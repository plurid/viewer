import { installApplicationMenu } from './desktop/windows/application-menu';
import {
  activateApplication,
  createIndependentWindow,
  dispatchApplicationCommand,
} from './desktop/windows/application-dispatch';
import { backdropChange, backdropWindowOptions } from './desktop/windows/backdrop';
import type { UIPreferences } from './domain/contracts';
import {
  nativeTheme,
  app,
  BrowserWindow,
  dialog,
  protocol,
  session,
  screen,
  crashReporter,
  globalShortcut,
  systemPreferences,
} from 'electron';
import type { WebPreferences } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync, realpathSync } from 'node:fs';
import { lookup } from 'mime-types';
import { accelerator, nativeMenuBindings } from './domain/preferences/shortcuts';
import { runMCPClient } from './desktop/agents/mcp-client';
import { Desktop } from './desktop/bridge';
import {
  WindowState,
  captureWindowFrame,
  restoreWindowFrame,
} from './desktop/windows/window-state';
import { errorMessage } from './domain/errors';
import { DiagnosticLog } from './desktop/diagnostics/diagnostics';
import { protectDiagnosticOutput } from './desktop/diagnostics/output';
import { applicationCSP } from './desktop/windows/application-csp';
import { debuggingAllowed } from './desktop/diagnostics/debugging';
import { HotkeyWindow } from './desktop/windows/hotkey-window';
import { macFiles } from './desktop/native/macos-files';
import { launchRequestSchema, parseLaunch, type LaunchRequest } from './domain/workspaces/launch';
import { askNatively } from './desktop/native/native-confirmation';
import { saveBeforeClose, type SaveFailureChoice } from './desktop/windows/save-before-close';
import { QuitSequence } from './desktop/windows/quit-sequence';
import type { QuitChoice, QuitRetryStep } from './desktop/windows/quit-sequence';
import { QuitShortcut } from './desktop/windows/quit-shortcut';
import { sendEvent } from './desktop/ipc/events';
import { WindowCreationRequests } from './desktop/windows/creation-requests';
import { isolatedShellHome } from './desktop/windows/test-integration';
import { isCLIInvocation } from './domain/cli/catalog';
import { runCLI } from './desktop/cli/run';
import { speechMediaAllowed } from './desktop/speech/media-policy';
import {
  frameLocationURLs,
  frameNavigationAllowed,
  isolatedContent,
  rendererRequestAllowed,
} from './desktop/windows/web-content-policy';
import { performanceMeter } from './desktop/diagnostics/performance';
import { assetPath, setAssetRoot } from './desktop/native/assets';
const terminalArguments = process.argv.slice(app.isPackaged ? 1 : 2);
const mcpMode = terminalArguments[0] === '--mcp';
const cliMode = !mcpMode && isCLIInvocation(terminalArguments);
const headless = mcpMode || cliMode;
if (headless) {
  const fail = (error: unknown) => {
    process.stderr.write(errorMessage(error) + '\n', () => app.exit(1));
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
}
// Headless stdout carries protocol or CLI results without diagnostic console wrapping.
if (!headless) protectDiagnosticOutput([process.stdout, process.stderr]);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'viewer-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: 'viewer-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: 'viewer-html',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
app.setName('Viewer');
setAssetRoot(app.isPackaged, app.getAppPath());
performanceMeter.start();
// Hidden rendering is restricted to QA with an explicitly isolated profile.
const renderTest = process.env.VIEWER_RENDER_TEST === '1';
const backgroundTest =
  renderTest && process.env.VIEWER_BACKGROUND_TEST === '1' && !!process.env.VIEWER_DATA_DIRECTORY;
if (backgroundTest && process.platform === 'darwin') app.setActivationPolicy('accessory');
/** The workspace and Settings windows: Viewer's own pages, reaching main only through the preload. */
const appWebPreferences = (): WebPreferences => ({
  ...isolatedContent,
  preload: path.join(__dirname, 'preload.cjs'),
  webviewTag: false,
  spellcheck: false,
  // Functional QA renders without showing windows or taking native focus.
  // Normal launches retain background throttling and visible windows.
  offscreen: backgroundTest,
  backgroundThrottling: !renderTest,
});
const defaultUserData = app.getPath('userData');
// An optional, main-process-only profile supports portable installations and isolated QA.
if (process.env.VIEWER_DATA_DIRECTORY) {
  if (!path.isAbsolute(process.env.VIEWER_DATA_DIRECTORY))
    throw new Error('VIEWER_DATA_DIRECTORY must be an absolute path.');
  mkdirSync(process.env.VIEWER_DATA_DIRECTORY, { recursive: true });
  app.setPath('userData', process.env.VIEWER_DATA_DIRECTORY);
}
const resolved = (directory: string) => {
  try {
    return realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
};
const shellCommandHome = headless
  ? undefined
  : isolatedShellHome({
      requested: process.env.VIEWER_TEST_SHELL_HOME && resolved(process.env.VIEWER_TEST_SHELL_HOME),
      renderTest,
      dataDirectory:
        process.env.VIEWER_DATA_DIRECTORY && resolved(process.env.VIEWER_DATA_DIRECTORY),
      defaultDataDirectory: resolved(defaultUserData),
    });
if (
  !debuggingAllowed({
    packaged: app.isPackaged,
    argv: process.argv,
    dataDirectory: process.env.VIEWER_DATA_DIRECTORY && resolved(process.env.VIEWER_DATA_DIRECTORY),
    defaultUserData: resolved(defaultUserData),
  })
) {
  console.error('Viewer does not start with a remote debugging switch on your own profile.');
  process.exit(1);
}
// Native crash dumps stay on this Mac; nothing is uploaded.
crashReporter.start({ uploadToServer: false, compress: true });
const diagnostics = new DiagnosticLog(
  path.join(app.getPath('userData'), 'Logs', 'diagnostics.log'),
);
const failure = (value: unknown) =>
  value instanceof Error ? (value.stack ?? value.message) : String(value);
// Monitors observe failures without changing how Node and Electron handle them.
process.on(
  'uncaughtExceptionMonitor',
  (error, origin) =>
    void diagnostics.record(
      origin === 'unhandledRejection' ? 'main-rejection' : 'main-exception',
      failure(error),
    ),
);
process.on('warning', (warning) => {
  if (warning.name === 'UnhandledPromiseRejectionWarning')
    void diagnostics.record('main-rejection', failure(warning));
});
app.on('render-process-gone', (_event, _contents, details) => {
  void diagnostics.record('renderer-gone', `${details.reason} (exit ${details.exitCode})`);
});
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return;
  const name = details.serviceName || details.name || details.type;
  void diagnostics.record('process-gone', `${name}: ${details.reason} (exit ${details.exitCode})`);
});
let window: BrowserWindow | null = null;
const viewerWindows = new Set<BrowserWindow>();
const windowFrames = new Map<BrowserWindow, WindowState>();
let hotkey: HotkeyWindow | undefined;
let desktop: Desktop | null = null;
let windowState: WindowState | undefined;
/** The Settings window's frame and last category: private, never config.jsonc. */
let settingsWindowState: WindowState | undefined;
let settingsWindow: BrowserWindow | null = null;
let settingsClosing: Promise<void> | undefined;
let initialLaunch: LaunchRequest | undefined;
let launchError: string | undefined;
if (!headless) {
  try {
    initialLaunch = parseLaunch(
      process.argv
        .slice(app.isPackaged ? 1 : 2)
        .filter(
          (argument) =>
            !renderTest ||
            !/^--(?:remote-debugging-port|remote-debugging-address|remote-allow-origins|disable-features|disable-renderer-backgrounding|disable-background-timer-throttling)(?:=|$)/.test(
              argument,
            ),
        ),
      process.cwd(),
      os.homedir(),
      (directory, file) => path.resolve(directory, file),
    );
  } catch (error) {
    launchError = errorMessage(error);
  }
}
const ownsInstance =
  headless || app.requestSingleInstanceLock({ request: initialLaunch, error: launchError });
