import {
  nativeTheme,
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  session,
  screen,
  shell,
  crashReporter,
} from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { lookup } from 'mime-types';
import { defaultShortcuts, accelerator, menuShortcuts } from './domain/shortcuts';
import { runMCPClient } from './desktop/mcp-client';
import { Desktop } from './desktop/bridge';
import { WindowState, captureWindowFrame, restoreWindowFrame } from './desktop/window-state';
import { errorMessage } from './domain/errors';
import { DiagnosticLog } from './desktop/diagnostics';
import { planeAlignments, planeSizePresets } from './domain/plane-layout';
import { applicationCSP } from './desktop/application-csp';
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
]);
app.setName('Viewer');
// Hidden rendering is restricted to QA with an explicitly isolated profile.
const renderTest = process.env.VIEWER_RENDER_TEST === '1';
const backgroundTest =
  renderTest && process.env.VIEWER_BACKGROUND_TEST === '1' && !!process.env.VIEWER_DATA_DIRECTORY;
if (backgroundTest && process.platform === 'darwin') app.setActivationPolicy('accessory');
// An optional, main-process-only profile supports portable installations and isolated QA.
if (process.env.VIEWER_DATA_DIRECTORY) {
  if (!path.isAbsolute(process.env.VIEWER_DATA_DIRECTORY))
    throw new Error('VIEWER_DATA_DIRECTORY must be an absolute path.');
  mkdirSync(process.env.VIEWER_DATA_DIRECTORY, { recursive: true });
  app.setPath('userData', process.env.VIEWER_DATA_DIRECTORY);
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
let desktop: Desktop | null = null;
let windowState: WindowState | undefined;
let settingsWindow: BrowserWindow | null = null;
let settingsClosing: Promise<void> | undefined;
const mcpMode = process.argv.includes('--mcp');
const ownsInstance = mcpMode || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let closing = false;
let quitting = false;
let quitPending = false;
let disposalPending = false;
let disposed = false;
const pendingPaths: string[] = [];
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
  const bindings = JSON.stringify([
    settings?.browsing.confirmTrash,
    settings?.shortcuts,
    settings?.recipes.map((recipe) => [recipe.id, recipe.name, recipe.shortcut]),
  ]);
  if (bindings === menuBindings) return;
  menuBindings = bindings;
  const command = (value: string) => () => {
    if (value === 'settings') {
      void openSettingsWindow();
      return;
    }
    const focused = BrowserWindow.getFocusedWindow();
    if (focused === settingsWindow) {
      const edits: Record<string, string> = {
        'undo-file': 'undo',
        'redo-file': 'redo',
        cut: 'cut',
        copy: 'copy',
        paste: 'paste',
        'select-all': 'selectAll',
      };
      const method = edits[value];
      if (method) {
        const contents = focused!.webContents;
        if (method === 'selectAll') contents.selectAll();
        else if (method === 'copy') contents.copy();
        else if (method === 'cut') contents.cut();
        else if (method === 'paste') contents.paste();
        else if (method === 'undo') contents.undo();
        else contents.redo();
      }
      return;
    }
    desktop?.emit({ type: 'command', command: value });
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              role: 'appMenu' as const,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                {
                  label: 'Settings…',
                  accelerator: accelerator(settings?.shortcuts['settings'] ?? 'Cmd+,'),
                  click: command('settings'),
                },
                { type: 'separator' as const },
                { role: 'services' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [
          { label: 'Create Project…', click: command('project-create') },
          { label: 'Workflows…', click: command('workflows') },
          { label: 'Open Project…', click: command('project-open') },
          { label: 'Save Project', click: command('project-save') },
          { label: 'Reload Project…', click: command('project-reload') },
          { type: 'separator' },
          {
            label: 'New Folder Plane',
            accelerator: accelerator(settings?.shortcuts['new-root-folder'] ?? 'Cmd+N'),
            click: command('new-root-folder'),
          },
          {
            label: 'Open Folder…',
            accelerator: accelerator(
              settings?.shortcuts['choose-folder'] ?? menuShortcuts['choose-folder'] ?? '',
            ),
            click: command('choose-folder'),
          },
          {
            label: 'New Folder…',
            accelerator: accelerator(
              settings?.shortcuts['new-folder'] ?? defaultShortcuts['new-folder'] ?? 'Cmd+Shift+N',
            ),
            click: command('new-folder'),
          },
          {
            label: 'Open Selection',
            accelerator: accelerator(
              settings?.shortcuts['open-selection'] ??
                defaultShortcuts['open-selection'] ??
                'Cmd+O',
            ),
            click: command('open-selection'),
          },
          { label: 'Open in Default App', click: command('open-default') },
          { label: 'Open With…', click: command('open-with') },
          { label: 'Quick Preview', click: command('quick-preview') },
          {
            label: 'Get Info…',
            accelerator: accelerator(
              settings?.shortcuts['info'] ?? defaultShortcuts['info'] ?? 'Cmd+I',
            ),
            click: command('info'),
          },
          { label: 'Calculate Size', click: command('calculate-size') },
          { type: 'separator' },
          {
            label: 'Duplicate',
            accelerator: accelerator(
              settings?.shortcuts['duplicate'] ?? defaultShortcuts['duplicate'] ?? 'Cmd+D',
            ),
            click: command('duplicate'),
          },
          { label: 'Copy To…', click: command('copy-to') },
          { label: 'Move To…', click: command('move-to') },
          {
            label: settings?.browsing.confirmTrash === false ? 'Move to Trash' : 'Move to Trash…',
            accelerator: accelerator(
              settings?.shortcuts['trash'] ?? defaultShortcuts['trash'] ?? 'Cmd+Backspace',
            ),
            click: command('trash'),
          },
          { type: 'separator' },
          { label: 'Recent File Operations', click: command('recent-operations') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          {
            label: 'Undo',
            accelerator: accelerator(
              settings?.shortcuts['undo-file'] ?? menuShortcuts['undo-file'] ?? '',
            ),
            click: command('undo-file'),
          },
          {
            label: 'Redo',
            accelerator: accelerator(
              settings?.shortcuts['redo-file'] ?? menuShortcuts['redo-file'] ?? '',
            ),
            click: command('redo-file'),
          },
          { type: 'separator' },
          {
            label: 'Cut',
            accelerator: accelerator(
              settings?.shortcuts['cut'] ?? defaultShortcuts['cut'] ?? 'Cmd+X',
            ),
            click: command('cut'),
          },
          {
            label: 'Copy',
            accelerator: accelerator(
              settings?.shortcuts['copy'] ?? defaultShortcuts['copy'] ?? 'Cmd+C',
            ),
            click: command('copy'),
          },
          {
            label: 'Paste',
            accelerator: accelerator(
              settings?.shortcuts['paste'] ?? defaultShortcuts['paste'] ?? 'Cmd+V',
            ),
            click: command('paste'),
          },
          {
            label: 'Move Copied Items Here',
            accelerator: accelerator(
              settings?.shortcuts['paste-move'] ?? defaultShortcuts['paste-move'] ?? '',
            ),
            click: command('paste-move'),
          },
          {
            label: 'Select All',
            accelerator: accelerator(
              settings?.shortcuts['select-all'] ?? defaultShortcuts['select-all'] ?? 'Cmd+A',
            ),
            click: command('select-all'),
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Commands…',
            accelerator: accelerator(settings?.shortcuts['palette'] ?? 'Cmd+K'),
            click: command('palette'),
          },
          {
            label: 'Find File…',
            accelerator: accelerator(settings?.shortcuts['find-file'] ?? 'Cmd+F'),
            click: command('find-file'),
          },
          {
            label: 'Go to Folder…',
            accelerator: accelerator(settings?.shortcuts['go-to'] ?? 'Cmd+L'),
            click: command('go-to'),
          },
          {
            label: 'Show / Hide Window Navigation',
            accelerator: accelerator(settings?.shortcuts['toggle-sidebar'] ?? 'Cmd+Alt+S'),
            click: command('toggle-sidebar'),
          },
          { label: 'Show / Hide Plane Navigation', click: command('plane-sidebar') },
          { label: 'View Side by Side', click: command('view-side-by-side') },
          { label: 'View Stacked', click: command('view-stacked') },
          {
            label: 'Size & Position',
            submenu: [
              { label: 'Move Plane', click: command('plane-move') },
              { label: 'Resize Plane', click: command('plane-resize') },
              { label: 'Fill Workspace', click: command('plane-fill') },
              { type: 'separator' },
              ...(['width', 'height'] as const).map((axis) => ({
                label: axis === 'width' ? 'Width' : 'Height',
                submenu: planeSizePresets.map((preset) => ({
                  label: `${preset.label} ${axis}`,
                  click: command(`plane-${axis}-${preset.id}`),
                })),
              })),
              {
                label: 'Position',
                submenu: planeAlignments.map((alignment) => ({
                  label: alignment.label,
                  click: command(`plane-align-${alignment.id}`),
                })),
              },
            ],
          },
          {
            label: 'Show / Hide Hidden Files',
            accelerator: accelerator(
              settings?.shortcuts['toggle-hidden'] ?? defaultShortcuts['toggle-hidden'] ?? '',
            ),
            click: command('hidden'),
          },
          { type: 'separator' },
          {
            label: 'Frame All Planes',
            accelerator: accelerator(settings?.shortcuts['frame-all'] ?? 'Cmd+0'),
            click: command('frame-all'),
          },
          {
            label: 'Dock / Reveal',
            accelerator: accelerator(settings?.shortcuts['dock'] ?? 'Cmd+Return'),
            click: command('dock'),
          },
          {
            label: 'Undo Arrangement',
            accelerator: accelerator(
              settings?.shortcuts['undo-arrangement'] ?? menuShortcuts['undo-arrangement'] ?? '',
            ),
            click: command('undo-arrangement'),
          },
          {
            label: 'Redo Arrangement',
            accelerator: accelerator(
              settings?.shortcuts['redo-arrangement'] ?? menuShortcuts['redo-arrangement'] ?? '',
            ),
            click: command('redo-arrangement'),
          },
          { label: 'Arrange Horizontally', click: command('arrange-horizontal') },
          { label: 'Arrange Vertically', click: command('arrange-vertical') },
          { type: 'separator' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Actions',
        submenu: [
          ...(settings?.customActions || [])
            .toSorted((a, b) => a.order - b.order)
            .map((action) => ({
              label: action.name,
              accelerator: accelerator(action.shortcut),
              click: command('custom.' + action.id),
            })),
          ...(settings?.recipes || []).map((recipe) => ({
            label: recipe.name + '…',
            accelerator: accelerator(recipe.shortcut || ''),
            click: command('recipe.' + recipe.id),
          })),
          { type: 'separator' as const },
          { label: 'Action Tasks…', click: command('tasks') },
        ],
      },
      {
        label: 'Workspace',
        submenu: [
          { label: 'New Workspace…', click: command('new-workspace') },
          { label: 'Rename Workspace…', click: command('rename-workspace') },
          { label: 'Delete Workspace…', click: command('delete-workspace') },
          { label: 'Undo Workspace Deletion', click: command('restore-workspace') },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'Commands…', click: command('palette') },
          { type: 'separator' },
          {
            label: 'Report an Issue…',
            click: () => void shell.openExternal('https://github.com/plurid/viewer/issues'),
          },
          {
            label: 'Viewer Website',
            click: () => void shell.openExternal('https://plurid.com/viewer'),
          },
          { type: 'separator' },
          {
            // A local file the person can attach to a support request if they choose.
            label: 'Show Diagnostic Log',
            click: () => {
              if (existsSync(diagnostics.file)) shell.showItemInFolder(diagnostics.file);
              else
                void dialog.showMessageBox({
                  type: 'info',
                  message: 'No problems have been recorded.',
                  detail: 'Viewer keeps a local log of errors here for support. It is never sent.',
                });
            },
          },
        ],
      },
    ]),
  );
}
async function createWindow(): Promise<void> {
  if (window || quitPending || quitting) return;
  closing = false;
  const restored = restoreWindowFrame(
    windowState?.value ?? null,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
  );
  window = new BrowserWindow({
    ...restored.bounds,
    minWidth: restored.minWidth,
    minHeight: restored.minHeight,
    title: 'Viewer',
    backgroundColor: '#272a30',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      // Functional QA renders without showing windows or taking native focus.
      // Normal launches retain background throttling and visible windows.
      offscreen: backgroundTest,
      backgroundThrottling: !renderTest,
    },
  });
  const createdWindow = window;
  const remember = () => rememberWindow(createdWindow);
  createdWindow.on('move', remember);
  createdWindow.on('resize', remember);
  createdWindow.on('maximize', remember);
  createdWindow.on('unmaximize', remember);
  createdWindow.on('enter-full-screen', remember);
  createdWindow.on('leave-full-screen', remember);
  createdWindow.on('restore', remember);
  let closePending = false;
  const services = desktop!;
  services.attach(window, 'viewer');
  services.open(pendingPaths.splice(0));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    remember();
    void Promise.all([
      services.flush().catch((error) => console.error('Workspace flush failed', error)),
      windowState?.flush().catch((error) => console.error('Window placement save failed', error)),
    ]).finally(() => {
      closing = true;
      if (!createdWindow.isDestroyed()) createdWindow.close();
    });
  });
  window.on('closed', () => {
    window = null;
  });
  menu();
  try {
    await createdWindow.loadURL(devURL || 'viewer-app://app/index.html');
  } catch (error) {
    if (createdWindow.isDestroyed() || closePending || quitPending || quitting) return;
    throw error;
  }
  if (!backgroundTest && !createdWindow.isDestroyed() && !closePending && !quitPending) {
    if (restored.maximized) createdWindow.maximize();
    createdWindow.show();
    if (restored.fullscreen) createdWindow.setFullScreen(true);
  }
}
function rememberWindow(created: BrowserWindow): void {
  if (created.isDestroyed() || created.isMinimized()) return;
  windowState?.remember(
    captureWindowFrame(created, screen.getDisplayMatching(created.getBounds())),
  );
}
async function openSettingsWindow(): Promise<void> {
  await settingsClosing;
  if (!desktop || quitPending || quitting) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!backgroundTest) {
      settingsWindow.show();
      settingsWindow.focus();
    }
    return;
  }
  await desktop.settings.load();
  const dimensions = desktop.settings.snapshot().settings.settingsWindow;
  const created = new BrowserWindow({
    width: dimensions.width,
    height: dimensions.height,
    minWidth: 760,
    minHeight: 540,
    title: 'Settings',
    backgroundColor: '#272a30',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      offscreen: backgroundTest,
      backgroundThrottling: !renderTest,
    },
  });
  settingsWindow = created;
  desktop.attach(created, 'settings');
  const services = desktop;
  let closePending = false,
    allowedClose = false;
  created.on('close', (event) => {
    if (allowedClose || quitting) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    settingsClosing = services
      .flushSettings(created)
      .catch((error) => console.error('Settings flush failed', error))
      .finally(() => {
        allowedClose = true;
        if (!created.isDestroyed()) created.close();
        settingsClosing = undefined;
      });
  });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  created.on('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (created.isDestroyed()) return;
      const [width, height] = created.getSize();
      void desktop?.settings
        .patch(
          [
            { path: 'settings.settingsWindow.width', value: width },
            { path: 'settings.settingsWindow.height', value: height },
          ],
          desktop.settings.snapshot().revision,
        )
        .catch(console.error);
    }, 250);
  });
  created.on('closed', () => {
    clearTimeout(timer);
    settingsWindow = null;
  });
  const url = new URL(devURL || 'viewer-app://app/index.html');
  url.searchParams.set('window', 'settings');
  try {
    await created.loadURL(url.toString());
  } catch (error) {
    if (created.isDestroyed() || closePending || quitPending || quitting) return;
    throw error;
  }
  if (!backgroundTest) created.show();
}
app.on('second-instance', () => {
  if (quitPending || quitting) return;
  if (window) {
    if (!backgroundTest) {
      window.show();
      window.focus();
    }
  } else void createWindow();
});
app.on('open-file', (event, file) => {
  event.preventDefault();
  if (desktop) desktop.open([file]);
  else pendingPaths.push(file);
});
app
  .whenReady()
  .then(async () => {
    if (!ownsInstance || quitPending || quitting) return;
    if (mcpMode) {
      app.dock?.hide();
      try {
        await runMCPClient(app.getPath('userData'));
      } catch (error) {
        process.stderr.write(errorMessage(error) + '\n');
        process.exitCode = 1;
      }
      quitting = true;
      app.quit();
      return;
    }
    // Development runs the stock Electron.app; give the Dock Viewer's icon.
    if (!app.isPackaged) app.dock?.setIcon(path.resolve('assets/icon.png'));
    windowState = new WindowState(path.join(app.getPath('userData'), 'window-state-v1.json'));
    await windowState.load();
    if (quitPending || quitting) return;
    desktop = new Desktop(app.getPath('userData'), trusted, {
      openSettings: openSettingsWindow,
      settingsChanged: menu,
      diagnose: (detail) => void diagnostics.record('renderer-error', detail),
      worker: path.join(__dirname, 'worker.cjs'),
      fileBackend:
        backgroundTest && process.env.VIEWER_TEST_FILE_THREADS === '1' ? 'thread' : undefined,
      terminalWorker: path.join(__dirname, 'terminal-worker.cjs'),
      ocr: app.isPackaged
        ? path.join(process.resourcesPath, 'viewer-ocr')
        : path.resolve('assets/viewer-ocr'),
      applications: app.isPackaged
        ? path.join(process.resourcesPath, 'viewer-applications')
        : path.resolve('assets/viewer-applications'),
    });
    protocol.handle('viewer-resource', (request) => desktop!.resources.response(request));
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
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
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
      const url = new URL(details.url);
      const allowed =
        ['viewer-app:', 'viewer-resource:', 'devtools:', 'blob:', 'data:'].includes(url.protocol) ||
        (!!devURL &&
          ['http:', 'ws:'].includes(url.protocol) &&
          ['127.0.0.1', 'localhost'].includes(url.hostname));
      callback({ cancel: !allowed });
    });
    await createWindow();
  })
  .catch((error: unknown) => {
    // A startup failure must not leave a windowless process running silently.
    console.error(error);
    // Hidden verification runs never show windows; their logs carry the error.
    if (!backgroundTest) dialog.showErrorBox('Viewer could not start', errorMessage(error));
    app.exit(1);
  });
app.on('activate', () => {
  if (!mcpMode && desktop && !window && !quitPending && !quitting) void createWindow();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  // Keep the bridge and services alive until every renderer has saved and
  // Electron has closed its windows. Cleanup belongs to will-quit.
  if (window) rememberWindow(window);
  void Promise.all([
    desktop?.flush().catch((error) => console.error(error)),
    windowState?.flush().catch((error) => console.error('Window placement save failed', error)),
  ]).finally(() => {
    quitting = true;
    closing = true;
    app.quit();
  });
});
app.on('will-quit', (event) => {
  if (disposed || !desktop) return;
  event.preventDefault();
  if (disposalPending) return;
  disposalPending = true;
  void desktop
    .dispose()
    .catch((error) => console.error('Desktop shutdown failed', error))
    .finally(() => {
      disposed = true;
      app.quit();
    });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
