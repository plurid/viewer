import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';

const fixture = vi.hoisted(() => ({
  guests: [] as {
    webContents: EventEmitter & {
      gone: boolean;
      crashed: boolean;
      forcefullyCrashRenderer: ReturnType<typeof vi.fn>;
      reload: ReturnType<typeof vi.fn>;
      getZoomFactor(): number;
      debugger: { sendCommand: ReturnType<typeof vi.fn> };
    };
    destroy(): void;
    gone: boolean;
    options: BrowserWindowConstructorOptions;
    show(): void;
    close: ReturnType<typeof vi.fn>;
  }[],
  flush: vi.fn(async () => {}),
  userAgent: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    gone = false;
    webContents = Object.assign(new EventEmitter(), {
      gone: false,
      isDestroyed() {
        return this.gone;
      },
      getURL() {
        if (this.gone) throw new Error('Object has been destroyed');
        return 'http://localhost/';
      },
      getTitle: () => 'Fixture',
      isLoading: () => false,
      getZoomFactor: () => 1,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      setFrameRate: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      debugger: { attach: vi.fn(), sendCommand: vi.fn(async () => {}) },
      crashed: false,
      isCrashed() {
        return this.crashed;
      },
      forcefullyCrashRenderer: vi.fn(function (this: { crashed: boolean }) {
        this.crashed = true;
      }),
      reload: vi.fn(function (this: { crashed: boolean }) {
        this.crashed = false;
      }),
    });
    constructor(public options: BrowserWindowConstructorOptions) {
      super();
      fixture.guests.push(this);
    }
    show = vi.fn();
    focus = vi.fn();
    setTitle = vi.fn();
    close = vi.fn(() => this.destroy());
    isDestroyed() {
      return this.gone;
    }
    loadURL() {
      return Promise.resolve();
    }
    destroy() {
      this.webContents.gone = true;
      this.webContents.emit('did-stop-loading');
      this.gone = true;
      this.emit('closed');
    }
  },
  app: { getName: () => 'Viewer' },
  session: {
    fromPartition: () => ({
      getUserAgent: () => 'Mozilla/5.0 Viewer/1.0.0 Chrome/142.0.0.0 Electron/45.1.0',
      setUserAgent: fixture.userAgent,
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() },
      cookies: { flushStore: fixture.flush },
      flushStorageData: vi.fn(),
    }),
  },
  sharedTexture: undefined,
}));
import { BrowserPlanes } from '../src/desktop/browser/browser-planes';
import type { BrowserWindow } from 'electron';

beforeEach(() => {
  fixture.guests.length = 0;
  fixture.flush.mockClear();
});

async function opened() {
  const send = vi.fn();
  const owner = {
    isDestroyed: () => false,
    isVisible: () => false,
    webContents: { isDestroyed: () => false, send },
  };
  const browsers = new BrowserPlanes(() => owner as unknown as BrowserWindow);
  await browsers.request(1, {
    kind: 'open',
    id: 'page',
    url: 'http://localhost/',
    width: 640,
    height: 480,
  });
  return { browsers, guest: fixture.guests[0]!, send };
}

it('opens a bounded normal page window without preload or Node authority, and retires it with its owner', async () => {
  const { browsers, guest } = await opened();
  await browsers.request(1, { kind: 'action', id: 'page', action: 'native-window' });
  const native = fixture.guests[1]!;
  expect(native.options.webPreferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
  });
  expect(native.options.webPreferences?.preload).toBeUndefined();
  // pages see Chromium's identity, which sites such as WhatsApp Web require
  expect(fixture.userAgent).toHaveBeenCalledWith('Mozilla/5.0 Chrome/142.0.0.0');
  expect(native.options.webPreferences?.offscreen).toBeUndefined();
  expect(native.show).not.toHaveBeenCalled();
  const prevented = vi.fn();
  native.webContents.emit(
    'will-navigate',
    { preventDefault: prevented },
    'file:///private/fixture.txt',
  );
  expect(prevented).toHaveBeenCalledOnce();
  await browsers.request(1, { kind: 'action', id: 'page', action: 'native-window' });
  expect(fixture.guests).toHaveLength(2);
  expect(guest.gone).toBe(false);
  browsers.stopOwner(1);
  expect(native.close).toHaveBeenCalledOnce();
  expect(native.gone).toBe(true);
  await browsers.closeAll();
});

it('ignores guest events after webContents destruction, before its window finishes closing', async () => {
  const { browsers, guest, send } = await opened();
  guest.webContents.gone = true;
  expect(() => guest.webContents.emit('did-stop-loading')).not.toThrow();
  expect(send).not.toHaveBeenCalled();
  await expect(browsers.request(1, { kind: 'state', id: 'page' })).rejects.toThrow('closed');
  await browsers.closeAll();
});

it('detaches and destroys guests before awaiting browser storage flush on shutdown', async () => {
  const { browsers, guest, send } = await opened();
  fixture.flush.mockImplementationOnce(async () => {
    expect(guest.gone).toBe(true);
  });
  await expect(browsers.closeAll()).resolves.toBeUndefined();
  expect(send).not.toHaveBeenCalled();
  await expect(
    browsers.request(1, {
      kind: 'open',
      id: 'late',
      url: 'http://localhost/',
      width: 640,
      height: 480,
    }),
  ).rejects.toThrow('closing');
});

it('reports a hung page in its plane and ends its process before reloading it', async () => {
  const { browsers, guest, send } = await opened();
  guest.webContents.emit('unresponsive');
  const errors = () =>
    send.mock.calls
      .map(([, event]) => (event as { browser?: { error?: string } }).browser?.error)
      .filter((error) => error !== undefined);
  expect(errors()).toContain('This page is not responding. Reload to try again.');
  await browsers.request(1, { kind: 'action', id: 'page', action: 'reload' });
  expect(guest.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
  expect(guest.webContents.reload).toHaveBeenCalledOnce();
  // a page that answers again needs no crash before its reload
  guest.webContents.emit('unresponsive');
  guest.webContents.emit('responsive');
  await browsers.request(1, { kind: 'action', id: 'page', action: 'reload' });
  expect(guest.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
  await browsers.closeAll();
});

it('places mouse input in the zoomed page’s CSS pixels, and keeps wheel deltas in window pixels', async () => {
  const { browsers, guest } = await opened();
  guest.webContents.getZoomFactor = () => 1.5;
  await browsers.request(1, {
    kind: 'input',
    id: 'page',
    event: { type: 'mouseWheel', x: 300, y: 150, deltaX: 0, deltaY: 100, modifiers: 0 },
  });
  expect(guest.webContents.debugger.sendCommand).toHaveBeenLastCalledWith(
    'Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: 200, y: 100, deltaX: 0, deltaY: 100, modifiers: 0 },
  );
  await browsers.closeAll();
});

it('destroys page windows at Quit, so a page cannot hold it', async () => {
  const { browsers } = await opened();
  await browsers.request(1, { kind: 'action', id: 'page', action: 'native-window' });
  const native = fixture.guests[1]!;
  native.close.mockImplementation(() => {});
  await browsers.closeAll();
  expect(native.close).not.toHaveBeenCalled();
  expect(native.gone).toBe(true);
});