if (!ownsInstance) app.quit();
const quit = new QuitSequence({
  pendingOperations: () => desktop?.pendingOperations() ?? 0,
  confirm: confirmQuit,
  drained: drainOperations,
  exports: async () => {
    await desktop?.backups.exported();
  },
  save: saveBeforeQuit,
  stopGuests: async () => {
    await desktop?.browsers.closeAll();
  },
  failed: quitStepFailure,
  dispose: () => desktop?.dispose(),
  closeHotkey: () => hotkey?.close(),
  quit: () => app.quit(),
  report: (context, error) => console.error(context, error),
});
const quitShortcut = new QuitShortcut({
  warns: () => !!desktop?.settings.snapshot().settings.quit.warnShortcut,
  hint: showQuitHint,
  quit: () => app.quit(),
});
const pendingPaths: string[] = [];

async function saveFailure(
  error: unknown,
  parent?: BrowserWindow,
  applicationQuit = false,
): Promise<SaveFailureChoice> {
  console.error('Viewer could not finish saving', error);
  desktop?.emit({ type: 'service-error', service: 'persistence', message: errorMessage(error) });
  // once Quit has begun, its own save asks for every window
  if (backgroundTest || (!quit.accepting() && !applicationQuit)) return 'keep-open';
  return askRetry(
    parent,
    'Viewer could not save your changes',
    `${errorMessage(error)}\n\nYour window will stay open. Retry saving, or keep working and try again later.`,
  );
}
/** A Quit step's failure asks as a failed save does: Retry runs the step again. */
const quitStepFailures: Record<QuitRetryStep, { message: string; retry: string }> = {
  draining: { message: 'Viewer could not finish the file operations', retry: 'Retry waiting' },
  'stopping-guests': {
    message: 'Viewer could not close its browser planes',
    retry: 'Retry closing them',
  },
};
async function quitStepFailure(step: QuitRetryStep, error: unknown): Promise<SaveFailureChoice> {
  const { message, retry } = quitStepFailures[step];
  console.error(message, error);
  desktop?.emit({ type: 'service-error', service: 'quit', message: errorMessage(error) });
  if (backgroundTest) return 'keep-open';
  return askRetry(
    window ?? undefined,
    message,
    `${errorMessage(error)}\n\nViewer will stay open. ${retry}, or keep working and quit later.`,
  );
}
async function askRetry(
  parent: BrowserWindow | undefined,
  message: string,
  detail: string,
): Promise<SaveFailureChoice> {
  const choice = await askNatively(parent, {
    message,
    detail,
    buttons: ['Retry', 'Keep Open'],
    defaultId: 1,
    cancelId: 1,
  });
  return choice === 0 ? 'retry' : 'keep-open';
}
/** "Press ⌘Q again to quit" where the person is looking; false with no Viewer window to show it. */
function showQuitHint(duration: number): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  const viewer = (candidate: BrowserWindow | null): candidate is BrowserWindow =>
    !!candidate &&
    !candidate.isDestroyed() &&
    (viewerWindows.has(candidate) || candidate === settingsWindow);
  // Electron calls a covered window not visible. A focused one is in front all the same, and with
  // a page window in front the hint goes to the workspace behind it: one press must not quit.
  const target = viewer(focused)
    ? focused
    : viewer(window) && !window.isMinimized() && (!!focused || window.isVisible())
      ? window
      : undefined;
  if (!target) return false;
  sendEvent(target.webContents, { type: 'quit-hint', duration });
  return true;
}
const devURL = MAIN_WINDOW_VITE_DEV_SERVER_URL;
const rendererRoot = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
const trusted = (url: string) => {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'viewer-app:' && parsed.hostname === 'app') ||
      (!!devURL && parsed.origin === new URL(devURL).origin)
    );
  } catch {
    return false;
  }
};
let menuBindings = '';
function menu(): void {
  const settings = desktop?.settings.snapshot().settings;
  const bindings = nativeMenuBindings(settings);
  if (bindings === menuBindings) return;
  menuBindings = bindings;
  const command = (value: string) => () => {
    void dispatchApplicationCommand(value, {
      openSettings: openSettingsWindow,
      newWindow: async () => {
        await createIndependentViewerWindow();
      },
      focusedWindow: () => BrowserWindow.getFocusedWindow(),
      settingsWindow: () => settingsWindow,
      workspaceCommand: (id) => desktop?.emit({ type: 'command', command: id }),
    }).catch(reportApplicationCommandFailure);
  };
  installApplicationMenu(settings, command, diagnostics.file, (byShortcut) =>
    quitShortcut.request(byShortcut),
  );
}

