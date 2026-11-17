import { EventEmitter } from 'node:events';
import { readFile, realpath } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { CustomAction } from '../src/domain/automation/actions';
import { ExecutionConfirmations } from '../src/desktop/actions/execution-confirmations';
import { Desktop } from '../src/desktop/bridge';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const native = vi.hoisted(() => ({ ask: vi.fn(async () => true) }));
vi.mock('electron', () => ({ app: {} }));
vi.mock('../src/desktop/native/native-confirmation', () => ({
  confirmNatively: native.ask,
}));

let root: string;
let desktop: Desktop;
let confirmations: ExecutionConfirmations;
const front = new EventEmitter() as BrowserWindow;
const owner = Object.assign(new EventEmitter(), {
  isDestroyed: vi.fn(() => false),
}) as unknown as BrowserWindow;
const profile = { id: 'custom', name: 'Custom', executable: '/bin/zsh', args: ['-l'], env: {} };

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-command-window-'));
  desktop = Object.create(Desktop.prototype) as Desktop;
  Reflect.set(desktop, 'window', front);
  native.ask.mockClear();
  vi.mocked(owner.isDestroyed).mockReturnValue(false);
  confirmations = new ExecutionConfirmations(root, (...args) =>
    Reflect.get(desktop, 'confirmExecution').apply(desktop, args),
  );
});
afterEach(async () => {
  await trashTemporary(root);
});

describe('native execution approval parents', () => {
  it.each(['action', 'profile', 'tmux', 'application'] as const)(
    'keeps the front window as the parent of an existing %s approval',
    async (kind) => {
      if (kind === 'action') {
        const action: CustomAction = {
          id: 'sample',
          name: 'Sample',
          aliases: [],
          icon: 'command',
          shortcut: '',
          order: 0,
          pinned: false,
          when: { target: 'any', extensions: [], min: 0, max: 10 },
          executor: {
            kind: 'shell',
            executable: '/bin/zsh',
            script: 'echo sample',
            perItem: false,
          },
        };
        await confirmations.require(action);
      }
      if (kind === 'profile') await confirmations.requireTerminal(profile);
      if (kind === 'tmux') await confirmations.requireTmux('/opt/sample/tmux', '', {});
      if (kind === 'application')
        await confirmations.requireTerminalApplication('/Applications/Sample.app');
      expect(native.ask).toHaveBeenCalledExactlyOnceWith(
        front,
        expect.any(String),
        expect.any(String),
        'Run',
      );
    },
  );

  it('keeps a definition approval attached to its given window even when another window is frontmost', async () => {
    await confirmations.requireDefinitionCommand(
      {
        key: 'sample/site',
        cwd: root,
        profile,
        command: 'npm run dev',
        workspaceName: 'Sample',
      },
      owner,
    );
    expect(native.ask).toHaveBeenCalledExactlyOnceWith(
      owner,
      expect.any(String),
      expect.stringContaining('npm run dev'),
      'Run',
    );
  });

  it.each(['missing', 'destroyed before dialog'] as const)(
    'declines a definition approval whose window is %s without falling back or recording it',
    async (state) => {
      const pending = confirmations.requireDefinitionCommand(
        {
          key: 'sample/site',
          cwd: root,
          profile,
          command: 'npm run dev',
          workspaceName: 'Sample',
        },
        state === 'missing' ? undefined : owner,
      );
      vi.mocked(owner.isDestroyed).mockReturnValue(true);
      await expect(pending).resolves.toEqual({ kind: 'declined' });
      expect(native.ask).not.toHaveBeenCalled();
      await expect(readFile(root + '/confirmed-actions-v1.json')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
});
