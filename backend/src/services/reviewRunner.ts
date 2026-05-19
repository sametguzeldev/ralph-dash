import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { getProvider, buildRunEnv, loadProviderConfig, resolveReviewProvider } from '../providers/registry.js';

interface ReviewRun {
  process?: ChildProcess;
  output: string[];
  fullOutput: string[];
  totalLines: number;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed';
  exitCode: number | null;
  stoppedByUser: boolean;
}

const MAX_OUTPUT_LINES = 500;
const FINISHED_TTL_MS = 60_000;

const reviewRuns = new Map<number, ReviewRun>();

function scheduleCleanup(projectId: number, info: ReviewRun): void {
  setTimeout(() => {
    const current = reviewRuns.get(projectId);
    if (current === info) reviewRuns.delete(projectId);
  }, FINISHED_TTL_MS);
}

function saveReviewOutput(projectPath: string, output: string[]): void {
  try {
    const dir = path.join(projectPath, 'scripts', 'ralph');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'review-output.md'), output.join('\n'), 'utf-8');
  } catch {
    // non-fatal — output stays in memory
  }
}

function parseStreamJsonLine(raw: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim() || null;
  }

  const type = parsed.type as string | undefined;

  if (type === 'system' && parsed.subtype === 'init') return '⏳ Claude session started...';

  if (type === 'assistant' && parsed.message) {
    const content = (parsed.message as Record<string, unknown>).content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim();
        if (text) parts.push(text);
      } else if (block.type === 'tool_use') {
        const name = block.name as string;
        const input = block.input as Record<string, unknown> | undefined;
        if (name === 'Bash' && input?.command) parts.push(`💻 Running: ${String(input.command).slice(0, 80)}`);
        else if (name === 'Read' && input?.file_path) parts.push(`📖 Reading ${input.file_path}`);
        else parts.push(`🔧 Using ${name}`);
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  if (type === 'result') {
    const result = parsed.result as string | undefined;
    if (result) return result;
    if (parsed.subtype === 'success') return '✅ Review completed';
    if (parsed.subtype === 'error') return `❌ Error: ${(parsed.error as string) ?? 'unknown error'}`;
  }

  return null;
}

export type StartReviewFailReason = 'not-found' | 'no-provider' | 'already-running' | 'unknown-provider';

export type StartReviewResult =
  | { ok: true }
  | { ok: false; reason: StartReviewFailReason; error: string };

