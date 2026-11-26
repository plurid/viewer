/**
 * A window whose renderer crashed, or hung past its grace, saves nothing more. Closing it, a backup
 * and Quit go ahead with what it saved last, never asking a dead renderer and never timing out.
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Storage } from '../src/desktop/persistence/storage';
import { temporaryRoot } from '../tools/temporary';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { Desktop } from '../src/desktop/bridge';
import { createSettingHandlers } from '../src/desktop/ipc/setting-handlers';
import { WindowFlushRequests } from '../src/desktop/windows/flush-requests';

vi.mock('electron', () => ({ ipcMain: { removeHandler: vi.fn() } }));
vi.mock('../src/desktop/native/window-dialogs', () => ({
  attachWindowDialogs: vi.fn(),
  WindowDialogs: class {},
}));

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
      [2, { window: settings.window, role: 'settings', ready: true, paths: [], launches: [] }],
    ]),
  );
  for (const name of ['storage', 'settings', 'buffers', 'notes', 'fabrication'])
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

  it('hands a stopped window to an agent task at once, with what it saved last', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const flushForTask = (owner: number): Promise<void> =>
        Reflect.get(f.desktop, 'flushForTask').call(f.desktop, owner);
      f.desktop.windowStopped(f.workspace.window, 'unresponsive');
      // no answer can come, so no save is asked for and nothing waits for one
      await expect(flushForTask(1)).resolves.toBeUndefined();
      expect(sentFlushes(f.workspace.send)).toBe(0);
      // a window that answers again is asked, and stopping during the save ends it as saved
      f.desktop.windowResumed(f.workspace.window);
      const handing = flushForTask(1);
      expect(sentFlushes(f.workspace.send)).toBe(1);
      f.desktop.windowStopped(f.workspace.window, 'gone');
      await expect(handing).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips flushing Settings before settingsGet marks it ready, flushes once ready, and clears ready on reload', async () => {
    const desktop = Object.create(Desktop.prototype) as Desktop;
    const flushes = new WindowFlushRequests();
    const settingsFlush = vi.fn(async () => {});
    const send = vi.fn();
    const wc = Object.assign(new EventEmitter(), {
      id: 9,
      isDestroyed: () => false,
      send,
    });
    const settingsWin = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      webContents: wc,
    }) as unknown as BrowserWindow;
    const noopOwner = { stopOwner: vi.fn(), ownerClosed: vi.fn() };
    Object.assign(desktop, {
      home: '/fixtures',
      windows: new Map(),
      flushes,
      options: {},
      settings: {
        load: vi.fn(async () => {}),
        snapshot: vi.fn(() => ({ revision: 0, settings: {}, ui: {}, look: 'dark' })),
        flush: settingsFlush,
      },
      speech: { ...noopOwner, allowsMicrophone: () => false, stopRecording: vi.fn() },
      fabrication: noopOwner,
      remote: noopOwner,
      taskRequests: noopOwner,
      personTaskWorkflows: noopOwner,
      watchers: { stopOwner: vi.fn(async () => {}) },
      resources: { stopOwner: vi.fn(() => []) },
      gitResources: new Set(),
    });
    desktop.attach(settingsWin, 'settings');
    const windows = Reflect.get(desktop, 'windows') as Map<
      number,
      { role: string; ready?: boolean }
    >;
    const handlers = createSettingHandlers({
      settings: Reflect.get(desktop, 'settings'),
      credentials: { load: vi.fn(async () => {}), ids: () => [] },
      backups: { request: vi.fn() },
      fileAccess: {
        scoped: false,
        remember: vi.fn(),
        allowOnce: vi.fn(),
        require: vi.fn(),
      },
      window: () => settingsWin,
      isSettings: (owner) => windows.get(owner)?.role === 'settings',
      markSettingsReady: (owner) => {
        const record = windows.get(owner);
        if (record?.role === 'settings') record.ready = true;
      },
    });

    // Before Settings calls settingsGet, flushSettings skips the renderer round-trip.
    await desktop.flushSettings(settingsWin);
    expect(sentFlushes(send)).toBe(0);
    expect(settingsFlush).toHaveBeenCalledTimes(1);

    // settingsGet marks Settings ready, so flushSettings requests a flush from it.
    await handlers.settingsGet([], 9);
    const saving = desktop.flushSettings(settingsWin);
    await vi.waitFor(() => expect(sentFlushes(send)).toBe(1));
    const event = send.mock.calls.at(-1)?.[1] as { token: string };
    flushes.acknowledge(event.token, 9, { ok: true });
    await expect(saving).resolves.toBeUndefined();
    expect(settingsFlush).toHaveBeenCalledTimes(2);

    // Top-level navigation clears ready until the reloaded renderer calls settingsGet again.
    wc.emit('did-start-navigation', {}, 'viewer-app://app/settings', false, true);
    await desktop.flushSettings(settingsWin);
    expect(sentFlushes(send)).toBe(1);
    expect(settingsFlush).toHaveBeenCalledTimes(3);

    // render-process-gone also clears ready.
    await handlers.settingsGet([], 9);
    wc.emit('render-process-gone');
    await desktop.flushSettings(settingsWin);
    expect(sentFlushes(send)).toBe(1);
    expect(settingsFlush).toHaveBeenCalledTimes(4);
  });
});

it('flushes documents on close and quit when a newer layout is protected', async () => {
  const f = fixture();
  const storage = new Storage(
    path.join(await temporaryRoot('viewer-retained-close-'), 'state.json'),
  );
  const original = '{"version":999}';
  await writeFile(storage.file, original);
  await storage.load();
  Reflect.set(f.desktop, 'storage', storage);
  f.workspace.send.mockImplementation((_channel, event) => {
    f.flushes.acknowledge(
      event.token,
      1,
      event.type === 'flush-documents'
        ? { ok: true }
        : { ok: false, code: 'STATE_RETAINED', error: 'Protected' },
    );
  });
  f.settings.send.mockImplementation((_channel, event) =>
    f.flushes.acknowledge(event.token, 2, { ok: true }),
  );
  await f.desktop.flushWindow(f.workspace.window);
  await f.desktop.flush();
  for (const name of ['notes', 'chats', 'fabrication'])
    expect(Reflect.get(f.desktop, name).flush).toHaveBeenCalledTimes(2);
  expect(Reflect.get(f.desktop, 'buffers').flush).toHaveBeenCalledTimes(3);
  expect(await readFile(storage.file, 'utf8')).toBe(original);
});
