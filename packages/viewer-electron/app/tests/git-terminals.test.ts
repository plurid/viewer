import { realpath } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitTerminalLaunch } from '../src/desktop/comparison/git-actions';
import type { TerminalEvent } from '../src/domain/automation/actions';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const fake = vi.hoisted(() => ({
  receive: undefined as ((message: unknown) => void) | undefined,
  postMessage: vi.fn(),
  launch: vi.fn(),
}));
vi.mock('../src/desktop/workers/utility-client', () => ({ launchWorker: fake.launch }));
vi.mock('../src/desktop/terminals/terminal-groups', () => ({
  terminateTerminalGroup: vi.fn(async () => {}),
}));
import { Terminals } from '../src/desktop/terminals/terminals';
import { terminateTerminalGroup } from '../src/desktop/terminals/terminal-groups';

let root: string;
let terminals: Terminals;
let emit = vi.fn<(owner: number, event: TerminalEvent) => void>();
const launches = (kind = 'start') =>
  fake.postMessage.mock.calls
    .map(([request]) => request)
    .filter((request) => request.kind === kind);
const program = (id: string, kind: GitTerminalLaunch['kind'] = 'status'): GitTerminalLaunch => ({
  request: {
    id,
    workspaceID: 'workspace',
    rootID: 'folder',
    cwd: root,
    profileID: '@viewer-git',
    cols: 80,
    rows: 24,
  },
  executable: '/usr/bin/git',
  args: ['--no-pager', '-C', root, kind],
  env: { PATH: '/usr/bin:/bin' },
  kind,
  outputLimit: 1024,
  timeoutMs: 10000,
  signal: new AbortController().signal,
});

beforeEach(async () => {
  vi.mocked(terminateTerminalGroup).mockReset().mockResolvedValue(undefined);
  root = await realpath(await temporaryRoot('viewer-git-pty-'));
  fake.postMessage.mockReset().mockImplementation((request) => {
    if (request.kind === 'close')
      queueMicrotask(() => fake.receive?.({ type: 'exit', id: request.id, code: 0 }));
  });
  fake.launch.mockReset().mockReturnValue({
    postMessage: fake.postMessage,
    message: (receive: typeof fake.receive) => {
      fake.receive = receive;
    },
    exit: () => {},
  });
  emit = vi.fn<(owner: number, event: TerminalEvent) => void>();
  terminals = new Terminals('/never-launched-worker.cjs', () => defaultSettings(root), emit);
});
afterEach(async () => {
  await terminals.close();
  await trashTemporary(root);
});