export function startReview(
  projectId: number,
  baseBranch: string,
): StartReviewResult {
  if (reviewRuns.has(projectId)) {
    const existing = reviewRuns.get(projectId)!;
    if (existing.status === 'running') return { ok: false, reason: 'already-running', error: 'Review already in progress' };
    reviewRuns.delete(projectId);
  }

  const projectRow = db.prepare(
    'SELECT path, provider, model_variant, review_provider, review_model_variant FROM projects WHERE id = ?'
  ).get(projectId) as
    {
      path: string;
      provider: string | null;
      model_variant: string | null;
      review_provider: string | null;
      review_model_variant: string | null;
    } | undefined;

  if (!projectRow) return { ok: false, reason: 'not-found', error: 'Project not found' };

  const { providerName, modelVariant } = resolveReviewProvider(projectRow);

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return { ok: false, reason: 'unknown-provider', error: `Unknown provider: ${providerName}` };
  }

  const providerRow = db.prepare('SELECT config, is_configured FROM providers WHERE name = ?').get(providerName) as
    { config: string | null; is_configured: number } | undefined;

  if (!providerRow || !providerRow.is_configured) {
    return { ok: false, reason: 'no-provider', error: `Provider '${providerName}' is not configured. Please configure authentication on the Models page first.` };
  }

  const info: ReviewRun = {
    output: [],
    fullOutput: [],
    totalLines: 0,
    startedAt: new Date(),
    status: 'running',
    exitCode: null,
    stoppedByUser: false,
  };

  reviewRuns.set(projectId, info);

  if (provider.name === 'claude') {
    const providerConfig = loadProviderConfig(providerName);
    const runEnv = buildRunEnv(providerName, modelVariant, providerConfig);
    const cliArgs = [
      '-p',
      `Do a PR-style code review comparing this branch against ${baseBranch}. Thoroughly check for bugs, logic errors, code quality issues, missing error handling, and naming inconsistencies. Be specific about file names and line numbers. End with a summary listing Required Fixes (must fix before merging) vs Nice-to-haves (optional improvements).`,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      ...provider.getCliArgs(providerConfig, modelVariant),
    ];

    const child = spawn('claude', cliArgs, {
      cwd: projectRow.path,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: runEnv,
    });

    info.process = child;

    const appendLine = (line: string) => {
      info.output.push(line);
      info.fullOutput.push(line);
      info.totalLines++;
      if (info.output.length > MAX_OUTPUT_LINES) info.output.shift();
    };

    let stdoutBuf = '';
    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const raw of lines) {
        const parsed = parseStreamJsonLine(raw);
        if (parsed) {
          for (const part of parsed.split('\n')) {
            if (part.trim()) appendLine(part);
          }
        }
      }
    });

    let stderrBuf = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) appendLine(line);
      }
    });

    child.on('close', (code) => {
      if (stdoutBuf.trim()) {
        const parsed = parseStreamJsonLine(stdoutBuf.trim());
        if (parsed) for (const part of parsed.split('\n')) { if (part.trim()) appendLine(part); }
      }
      if (stderrBuf.trim()) appendLine(stderrBuf.trim());
      const current = reviewRuns.get(projectId);
      if (current && current.process === child && !current.stoppedByUser) {
        current.status = code === 0 ? 'completed' : 'failed';
        current.exitCode = code;
        saveReviewOutput(projectRow.path, current.fullOutput);
      }
      if (current && current.process === child) {
        scheduleCleanup(projectId, current);
      }
    });

    child.on('error', () => {
      const current = reviewRuns.get(projectId);
      if (current && current.process === child) {
        current.status = 'failed';
        current.exitCode = -1;
        scheduleCleanup(projectId, current);
      }
    });
  } else if (provider.name === 'codex') {
    const providerConfig = loadProviderConfig(providerName);
    const runEnv = buildRunEnv(providerName, modelVariant, providerConfig);

    const child = spawn('codex', ['exec', 'review', '--base', baseBranch], {
      cwd: projectRow.path,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: runEnv,
    });

    info.process = child;

    const appendLine = (line: string) => {
      info.output.push(line);
      info.fullOutput.push(line);
      info.totalLines++;
      if (info.output.length > MAX_OUTPUT_LINES) info.output.shift();
    };

    const appendData = (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
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
        saveReviewOutput(projectRow.path, current.fullOutput);
      }
      if (current && current.process === child) {
        scheduleCleanup(projectId, current);
      }
    });

    child.on('error', () => {
      const current = reviewRuns.get(projectId);
      if (current && current.process === child) {
        current.status = 'failed';
        current.exitCode = -1;
        scheduleCleanup(projectId, current);
      }
    });
  } else {
    reviewRuns.delete(projectId);
    return { ok: false, reason: 'unknown-provider', error: `Review is not supported for provider '${provider.name}'` };
  }

  return { ok: true };
}

export function stopReview(projectId: number): boolean {
  const info = reviewRuns.get(projectId);
  if (!info || info.status !== 'running') return false;

  info.stoppedByUser = true;
  info.status = 'failed';
  info.exitCode = -1;

  if (info.process) {
    try {
      if (info.process.pid) process.kill(-info.process.pid, 'SIGTERM');
    } catch {
      info.process.kill('SIGTERM');
    }
  }

  scheduleCleanup(projectId, info);

  return true;
}

export function isReviewActive(projectId: number): boolean {
  const info = reviewRuns.get(projectId);
  return !!info && info.status === 'running';
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
  return info.fullOutput.join('\n');
}
