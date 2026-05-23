import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/connection.js';
import { ProviderError } from '../providers/providerError.js';
import { getProvider, buildRunEnv, loadProviderConfig } from '../providers/registry.js';
import * as ProcessRun from './processRun.js';

type StartRunResult = { ok: true } | { ok: false; conflictKind: ProcessRun.RunKind };

function compactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function startRun(projectId: number, projectPath: string): StartRunResult {
  const projectRow = db.prepare('SELECT provider, model_variant FROM projects WHERE id = ?').get(projectId) as
    { provider: string | null; model_variant: string | null } | undefined;

  if (!projectRow?.provider) {
    throw new ProviderError('not-configured', 'project', 'Project has no provider assigned. Configure a provider first.');
  }

  let provider;
  try {
    provider = getProvider(projectRow.provider);
  } catch {
    throw new ProviderError('invalid-config', projectRow.provider, `Unknown provider: ${projectRow.provider}`);
  }

  const providerRow = db.prepare('SELECT config, is_configured FROM providers WHERE name = ?').get(projectRow.provider) as
    { config: string | null; is_configured: number } | undefined;

  if (!providerRow) {
    throw new ProviderError(
      'not-configured',
      projectRow.provider,
      `Provider '${projectRow.provider}' is not configured. Please add a token on the Models page first.`,
    );
  }

  if (!providerRow.is_configured) {
    throw new ProviderError(
      'not-configured',
      projectRow.provider,
      `Provider '${projectRow.provider}' is not configured. Please configure authentication on the Models page first.`,
    );
  }

  const scriptPath = path.join(projectPath, 'scripts', 'ralph', provider.runnerScript);

  if (!fs.existsSync(scriptPath)) {
    throw new ProviderError('artifact-missing', provider.name, `Script not found: ${scriptPath}. Try "Sync Files" first.`);
  }

  try {
    fs.accessSync(scriptPath, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(scriptPath, 0o755);
    } catch {
      throw new ProviderError('artifact-missing', provider.name, `Script is not executable and chmod failed: ${scriptPath}`);
    }
  }

  const providerConfig = loadProviderConfig(projectRow.provider);
  const modelVariant = projectRow.model_variant ?? undefined;
  const env = compactEnv(buildRunEnv(projectRow.provider, modelVariant, providerConfig));

  return ProcessRun.start(projectId, {
    kind: 'loop',
    command: 'bash',
    args: [scriptPath, ...provider.getCliArgs(providerConfig, modelVariant)],
    cwd: projectPath,
    env,
  });
}

export function stopRun(projectId: number): boolean {
  return ProcessRun.stop(projectId, 'loop');
}

export function getRunStatus(projectId: number): ProcessRun.RunStatus {
  return ProcessRun.status(projectId, 'loop');
}

export function getRunOutput(projectId: number, since = 0): { lines: string[]; total: number } {
  return ProcessRun.output(projectId, since, 'loop');
}
