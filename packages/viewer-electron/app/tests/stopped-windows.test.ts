/**
 * A window whose renderer crashed, or hung past its grace, saves nothing more. Closing it, a backup
 * and Quit go ahead with what it saved last, never asking a dead renderer and never timing out.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { Desktop } from '../src/desktop/bridge';
import { WindowFlushRequests } from '../src/desktop/windows/flush-requests';

vi.mock('electron', () => ({ ipcMain: { removeHandler: vi.fn() } }));

function window(id: number) {
  const send = vi.fn();
  const created = {
    isDestroyed: () => false,
    webContents: { id, isDestroyed: () => false, send },
  };
  return { window: created as unknown as BrowserWindow, send };
}

function fixture() {
  const desktop = Object.create(Desktop.prototype) as Desktop;
  const store = () => ({ flush: vi.fn(async () => {}) });
  const flushes = new WindowFlushRequests();
  const workspace = window(1);
  const settings = window(2);
  Reflect.set(desktop, 'flushes', flushes);
  Reflect.set(
    desktop,
    'windows',
    new Map([
      [1, { window: workspace.window, role: 'viewer', ready: true, paths: [], launches: [] }],
      [2, { window: settings.window, role: 'settings', paths: [], launches: [] }],
    ]),
  );
  for (const name of ['storage', 'settings', 'buffers', 'notes'])
    Reflect.set(desktop, name, store());
  Reflect.set(desktop, 'chats', { ...store(), stopOwner: vi.fn(async () => {}) });
  /** The renderer answers each flush it is sent, as a working window does. */
  const answer = (sent: ReturnType<typeof vi.fn>, owner: number) => {
    const event = sent.mock.calls.at(-1)?.[1] as { token: string } | undefined;
    if (event) flushes.acknowledge(event.token, owner, { ok: true });
  };
  return { desktop, flushes, workspace, settings, answer };
}

const sentFlushes = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter(([, event]) => /^flush/.test((event as { type: string }).type)).length;

describe('a stopped window', () => {
  it('ends the save it was waiting for, as saved, when its renderer stops', async () => {
    const f = fixture();
    const closing = f.desktop.flushWindow(f.workspace.window);
    await vi.waitFor(() => expect(sentFlushes(f.workspace.send)).toBe(1));
    f.desktop.windowStopped(f.workspace.window, 'gone');
    await expect(closing).resolves.toBeUndefined();
  });

  it('closes without asking a crashed renderer, and asks the reloaded one once it is ready', async () => {
    const f = fixture();
    f.desktop.windowStopped(f.workspace.window, 'gone');
    await f.desktop.flushWindow(f.workspace.window);
    expect(sentFlushes(f.workspace.send)).toBe(0);
    // reloaded, it answers a save only once it has published its commands again
    f.desktop.windowResumed(f.workspace.window);
    await f.desktop.flushWindow(f.workspace.window);
    expect(sentFlushes(f.workspace.send)).toBe(0);
    const record = (Reflect.get(f.desktop, 'windows') as Map<number, { ready?: boolean }>).get(1)!;
    record.ready = true;
    const closing = f.desktop.flushWindow(f.workspace.window);
    await vi.waitFor(() => expect(sentFlushes(f.workspace.send)).toBe(1));
    f.answer(f.workspace.send, 1);
    await expect(closing).resolves.toBeUndefined();
  });

  it('skips a hung workspace window and Settings at Quit, and asks them again once they answer', async () => {
    const f = fixture();
    f.desktop.windowStopped(f.workspace.window, 'unresponsive');
    f.desktop.windowStopped(f.settings.window, 'unresponsive');
    await expect(f.desktop.flush()).resolves.toBeUndefined();
    expect(sentFlushes(f.workspace.send) + sentFlushes(f.settings.send)).toBe(0);
    f.desktop.windowResumed(f.workspace.window);
    f.desktop.windowResumed(f.settings.window);
    const quitting = f.desktop.flush();
    await vi.waitFor(() => expect(sentFlushes(f.settings.send)).toBe(1));
    f.answer(f.settings.send, 2);
    await vi.waitFor(() => expect(sentFlushes(f.workspace.send)).toBe(1));
    f.answer(f.workspace.send, 1);
    await expect(quitting).resolves.toBeUndefined();
  });
});
