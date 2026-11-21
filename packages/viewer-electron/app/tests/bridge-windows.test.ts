/**
 * A request can outlive the window that sent it: the bridge reaches a window only through
 * `requireWindow`/`requireRecord`, which report a closed window instead of crashing on it,
 * and parents a dialog to the window that asked rather than to whichever is selected.
 */
import { EventEmitter } from 'node:events';
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
import { Resources } from '../src/desktop/previews/resources';
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
  const win = new EventEmitter() as unknown as BrowserWindow & EventEmitter;
  const wc = new EventEmitter() as EventEmitter & {
    id: number;
    isDestroyed: () => boolean;
    send: ReturnType<typeof vi.fn>;
  };
  wc.id = id;
  wc.isDestroyed = () => false;
  wc.send = vi.fn((_channel: string, event: DesktopEvent) => {
    sent.push(event);
    onSend?.(event);
  });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  return { win, wc, sent };
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

    (
      desktop as unknown as { sendCommand(command: string, target?: BrowserWindow): void }
    ).sendCommand('trash', first.win);
    expect(first.sent).toEqual([{ type: 'command', command: 'trash' }]);
    expect(second.sent).toEqual([]);
    expect(settings.sent).toEqual([]);

    // Without a focused target (e.g. a native sheet held focus), fall back to the active viewer window only.
    (
      desktop as unknown as { sendCommand(command: string, target?: BrowserWindow): void }
    ).sendCommand('paste');
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toEqual([{ type: 'command', command: 'paste' }]);
    expect(settings.sent).toEqual([]);

    // A non-viewer target must never redirect onto a background workspace window.
    (
      desktop as unknown as { sendCommand(command: string, target?: BrowserWindow): void }
    ).sendCommand('duplicate', settings.win);
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

    const settings = new SettingsService(
      dataPath,
      home,
      () => false,
      () => {},
    );
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
    const holder: { win?: BrowserWindow } = {};
    const { win } = stubWindow(1, (event) => {
      if (event.type === 'dialog' && event.prompt?.kind === 'file') {
        publishedPrompts.push(event.prompt.id);
        void windowDialogs(holder.win!, false)?.request({
          kind: 'choose',
          id: event.prompt.id,
          paths: [targetDir],
        });
      }
    });
    holder.win = win;
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

  it('flushes openIn paths queued between bootstrap and commandsPublish when commandsPublish marks the window ready', () => {
    const desktop = Object.create(Desktop.prototype) as Desktop;
    const noop = () => ({ stopOwner: vi.fn(), ownerClosed: vi.fn(), focus: vi.fn() });
    Reflect.set(desktop, 'home', '/tmp');
    Reflect.set(desktop, 'windows', new Map());
    Reflect.set(desktop, 'options', {});
    Reflect.set(desktop, 'openPaths', []);
    Reflect.set(desktop, 'workspaceSessions', { reserve: vi.fn(), focus: vi.fn() });
    Reflect.set(desktop, 'speech', {
      ...noop(),
      allowsMicrophone: () => false,
      stopRecording: vi.fn(),
    });
    Reflect.set(desktop, 'fabrication', noop());
    Reflect.set(desktop, 'remote', noop());
    Reflect.set(desktop, 'taskRequests', noop());
    Reflect.set(desktop, 'personTaskWorkflows', noop());
    for (const field of [
      'definitions',
      'definedWorkspaces',
      'shellCommand',
      'flushes',
      'settings',
      'credentials',
      'backups',
      'fileAccess',
      'providers',
      'modelPermissions',
      'files',
      'information',
      'watchers',
      'networkSharing',
      'applications',
      'appIcons',
      'pasteboard',
      'operations',
      'nativeSelections',
      'resources',
      'trash',
      'search',
      'thumbnails',
      'webPreviews',
      'browsers',
      'mediaDocuments',
      'optimizationReviews',
      'transforms',
      'activity',
      'texts',
      'buffers',
      'notes',
      'receipts',
      'journal',
      'operationPlans',
      'checkpoints',
      'actions',
      'comparisons',
      'duplicates',
      'git',
      'worktrees',
      'gitReviews',
      'gitActions',
      'lenses',
      'projects',
      'tours',
      'workflows',
      'watchRules',
      'relationships',
      'terminals',
      'definitionCommands',
      'declaredCommands',
      'externalTerminals',
      'executions',
      'agentSessions',
      'agentRequests',
      'agents',
      'reconstructions',
      'canvases',
      'chats',
    ])
      Reflect.set(desktop, field, {});
    Reflect.set(desktop, 'gitResources', new Set());
    Reflect.set(desktop, 'agentCommands', new Map());
    Reflect.set(desktop, 'sessionKeys', { bindings: [], aliases: [] });

    const { win, sent } = stubWindow(43);
    desktop.attach(win, 'viewer', 'ws-1');
    desktop.openIn(43, ['/tmp/acknowledgments.txt']);
    expect(sent).toEqual([]);

    const createHandlers = Reflect.get(Desktop.prototype, 'createHandlers') as () => {
      commandsPublish(args: unknown[], sender: number): void;
    };
    createHandlers
      .call(desktop)
      .commandsPublish(
        [{ workspaceID: 'ws-1', paneID: 'none', selection: [] }, [], undefined, {}],
        43,
      );

    expect(sent).toContainEqual({ type: 'open', paths: ['/tmp/acknowledgments.txt'] });
  });

  it('ignores subframe and in-place did-start-navigation and stops window-owned work only on top-level navigation', () => {
    const desktop = Object.create(Desktop.prototype) as Desktop;
    const speech = {
      stopOwner: vi.fn(),
      allowsMicrophone: vi.fn(() => false),
      stopRecording: vi.fn(),
    };
    const fabrication = { stopOwner: vi.fn() };
    const remote = { ownerClosed: vi.fn() };
    const taskRequests = { stopOwner: vi.fn() };
    const personTaskWorkflows = { stopOwner: vi.fn() };
    const watchers = { stopOwner: vi.fn(async () => {}) };
    const resources = { stopOwner: vi.fn(() => []) };
    Reflect.set(desktop, 'home', '/tmp');
    Reflect.set(desktop, 'windows', new Map());
    Reflect.set(desktop, 'options', {});
    Reflect.set(desktop, 'workspaceSessions', { reserve: vi.fn() });
    Reflect.set(desktop, 'speech', speech);
    Reflect.set(desktop, 'fabrication', fabrication);
    Reflect.set(desktop, 'remote', remote);
    Reflect.set(desktop, 'taskRequests', taskRequests);
    Reflect.set(desktop, 'personTaskWorkflows', personTaskWorkflows);
    Reflect.set(desktop, 'watchers', watchers);
    Reflect.set(desktop, 'resources', resources);

    const { win, wc } = stubWindow(20);
    desktop.attach(win, 'viewer', 'ws-1');

    // Subframe and in-place navigations must not stop active window-owned services.
    wc.emit('did-start-navigation', {}, 'viewer-html://preview/index.html', false, false);
    wc.emit('did-start-navigation', {}, 'viewer-app://app/#section', true, true);
    expect(speech.stopOwner).not.toHaveBeenCalled();
    expect(fabrication.stopOwner).not.toHaveBeenCalled();
    expect(remote.ownerClosed).not.toHaveBeenCalled();
    expect(taskRequests.stopOwner).not.toHaveBeenCalled();
    expect(personTaskWorkflows.stopOwner).not.toHaveBeenCalled();
    expect(watchers.stopOwner).not.toHaveBeenCalled();
    expect(resources.stopOwner).not.toHaveBeenCalled();

    // Top-level non-in-place navigation stops all window-owned services.
    wc.emit('did-start-navigation', {}, 'viewer-app://app/reload', false, true);
    expect(speech.stopOwner).toHaveBeenCalledExactlyOnceWith(20);
    expect(fabrication.stopOwner).toHaveBeenCalledExactlyOnceWith(20);
    expect(remote.ownerClosed).toHaveBeenCalledExactlyOnceWith(20);
    expect(taskRequests.stopOwner).toHaveBeenCalledExactlyOnceWith(20);
    expect(personTaskWorkflows.stopOwner).toHaveBeenCalledExactlyOnceWith(20);
    expect(watchers.stopOwner).toHaveBeenCalledExactlyOnceWith(20);
    expect(resources.stopOwner).toHaveBeenCalledExactlyOnceWith(20);

    // Renderer crash also stops window-owned watches and services.
    wc.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(watchers.stopOwner).toHaveBeenCalledTimes(2);
    expect(watchers.stopOwner).toHaveBeenLastCalledWith(20);
  });

  it('releases a closing window’s preview resource leases while peer windows keep theirs', async () => {
    const resources = new Resources(async () => {});
    const desktop = Object.create(Desktop.prototype) as Desktop;
    const noop = () => ({
      stopOwner: vi.fn(),
      ownerClosed: vi.fn(),
      retain: vi.fn(),
      release: vi.fn(),
      disconnected: vi.fn(),
      clearRootSearch: vi.fn(),
      reserve: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      closeAndPersist: vi.fn(async () => {}),
      snapshot: () => undefined,
    });
    Reflect.set(desktop, 'home', '/tmp');
    Reflect.set(desktop, 'windows', new Map());
    Reflect.set(desktop, 'options', {});
    Reflect.set(desktop, 'agentCommands', new Map());
    Reflect.set(desktop, 'gitResources', new Set());
    Reflect.set(desktop, 'resources', resources);
    Reflect.set(desktop, 'workspaceSessions', noop());
    for (const name of [
      'remote',
      'speech',
      'fabrication',
      'backups',
      'browsers',
      'mediaDocuments',
      'flushes',
      'chats',
      'canvases',
      'gitActions',
      'worktrees',
      'agentTaskWorkflows',
      'taskRequests',
      'personTaskWorkflows',
      'gitReviews',
      'terminals',
      'executions',
      'definitions',
    ])
      Reflect.set(desktop, name, noop());
    const watchers = { stopOwner: vi.fn(async () => {}) };
    Reflect.set(desktop, 'optimizationReviews', { stopOwner: vi.fn(async () => {}) });
    Reflect.set(desktop, 'webPreviews', { stopOwner: vi.fn(async () => {}) });
    Reflect.set(desktop, 'watchers', watchers);

    const first = stubWindow(1);
    const second = stubWindow(2);
    desktop.attach(first.win, 'viewer', 'ws-1');
    desktop.attach(second.win, 'viewer', 'ws-2');

    const sample = await resources.grantBytes('/tmp', 'w1-sample.txt', Buffer.from('secret'), 1);
    await expect(resources.read(sample.id, undefined, 2)).rejects.toThrow('expired');
    expect(resources.release(sample.id, 2)).toBe(false);
    for (let index = 0; index < 255; index++) {
      await resources.grantBytes('/tmp', `w1-${index}.txt`, Buffer.from('a'), 1);
    }
    first.win.emit('closed');

    expect(watchers.stopOwner).toHaveBeenCalledExactlyOnceWith(1);

    await expect(resources.read(sample.id, undefined, 1)).rejects.toThrow('expired');
    await expect(
      resources.grantBytes('/tmp', 'w2-new.txt', Buffer.from('b'), 2),
    ).resolves.toMatchObject({ entry: { name: 'w2-new.txt' } });
  });

  it('aborts in-flight unkeyed grant and grantBytes when their owning window closes', async () => {
    let releaseAccess!: () => void;
    const accessGate = new Promise<void>((resolve) => {
      releaseAccess = resolve;
    });
    const access = vi.fn(() => accessGate);
    const resources = new Resources(access);
    const pendingGrant = resources.grant('/tmp/sample.txt', undefined, 7);
    const pendingBytes = resources.grantBytes('/tmp', 'in-flight.txt', Buffer.from('abc'), 7);
    await vi.waitFor(() => expect(access).toHaveBeenCalledTimes(2));

    expect(resources.stopOwner(7)).toEqual([]);
    releaseAccess();

    await expect(pendingGrant).rejects.toThrow();
    await expect(pendingBytes).rejects.toThrow();
    expect((Reflect.get(resources, 'grants') as Map<string, unknown>).size).toBe(0);
  });

  it('formats default backup and journal filenames using the local calendar date rather than UTC', async () => {
    const bridgeModule = await import('../src/desktop/bridge');
    const localDateStamp = (bridgeModule as unknown as { localDateStamp(date?: Date): string })
      .localDateStamp;
    const fakeDate = {
      getFullYear: () => 2026,
      getMonth: () => 10,
      getDate: () => 5,
      toISOString: () => '2026-11-06T02:30:00.000Z',
    } as unknown as Date;
    expect(localDateStamp(fakeDate)).toBe('2026-11-05');
    expect(bridge).not.toContain('new Date().toISOString().slice(0, 10)');
  });
});
