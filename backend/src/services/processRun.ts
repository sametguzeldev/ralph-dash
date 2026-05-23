import { spawn } from 'node:child_process';
import type { SkillName } from './skills/registry.js';

export type RunKind = 'loop' | 'skill';

export interface RunSpec {
  kind: RunKind;
  skillName?: SkillName;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  parseLine?: (raw: string) => string | null;
}

export interface RunStatus {
  running: boolean;
  kind?: RunKind;
  skillName?: SkillName;
  status?: 'running' | 'completed' | 'failed';
  pid?: number;
  startedAt?: string;
  exitCode?: number | null;
  error?: string | null;
}

export type StartResult = { ok: true } | { ok: false; conflictKind: RunKind };

interface SpawnOptions {
  cwd: string;
  detached: true;
  stdio: ['ignore', 'pipe', 'pipe'];
  env: NodeJS.ProcessEnv;
}

interface StreamLike {
  on(event: 'data', listener: (data: Buffer) => void): unknown;
}

interface ProcessLike {
  pid?: number;
  stdout?: StreamLike | null;
  stderr?: StreamLike | null;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}
type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ProcessLike;
type TerminateProcess = (child: ProcessLike) => void;

interface ActiveRun {
  child: ProcessLike;
  kind: RunKind;
  skillName?: SkillName;
  output: string[];
  totalLines: number;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed';
  exitCode: number | null;
  error: string | null;
  stdoutBuffer: string;
  stderrBuffer: string;
  parseLine: (raw: string) => string | null;
}

const MAX_OUTPUT_LINES = 500;

function defaultSpawnProcess(command: string, args: string[], options: SpawnOptions): ProcessLike {
  return spawn(command, args, options);
}

function defaultTerminateProcess(child: ProcessLike): void {
  try {
    if (child.pid) {
      process.kill(-child.pid, 'SIGTERM');
      return;
    }
  } catch {
    // Fall back to killing the child directly if process-group signaling fails.
  }

  child.kill('SIGTERM');
}

export class ProcessRun {
  private readonly runs = new Map<number, ActiveRun>();

  constructor(
    private readonly spawnProcess: SpawnProcess = defaultSpawnProcess,
    private readonly terminateProcess: TerminateProcess = defaultTerminateProcess,
  ) {}

  start(projectId: number, spec: RunSpec): StartResult {
    const existing = this.runs.get(projectId);
    if (existing?.status === 'running') {
      return { ok: false, conflictKind: existing.kind };
    }

    const child = this.spawnProcess(spec.command, spec.args, {
      cwd: spec.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spec.env,
    });

    const run: ActiveRun = {
      child,
      kind: spec.kind,
      skillName: spec.skillName,
      output: [],
      totalLines: 0,
      startedAt: new Date(),
      status: 'running',
      exitCode: null,
      error: null,
      stdoutBuffer: '',
      stderrBuffer: '',
      parseLine: spec.parseLine ?? ((raw) => raw),
    };

    child.stdout?.on('data', (data: Buffer) => {
      this.consumeChunk(run, 'stdoutBuffer', data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.consumeChunk(run, 'stderrBuffer', data.toString());
    });

    child.on('close', (code: number | null) => {
      if (this.runs.get(projectId) !== run || run.status !== 'running') return;

      this.flushBuffer(run, 'stdoutBuffer');
      this.flushBuffer(run, 'stderrBuffer');
      run.status = code === 0 ? 'completed' : 'failed';
      run.exitCode = code;
    });

    child.on('error', (error: Error) => {
      if (this.runs.get(projectId) !== run || run.status !== 'running') return;

      this.flushBuffer(run, 'stdoutBuffer');
      this.flushBuffer(run, 'stderrBuffer');
      run.status = 'failed';
      run.exitCode = -1;
      run.error = error.message;
    });

    this.runs.set(projectId, run);
    return { ok: true };
  }

  status(projectId: number, filterKind?: RunKind): RunStatus {
    const run = this.runs.get(projectId);
    if (!run || (filterKind && run.kind !== filterKind)) {
      return { running: false };
    }

    return {
      running: run.status === 'running',
      kind: run.kind,
      skillName: run.skillName,
      status: run.status,
      pid: run.child.pid,
      startedAt: run.startedAt.toISOString(),
      exitCode: run.exitCode,
      error: run.error,
    };
  }

  output(projectId: number, since = 0, filterKind?: RunKind): { lines: string[]; total: number } {
    const run = this.runs.get(projectId);
    if (!run || (filterKind && run.kind !== filterKind)) {
      return { lines: [], total: since };
    }

    const bufferStart = run.totalLines - run.output.length;
    const bufferOffset = Math.max(0, since - bufferStart);
    return { lines: run.output.slice(bufferOffset), total: run.totalLines };
  }

  stop(projectId: number, filterKind?: RunKind): boolean {
    const run = this.runs.get(projectId);
    if (!run || run.status !== 'running' || (filterKind && run.kind !== filterKind)) {
      return false;
    }

    this.terminateProcess(run.child);
    run.status = 'failed';
    run.exitCode = -1;
    return true;
  }

  private consumeChunk(run: ActiveRun, bufferKey: 'stdoutBuffer' | 'stderrBuffer', chunk: string): void {
    run[bufferKey] += chunk;
    const lines = run[bufferKey].split('\n');
    run[bufferKey] = lines.pop() ?? '';

    for (const line of lines) {
      this.appendParsedLine(run, line);
    }
  }

  private flushBuffer(run: ActiveRun, bufferKey: 'stdoutBuffer' | 'stderrBuffer'): void {
    const remaining = run[bufferKey];
    run[bufferKey] = '';
    if (remaining) {
      this.appendParsedLine(run, remaining);
    }
  }

  private appendParsedLine(run: ActiveRun, raw: string): void {
    const parsed = run.parseLine(raw);
    if (parsed === null || parsed === '') return;

    for (const line of parsed.split('\n')) {
      if (!line) continue;

      run.output.push(line);
      run.totalLines++;
      if (run.output.length > MAX_OUTPUT_LINES) {
        run.output.shift();
      }
    }
  }
}

export function createProcessRun(
  spawnProcess: SpawnProcess = defaultSpawnProcess,
  terminateProcess: TerminateProcess = defaultTerminateProcess,
): ProcessRun {
  return new ProcessRun(spawnProcess, terminateProcess);
}

const defaultProcessRun = createProcessRun();

export const start = defaultProcessRun.start.bind(defaultProcessRun);
export const status = defaultProcessRun.status.bind(defaultProcessRun);
export const output = defaultProcessRun.output.bind(defaultProcessRun);
export const stop = defaultProcessRun.stop.bind(defaultProcessRun);
