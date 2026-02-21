import { spawn, ChildProcess } from 'child_process';
import path from 'path';

interface RunInfo {
  process: ChildProcess;
  output: string[];
  startedAt: Date;
}

const MAX_OUTPUT_LINES = 500;
const runs = new Map<number, RunInfo>();

export function startRun(projectId: number, projectPath: string): boolean {
  if (runs.has(projectId)) return false;

  const scriptPath = path.join(projectPath, 'scripts', 'ralph', 'ralph-cc.sh');
  const cwd = projectPath;

  const child = spawn('bash', [scriptPath], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const info: RunInfo = {
    process: child,
    output: [],
    startedAt: new Date(),
  };

  const appendOutput = (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line) {
        info.output.push(line);
        if (info.output.length > MAX_OUTPUT_LINES) {
          info.output.shift();
        }
      }
    }
  };

  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);

  child.on('close', () => {
    runs.delete(projectId);
  });

  child.on('error', () => {
    runs.delete(projectId);
  });

  runs.set(projectId, info);
  return true;
}

export function stopRun(projectId: number): boolean {
  const info = runs.get(projectId);
  if (!info) return false;

  try {
    // Kill the process group
    if (info.process.pid) {
      process.kill(-info.process.pid, 'SIGTERM');
    }
  } catch {
    // Process may already be dead
    info.process.kill('SIGTERM');
  }

  runs.delete(projectId);
  return true;
}

export function getRunStatus(projectId: number): { running: boolean; pid?: number; startedAt?: string } {
  const info = runs.get(projectId);
  if (!info) return { running: false };
  return {
    running: true,
    pid: info.process.pid,
    startedAt: info.startedAt.toISOString(),
  };
}

export function getRunOutput(projectId: number, since = 0): string[] {
  const info = runs.get(projectId);
  if (!info) return [];
  return info.output.slice(since);
}
