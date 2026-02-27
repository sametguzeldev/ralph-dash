import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';

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

  const scriptPath = path.join(projectPath, 'scripts', 'ralph', 'ralph-cc.sh');

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

  const cwd = projectPath;

  // Build env: inject Claude auth token from DB (same as skillRunner)
  const runEnv = { ...process.env };
  delete runEnv.CLAUDECODE;
  if (!runEnv.ANTHROPIC_API_KEY && !runEnv.CLAUDE_CODE_OAUTH_TOKEN) {
    const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeToken') as { value: string } | undefined;
    if (tokenRow?.value) {
      if (tokenRow.value.startsWith('sk-ant-oat')) {
        runEnv.CLAUDE_CODE_OAUTH_TOKEN = tokenRow.value;
      } else if (tokenRow.value.startsWith('sk-ant-api')) {
        runEnv.ANTHROPIC_API_KEY = tokenRow.value;
      }
    }
  }

  // Inject git identity from DB if not already set in the environment
  const nameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserName') as { value: string } | undefined;
  const emailRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserEmail') as { value: string } | undefined;
  if (nameRow?.value && emailRow?.value) {
    if (!runEnv.GIT_AUTHOR_NAME) runEnv.GIT_AUTHOR_NAME = nameRow.value;
    if (!runEnv.GIT_AUTHOR_EMAIL) runEnv.GIT_AUTHOR_EMAIL = emailRow.value;
    if (!runEnv.GIT_COMMITTER_NAME) runEnv.GIT_COMMITTER_NAME = nameRow.value;
    if (!runEnv.GIT_COMMITTER_EMAIL) runEnv.GIT_COMMITTER_EMAIL = emailRow.value;
  }

  // Inject Claude model preference from DB as fallback only when ANTHROPIC_MODEL is not already set
  const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeModel') as { value: string } | undefined;
  if (modelRow?.value && !runEnv.ANTHROPIC_MODEL) {
    runEnv.ANTHROPIC_MODEL = modelRow.value;
  }

  // Inject auto-memory disable flag when disabled in settings (guard: only if not already set)
  const autoMemoryRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('autoMemoryEnabled') as { value: string } | undefined;
  const autoMemoryEnabled = autoMemoryRow ? autoMemoryRow.value === 'true' : true;
  if (!autoMemoryEnabled && !runEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY) {
    runEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  }

  const child = spawn('bash', [scriptPath], {
    cwd,
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
