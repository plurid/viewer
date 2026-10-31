import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandOutput } from '../src/desktop/terminals/command-output';
import { TerminalCommands, type TerminalCommand } from '../src/desktop/terminals/terminal-commands';
import type { TerminalWorkerRequest } from '../src/desktop/terminals/terminal-protocol';
vi.mock('../src/desktop/terminals/terminal-groups', () => ({
  terminateTerminalGroup: vi.fn(async () => {}),
}));
import { terminateTerminalGroup } from '../src/desktop/terminals/terminal-groups';

const program: TerminalCommand = {
  id: 'command',
  owner: 7,
  workspaceID: 'workspace',
  rootID: 'folder',
  cwd: '/fixture',
  executable: '/bin/zsh',
  args: ['-lic', 'll'],
  env: {},
};
let commands: TerminalCommands;
let post = vi.fn<(request: TerminalWorkerRequest) => void>();
beforeEach(() => {
  vi.mocked(terminateTerminalGroup).mockReset().mockResolvedValue(undefined);
  post = vi.fn();
  commands = new TerminalCommands(post);
});
afterEach(async () => {
  commands.failed('Test finished.');
  await commands.close();
  vi.useRealTimers();
});

it('decodes split terminal controls without hiding error text or mangling Unicode', () => {
  const text =
    '\x1b[31mERROR\x1b[0m\r\n漢字\x1b]8;;https://example.org\x07label\x1b]8;;\x1b\\\r\n\x1b(Bdone';
  for (let split = 0; split <= text.length; split++) {
    const output = new CommandOutput();
    expect(output.accept(text.slice(0, split)) + output.accept(text.slice(split))).toBe(
      'ERROR\n漢字label\ndone',
    );
  }
});
it('auto-acknowledges terminal output and waits for process cleanup before reporting exit', async () => {
  const chunks: string[] = [];
  const done = commands.run(program, new AbortController().signal, (text) => chunks.push(text));
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'start', input: false, executable: '/bin/zsh' }),
  );
  commands.receive({ type: 'started', id: program.id, pid: 9900001 });
  commands.receive({ type: 'data', id: program.id, data: '\x1b[32mhello\x1b[0m\r\n' });
  expect(chunks).toEqual(['hello\n']);
  expect(post).toHaveBeenLastCalledWith({ kind: 'ack', id: program.id, bytes: 16 });
  let release!: () => void;
  vi.mocked(terminateTerminalGroup).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  commands.receive({ type: 'exit', id: program.id, code: 7 });
  expect(commands.has(program.id)).toBe(true);
  release();
  await expect(done).resolves.toBe(7);
  expect(commands.has(program.id)).toBe(false);
});
it('isolates cancellation by owner and escalates an unresponsive terminal', async () => {
  vi.useFakeTimers();
  const done = commands.run(program, new AbortController().signal, () => {});
  const rejected = expect(done).rejects.toThrow('did not stop');
  commands.receive({ type: 'started', id: program.id, pid: 9900001 });
  commands.stopOwner(8);
  expect(post).toHaveBeenCalledTimes(1);
  commands.stopOwner(7);
  expect(post).toHaveBeenLastCalledWith({ kind: 'close', id: program.id });
  await vi.advanceTimersByTimeAsync(1500);
  expect(post).toHaveBeenLastCalledWith({ kind: 'kill', id: program.id });
  await vi.advanceTimersByTimeAsync(1500);
  await rejected;
  expect(terminateTerminalGroup).toHaveBeenCalledWith(9900001);
});
it('does not report a signal termination as successful exit zero', async () => {
  const done = commands.run(program, new AbortController().signal, () => {});
  const rejected = expect(done).rejects.toThrow('signal 9');
  commands.receive({ type: 'started', id: program.id, pid: 9900001 });
  commands.receive({ type: 'exit', id: program.id, code: 0, signal: 9 });
  await rejected;
});
it('settles worker crashes and refuses successful revocation when cleanup failed', async () => {
  const done = commands.run(program, new AbortController().signal, () => {});
  const rejected = expect(done).rejects.toThrow('cannot stop');
  commands.receive({ type: 'started', id: program.id, pid: 9900001 });
  vi.mocked(terminateTerminalGroup).mockRejectedValueOnce(new Error('cannot stop'));
  commands.failed('worker stopped');
  await rejected;
  await expect(commands.quiesce('/fixture')).rejects.toThrow('cannot stop');
});
