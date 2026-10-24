import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const native = vi.hoisted(() => ({
  flush: vi.fn<() => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  flushSettings: vi.fn<() => Promise<void>>(),
  bridge: true,
  options: undefined as { openSettings(): Promise<void> } | undefined,
  profile: '',
  /** File operations Quit would cancel, and when they finish. */
  pending: 0,
  drained: Promise.resolve(),
  ask: vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(),
}));
class NativeEvent {
  prevented = false;
  preventDefault() {
    this.prevented = true;
  }
}
class TestWindow extends EventEmitter {
  static windows: TestWindow[] = [];
  destroyed = false;
  bounds: { x: number; y: number; width: number; height: number };
  maximized = false;
  fullscreen = false;
  minimized = false;
  webContents = Object.assign(new EventEmitter(), {
    id: TestWindow.windows.length + 1,
    setWindowOpenHandler: vi.fn(),
  });
  constructor(options: { x?: number; y?: number; width: number; height: number }) {
    super();
    this.bounds = {
      x: options.x ?? 100,
      y: options.y ?? 100,
      width: options.width,
      height: options.height,
    };
    TestWindow.windows.push(this);
  }
  static getFocusedWindow() {
    return undefined;
  }
  async loadURL() {}
  show() {}
  focus() {}
  getSize() {
    return [900, 640];
  }
  getBounds() {
    return { ...this.bounds };
  }
  getNormalBounds() {
    return { ...this.bounds };
  }
  isMaximized() {
    return this.maximized;
  }
  isFullScreen() {
    return this.fullscreen;
  }
  isMinimized() {
    return this.minimized;
  }
  maximize() {
    this.maximized = true;
  }
  setFullScreen(value: boolean) {
    this.fullscreen = value;
  }
  setBounds(bounds: typeof this.bounds) {
    this.bounds = { ...bounds };
    this.emit('move');
    this.emit('resize');
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    if (this.destroyed) return;
    const event = new NativeEvent();
    this.emit('close', event);
    if (event.prevented) return;
    this.destroyed = true;
    this.emit('closed');
  }
}
const application = Object.assign(new EventEmitter(), {
  setName: vi.fn(),
  requestSingleInstanceLock: () => true,
  getPath: () => native.profile,
  whenReady: () => Promise.resolve(),
  terminated: false,
  quit(): void {
    const before = new NativeEvent();
    application.emit('before-quit', before);
    if (before.prevented) return;
    for (const window of TestWindow.windows) window.close();
    if (TestWindow.windows.some((window) => !window.destroyed)) return;
    const will = new NativeEvent();
    application.emit('will-quit', will);
    if (!will.prevented) this.terminated = true;
  },
});
const theme = new EventEmitter();
let processListeners: Map<string | symbol, Set<(...args: never[]) => unknown>>;
vi.mock('electron', () => ({
  app: application,
  BrowserWindow: TestWindow,
  nativeTheme: theme,
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: true }) },
  screen: {
    getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 25, width: 1920, height: 1000 } }],
    getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 25, width: 1920, height: 1000 } }),
    getDisplayMatching: () => ({ id: 1, workArea: { x: 0, y: 25, width: 1920, height: 1000 } }),
  },
  Menu: { buildFromTemplate: (value: unknown) => value, setApplicationMenu: vi.fn() },
  dialog: { showMessageBox: native.ask },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  crashReporter: { start: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  session: {
    defaultSession: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onHeadersReceived: vi.fn(), onBeforeRequest: vi.fn() },
    },
  },
}));
vi.mock('../src/desktop/agents/mcp-client', () => ({ runMCPClient: vi.fn() }));
vi.mock('../src/desktop/bridge', () => ({
  Desktop: class {
    settings = {
      snapshot: () => ({
        settings: defaultSettings('/fixtures'),
        ui: normalizePreferences(),
        look: 'dark',
      }),
      load: async () => {},
    };
    prepareSettings = async () => {};
    windowPreferences = () => this.settings.snapshot();
    workspaceForWindow = () => undefined;
    createWorkspace = () => 'workspace';
    resources = { response: vi.fn() };
    workspaceSessions = {
      snapshot: () => undefined,
      create: () => 'workspace',
      owner: () => undefined,
    };
    attach = vi.fn();
    open = vi.fn();
    openIn = vi.fn();
    launchIn = vi.fn();
    windowForWorkspace = vi.fn();
    emit = vi.fn();
    flush = native.flush;
    flushWindow = native.flush;
    flushSettings = native.flushSettings;
    pendingOperations = () => native.pending;
    operationsDrained = () => native.drained;
    constructor(_path: string, _trusted: unknown, options: typeof native.options) {
      native.options = options;
    }
    async dispose() {
      native.bridge = false;
      await native.dispose();
    }
  },
}));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  processListeners = new Map(
    process.eventNames().map((event) => [event, new Set(process.rawListeners(event))]),
  );
  vi.resetModules();
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
  vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
  vi.stubEnv('VIEWER_RENDER_TEST', '0');
  vi.stubEnv('VIEWER_DATA_DIRECTORY', '');
  TestWindow.windows = [];
  application.removeAllListeners();
  application.terminated = false;
  native.bridge = true;
  native.flush.mockReset().mockResolvedValue();
  native.dispose.mockReset().mockResolvedValue();
  native.flushSettings.mockReset().mockResolvedValue();
  native.pending = 0;
  native.drained = Promise.resolve();
  native.ask.mockReset().mockResolvedValue({ response: 2 });
  native.profile = await temporaryRoot('viewer-lifecycle-');
  await import('../src/main');
  await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(1));
});
afterEach(async () => {
  native.pending = 0;
  application.quit();
  await vi.waitFor(() => expect(application.terminated).toBe(true));
  application.removeAllListeners();
  theme.removeAllListeners();
  for (const event of process.eventNames()) {
    const previous = processListeners.get(event);
    for (const listener of process.rawListeners(event))
      if (!previous?.has(listener)) process.removeListener(event, listener);
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await trashTemporary(native.profile);
});
describe('native window and application shutdown', () => {
  it('treats a load cancellation after closing a starting workspace as an expected close', async () => {
    TestWindow.windows[0].close();
    await vi.waitFor(() => expect(TestWindow.windows[0].destroyed).toBe(true));
    let reject!: (error: Error) => void;
    const loading = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const spy = vi.spyOn(TestWindow.prototype, 'loadURL').mockReturnValue(loading);
    try {
      application.emit('activate');
      await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(2));
      const starting = TestWindow.windows[1];
      starting.close();
      await vi.waitFor(() => expect(starting.destroyed).toBe(true));
      reject(new Error('ERR_ABORTED while closing'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(native.dispose).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it('settles a Settings load cancelled by an actual native close', async () => {
    let reject!: (error: Error) => void;
    const loading = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const spy = vi.spyOn(TestWindow.prototype, 'loadURL').mockReturnValue(loading);
    try {
      const opening = native.options!.openSettings();
      await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(2));
      const starting = TestWindow.windows[1];
      starting.close();
      await vi.waitFor(() => expect(starting.destroyed).toBe(true));
      reject(new Error('ERR_ABORTED while closing Settings'));
      await expect(opening).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
  it('retains a Rectangle-sized frame when closing and reopening on macOS', async () => {
    const frame = { x: 0, y: 25, width: 1920, height: 1000 };
    const window = TestWindow.windows[0];
    window.setBounds(frame);
    window.close();
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
    application.emit('activate');
    await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(2));
    expect(TestWindow.windows[1].getBounds()).toEqual(frame);
  });
  it('saves the final position when closing before the resize debounce fires', async () => {
    const frame = { x: 185, y: 140, width: 1000, height: 700 };
    const window = TestWindow.windows[0];
    window.setBounds(frame);
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(
      await readFile(path.join(native.profile, 'window-state-v1.json'), 'utf8'),
    );
    expect(saved.bounds).toEqual(frame);
  });
  it('closes every window before disposing IPC, saves once and refuses reopening during Quit', async () => {
    await native.options!.openSettings();
    const save = gate();
    const disposal = gate();
    native.flush.mockReturnValue(save.promise);
    native.dispose.mockReturnValue(disposal.promise);
    application.quit();
    application.quit();
    expect(native.flush).toHaveBeenCalledTimes(1);
    expect(native.bridge).toBe(true);
    expect(TestWindow.windows.every((window) => !window.destroyed)).toBe(true);
    save.resolve();
    await vi.waitFor(() => expect(native.dispose).toHaveBeenCalledTimes(1));
    expect(TestWindow.windows.every((window) => window.destroyed)).toBe(true);
    application.emit('activate');
    application.emit('second-instance');
    await native.options!.openSettings();
    expect(TestWindow.windows).toHaveLength(2);
    application.quit();
    expect(native.dispose).toHaveBeenCalledTimes(1);
    disposal.resolve();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
  });
  describe('Quit while file operations are in progress (2026-10-21)', () => {
    // Quit cancelled them without a word: queued work was never done.
    const buttons = () => (native.ask.mock.calls[0]?.[1] as { buttons: string[] }).buttons;
    it('asks first, and Keep Viewer open keeps everything running', async () => {
      native.pending = 2;
      application.quit();
      await vi.waitFor(() => expect(native.ask).toHaveBeenCalledOnce());
      expect(buttons()).toEqual(['Wait for them', 'Cancel them and quit', 'Keep Viewer open']);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(native.flush).not.toHaveBeenCalled();
      expect(application.terminated).toBe(false);
      expect(TestWindow.windows.every((window) => !window.destroyed)).toBe(true);
    });
    it('quits as before after Cancel them and quit', async () => {
      native.pending = 1;
      native.ask.mockResolvedValue({ response: 1 });
      application.quit();
      await vi.waitFor(() => expect(application.terminated).toBe(true));
      expect(native.flush).toHaveBeenCalledOnce();
    });
    it('quits once they finish after Wait for them, and a second Quit does not ask again', async () => {
      native.pending = 1;
      const finished = gate();
      native.drained = finished.promise;
      native.ask.mockResolvedValue({ response: 0 });
      application.quit();
      await vi.waitFor(() => expect(native.ask).toHaveBeenCalledOnce());
      application.quit();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(native.ask).toHaveBeenCalledOnce();
      expect(native.flush).not.toHaveBeenCalled();
      native.pending = 0;
      finished.resolve();
      await vi.waitFor(() => expect(application.terminated).toBe(true));
      expect(native.flush).toHaveBeenCalledOnce();
    });
  });
  it('a native window close saves once and preserves services for macOS reopening', async () => {
    const save = gate();
    native.flush.mockReturnValue(save.promise);
    const window = TestWindow.windows[0];
    window.close();
    window.close();
    expect(native.flush).toHaveBeenCalledTimes(1);
    expect(window.destroyed).toBe(false);
    save.resolve();
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
    expect(native.dispose).not.toHaveBeenCalled();
    expect(native.bridge).toBe(true);
    application.emit('activate');
    await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(2));
    expect(TestWindow.windows[1].destroyed).toBe(false);
  });

  it('keeps a workspace open when its save fails, and permits a later successful close', async () => {
    native.flush.mockRejectedValueOnce(new Error('Draft storage is full'));
    const window = TestWindow.windows[0];
    window.close();
    await vi.waitFor(() => expect(native.ask).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.destroyed).toBe(false);
    expect(native.dispose).not.toHaveBeenCalled();
    native.flush.mockResolvedValue(undefined);
    window.close();
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
  });

  it('cancels Quit on failed persistence and keeps the application available for retry', async () => {
    native.flush.mockRejectedValueOnce(new Error('Chat draft could not be saved'));
    application.quit();
    await vi.waitFor(() => expect(native.ask).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(application.terminated).toBe(false);
    expect(TestWindow.windows[0].destroyed).toBe(false);
    expect(native.dispose).not.toHaveBeenCalled();
    native.flush.mockResolvedValue(undefined);
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
  });

  it('joins a retried save before a native close can succeed', async () => {
    const retried = gate();
    native.flush.mockRejectedValueOnce(new Error('Temporary storage failure'));
    native.flush.mockReturnValueOnce(retried.promise);
    native.ask.mockResolvedValueOnce({ response: 0 });
    const window = TestWindow.windows[0];
    window.close();
    await vi.waitFor(() => expect(native.flush).toHaveBeenCalledTimes(2));
    expect(window.destroyed).toBe(false);
    retried.resolve();
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
  });
});
