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