describe('human Git terminal ownership', () => {
  it('shares its worker with command output without exposing command input or agent reads', async () => {
    await terminals.startGit(program('git'), 7);
    const output = vi.fn();
    const done = terminals.runCommand(
      {
        id: 'command',
        owner: 7,
        workspaceID: 'workspace',
        rootID: 'folder',
        cwd: root,
        executable: '/bin/zsh',
        args: ['-lic', 'll'],
        env: {},
      },
      new AbortController().signal,
      output,
    );
    expect(fake.launch).toHaveBeenCalledOnce();
    expect(() => terminals.write('command', 'input', 7)).toThrow('no longer available');
    expect(() => terminals.agentRead('command')).toThrow('no longer available');
    await expect(
      terminals.start({ ...program('command').request, profileID: 'login' }, 7),
    ).rejects.toThrow('command output');
    fake.receive?.({ type: 'data', id: 'command', data: '\x1b[32mhello\x1b[0m' });
    expect(output).toHaveBeenCalledWith('hello');
    expect(emit).not.toHaveBeenCalled();
    fake.receive?.({ type: 'exit', id: 'command', code: 0 });
    await expect(done).resolves.toBe(0);
  });
  it('never loads Git from an editable terminal profile', async () => {
    await expect(terminals.start(program('job').request, 7)).rejects.toThrow('reviewed command');
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it('directs output only to the owner and rejects readonly input and all agent reads', async () => {
    await terminals.startGit(program('job'), 7);
    expect(launches()).toEqual([
      expect.objectContaining({
        executable: '/usr/bin/git',
        readOnly: true,
        outputLimit: 1024,
        timeoutMs: 10000,
      }),
    ]);
    expect(() => terminals.write('job', '!sh\n', 7)).toThrow('does not accept');
    expect(() => terminals.write('job', 'input', 8)).toThrow('no longer available');
    expect(() => terminals.agentRead('job')).toThrow('private');
    fake.receive?.({ type: 'data', id: 'job', data: 'output' } satisfies TerminalEvent);
    expect(emit).toHaveBeenLastCalledWith(7, { type: 'data', id: 'job', data: 'output' });
    expect(() => terminals.resize('job', 100, 40, 8)).toThrow('no longer available');
    terminals.ack('job', 6, 8);
    expect(launches('ack')).toEqual([]);
    expect(launches('write')).toEqual([]);
  });

  it('allows only the owner to answer interactive mutation prompts', async () => {
    await terminals.startGit(program('push', 'push'), 7);
    terminals.write('push', 'human auth response\r', 7);
    expect(launches('write')).toEqual([
      { kind: 'write', id: 'push', data: 'human auth response\r' },
    ]);
    expect(() => terminals.agentRead('push')).toThrow('private');
    terminals.stopOwner(8);
    expect(launches('close')).toEqual([]);
    terminals.stopOwner(7);
    expect(launches('close')).toEqual([{ kind: 'close', id: 'push' }]);
  });

  it('reserves one mutating lane per repository without blocking read-only output', async () => {
    const first = terminals.startGit(program('commit', 'commit'), 7);
    await expect(terminals.startGit(program('push', 'push'), 8)).rejects.toThrow('still changing');
    await first;
    await terminals.startGit(program('status'), 8);
    expect(launches()).toHaveLength(2);
    await expect(terminals.startGit(program('commit', 'commit'), 7)).rejects.toThrow(
      'already started',
    );
  });

  it('keeps the mutation lane until the previous process group has finished stopping', async () => {
    await terminals.startGit(program('commit', 'commit'), 7);
    fake.receive?.({ type: 'started', id: 'commit', pid: 9900001 });
    let release!: () => void;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(terminateTerminalGroup).mockReturnValueOnce(stopped);
    terminals.stop('commit', 7);
    await expect(terminals.startGit(program('push', 'push'), 7)).rejects.toThrow('still changing');
    release();
    await terminals.quiesce(root);
    await terminals.startGit(program('push', 'push'), 7);
    expect(launches()).toHaveLength(2);
  });

  it('cancels a launch that is still waiting for folder access', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    terminals = new Terminals(
      '/never-launched-worker.cjs',
      () => defaultSettings(root),
      emit,
      () => wait,
    );
    const pending = terminals.startGit(program('job'), 7);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    terminals.stop('job', 7);
    release();
    await rejected;
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it('runs at most 100 terminals, counting those still starting', async () => {
    const starts = Array.from({ length: 99 }, (_, index) =>
      terminals.startGit(program('job-' + index), 7),
    );
    // the hundredth is still starting while the 101st asks
    const hundredth = terminals.startGit(program('job-99'), 7);
    await expect(terminals.startGit(program('job-100'), 7)).rejects.toThrow(
      'Close a terminal before opening another.',
    );
    await Promise.all([...starts, hundredth]);
    expect(launches()).toHaveLength(100);
    await expect(terminals.startGit(program('job-100'), 7)).rejects.toThrow(
      'Close a terminal before opening another.',
    );
    expect(launches()).toHaveLength(100);
  });

  it('honors cancellation signals and cannot substitute another executable', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      terminals.startGit({ ...program('job'), signal: abort.signal }, 7),
    ).rejects.toThrow('cancelled');
    await expect(
      terminals.startGit(
        { ...program('other'), executable: '/bin/sh' } as unknown as GitTerminalLaunch,
        7,
      ),
    ).rejects.toThrow('specification');
    expect(fake.launch).not.toHaveBeenCalled();
  });
});
