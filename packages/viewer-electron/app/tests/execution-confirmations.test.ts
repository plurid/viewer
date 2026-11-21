import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomAction } from '../src/domain/automation/actions';
import {
  ExecutionConfirmations,
  executionSummary,
} from '../src/desktop/actions/execution-confirmations';
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
  it('pages scripts, executable arguments and terminal settings longer than 6,000 characters and requires every page', async () => {
    const tail = 'TAIL_MARKER_AFTER_6000';
    const longScript = `${'# padding\n'.repeat(1400)}${tail}`;
    expect(longScript.length).toBeGreaterThan(14000);
    const seen: { title: string; detail: string }[] = [];
    const ask = vi.fn(async (input: { title: string; detail: string }) => {
      seen.push(input);
      return true;
    });
    const confirmations = new ExecutionConfirmations(root, ask);
    await confirmations.require(shell(longScript));
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.every((page) => page.detail.length <= 6000)).toBe(true);
    expect(seen.map((page) => page.detail).join('')).toContain(tail);
    // Approving once remembers the exact full executor fingerprint across reloads.
    const reloaded = new ExecutionConfirmations(root, ask);
    await reloaded.require(shell(longScript));
    expect(ask).toHaveBeenCalledTimes(seen.length);

    // Declining a later page refuses and records no approval.
    let calls = 0;
    const partial = vi.fn(async () => ++calls % 2 === 1);
    const declining = new ExecutionConfirmations(root, partial);
    await expect(declining.require(shell(longScript + '\n# two'))).rejects.toThrow('not confirmed');
    expect(partial).toHaveBeenCalledTimes(2);
    await expect(declining.require(shell(longScript + '\n# two'))).rejects.toThrow('not confirmed');
    expect(partial).toHaveBeenCalledTimes(4);

    // Long executable arguments, terminal profile args and tmux options are paged too.
    const longExecSeen: { detail: string }[] = [];
    const longExec = new ExecutionConfirmations(root, async (input) => {
      longExecSeen.push(input);
      return true;
    });
    await longExec.require(
      action({
        kind: 'executable',
        executable: '/usr/bin/tool',
        args: ['--pad=' + 'x'.repeat(6500), '--tail=' + tail],
        perItem: false,
      }),
    );
    expect(longExecSeen.length).toBeGreaterThan(1);
    expect(longExecSeen.every((page) => page.detail.length <= 6000)).toBe(true);
    expect(longExecSeen.map((page) => page.detail).join('')).toContain(tail);

    const longTermSeen: { detail: string }[] = [];
    const longTerm = new ExecutionConfirmations(root, async (input) => {
      longTermSeen.push(input);
      return true;
    });
    await longTerm.requireTerminal({
      id: 'long',
      name: 'Long',
      executable: '/bin/sh',
      args: ['-c', 'a'.repeat(6500) + tail],
      env: {},
    });
    expect(longTermSeen.length).toBeGreaterThan(1);
    expect(longTermSeen.every((page) => page.detail.length <= 6000)).toBe(true);
    expect(longTermSeen.map((page) => page.detail).join('')).toContain(tail);

    const longTmuxSeen: { detail: string }[] = [];
    const longTmux = new ExecutionConfirmations(root, async (input) => {
      longTmuxSeen.push(input);
      return true;
    });
    await longTmux.requireTmux('/opt/tmux', '/' + 'a'.repeat(6500) + '/' + tail, {});
    expect(longTmuxSeen.length).toBeGreaterThan(1);
    expect(longTmuxSeen.every((page) => page.detail.length <= 6000)).toBe(true);
    expect(longTmuxSeen.map((page) => page.detail).join('')).toContain(tail);
  });
});
