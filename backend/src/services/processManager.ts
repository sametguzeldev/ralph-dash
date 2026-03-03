import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { getProvider, buildRunEnv, loadProviderConfig } from '../providers/registry.js';

interface RunInfo {
  process: ChildProcess;
  output: string[];
  totalLines: number;
  startedAt: Date;
  exitCode: number | null;
  finished: boolean;
  error: string | null;
}

const MAX_OUTPUT_LINES = 500;
const FINISHED_TTL_MS = 60_000; // keep finished run info for 60s so the frontend can read it
const runs = new Map<number, RunInfo>();

function scheduleCleanup(projectId: number, info: RunInfo): void {
  setTimeout(() => {
    const current = runs.get(projectId);
    if (current === info) runs.delete(projectId);
  }, FINISHED_TTL_MS);
}

export function startRun(projectId: number, projectPath: string): { ok: boolean; error?: string } {
  if (runs.has(projectId)) {
    const existing = runs.get(projectId)!;
    if (!existing.finished) return { ok: false, error: 'Run already in progress' };
    // Clear a stale finished run so we can start fresh
    runs.delete(projectId);
  }

  // Read project's assigned provider and model_variant from the projects table
  const projectRow = db.prepare('SELECT provider, model_variant FROM projects WHERE id = ?').get(projectId) as
    { provider: string | null; model_variant: string | null } | undefined;

  if (!projectRow?.provider) {
    console.error(`[processManager] Project ${projectId} has no provider assigned. Cannot start run.`);
    return { ok: false, error: 'Project has no provider assigned. Configure a provider first.' };
  }

  // Get provider instance from registry
  let provider;
  try {
    provider = getProvider(projectRow.provider);
  } catch {
    console.error(`[processManager] Unknown provider '${projectRow.provider}' for project ${projectId}`);
    return { ok: false, error: `Unknown provider: ${projectRow.provider}` };
  }

  // Get provider row from DB for config and is_configured
  const providerRow = db.prepare('SELECT config, is_configured FROM providers WHERE name = ?').get(projectRow.provider) as
    { config: string | null; is_configured: number } | undefined;

  // If no provider row exists, the provider has never been configured at all
  if (!providerRow) {
    console.error(`[processManager] Provider '${projectRow.provider}' has no DB row — not configured`);
    return { ok: false, error: `Provider '${projectRow.provider}' is not configured. Please add a token on the Models page first.` };
  }

  // Check if provider is configured (has a token) before starting a run
  if (!providerRow.is_configured) {
    console.error(`[processManager] Provider '${projectRow.provider}' is not configured (no token saved)`);
    return { ok: false, error: `Provider '${projectRow.provider}' is not configured. Please save an API token on the Models page first.` };
  }

  // Validate runner_script: must be a plain filename with no path traversal
  if (provider.runnerScript.includes('/') || provider.runnerScript.includes('\\') || provider.runnerScript.includes('..')) {
    console.error(`[processManager] Invalid runner_script '${provider.runnerScript}' for provider '${projectRow.provider}'`);
    return { ok: false, error: `Invalid runner script name: ${provider.runnerScript}` };
  }

  // Use provider's runner_script instead of hardcoded ralph-cc.sh
  const scriptPath = path.join(projectPath, 'scripts', 'ralph', provider.runnerScript);

  // Check the script exists before attempting to spawn
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Script not found: ${scriptPath}. Try "Sync Files" first.` };
  }

  // Ensure the script is executable
  try {
    fs.accessSync(scriptPath, fs.constants.X_OK);
  } catch {
    // Attempt to make it executable
    try {
      fs.chmodSync(scriptPath, 0o755);
    } catch {
      return { ok: false, error: `Script is not executable and chmod failed: ${scriptPath}` };
    }
  }

  // Fetch provider config once and pass to both buildRunEnv and getCliArgs
  const providerConfig = loadProviderConfig(projectRow.provider);
  const runEnv = buildRunEnv(projectRow.provider, projectRow.model_variant ?? undefined, providerConfig);
  const cliArgs = provider.getCliArgs(providerConfig, projectRow.model_variant ?? undefined);

  const child = spawn('bash', [scriptPath, ...cliArgs], {
    cwd: projectPath,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: runEnv,
  });

  const info: RunInfo = {
    process: child,
    output: [],
    totalLines: 0,
    startedAt: new Date(),
    exitCode: null,
    finished: false,
    error: null,
  };

  const appendOutput = (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line) {
        info.output.push(line);
        info.totalLines++;
        if (info.output.length > MAX_OUTPUT_LINES) {
          info.output.shift();
        }
      }
    }
  };

  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);

  child.on('close', (code) => {
    info.exitCode = code;
    info.finished = true;
    scheduleCleanup(projectId, info);
  });

  child.on('error', (err) => {
    info.error = err.message;
    info.finished = true;
    info.exitCode = -1;
    scheduleCleanup(projectId, info);
  });

  runs.set(projectId, info);
  return { ok: true };
}

export function stopRun(projectId: number): boolean {
  const info = runs.get(projectId);
  if (!info || info.finished) return false;

  try {
    // Kill the process group
    if (info.process.pid) {
      process.kill(-info.process.pid, 'SIGTERM');
    }
  } catch {
    // Process may already be dead
    info.process.kill('SIGTERM');
  }

  info.finished = true;
  info.exitCode = -1;
  scheduleCleanup(projectId, info);

  return true;
}

export function getRunStatus(projectId: number): {
  running: boolean;
  pid?: number;
  startedAt?: string;
  exitCode?: number | null;
  error?: string | null;
} {
  const info = runs.get(projectId);
  if (!info) return { running: false };
  return {
    running: !info.finished,
    pid: info.process.pid,
    startedAt: info.startedAt.toISOString(),
    exitCode: info.exitCode,
    error: info.error,
  };
}

export function getRunOutput(projectId: number, since = 0): { lines: string[]; total: number } {
  const info = runs.get(projectId);
  if (!info) return { lines: [], total: since };
  // Map the absolute `since` offset to a position within the rotating buffer.
  // bufferStart is the absolute index of the first item currently in the buffer.
  const bufferStart = info.totalLines - info.output.length;
  const bufferOffset = Math.max(0, since - bufferStart);
  return { lines: info.output.slice(bufferOffset), total: info.totalLines };
}
