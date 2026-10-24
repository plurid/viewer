import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalWorkerRequest } from '../src/desktop/terminals/terminal-protocol';

const fake = vi.hoisted(() => ({
  receive: undefined as ((event: { data: unknown }) => void) | undefined,
  postMessage: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('../src/desktop/workers/worker-port', () => ({
  workerPort: {
    postMessage: fake.postMessage,
    on: (_type: string, receive: typeof fake.receive) => {
      fake.receive = receive;
    },
  },
}));
vi.mock('node-pty', () => ({ spawn: fake.spawn }));
import '../src/desktop/terminals/terminal-worker';

const processes: ReturnType<typeof processStub>[] = [];
let nextID = 0;

function processStub() {
  const callbacks = {
    data: undefined as ((data: string) => void) | undefined,
    exit: undefined as ((event: { exitCode: number }) => void) | undefined,
  };
  return {
    pid: 9900000 + nextID,
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    onData: (callback: typeof callbacks.data) => {
      callbacks.data = callback;
    },
    onExit: (callback: typeof callbacks.exit) => {
      callbacks.exit = callback;
    },
    data: (value: string) => callbacks.data?.(value),
    exit: () => callbacks.exit?.({ exitCode: 0 }),
  };
}
function send(request: TerminalWorkerRequest) {
  fake.receive?.({ data: request });
}
function start(options: { readOnly?: boolean; outputLimit?: number; timeoutMs?: number } = {}) {
  const id = `git-worker-${++nextID}`;
  send({
    kind: 'start',
    id,
    workspaceID: 'workspace',
    rootID: 'folder',
    cwd: '/fixture',
    profileID: '@viewer-git',
    executable: '/usr/bin/git',
    args: ['--no-pager', 'status'],
    env: {},
    cols: 80,
    rows: 24,
    ...options,
  });
  const process = processes.at(-1);
  if (!process) throw new Error('Expected a mocked PTY.');
  return { id, process };
}
beforeEach(() => {
  vi.useFakeTimers();
  fake.postMessage.mockClear();
  fake.spawn.mockImplementation(() => {
    const process = processStub();
    processes.push(process);
    return process;
  });
});
afterEach(() => {
  for (const process of processes.splice(0)) process.exit();
  vi.useRealTimers();
});

describe('private Git PTY worker limits', () => {
  it('bounds output before renderer acknowledgement and drains only the accepted text', () => {
    const { id, process } = start({ outputLimit: 8, readOnly: true });
    process.data('1234');
    process.data('56789');
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'data', id, data: '12345678' });
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        id,
        message: expect.stringContaining('size limit'),
      }),
    );
    expect(process.kill).toHaveBeenCalledOnce();
    process.data('must not stream after cancellation');
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it('enforces the deadline even while a PTY is paused for renderer backpressure', () => {
    const { id, process } = start({ outputLimit: 1024 * 1024, timeoutMs: 100 });
    process.data('x'.repeat(512 * 1024));
    expect(process.pause).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(process.resume).toHaveBeenCalled();
    expect(process.kill).toHaveBeenCalledOnce();
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        id,
        message: expect.stringContaining('time limit'),
      }),
    );
  });

  it('rejects read-only writes at the worker boundary as well as in main', () => {
    const { id, process } = start({ readOnly: true });
    send({ kind: 'write', id, data: '!sh\n' });
    expect(process.write).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        id,
        message: expect.stringContaining('does not accept'),
      }),
    );
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it('permits human auth input for mutations and clears the deadline on exit', () => {
    const { id, process } = start({ timeoutMs: 100 });
    send({ kind: 'write', id, data: 'human response\r' });
    expect(process.write).toHaveBeenCalledWith('human response\r');
    process.exit();
    vi.advanceTimersByTime(200);
    expect(process.kill).not.toHaveBeenCalled();
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'exit', id, code: 0 });
  });
});
