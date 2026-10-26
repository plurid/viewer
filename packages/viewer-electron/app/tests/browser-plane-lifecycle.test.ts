import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  guests: [] as {
    webContents: EventEmitter & { gone: boolean };
    destroy(): void;
    gone: boolean;
  }[],
  flush: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({
  BrowserWindow: class {
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
    });
    constructor() {
      fixture.guests.push(this);
    }
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
    }
  },
  session: {
    fromPartition: () => ({
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
  const owner = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
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
