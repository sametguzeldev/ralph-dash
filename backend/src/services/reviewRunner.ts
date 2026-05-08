import { spawn, ChildProcess } from 'child_process';
import { db } from '../db/connection.js';
import { getProvider, buildRunEnv, loadProviderConfig } from '../providers/registry.js';

interface ReviewRun {
  process: ChildProcess;
  output: string[];
  totalLines: number;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed';
  exitCode: number | null;
  stoppedByUser: boolean;
}

const MAX_OUTPUT_LINES = 500;

const reviewRuns = new Map<number, ReviewRun>();

export function startReview(
  projectId: number,
  baseBranch: string,
): { ok: boolean; error?: string } {
  if (reviewRuns.has(projectId)) {
    const existing = reviewRuns.get(projectId)!;
    if (existing.status === 'running') return { ok: false, error: 'Review already in progress' };
    reviewRuns.delete(projectId);
  }

  const projectRow = db.prepare('SELECT path, review_provider, review_model_variant FROM projects WHERE id = ?').get(projectId) as
    { path: string; review_provider: string | null; review_model_variant: string | null } | undefined;

  if (!projectRow) {
    return { ok: false, error: 'Project not found' };
  }

  if (!projectRow.review_provider) {
    return { ok: false, error: 'No review provider configured for this project' };
  }

  let provider;
  try {
    provider = getProvider(projectRow.review_provider);
  } catch {
    return { ok: false, error: `Unknown provider: ${projectRow.review_provider}` };
  }

  const providerRow = db.prepare('SELECT config, is_configured FROM providers WHERE name = ?').get(projectRow.review_provider) as
    { config: string | null; is_configured: number } | undefined;

  if (!providerRow || !providerRow.is_configured) {
    return { ok: false, error: `Provider '${projectRow.review_provider}' is not configured. Please configure authentication on the Models page first.` };
  }

  const providerConfig = loadProviderConfig(projectRow.review_provider);
  const runEnv = buildRunEnv(projectRow.review_provider, projectRow.review_model_variant ?? undefined, providerConfig);

  let command: string;
  let args: string[];

  if (provider.name === 'claude') {
    const prompt = `/review --base-branch ${baseBranch}`;
    args = [
      '-p', prompt,
      '--print',
      '--dangerously-skip-permissions',
      '--verbose',
      ...provider.getCliArgs(providerConfig, projectRow.review_model_variant ?? undefined),
    ];
    command = 'claude';
  } else if (provider.name === 'codex') {
    args = ['exec', 'review', '--base', baseBranch];
    command = 'codex';
  } else {
    return { ok: false, error: `Review is not supported for provider '${provider.name}'` };
  }

  const child = spawn(command, args, {
    cwd: projectRow.path,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: runEnv,
  });

  const info: ReviewRun = {
    process: child,
    output: [],
    totalLines: 0,
    startedAt: new Date(),
    status: 'running',
    exitCode: null,
    stoppedByUser: false,
  };

  const appendLine = (line: string) => {
    info.output.push(line);
    info.totalLines++;
    if (info.output.length > MAX_OUTPUT_LINES) {
      info.output.shift();
    }
  };

  const appendData = (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line) appendLine(line);
    }
  };

  child.stdout?.on('data', appendData);
  child.stderr?.on('data', appendData);

  child.on('close', (code) => {
    const current = reviewRuns.get(projectId);
    if (current && current.process === child && !current.stoppedByUser) {
      current.status = code === 0 ? 'completed' : 'failed';
      current.exitCode = code;
    }
  });

  child.on('error', () => {
    const current = reviewRuns.get(projectId);
    if (current && current.process === child) {
      current.status = 'failed';
      current.exitCode = -1;
    }
  });

  reviewRuns.set(projectId, info);
  return { ok: true };
}

export function stopReview(projectId: number): boolean {
  const info = reviewRuns.get(projectId);
  if (!info || info.status !== 'running') return false;

  try {
    if (info.process.pid) {
      process.kill(-info.process.pid, 'SIGTERM');
    }
  } catch {
    info.process.kill('SIGTERM');
  }

  info.stoppedByUser = true;
  info.status = 'failed';
  info.exitCode = -1;
  return true;
}

export function getStatus(projectId: number): {
  running: boolean;
  status: 'running' | 'completed' | 'failed' | null;
  startedAt?: string;
  exitCode: number | null;
} {
  const info = reviewRuns.get(projectId);
  if (!info) return { running: false, status: null, exitCode: null };
  return {
    running: info.status === 'running',
    status: info.status,
    startedAt: info.startedAt.toISOString(),
    exitCode: info.exitCode,
  };
}

export function getOutput(projectId: number, since = 0): { lines: string[]; total: number } {
  const info = reviewRuns.get(projectId);
  if (!info) return { lines: [], total: since };
  const bufferStart = info.totalLines - info.output.length;
  const bufferOffset = Math.max(0, since - bufferStart);
  return { lines: info.output.slice(bufferOffset), total: info.totalLines };
}

export function getFullOutputText(projectId: number): string | null {
  const info = reviewRuns.get(projectId);
  if (!info) return null;
  return info.output.join('\n');
}