function reportApplicationCommandFailure(error: unknown): void {
  const message = errorMessage(error);
  void diagnostics.record('main-rejection', failure(error));
  desktop?.emit({ type: 'service-error', service: 'window', message });
  if (!backgroundTest) dialog.showErrorBox('Viewer could not complete this command', message);
}
/** The backdrop the window was made with: a clear one cannot be switched on or off in place. */
const createdBackdrops = new Map<BrowserWindow, UIPreferences['space']['backdrop']>();
/** Blur and solid apply at once; clear waits for the window to open again (backdrop.ts). */
function applyBackdrop(): void {
  if (!desktop || process.platform !== 'darwin') return;
  for (const [window, created] of createdBackdrops) {
    const preferences = desktop.windowPreferences(desktop.workspaceForWindow(window));
    const next = preferences.ui.space.backdrop;
    const options = backdropWindowOptions(next, preferences.look);
    if (window.isDestroyed() || created === 'clear' || backdropChange(created, next) !== 'live')
      continue;
    window.setVibrancy(next === 'blur' ? 'under-window' : null);
    window.setBackgroundColor(options.backgroundColor);
  }
}
function workspaceFrame(workspaceID?: string): WindowState {
  const name =
    createHash('sha256')
      .update(workspaceID ?? 'initial')
      .digest('hex') + '.json';
  return new WindowState(path.join(app.getPath('userData'), 'window-states', name));
}

