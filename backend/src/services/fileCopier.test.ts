import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: new Map<string, string>([
    ['selectedProviders', JSON.stringify(['codex'])],
    ['selectedSkills', JSON.stringify(['prd'])],
  ]),
  provider: {
    name: 'codex',
    syncManifest: vi.fn(),
  },
}));

vi.mock('../db/connection.js', () => ({
  db: {
    prepare: () => ({
      get: (key: string) => {
        const value = mocks.settings.get(key);
        return value === undefined ? undefined : { value };
      },
    }),
  },
}));

vi.mock('../providers/registry.js', () => ({
  DEFAULT_PROVIDER: 'claude',
  getProvider: vi.fn(() => mocks.provider),
}));

describe('copyRalphFiles', () => {
  let ralphPath: string;
  let projectRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    ralphPath = fs.mkdtempSync(path.join(os.tmpdir(), 'file-copier-ralph-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'file-copier-project-'));

    const sourceFile = path.join(ralphPath, 'scripts', 'ralph', 'AGENTS.md');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, 'agent instructions');

    mocks.provider.syncManifest.mockReturnValue([
      {
        sourcePath: sourceFile,
        destRelative: 'AGENTS.md',
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(ralphPath, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('copies provider syncManifest entries without provider-specific path logic', async () => {
    const { copyRalphFiles } = await import('./fileCopier.js');

    copyRalphFiles(ralphPath, projectRoot, 'codex');

    expect(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf-8')).toBe('agent instructions');
    expect(mocks.provider.syncManifest).toHaveBeenCalledOnce();
  });
});
