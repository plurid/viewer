import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
import { QUIT_AGAIN_MS } from '../src/desktop/windows/quit-shortcut';

const native = vi.hoisted(() => ({
  flush: vi.fn<() => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  closeBrowsers: vi.fn<() => Promise<void>>(),
  flushSettings: vi.fn<() => Promise<void>>(),
  bridge: true,
  options: undefined as { openSettings(): Promise<void>; quitting(): boolean } | undefined,
  profile: '',
  /** File operations Quit would cancel, and when they finish. */
  pending: 0,
  drained: Promise.resolve(),
  ask: vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(),
  /** Electron's readiness; Desktop exists only after it. */
  ready: Promise.resolve(),
  open: vi.fn(),
  launchIn: vi.fn(),
  mcp: vi.fn<() => Promise<void>>(),
  cli: vi.fn<() => Promise<number>>(),
  /** Backup exports being written, which Quit waits for. */
  exported: vi.fn<() => Promise<void>>(),
  menu: vi.fn<(template: unknown) => void>(),
  warnShortcut: true,
}));
class NativeEvent {
  prevented = false;
  preventDefault() {
    this.prevented = true;
  }
}
class TestWindow extends EventEmitter {
  static windows: TestWindow[] = [];
  static focused: TestWindow | undefined;
  destroyed = false;
  visible = false;
  bounds: { x: number; y: number; width: number; height: number };
  maximized = false;
  fullscreen = false;
  minimized = false;
  webContents = Object.assign(new EventEmitter(), {
    id: TestWindow.windows.length + 1,
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => this.destroyed,
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
    return TestWindow.focused;
  }
  async loadURL() {}
  show() {
    this.visible = true;
  }
  isVisible() {
    return this.visible;
  }
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
  getAppPath: () => process.cwd(),
  getVersion: () => '0.0.0',
  whenReady: () => native.ready,
  terminated: false,
  exit: vi.fn<(code: number) => void>(),
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
  Menu: { buildFromTemplate: (value: unknown) => value, setApplicationMenu: native.menu },
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
vi.mock('../src/desktop/agents/mcp-client', () => ({ runMCPClient: native.mcp }));
vi.mock('../src/desktop/cli/run', () => ({ runCLI: native.cli }));
vi.mock('../src/desktop/bridge', () => ({
  Desktop: class {
    settings = {
      snapshot: () => ({
        settings: { ...defaultSettings('/fixtures'), quit: { warnShortcut: native.warnShortcut } },
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
    browsers = { closeAll: native.closeBrowsers };
    backups = { exported: native.exported };
    workspaceSessions = {
      snapshot: () => undefined,
      create: () => 'workspace',
      owner: () => undefined,
    };
    attach = vi.fn();
    open = native.open;
    openIn = vi.fn();
    launchIn = native.launchIn;
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
  TestWindow.focused = undefined;
  application.removeAllListeners();
  application.terminated = false;
  native.bridge = true;
  native.flush.mockReset().mockResolvedValue();
  native.dispose.mockReset().mockResolvedValue();
  native.closeBrowsers.mockReset().mockResolvedValue();
  native.flushSettings.mockReset().mockResolvedValue();
  native.pending = 0;
  native.drained = Promise.resolve();
  native.ask.mockReset().mockResolvedValue({ response: 2 });
  native.options = undefined;
  native.ready = Promise.resolve();
  native.mcp.mockReset().mockResolvedValue();
  native.cli.mockReset().mockResolvedValue(0);
  native.exported.mockReset().mockResolvedValue();
  native.warnShortcut = true;
  application.exit.mockReset().mockImplementation(() => {
    application.terminated = true;
  });
  native.profile = await temporaryRoot('viewer-lifecycle-');
});
/** Starts Viewer with its first workspace window open and its own launch request delivered. */
async function launch() {
  await import('../src/main');
  await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(1));
  await vi.waitFor(() => expect(native.launchIn).toHaveBeenCalledOnce());
  native.launchIn.mockClear();
}
/** Waits for the work already started to run. */
const idle = () => new Promise((resolve) => setTimeout(resolve, 20));
/** Keeps an expected failure's log for the test to read. */
const logged = () => vi.spyOn(console, 'error').mockImplementation(() => {});
/** The options of the `index`th native question, asked with or without a parent window. */
const question = (index: number) =>
  native.ask.mock.calls[index]!.find(
    (argument): argument is { message: string; buttons: string[] } =>
      !!argument && typeof argument === 'object' && 'buttons' in argument,
  );
afterEach(async () => {
  vi.restoreAllMocks();
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
  beforeEach(launch);
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
    const browserStop = gate();
    const disposal = gate();
    native.flush.mockReturnValue(save.promise);
    native.closeBrowsers.mockReturnValue(browserStop.promise);
    native.dispose.mockReturnValue(disposal.promise);
    application.quit();
    application.quit();
    await vi.waitFor(() => expect(native.flush).toHaveBeenCalledOnce());
    expect(native.bridge).toBe(true);
    expect(native.closeBrowsers).not.toHaveBeenCalled();
    expect(TestWindow.windows.every((window) => !window.destroyed)).toBe(true);
    save.resolve();
    await vi.waitFor(() => expect(native.closeBrowsers).toHaveBeenCalledTimes(1));
    expect(TestWindow.windows.every((window) => !window.destroyed)).toBe(true);
    expect(native.dispose).not.toHaveBeenCalled();
    browserStop.resolve();
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
  it('does not ask about a window’s own failed save while Quit saves, and Quit completes', async () => {
    const save = gate();
    native.flush.mockReturnValueOnce(save.promise);
    native.flush.mockRejectedValueOnce(new Error('Draft storage is full'));
    application.quit();
    await vi.waitFor(() => expect(native.flush).toHaveBeenCalledOnce());
    const window = TestWindow.windows[0];
    window.close();
    await vi.waitFor(() => expect(native.flush).toHaveBeenCalledTimes(2));
    await idle();
    expect(window.destroyed).toBe(false);
    save.resolve();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(native.ask).not.toHaveBeenCalled();
    expect(native.dispose).toHaveBeenCalledOnce();
  });
  it('does not ask about a window’s own save that fails after Quit closed the window', async () => {
    const save = gate();
    let fail!: (error: Error) => void;
    native.flush.mockReturnValueOnce(save.promise);
    native.flush.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    application.quit();
    await vi.waitFor(() => expect(native.flush).toHaveBeenCalledOnce());
    const window = TestWindow.windows[0];
    window.close();
    save.resolve();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(window.destroyed).toBe(true);
    fail(new Error('The window closed before its changes were saved.'));
    await idle();
    expect(native.ask).not.toHaveBeenCalled();
  });
  it.each(['before', 'after'] as const)(
    'closes Settings once when its own save finishes %s the Quit save',
    async (order) => {
      await native.options!.openSettings();
      const settings = TestWindow.windows[1];
      const closed = vi.fn();
      settings.on('closed', closed);
      const save = gate();
      const settingsSave = gate();
      native.flush.mockReturnValueOnce(save.promise);
      native.flushSettings.mockReturnValueOnce(settingsSave.promise);
      application.quit();
      await vi.waitFor(() => expect(native.flush).toHaveBeenCalledOnce());
      settings.close();
      expect(native.flushSettings).toHaveBeenCalledOnce();
      const [first, second] = order === 'before' ? [settingsSave, save] : [save, settingsSave];
      first.resolve();
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
      second.resolve();
      await vi.waitFor(() => expect(application.terminated).toBe(true));
      await idle();
      expect(closed).toHaveBeenCalledOnce();
      expect(native.flushSettings).toHaveBeenCalledOnce();
      expect(native.flush).toHaveBeenCalledOnce();
      expect(native.dispose).toHaveBeenCalledOnce();
    },
  );
  it('tells Desktop it is quitting only once Quit closes the windows', async () => {
    const save = gate();
    const guests = gate();
    native.flush.mockReturnValueOnce(save.promise);
    native.closeBrowsers.mockReturnValueOnce(guests.promise);
    const quitting: boolean[] = [];
    TestWindow.windows[0].on('closed', () => quitting.push(native.options!.quitting()));
    expect(native.options!.quitting()).toBe(false);
    application.quit();
    expect(native.options!.quitting()).toBe(false);
    save.resolve();
    await vi.waitFor(() => expect(native.closeBrowsers).toHaveBeenCalledOnce());
    expect(native.options!.quitting()).toBe(false);
    guests.resolve();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(quitting).toEqual([true]);
    expect(native.options!.quitting()).toBe(true);
  });
  it('asks when browser guests fail to stop: Keep Open stays, and a later Quit succeeds', async () => {
    const log = logged();
    native.closeBrowsers.mockRejectedValueOnce(new Error('A guest did not stop'));
    native.ask.mockResolvedValueOnce({ response: 1 });
    application.quit();
    await vi.waitFor(() => expect(native.ask).toHaveBeenCalledOnce());
    expect(question(0)).toMatchObject({
      message: 'Viewer could not close its browser planes',
      buttons: ['Retry', 'Keep Open'],
    });
    expect(log).toHaveBeenCalledWith(
      'Viewer could not close its browser planes',
      expect.any(Error),
    );
    await idle();
    expect(application.terminated).toBe(false);
    expect(TestWindow.windows[0].destroyed).toBe(false);
    expect(native.dispose).not.toHaveBeenCalled();
    expect(native.options!.quitting()).toBe(false);
    await native.options!.openSettings();
    expect(TestWindow.windows).toHaveLength(2);
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(native.flush).toHaveBeenCalledTimes(2);
    expect(native.closeBrowsers).toHaveBeenCalledTimes(2);
  });
  it('stops browser guests again on Retry, then quits', async () => {
    logged();
    native.closeBrowsers.mockRejectedValueOnce(new Error('A guest did not stop'));
    native.ask.mockResolvedValueOnce({ response: 0 });
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(native.closeBrowsers).toHaveBeenCalledTimes(2);
    expect(native.flush).toHaveBeenCalledOnce();
    expect(native.ask).toHaveBeenCalledOnce();
  });
  it('saves only once the backup exports being written have finished', async () => {
    const exports = gate();
    native.exported.mockReturnValueOnce(exports.promise);
    application.quit();
    await idle();
    expect(native.exported).toHaveBeenCalledOnce();
    expect(native.flush).not.toHaveBeenCalled();
    expect(TestWindow.windows[0].destroyed).toBe(false);
    exports.resolve();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(native.flush).toHaveBeenCalledOnce();
  });
  it('saves the Settings window’s placement as part of Quit, before the services stop', async () => {
    const { readFile } = await import('node:fs/promises');
    await native.options!.openSettings();
    const frame = { x: 240, y: 160, width: 920, height: 660 };
    TestWindow.windows[1].setBounds(frame);
    let placement: { bounds: typeof frame } | undefined;
    native.dispose.mockImplementation(async () => {
      placement = await readFile(path.join(native.profile, 'settings-window-v1.json'), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => undefined);
    });
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(placement?.bounds).toEqual(frame);
  });
  it('terminates when Desktop fails to stop its services', async () => {
    const log = logged();
    native.dispose.mockRejectedValueOnce(new Error('Desktop services failed to stop.'));
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(native.dispose).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Desktop shutdown failed', expect.any(Error));
  });
  it('opens no window for activate, open-file, second-instance or Settings while Quit saves', async () => {
    const workspace = TestWindow.windows[0];
    workspace.close();
    await vi.waitFor(() => expect(workspace.destroyed).toBe(true));
    const save = gate();
    native.flush.mockReturnValueOnce(save.promise);
    application.quit();
    application.emit('activate');
    application.emit('open-file', new NativeEvent(), '/fixtures/report.pdf');
    application.emit('second-instance', new NativeEvent(), [], '/fixtures', {
      request: { paths: ['/fixtures/notes.txt'], newWindow: false, terminal: false },
    });
    await native.options!.openSettings();
    await idle();
    expect(TestWindow.windows).toHaveLength(1);
    expect(native.open).toHaveBeenCalledExactlyOnceWith(['/fixtures/report.pdf']);
    expect(native.launchIn).not.toHaveBeenCalled();
    save.resolve();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
  });
  it.each([
    ['darwin', false],
    ['linux', true],
  ] as const)('on %s, closing the last window quits: %s', async (platform, quits) => {
    const window = TestWindow.windows[0];
    window.close();
    await vi.waitFor(() => expect(window.destroyed).toBe(true));
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...original, value: platform });
    try {
      application.emit('window-all-closed');
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
    if (quits) await vi.waitFor(() => expect(application.terminated).toBe(true));
    else await idle();
    expect(application.terminated).toBe(quits);
    expect(native.dispose).toHaveBeenCalledTimes(quits ? 1 : 0);
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
    /** A drain that fails until a test replaces it. */
    const stoppedQueue = () => {
      const stopped = Promise.reject(new Error('The operation queue stopped'));
      stopped.catch(() => {});
      return stopped;
    };
    it('asks when waiting for them fails: Keep Open stays, and a later Quit asks again', async () => {
      const log = logged();
      native.pending = 1;
      native.drained = stoppedQueue();
      native.ask.mockResolvedValueOnce({ response: 0 });
      native.ask.mockResolvedValueOnce({ response: 1 });
      application.quit();
      await vi.waitFor(() => expect(native.ask).toHaveBeenCalledTimes(2));
      expect(question(1)).toMatchObject({
        message: 'Viewer could not finish the file operations',
        buttons: ['Retry', 'Keep Open'],
      });
      expect(log).toHaveBeenCalledWith(
        'Viewer could not finish the file operations',
        expect.any(Error),
      );
      await idle();
      expect(native.flush).not.toHaveBeenCalled();
      expect(application.terminated).toBe(false);
      expect(TestWindow.windows.every((window) => !window.destroyed)).toBe(true);
      native.ask.mockResolvedValueOnce({ response: 1 });
      application.quit();
      await vi.waitFor(() => expect(application.terminated).toBe(true));
      expect(native.ask).toHaveBeenCalledTimes(3);
      expect(question(2)!.buttons).toEqual([
        'Wait for them',
        'Cancel them and quit',
        'Keep Viewer open',
      ]);
      expect(native.flush).toHaveBeenCalledOnce();
    });
    it('waits for them again on Retry, then quits', async () => {
      logged();
      native.pending = 1;
      native.drained = stoppedQueue();
      native.ask.mockResolvedValueOnce({ response: 0 });
      native.ask.mockImplementationOnce(async () => {
        native.drained = Promise.resolve();
        return { response: 0 };
      });
      application.quit();
      await vi.waitFor(() => expect(application.terminated).toBe(true));
      expect(native.ask).toHaveBeenCalledTimes(2);
      expect(native.flush).toHaveBeenCalledOnce();
    });
    it('opens a window for activate, open-file and second-instance while it asks', async () => {
      const closeWindows = async () => {
        for (const window of TestWindow.windows) window.close();
        await vi.waitFor(() =>
          expect(TestWindow.windows.every((window) => window.destroyed)).toBe(true),
        );
      };
      await closeWindows();
      native.pending = 1;
      const answer = gate();
      native.ask.mockReturnValueOnce(answer.promise.then(() => ({ response: 2 })));
      application.quit();
      await vi.waitFor(() => expect(native.ask).toHaveBeenCalledOnce());
      application.emit('activate');
      await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(2));
      await closeWindows();
      application.emit('open-file', new NativeEvent(), '/fixtures/report.pdf');
      expect(native.open).toHaveBeenCalledExactlyOnceWith(['/fixtures/report.pdf']);
      await vi.waitFor(() => expect(TestWindow.windows).toHaveLength(3));
      await closeWindows();
      application.emit('second-instance', new NativeEvent(), [], '/fixtures', {
        request: { paths: ['/fixtures/notes.txt'], newWindow: false, terminal: false },
      });
      await vi.waitFor(() => expect(native.launchIn).toHaveBeenCalledOnce());
      expect(TestWindow.windows).toHaveLength(4);
      answer.resolve();
      await idle();
      expect(application.terminated).toBe(false);
      expect(TestWindow.windows[3].destroyed).toBe(false);
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
    expect(native.closeBrowsers).not.toHaveBeenCalled();
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
// the app menu, and with it Quit Viewer, is macOS's
describe.runIf(process.platform === 'darwin')('⌘Q twice to quit', () => {
  beforeEach(launch);
  /** Chooses Quit Viewer in the app menu, by its key equivalent or a click. */
  const choose = (byShortcut: boolean) => {
    const template = native.menu.mock.calls.at(-1)![0] as {
      submenu?: { label?: string; click?(item: unknown, window: unknown, event: object): void }[];
    }[];
    const item = template[0]!.submenu!.find((entry) => entry.label === 'Quit Viewer')!;
    item.click!(undefined, undefined, { triggeredByAccelerator: byShortcut });
  };
  const hints = (window: TestWindow) =>
    window.webContents.send.mock.calls.filter(
      ([, event]) => (event as { type: string }).type === 'quit-hint',
    );
  it('shows the hint on the first press, and a second within the moment quits', async () => {
    const window = TestWindow.windows[0];
    choose(true);
    expect(hints(window)).toEqual([
      ['viewer:event', { type: 'quit-hint', duration: QUIT_AGAIN_MS }],
    ]);
    await idle();
    expect(native.flush).not.toHaveBeenCalled();
    expect(application.terminated).toBe(false);
    choose(true);
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(hints(window)).toHaveLength(1);
  });
  it('shows the hint again once the moment has passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      choose(true);
      vi.advanceTimersByTime(QUIT_AGAIN_MS);
      choose(true);
    } finally {
      vi.useRealTimers();
    }
    expect(hints(TestWindow.windows[0])).toHaveLength(2);
    await idle();
    expect(application.terminated).toBe(false);
  });
  it('shows the hint in the focused Settings window', async () => {
    await native.options!.openSettings();
    const [workspace, settings] = TestWindow.windows;
    TestWindow.focused = settings;
    choose(true);
    expect(hints(settings!)).toHaveLength(1);
    expect(hints(workspace!)).toEqual([]);
  });
  it('shows the hint in the focused window though Electron calls it covered', async () => {
    const window = TestWindow.windows[0]!;
    TestWindow.focused = window;
    window.visible = false;
    choose(true);
    expect(hints(window)).toHaveLength(1);
    await idle();
    expect(application.terminated).toBe(false);
  });
  it('shows the hint in the covered workspace window behind a focused page window', async () => {
    const [workspace] = TestWindow.windows;
    TestWindow.focused = new TestWindow({ width: 1000, height: 740 });
    workspace!.visible = false;
    choose(true);
    expect(hints(workspace!)).toHaveLength(1);
    await idle();
    expect(application.terminated).toBe(false);
  });
  it('quits on the first ⌘Q with no window focused and the workspace window hidden', async () => {
    const [workspace] = TestWindow.windows;
    TestWindow.focused = undefined;
    workspace!.visible = false;
    choose(true);
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(hints(workspace!)).toEqual([]);
  });
  it('quits at once when Quit Viewer is clicked', async () => {
    choose(false);
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(hints(TestWindow.windows[0])).toEqual([]);
  });
  it('quits on the first ⌘Q with the warning off', async () => {
    native.warnShortcut = false;
    choose(true);
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    expect(hints(TestWindow.windows[0])).toEqual([]);
  });
  it.each(['minimized', 'closed'] as const)(
    'quits on the first ⌘Q with the only window %s',
    async (state) => {
      const window = TestWindow.windows[0];
      if (state === 'minimized') window.minimized = true;
      else {
        window.close();
        await vi.waitFor(() => expect(window.destroyed).toBe(true));
      }
      choose(true);
      await vi.waitFor(() => expect(application.terminated).toBe(true));
      expect(hints(window)).toEqual([]);
    },
  );
});
describe('Quit before Desktop exists', () => {
  it('terminates without opening a window or stopping services', async () => {
    const ready = gate();
    native.ready = ready.promise;
    await import('../src/main');
    application.quit();
    await vi.waitFor(() => expect(application.terminated).toBe(true));
    ready.resolve();
    await idle();
    expect(TestWindow.windows).toHaveLength(0);
    expect(native.options).toBeUndefined();
    expect(native.dispose).not.toHaveBeenCalled();
    expect(application.exit).not.toHaveBeenCalled();
  });
});
describe('headless exit', () => {
  const argv = process.argv;
  const exitCode = process.exitCode;
  let written: string[];
  beforeEach(() => {
    written = [];
    const record = (name: string) =>
      ((chunk: string, done?: () => void) => {
        written.push(`${name} ${chunk}`);
        done?.();
        return true;
      }) as typeof process.stdout.write;
    vi.spyOn(process.stdout, 'write').mockImplementation(record('stdout'));
    vi.spyOn(process.stderr, 'write').mockImplementation(record('stderr'));
    application.exit.mockImplementation((code) => {
      written.push(`exit ${code}`);
      application.terminated = true;
    });
  });
  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
  });
  /** Starts Viewer as `viewer <args>` from a terminal. */
  async function run(...args: string[]) {
    process.argv = [argv[0]!, argv[1]!, ...args];
    await import('../src/main');
    await vi.waitFor(() => expect(application.terminated).toBe(true));
  }
  it('reports a failed agent server, flushes both streams, then exits with 1', async () => {
    native.mcp.mockRejectedValue(new Error('The agent server is unavailable'));
    await run('--mcp');
    expect(written).toEqual([
      'stderr The agent server is unavailable\n',
      'stdout ',
      'stderr ',
      'exit 1',
    ]);
  });
  it('exits with a failed command’s code after flushing both streams', async () => {
    native.cli.mockResolvedValue(3);
    await run('--version');
    expect(written).toEqual(['stdout ', 'stderr ', 'exit 3']);
  });
  it('quits normally after a successful command', async () => {
    await run('--version');
    expect(native.cli).toHaveBeenCalledOnce();
    expect(application.exit).not.toHaveBeenCalled();
    expect(written).toEqual([]);
    expect(native.options).toBeUndefined();
  });
});
