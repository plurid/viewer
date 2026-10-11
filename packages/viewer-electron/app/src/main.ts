import { nativeTheme, app, BrowserWindow, Menu, protocol, session } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { lookup } from 'mime-types';
import { accelerator } from './domain/shortcuts';
import { runMCPClient } from './desktop/mcp-client';
import { Desktop } from './desktop/bridge';
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
let window: BrowserWindow | null = null;
let desktop: Desktop | null = null;
let settingsWindow: BrowserWindow | null = null;
let settingsClosing: Promise<void> | undefined;
const mcpMode = process.argv.includes('--mcp');
const ownsInstance = mcpMode || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let closing = false;
let quitting = false;
let quitPending = false;
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
          {
            label: 'New Folder Plane',
            accelerator: accelerator(settings?.shortcuts['new-root-folder'] ?? 'Cmd+N'),
            click: command('new-root-folder'),
          },
          {
            label: 'Open Folder…',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: command('choose-folder'),
          },
          { label: 'New Folder…', accelerator: 'CmdOrCtrl+Shift+N', click: command('new-folder') },
          { label: 'Open Selection', accelerator: 'CmdOrCtrl+O', click: command('open-selection') },
          { label: 'Open in Default App', click: command('open-default') },
          { label: 'Open With…', click: command('open-with') },
          { label: 'Quick Preview', click: command('quick-preview') },
          { label: 'Get Info…', accelerator: 'CmdOrCtrl+I', click: command('info') },
          { label: 'Calculate Size', click: command('calculate-size') },
          { type: 'separator' },
          { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: command('duplicate') },
          { label: 'Copy To…', click: command('copy-to') },
          { label: 'Move To…', click: command('move-to') },
          { label: 'Move to Trash…', accelerator: 'CmdOrCtrl+Backspace', click: command('trash') },
          { type: 'separator' },
          { label: 'Recent File Operations', click: command('recent-operations') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: command('undo-file') },
          { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: command('redo-file') },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: command('cut') },
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: command('copy') },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: command('paste') },
          { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: command('select-all') },
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
          {
            label: 'Show / Hide Hidden Files',
            accelerator: 'CmdOrCtrl+Shift+.',
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
            accelerator: 'CmdOrCtrl+Alt+Z',
            click: command('undo-arrangement'),
          },
          {
            label: 'Redo Arrangement',
            accelerator: 'CmdOrCtrl+Alt+Shift+Z',
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
    ]),
  );
}
async function createWindow(): Promise<void> {
  if (window) return;
  closing = false;
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 780,
    minHeight: 560,
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
    void services
      .flush()
      .catch((error) => console.error('Workspace flush failed', error))
      .finally(() => {
        closing = true;
        if (!createdWindow.isDestroyed()) createdWindow.close();
      });
  });
  window.on('closed', () => {
    window = null;
  });
  menu();
  await window.loadURL(devURL || 'viewer-app://app/index.html');
  if (!backgroundTest) window.show();
}
async function openSettingsWindow(): Promise<void> {
  await settingsClosing;
  if (!desktop) return;
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
  await created.loadURL(url.toString());
  if (!backgroundTest) created.show();
}
app.on('second-instance', () => {
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
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  if (mcpMode) {
    app.dock?.hide();
    try {
      await runMCPClient(app.getPath('userData'));
    } catch (error) {
      process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
      process.exitCode = 1;
    }
    quitting = true;
    app.quit();
    return;
  }
  desktop = new Desktop(app.getPath('userData'), trusted, {
    openSettings: openSettingsWindow,
    settingsChanged: menu,
    worker: path.join(__dirname, 'worker.cjs'),
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
    const relative = decodeURIComponent(url.pathname);
    const file = path.resolve(rendererRoot, '.' + relative);
    if (url.hostname !== 'app' || !file.startsWith(rendererRoot + path.sep))
      return new Response(null, { status: 403 });
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': lookup(file) || 'application/octet-stream' },
      });
    } catch {
      return new Response('Application asset is unavailable.', { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const applicationCSP = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' viewer-resource: blob: data:; media-src 'self' viewer-resource: blob:; connect-src 'self' viewer-resource:${devURL ? ' ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:*' : ''}; worker-src 'self' blob:; font-src 'self' blob: data:; object-src 'none'; frame-src 'none'; base-uri 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: trusted(details.url)
        ? { ...details.responseHeaders, 'Content-Security-Policy': [applicationCSP] }
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
});
app.on('activate', () => {
  if (!mcpMode && desktop && !window) void createWindow();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void (async () => {
    await desktop?.flush();
    await desktop?.dispose();
  })()
    .catch((error) => console.error(error))
    .finally(() => {
      quitting = true;
      closing = true;
      app.quit();
    });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
