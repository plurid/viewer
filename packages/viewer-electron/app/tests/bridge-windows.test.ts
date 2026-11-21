/**
 * A request can outlive the window that sent it: the bridge reaches a window only through
 * `requireWindow`/`requireRecord`, which report a closed window instead of crashing on it,
 * and parents a dialog to the window that asked rather than to whichever is selected.
 */
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  ipcMain: { removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));
vi.mock('electron', () => electronMock);

import { Desktop } from '../src/desktop/bridge';
import { AgentAccess } from '../src/desktop/agents/agent-access';
import { FileAccess } from '../src/desktop/files/file-access';
import { SettingsService } from '../src/desktop/preferences/settings';
import { windowDialogs } from '../src/desktop/native/window-dialogs';
import type { DesktopEvent } from '../src/domain/contracts';
import { temporaryRoot } from '../tools/temporary';

const source = (file: string) =>
  readFileSync(new URL(`../src/desktop/${file}`, import.meta.url), 'utf8');
const bridge = source('bridge.ts');
// the handler groups that reach a window through the bridge's lookups
const handlers = [
  'access',
  'application',
  'automation',
  'media',
  'pasteboard',
  'setting',
  'window',
].map((group) => source(`ipc/${group}-handlers.ts`));

it('looks up windows only through the checked helpers', () => {
  expect(bridge).not.toMatch(/this\.windows\.get\([^)]*\)!/);
  expect(bridge).not.toMatch(/this\.window!/);
  for (const group of handlers) expect(group).not.toMatch(/[wW]indow\([^)]*\)!/);
  expect(bridge).toContain("throw new Error('The window closed before Viewer could finish.')");
});

function stubWindow(id: number, onSend?: (event: DesktopEvent) => void) {
  const sent: DesktopEvent[] = [];
  const win = {
    isDestroyed: () => false,
    on: vi.fn(),
    webContents: {
      id,
      isDestroyed: () => false,
      send: vi.fn((_channel: string, event: DesktopEvent) => {
        sent.push(event);
        onSend?.(event);
      }),
      on: vi.fn(),
    },
  } as unknown as BrowserWindow;
  return { win, sent };
}

describe('Desktop window targeting and native dialog boundaries', () => {
  it('delivers menu commands only to the targeted workspace window, never to unfocused peers', () => {
    const desktop = Object.create(Desktop.prototype) as Desktop;
    Reflect.set(desktop, 'windows', new Map());
    const first = stubWindow(1);
    const second = stubWindow(2);
    const settings = stubWindow(3);
    Reflect.get(desktop, 'windows').set(1, { window: first.win, role: 'viewer' });
    Reflect.get(desktop, 'windows').set(2, { window: second.win, role: 'viewer' });
    Reflect.get(desktop, 'windows').set(3, { window: settings.win, role: 'settings' });
    Reflect.set(desktop, 'window', second.win);

    (desktop as unknown as { sendCommand(command: string, target?: BrowserWindow): void }).sendCommand(
      'trash',
      first.win,
    );
    expect(first.sent).toEqual([{ type: 'command', command: 'trash' }]);
    expect(second.sent).toEqual([]);
    expect(settings.sent).toEqual([]);

    // Without a focused target (e.g. a native sheet held focus), fall back to the active viewer window only.
    (desktop as unknown as { sendCommand(command: string, target?: BrowserWindow): void }).sendCommand(
      'paste',
    );
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toEqual([{ type: 'command', command: 'paste' }]);
    expect(settings.sent).toEqual([]);

    // A non-viewer target must never redirect onto a background workspace window.
    (desktop as unknown as { sendCommand(command: string, target?: BrowserWindow): void }).sendCommand(
      'duplicate',
      settings.win,
    );
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
    expect(settings.sent).toEqual([]);
  });

  it('requires a native folder panel when authorizing an agent folder in the direct build', async () => {
    electronMock.dialog.showOpenDialog.mockReset();
    electronMock.dialog.showMessageBox.mockReset();
    const root = await temporaryRoot('viewer-agent-folder-');
    const dataPath = path.join(root, 'data');
    const home = path.join(root, 'home');
    const targetDir = path.join(root, 'target');
    await mkdir(dataPath, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(targetDir, { recursive: true });

    const settings = new SettingsService(dataPath, home, () => false, () => {});
    await settings.load();
    const access = new AgentAccess(dataPath, () => {
      const snapshot = settings.snapshot();
      return { ...snapshot.settings.agents, revision: snapshot.revision };
    });
    const fileAccess = new FileAccess(dataPath);

    const desktop = Object.create(Desktop.prototype) as Desktop;
    Reflect.set(desktop, 'home', home);
    Reflect.set(desktop, 'options', { qaRuntime: true });
    Reflect.set(desktop, 'windows', new Map());
    Reflect.set(desktop, 'fileAccess', fileAccess);
    Reflect.set(desktop, 'settings', settings);
    Reflect.set(desktop, 'storage', { load: async () => ({ state: undefined }) });
    Reflect.set(desktop, 'search', { quiesce: async () => {} });
    Reflect.set(desktop, 'files', { configure: async () => {} });
    Reflect.set(desktop, 'agentsConfiguration', Promise.resolve());
    Reflect.set(desktop, 'agentsEnabled', false);
    Reflect.set(desktop, 'agents', {
      access,
      checkFolders: async () => {},
      start: async () => {},
      close: async () => {},
    });

    const publishedPrompts: string[] = [];
    let winRef!: BrowserWindow;
    const { win } = stubWindow(1, (event) => {
      if (event.type === 'dialog' && event.prompt?.kind === 'file') {
        publishedPrompts.push(event.prompt.id);
        void windowDialogs(winRef, false)?.request({
          kind: 'choose',
          id: event.prompt.id,
          paths: [targetDir],
        });
      }
    });
    winRef = win;
    desktop.attach(win, 'settings');
    await windowDialogs(win, false)!.request({ kind: 'current' });

    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [targetDir],
    });

    const changeAgentAccess = Reflect.get(desktop, 'changeAgentAccess') as (
      request: unknown,
      senderID: number,
    ) => Promise<void>;
    await changeAgentAccess.call(desktop, { kind: 'add-folder' }, 1);

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledOnce();
    expect(publishedPrompts).toEqual([]);
    expect((await access.state()).roots).toContain(targetDir);
  });
});
