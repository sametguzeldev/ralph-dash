import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createProcessRun, type RunSpec } from './processRun.js';

class FakeStream extends EventEmitter {
  write(chunk: string): void {
    this.emit('data', Buffer.from(chunk));
  }
}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killedWith: NodeJS.Signals | undefined;

  constructor(readonly pid: number) {
    super();
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }

  close(code: number | null): void {
    this.emit('close', code);
  }
}

function makeHarness() {
  const children: FakeChildProcess[] = [];
  const processRun = createProcessRun((command, args, options) => {
    const child = new FakeChildProcess(1000 + children.length);
    children.push(child);
    expect(command).toBe('cmd');
    expect(args).toEqual(['--flag']);
    expect(options.cwd).toBe('/tmp/project');
    expect(options.env).toMatchObject({ TEST_ENV: '1' });
    return child;
  });

  const spec: RunSpec = {
    kind: 'loop',
    command: 'cmd',
    args: ['--flag'],
    cwd: '/tmp/project',
    env: { TEST_ENV: '1' },
  };

  return { children, processRun, spec };
}

describe('ProcessRun', () => {
  it('starts, reports status and output, and stops with SIGTERM', () => {
    const { children, processRun, spec } = makeHarness();

    expect(processRun.start(1, spec)).toEqual({ ok: true });
    children[0].stdout.write('first\n');
    children[0].stderr.write('second\n');

    expect(processRun.status(1)).toMatchObject({
      running: true,
      kind: 'loop',
      pid: 1000,
      exitCode: null,
      error: null,
    });
    expect(processRun.output(1, 0)).toEqual({ lines: ['first', 'second'], total: 2 });

    expect(processRun.stop(1)).toBe(true);
    expect(children[0].killedWith).toBe('SIGTERM');
    expect(processRun.status(1)).toMatchObject({
      running: false,
      kind: 'loop',
      status: 'failed',
      exitCode: -1,
    });
  });

  it('buffers partial lines across chunks and flushes remaining data on close', () => {
    const { children, processRun, spec } = makeHarness();

    processRun.start(1, spec);
    children[0].stdout.write('hel');
    children[0].stdout.write('lo\nwor');
    children[0].stderr.write('err');
    children[0].stderr.write('or\n');
    children[0].close(0);

    expect(processRun.output(1, 0)).toEqual({
      lines: ['hello', 'error', 'wor'],
      total: 3,
    });
    expect(processRun.status(1)).toMatchObject({
      running: false,
      status: 'completed',
      exitCode: 0,
    });
  });

  it('keeps a 500-line rotating buffer while preserving the absolute total', () => {
    const { children, processRun, spec } = makeHarness();

    processRun.start(1, spec);
    for (let i = 1; i <= 505; i++) {
      children[0].stdout.write(`line-${i}\n`);
    }

    const all = processRun.output(1, 0);
    expect(all.total).toBe(505);
    expect(all.lines).toHaveLength(500);
    expect(all.lines[0]).toBe('line-6');
    expect(all.lines.at(-1)).toBe('line-505');
    expect(processRun.output(1, 503)).toEqual({ lines: ['line-504', 'line-505'], total: 505 });
  });

  it('applies parseLine and suppresses null results', () => {
    const { children, processRun, spec } = makeHarness();

    processRun.start(1, {
      ...spec,
      parseLine: (raw) => (raw.startsWith('skip') ? null : raw.toUpperCase()),
    });
    children[0].stdout.write('keep\nskip this\nalso keep\n');

    expect(processRun.output(1, 0)).toEqual({
      lines: ['KEEP', 'ALSO KEEP'],
      total: 2,
    });
  });

  it('rejects a second active run with the active run kind as conflictKind', () => {
    const { processRun, spec } = makeHarness();

    expect(processRun.start(1, { ...spec, kind: 'skill', skillName: 'prd' })).toEqual({ ok: true });
    expect(processRun.start(1, spec)).toEqual({ ok: false, conflictKind: 'skill' });
  });

  it('hides mismatched kinds behind filterKind', () => {
    const { processRun, spec } = makeHarness();

    processRun.start(1, { ...spec, kind: 'skill', skillName: 'ralph' });

    expect(processRun.status(1, 'loop')).toEqual({ running: false });
    expect(processRun.output(1, 7, 'loop')).toEqual({ lines: [], total: 7 });
    expect(processRun.stop(1, 'loop')).toBe(false);
  });

  it('persists a finished run until the next start replaces it', () => {
    const { children, processRun, spec } = makeHarness();

    processRun.start(1, spec);
    children[0].stdout.write('old\n');
    children[0].close(0);

    expect(processRun.status(1)).toMatchObject({ running: false, status: 'completed' });
    expect(processRun.output(1, 0)).toEqual({ lines: ['old'], total: 1 });

    expect(processRun.start(1, { ...spec, kind: 'skill', skillName: 'prd-questions' })).toEqual({ ok: true });
    expect(processRun.status(1)).toMatchObject({ running: true, kind: 'skill', skillName: 'prd-questions' });
    expect(processRun.output(1, 0)).toEqual({ lines: [], total: 0 });
  });
});