const windowCreations = new WindowCreationRequests<BrowserWindow | undefined>();
async function createIndependentViewerWindow(): Promise<BrowserWindow | undefined> {
  const services = desktop;
  if (!services) return;
  return createIndependentWindow({
    available: () => desktop === services && quit.accepting(),
    prepare: () => services.prepareSettings(),
    createWorkspace: () => services.createWorkspace(),
    create: createWindow,
  });
}

async function createWindow(workspaceID?: string): Promise<BrowserWindow | undefined> {
  if ((window && !workspaceID) || !quit.accepting()) return window ?? undefined;
  await desktop?.prepareSettings();
  const desired = workspaceID ?? desktop?.workspaceSessions.snapshot()?.activeWorkspace;
  const existing = desired ? desktop?.windowForWorkspace(desired) : undefined;
  if (existing && !existing.isDestroyed()) return existing;
  return windowCreations.create(desired ?? 'initial', () => createViewerWindow(desired));
}
async function createViewerWindow(workspaceID?: string): Promise<BrowserWindow | undefined> {
  if ((window && !workspaceID) || !quit.accepting()) return window ?? undefined;
  const desiredWorkspace = workspaceID ?? desktop?.workspaceSessions.snapshot()?.activeWorkspace;
  const preferences = desktop?.windowPreferences(desiredWorkspace);
  const frame = workspaceFrame(desiredWorkspace);
  await frame.load();
  const restored = restoreWindowFrame(
    frame.value ?? windowState?.value ?? null,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
  );
  const backdrop =
    process.platform === 'darwin' ? (preferences?.ui.space.backdrop ?? 'opaque') : 'opaque';
  window = new BrowserWindow({
    ...restored.bounds,
    minWidth: restored.minWidth,
    minHeight: restored.minHeight,
    title: 'Viewer',
    ...backdropWindowOptions(backdrop, preferences?.look ?? 'dark'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: false,
    webPreferences: appWebPreferences(),
  });
  performanceMeter.mark('main:window');
  const createdWindow = window;
  createdBackdrops.set(createdWindow, backdrop);
  viewerWindows.add(createdWindow);
  windowFrames.set(createdWindow, frame);
  createdWindow.on('focus', () => {
    window = createdWindow;
  });
  const remember = () => rememberWindow(createdWindow);
  createdWindow.on('move', remember);
  createdWindow.on('resize', remember);
  createdWindow.on('maximize', remember);
  createdWindow.on('unmaximize', remember);
  createdWindow.on('enter-full-screen', remember);
  createdWindow.on('leave-full-screen', remember);
  createdWindow.on('restore', remember);
  let closePending = false;
  let allowedClose = false;
  const services = desktop!;
  createdWindow.on('closed', () => {
    viewerWindows.delete(createdWindow);
    createdBackdrops.delete(createdWindow);
    windowFrames.delete(createdWindow);
    if (window === createdWindow) window = [...viewerWindows].at(-1) ?? null;
  });
  try {
    services.attach(createdWindow, 'viewer', desiredWorkspace);
  } catch (error) {
    createdWindow.destroy();
    throw error;
  }
  services.openIn(createdWindow.webContents.id, pendingPaths.splice(0));
  createdWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  createdWindow.webContents.on('will-navigate', (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  createdWindow.webContents.on('will-frame-navigate', (event) => {
    const allowed = frameNavigationAllowed(
      {
        url: event.url,
        mainFrame: event.isMainFrame,
        frameURLs: frameLocationURLs(event.frame),
        initiatorURLs: frameLocationURLs(event.initiator),
      },
      {
        trustedDocument: trusted,
        ownsHtmlURL: (url) => services.webPreviews.ownsHtmlURL(createdWindow.webContents.id, url),
      },
    );
    if (!allowed) event.preventDefault();
  });
  createdWindow.on('close', (event) => {
    if (allowedClose || quit.closingWindows()) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    remember();
    void saveBeforeClose(
      async () => {
        await Promise.all([
          services.flushWindow(createdWindow),
          windowFrames.get(createdWindow)?.flush(),
        ]);
      },
      (error) => saveFailure(error, createdWindow),
    )
      .then((saved) => {
        if (!saved) return;
        allowedClose = true;
        if (!createdWindow.isDestroyed()) createdWindow.close();
      })
      .catch((error) => console.error('Workspace close failed', error))
      .finally(() => {
        closePending = false;
      });
  });
  menu();
  try {
    await createdWindow.loadURL(devURL || 'viewer-app://app/index.html');
    performanceMeter.mark('main:loaded');
  } catch (error) {
    if (createdWindow.isDestroyed() || closePending || !quit.accepting()) return;
    throw error;
  }
  if (!backgroundTest && !createdWindow.isDestroyed() && !closePending && quit.accepting()) {
    if (restored.maximized) createdWindow.maximize();
    createdWindow.show();
    if (restored.fullscreen) {
      if (hotkey) hotkey.setFullScreen(createdWindow, true);
      else createdWindow.setFullScreen(true);
    }
  }
  return createdWindow;
}
function rememberWindow(created: BrowserWindow): void {
  if (created.isDestroyed() || created.isMinimized() || hotkey?.isDropped(created)) return;
  const frame = captureWindowFrame(created, screen.getDisplayMatching(created.getBounds()));
  windowFrames.get(created)?.remember(frame);
  if (created === window) windowState?.remember(frame);
}
async function openSettingsWindow(focus?: string): Promise<void> {
  await settingsClosing;
  if (!desktop || !quit.accepting()) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!backgroundTest) {
      settingsWindow.show();
      settingsWindow.focus();
    }
    // a setting's command: Settings shows that setting
    if (focus) desktop.emit({ type: 'settings-focus', path: focus });
    return;
  }
  await desktop.settings.load();
  // the size config.jsonc held stands until the window has a frame of its own
  const legacy = desktop.settings.snapshot().settings.settingsWindow;
  const restored = restoreWindowFrame(
    settingsWindowState?.value ?? null,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
    { width: legacy?.width ?? 900, height: legacy?.height ?? 640, minWidth: 760, minHeight: 540 },
  );
  const created = new BrowserWindow({
    ...restored.bounds,
    minWidth: restored.minWidth,
    minHeight: restored.minHeight,
    title: 'Settings',
    backgroundColor: '#272a30',
    show: false,
    webPreferences: appWebPreferences(),
  });
  settingsWindow = created;
  desktop.attach(created, 'settings');
  const services = desktop;
  let closePending = false,
    allowedClose = false;
  created.on('close', (event) => {
    if (allowedClose || quit.closingWindows()) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    settingsClosing = saveBeforeClose(
      () => services.flushSettings(created),
      (error) => saveFailure(error, created),
    )
      .then((saved) => {
        if (!saved) return;
        allowedClose = true;
        if (!created.isDestroyed()) created.close();
      })
      .catch((error) => console.error('Settings close failed', error))
      .finally(() => {
        closePending = false;
        settingsClosing = undefined;
      });
  });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  const placed = () => {
    if (created.isDestroyed() || created.isMinimized()) return;
    settingsWindowState?.remember(
      captureWindowFrame(created, screen.getDisplayMatching(created.getBounds())),
    );
  };
  created.on('resize', placed);
  created.on('move', placed);
  created.on('closed', () => {
    settingsWindow = null;
    // Quit saved the placement already: a write now could race the services stopping
    if (quit.closingWindows()) return;
    void settingsWindowState
      ?.flush()
      .catch((error) => console.error('Settings window placement save failed', error));
  });
  const url = new URL(devURL || 'viewer-app://app/index.html');
  url.searchParams.set('window', 'settings');
  url.searchParams.set('category', settingsWindowState?.value?.category ?? legacy?.category ?? '');
  if (focus) url.searchParams.set('focus', focus);
  try {
    await created.loadURL(url.toString());
  } catch (error) {
    if (created.isDestroyed() || closePending || !quit.accepting()) return;
    throw error;
  }
  if (!backgroundTest) created.show();
}
async function launch(request: LaunchRequest): Promise<void> {
  if (!desktop || !quit.accepting()) return;
  let target = window ?? undefined;
  if (request.workspace) {
    const spaces = desktop.workspaceSessions.snapshot()?.workspaces ?? [];
    const matches = spaces.filter(
      (space) => space.id === request.workspace || space.name === request.workspace,
    );
    if (matches.length !== 1)
      throw new Error('Name one existing workspace by ID or its unique name.');
    const workspace = matches[0]!;
    target = desktop.windowForWorkspace(workspace.id) ?? (await createWindow(workspace.id));
  } else if (request.newWindow) {
    target = await createIndependentViewerWindow();
  } else if (!target) target = await createWindow();
  if (!target) return;
  desktop.launchIn(target.webContents.id, request);
  if (!backgroundTest) {
    target.show();
    target.focus();
  }
}

app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
  if (!quit.accepting()) return;
  const request = launchRequestSchema.safeParse((additionalData as { request?: unknown })?.request);
  if (!request.success) return;
  void launch(request.data).catch((error) =>
    desktop?.emit({ type: 'service-error', service: 'launch', message: errorMessage(error) }),
  );
});
app.on('open-file', (event, file) => {
  event.preventDefault();
  if (desktop) desktop.open([file]);
  else pendingPaths.push(file);
  // with every window closed, the file waited for a later Dock click; a window opens
  // for it, as `activate` would open one
  if (!headless && desktop && !window && quit.accepting()) void createWindow();
});
app
  .whenReady()
  .then(async () => {
    performanceMeter.mark('main:ready');
    if (!ownsInstance || !quit.accepting()) return;
    if (launchError) throw new Error(launchError);
    if (headless) {
      app.dock?.hide();
      try {
        if (cliMode) {
          const interrupt = new AbortController();
          const cancel = () => interrupt.abort();
          process.once('SIGINT', cancel);
          process.once('SIGTERM', cancel);
          try {
            process.exitCode = await runCLI(terminalArguments, {
              dataPath: app.getPath('userData'),
              version: app.getVersion(),
              cwd: process.cwd(),
              home: os.homedir(),
              token: process.env.VIEWER_AGENT_TOKEN,
              input: process.stdin,
              output: process.stdout,
              error: process.stderr,
              signal: interrupt.signal,
            });
          } finally {
            process.removeListener('SIGINT', cancel);
            process.removeListener('SIGTERM', cancel);
          }
        } else await runMCPClient(app.getPath('userData'));
      } catch (error) {
        process.stderr.write(errorMessage(error) + '\n');
        process.exitCode = 1;
      }
      quit.exitHeadless();
      // app.quit() ends with 0 whatever process.exitCode says, so an agent's client saw a failed
      // start as success: flush what was written, then exit with the failure
      if (process.exitCode) {
        await new Promise((resolve) => process.stdout.write('', resolve));
        await new Promise((resolve) => process.stderr.write('', resolve));
        app.exit(Number(process.exitCode));
        return;
      }
      app.quit();
      return;
    }
    // Development runs the stock Electron.app; give the Dock Viewer's icon.
    if (!app.isPackaged) app.dock?.setIcon(assetPath('icon.png'));
    windowState = new WindowState(path.join(app.getPath('userData'), 'window-state-v1.json'));
    await windowState.load();
    settingsWindowState = new WindowState(
      path.join(app.getPath('userData'), 'settings-window-v1.json'),
    );
    await settingsWindowState.load();
    if (!quit.accepting()) return;
    desktop = new Desktop(app.getPath('userData'), trusted, {
      shellCommandHome,
      openSettings: openSettingsWindow,
      newWindow: async (workspaceID) => {
        await createWindow(workspaceID);
      },
      workspaceChanged: (window, workspaceID) => {
        if (window.isDestroyed()) return;
        const previous = windowFrames.get(window);
        const next = workspaceFrame(workspaceID);
        next.remember(previous?.value ?? null);
        windowFrames.set(window, next);
        rememberWindow(window);
        applyBackdrop();
        void previous
          ?.flush()
          .catch((error) => diagnostics.record('main-rejection', failure(error)));
      },
      quitting: () => quit.closingWindows(),
      hotkeyStatus: () => hotkey?.snapshot() ?? { registered: false, shortcut: 'Alt+Space' },
      restoreWindow: () => hotkey?.restore(),
      settingsCategory: (category) => {
        if (!settingsWindow || settingsWindow.isDestroyed()) return;
        const frame = captureWindowFrame(
          settingsWindow,
          screen.getDisplayMatching(settingsWindow.getBounds()),
        );
        settingsWindowState?.remember(frame && { ...frame, category });
      },
      settingsChanged: () => {
        menu();
        applyBackdrop();
        const settings = desktop?.settings.snapshot().settings.hotkey;
        if (settings)
          hotkey?.configure(settings.enabled, accelerator(settings.shortcut) ?? settings.shortcut);
      },
      diagnose: (detail) => void diagnostics.record('renderer-error', detail),
      worker: path.join(__dirname, 'worker.cjs'),
      fileBackend:
        backgroundTest && process.env.VIEWER_TEST_FILE_THREADS === '1' ? 'thread' : undefined,
      terminalWorker: path.join(__dirname, 'terminal-worker.cjs'),
      ocr: assetPath('viewer-ocr'),
      applications: assetPath('viewer-applications'),
    });
    // Loading the main-thread binding registers public AppKit observers before
    // createWindow can request restoration of a native fullscreen Space.
    const nativeWindows = process.platform === 'darwin' ? macFiles() : undefined;
    hotkey = new HotkeyWindow(
      globalShortcut,
      async () => window ?? (await createWindow()),
      () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
      () => !systemPreferences.getAnimationSettings().prefersReducedMotion && !backgroundTest,
      () => {},
      !backgroundTest,
      (selected) =>
        nativeWindows?.windowFullscreenPhase(selected.getNativeWindowHandle()) ?? 'idle',
    );
    protocol.handle('viewer-resource', (request) => desktop!.resources.response(request));
    protocol.handle('viewer-html', (request) => desktop!.webPreviews.response(request));
    nativeTheme.on('updated', () => desktop?.settings.announce());
    protocol.handle('viewer-app', async (request) => {
      const url = new URL(request.url);
      let relative: string;
      try {
        relative = decodeURIComponent(url.pathname);
      } catch {
        return new Response(null, { status: 400 });
      }
      const file = path.resolve(rendererRoot, '.' + relative);
      if (url.hostname !== 'app' || !file.startsWith(rendererRoot + path.sep))
        return new Response(null, { status: 403 });
      try {
        // The policy travels with the document itself, independent of webRequest hooks.
        return new Response(await readFile(file), {
          headers: {
            'Content-Type': lookup(file) || 'application/octet-stream',
            'Content-Security-Policy': applicationCSP(url.pathname, !!devURL),
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch {
        return new Response('Application asset is unavailable.', { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(
        speechMediaAllowed({
          permission,
          mainFrame: details.isMainFrame,
          trusted: trusted(details.requestingUrl),
          active: !!desktop?.speechMicrophoneAllowed(contents.id),
          media: 'mediaTypes' in details ? (details.mediaTypes ?? []) : [],
        }),
      ),
    );
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
      speechMediaAllowed({
        permission,
        mainFrame: details.isMainFrame,
        trusted: !!details.requestingUrl && trusted(details.requestingUrl),
        active: !!contents && !!desktop?.speechMicrophoneAllowed(contents.id),
        media: details.mediaType ? [details.mediaType] : [],
      }),
    );
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: trusted(details.url)
          ? {
              ...details.responseHeaders,
              'Content-Security-Policy': [applicationCSP(new URL(details.url).pathname, !!devURL)],
            }
          : details.responseHeaders,
      }),
    );
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const owner = details.webContentsId ?? details.webContents?.id;
      const allowed = rendererRequestAllowed(
        {
          url: details.url,
          frameURLs: frameLocationURLs(details.frame),
          resourceType: details.resourceType,
          initiatorOrigin: details.initiatorOrigin,
          referrer: details.referrer,
        },
        {
          development: !!devURL,
          trustedDocument: trusted,
          ownsHtmlURL: (url) =>
            owner !== undefined && !!desktop?.webPreviews.ownsHtmlURL(owner, url),
        },
      );
      callback({ cancel: !allowed });
    });
    await desktop.prepareSettings();
    const saved = desktop.workspaceSessions.snapshot();
    const restoreWindows = desktop.settings.snapshot().settings.browsing.restoreSession
      ? (saved?.openWindows?.filter((id) => saved.workspaces.some((space) => space.id === id)) ??
        [])
      : [];
    if (!initialLaunch?.workspace && !initialLaunch?.newWindow) {
      await createWindow(restoreWindows[0]);
      for (const workspaceID of restoreWindows.slice(1)) await createWindow(workspaceID);
    }
    if (initialLaunch) await launch(initialLaunch);
  })
  .catch((error: unknown) => {
    // A startup failure must not leave a windowless process running silently.
    console.error(error);
    // Hidden verification runs never show windows; their logs carry the error.
    if (!backgroundTest) dialog.showErrorBox('Viewer could not start', errorMessage(error));
    app.exit(1);
  });
app.on('activate', () => {
  void activateApplication({
    available: () => !headless && !!desktop && quit.accepting(),
    present: !backgroundTest,
    restoreHotkey: () => hotkey?.restore() ?? false,
    currentWindow: () => {
      if (window?.isDestroyed())
        window = [...viewerWindows].toReversed().find((item) => !item.isDestroyed()) ?? null;
      return window ?? undefined;
    },
    createWindow: () => createWindow(),
  }).catch(reportApplicationCommandFailure);
});
/** Quit's question while file operations are in progress. */
async function confirmQuit(pending: number): Promise<QuitChoice> {
  const choice = await askNatively(window ?? undefined, {
    message:
      pending === 1
        ? 'A file operation is still in progress.'
        : `${pending} file operations are still in progress.`,
    detail:
      'Quitting now cancels them: what is already done stays done, and a partial copy goes to the Trash. Waiting finishes them first, then quits; answer any question they ask.',
    buttons: ['Wait for them', 'Cancel them and quit', 'Keep Viewer open'],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice === 0) return 'wait';
  if (choice === 2) return 'keep-open';
  return 'cancel-operations';
}
async function drainOperations(): Promise<void> {
  // their questions are answered in the workspace window
  if (!window) await createWindow();
  await desktop?.operationsDrained();
}
function saveBeforeQuit(): Promise<boolean> {
  for (const created of viewerWindows) rememberWindow(created);
  return saveBeforeClose(
    async () => {
      await Promise.all([
        desktop?.flush(),
        windowState?.flush(),
        settingsWindowState?.flush(),
        ...[...windowFrames.values()].map((frame) => frame.flush()),
      ]);
    },
    (error) => saveFailure(error, window ?? undefined, true),
  );
}
app.on('before-quit', (event) => quit.beforeQuit(event));
app.on('will-quit', (event) => quit.willQuit(event));
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
