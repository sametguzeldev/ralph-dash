import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../providers/types.js';
import { ProviderError } from '../providers/providerError.js';
import type { RunSpec } from './processRun.js';

const mocks = vi.hoisted(() => {
  const state: {
    projectRow: { provider: string | null; model_variant: string | null } | undefined;
    providerRow: { config: string | null; is_configured: number } | undefined;
  } = {
    projectRow: { provider: 'codex', model_variant: 'gpt-5.5' },
    providerRow: { config: '{}', is_configured: 1 },
  };

  const provider = {
    name: 'codex',
    runnerScript: 'ralph-codex.sh',
    getCliArgs: vi.fn((_config: ProviderConfig, modelVariant?: string) => ['--model', modelVariant ?? 'default']),
  };

  return {
    state,
    provider,
    buildRunEnv: vi.fn(() => ({ CODEX_MODEL: 'gpt-5.5', UNSET_VALUE: undefined })),
    loadProviderConfig: vi.fn(() => ({ token: 'token', tokenType: 'api-key', model: 'gpt-5.5', autoMemoryEnabled: false })),
    start: vi.fn(() => ({ ok: true as const })),
    status: vi.fn(() => ({ running: true, kind: 'loop' as const, status: 'running' as const, pid: 123 })),
    output: vi.fn(() => ({ lines: ['line'], total: 1 })),
    stop: vi.fn(() => true),
  };
});

vi.mock('../db/connection.js', () => ({
  db: {
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes('FROM projects')) return mocks.state.projectRow;
        if (sql.includes('FROM providers')) return mocks.state.providerRow;
        throw new Error(`Unexpected query: ${sql}`);
      },
    }),
  },
}));

vi.mock('../providers/registry.js', () => ({
  getProvider: vi.fn((name: string) => {
    if (name !== mocks.provider.name) throw new Error(`Unknown provider: ${name}`);
    return mocks.provider;
  }),
  buildRunEnv: mocks.buildRunEnv,
  loadProviderConfig: mocks.loadProviderConfig,
}));

vi.mock('./processRun.js', () => ({
  start: mocks.start,
  status: mocks.status,
  output: mocks.output,
  stop: mocks.stop,
}));

describe('processManager', () => {
  let projectPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.projectRow = { provider: 'codex', model_variant: 'gpt-5.5' };
    mocks.state.providerRow = { config: '{}', is_configured: 1 };
    mocks.provider.runnerScript = 'ralph-codex.sh';

    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'process-manager-'));
    const scriptDir = path.join(projectPath, 'scripts', 'ralph');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, 'ralph-codex.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(scriptDir, 'ralph-codex.sh'), 0o755);
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('builds a loop RunSpec and delegates start to ProcessRun', async () => {
    const { startRun } = await import('./processManager.js');

    expect(startRun(7, projectPath)).toEqual({ ok: true });

    const scriptPath = path.join(projectPath, 'scripts', 'ralph', 'ralph-codex.sh');
    expect(mocks.start).toHaveBeenCalledWith(7, {
      kind: 'loop',
      command: 'bash',
      args: [scriptPath, '--model', 'gpt-5.5'],
      cwd: projectPath,
      env: { CODEX_MODEL: 'gpt-5.5' },
    } satisfies RunSpec);
  });

  it('returns ProcessRun loop conflicts with conflictKind', async () => {
    const { startRun } = await import('./processManager.js');
    mocks.start.mockReturnValueOnce({ ok: false, conflictKind: 'loop' });

    expect(startRun(7, projectPath)).toEqual({ ok: false, conflictKind: 'loop' });
  });

  it('scopes status, output, and stop to loop runs', async () => {
    const { getRunStatus, getRunOutput, stopRun } = await import('./processManager.js');

    expect(getRunStatus(7)).toEqual({ running: true, kind: 'loop', status: 'running', pid: 123 });
    expect(getRunOutput(7, 2)).toEqual({ lines: ['line'], total: 1 });
    expect(stopRun(7)).toBe(true);

    expect(mocks.status).toHaveBeenCalledWith(7, 'loop');
    expect(mocks.output).toHaveBeenCalledWith(7, 2, 'loop');
    expect(mocks.stop).toHaveBeenCalledWith(7, 'loop');
  });

  it('throws ProviderError when the provider has not been configured', async () => {
    const { startRun } = await import('./processManager.js');
    mocks.state.providerRow = { config: '{}', is_configured: 0 };

    expect(() => startRun(7, projectPath)).toThrow(ProviderError);
    expect(() => startRun(7, projectPath)).toThrow(/not configured/);
  });

  it('throws ProviderError when the runner script is missing', async () => {
    const { startRun } = await import('./processManager.js');
    fs.rmSync(path.join(projectPath, 'scripts', 'ralph', 'ralph-codex.sh'));

    expect(() => startRun(7, projectPath)).toThrow(ProviderError);
    expect(() => startRun(7, projectPath)).toThrow(/Script not found/);
  });
});
