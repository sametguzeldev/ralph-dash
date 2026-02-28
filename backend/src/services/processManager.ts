import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { getProvider } from '../providers/registry.js';

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

  // Get provider row from DB for runner_script, config, and is_configured
  const providerRow = db.prepare('SELECT runner_script, config, is_configured FROM providers WHERE name = ?').get(projectRow.provider) as
    { runner_script: string | null; config: string | null; is_configured: number } | undefined;

  if (!providerRow?.runner_script) {
    console.error(`[processManager] Provider '${projectRow.provider}' has no runner_script configured`);
    return { ok: false, error: `Provider '${projectRow.provider}' has no runner script configured.` };
  }

  // Check if provider is configured (has a token) before starting a run
  if (!providerRow.is_configured) {
    console.error(`[processManager] Provider '${projectRow.provider}' is not configured (no token)`);
    return { ok: false, error: `Provider '${projectRow.provider}' is not configured. Please add a token first.` };
  }

  // Validate runner_script: must be a plain filename with no path traversal
  if (providerRow.runner_script.includes('/') || providerRow.runner_script.includes('\\') || providerRow.runner_script.includes('..')) {
    console.error(`[processManager] Invalid runner_script '${providerRow.runner_script}' for provider '${projectRow.provider}'`);
    return { ok: false, error: `Invalid runner script name: ${providerRow.runner_script}` };
  }

  // Build provider config from DB
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = providerRow.config ? JSON.parse(providerRow.config) as Record<string, unknown> : {};
  } catch {
    console.error(`[processManager] Failed to parse provider config for '${projectRow.provider}', using defaults`);
  }
  const providerConfig = provider.parseConfig(rawConfig);

  // Use provider's runner_script instead of hardcoded ralph-cc.sh
  const scriptPath = path.join(projectPath, 'scripts', 'ralph', providerRow.runner_script);

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

  // Build env: start with process env and remove CLAUDECODE
  const runEnv = { ...process.env };
  delete runEnv.CLAUDECODE;

  // Use provider abstraction to get env vars (replaces hardcoded Claude-specific logic)
  const providerEnvVars = provider.getEnvVars(providerConfig, projectRow.model_variant ?? undefined);
  for (const [key, value] of Object.entries(providerEnvVars)) {
    // Guard: only inject if not already set in process env
    if (!runEnv[key]) {
      runEnv[key] = value;
    }
  }

  // Inject git identity from DB if not already set in the environment (not provider-specific)
  const nameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserName') as { value: string } | undefined;
  const emailRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserEmail') as { value: string } | undefined;
  if (nameRow?.value && emailRow?.value) {
    if (!runEnv.GIT_AUTHOR_NAME) runEnv.GIT_AUTHOR_NAME = nameRow.value;
    if (!runEnv.GIT_AUTHOR_EMAIL) runEnv.GIT_AUTHOR_EMAIL = emailRow.value;
    if (!runEnv.GIT_COMMITTER_NAME) runEnv.GIT_COMMITTER_NAME = nameRow.value;
    if (!runEnv.GIT_COMMITTER_EMAIL) runEnv.GIT_COMMITTER_EMAIL = emailRow.value;
  }

  // Get CLI args from provider for injection into the spawned script
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
