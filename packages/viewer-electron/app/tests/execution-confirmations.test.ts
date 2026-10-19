import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomAction } from '../src/domain/automation';
import { ExecutionConfirmations, executionSummary } from '../src/desktop/execution-confirmations';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-confirmations-');
});
afterEach(async () => {
  await trashTemporary(root);
});
const action = (executor: CustomAction['executor']): CustomAction => ({
  id: 'fixture',
  name: 'Fixture',
  aliases: [],
  icon: 'command',
  shortcut: '',
  order: 0,
  pinned: false,
  when: { target: 'any', extensions: [], min: 0, max: 10 },
  executor,
});
const shell = (script: string) =>
  action({ kind: 'shell', executable: '/bin/zsh', script, perItem: false });

describe('first-run execution confirmations', () => {
  it('asks once per exact executor and remembers the answer privately', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.require(shell('echo one'));
    await confirmations.require(shell('echo one'));
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]).toEqual([
      expect.objectContaining({ detail: expect.stringContaining('echo one') }),
    ]);
    const reloaded = new ExecutionConfirmations(root, ask);
    await reloaded.require(shell('echo one'));
    expect(ask).toHaveBeenCalledOnce();
    await reloaded.require(shell('echo changed'));
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('refuses when the person declines and keeps asking next time', async () => {
    const ask = vi.fn(async () => false);
    const confirmations = new ExecutionConfirmations(root, ask);
    await expect(confirmations.require(shell('echo no'))).rejects.toThrow('not confirmed');
    await expect(confirmations.require(shell('echo no'))).rejects.toThrow('not confirmed');
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('shares one dialog between concurrent starts and ignores built-in actions', async () => {
    let answer!: (value: boolean) => void;
    const ask = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const confirmations = new ExecutionConfirmations(root, ask);
    const first = confirmations.require(shell('echo twice'));
    const second = confirmations.require(shell('echo twice'));
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    answer(true);
    await Promise.all([first, second]);
    await confirmations.require(action({ kind: 'builtin', command: 'copy-path' }));
    expect(ask).toHaveBeenCalledOnce();
  });
  it('starts the login shell without asking and confirms each configured terminal program once', async () => {
    const ask = vi.fn(async () => true);
    const confirmations = new ExecutionConfirmations(root, ask);
    const login = { id: 'login', name: 'Login shell', executable: '', args: ['-l'], env: {} };
    await confirmations.requireTerminal(login);
    await confirmations.requireTmux('tmux', '', {});
    expect(ask).not.toHaveBeenCalled();
    const build = {
      ...login,
      id: 'build',
      name: 'Build',
      executable: '/bin/sh',
      args: ['-c', 'make'],
    };
    await confirmations.requireTerminal(build);
    // A renamed profile runs the same program, so it is not asked about again.
    await confirmations.requireTerminal({ ...build, name: 'Renamed' });
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]).toEqual([expect.objectContaining({ detail: '/bin/sh -c make' })]);
    await confirmations.requireTerminal({ ...login, env: { TOKEN: 'generated' } });
    await confirmations.requireTmux('/opt/tools/tmux', '', {});
    await confirmations.requireTmux('tmux', '/private/tmp/shared.sock', {});
    await confirmations.requireTerminalApplication('/Applications/Other Terminal.app');
    expect(ask).toHaveBeenCalledTimes(5);
    const reloaded = new ExecutionConfirmations(root, ask);
    await reloaded.requireTerminal(build);
    expect(ask).toHaveBeenCalledTimes(5);
  });
  it('refuses a declined terminal program', async () => {
    const confirmations = new ExecutionConfirmations(root, async () => false);
    await expect(
      confirmations.requireTerminal({
        id: 'build',
        name: 'Build',
        executable: '/bin/sh',
        args: ['-c', 'make'],
        env: {},
      }),
    ).rejects.toThrow('not confirmed');
  });
  it('shows the full command line for executables', () => {
    expect(
      executionSummary(
        action({
          kind: 'executable',
          executable: '/usr/bin/open',
          args: ['-a', 'Preview', '{paths}'],
          perItem: true,
        }),
      ).detail,
    ).toContain('/usr/bin/open -a Preview {paths}');
  });
});
