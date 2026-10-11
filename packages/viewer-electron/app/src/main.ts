import { app, BrowserWindow, Menu, protocol, session } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { lookup } from 'mime-types';
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
// An optional, main-process-only profile supports portable installations and isolated QA.
if (process.env.VIEWER_DATA_DIRECTORY) {
  if (!path.isAbsolute(process.env.VIEWER_DATA_DIRECTORY))
    throw new Error('VIEWER_DATA_DIRECTORY must be an absolute path.');
  mkdirSync(process.env.VIEWER_DATA_DIRECTORY, { recursive: true });
  app.setPath('userData', process.env.VIEWER_DATA_DIRECTORY);
}
let window: BrowserWindow | null = null;
let desktop: Desktop | null = null;
let closing = false;
let quitting = false;
let quitPending = false;
let disposing: Promise<void> = Promise.resolve();
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
function menu(): void {
  const command = (value: string) => () => desktop?.emit({ type: 'command', command: value });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              role: 'appMenu' as const,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: command('settings') },
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
            label: 'Open Folder…',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: command('choose-folder'),
          },
          { label: 'New Folder…', accelerator: 'CmdOrCtrl+Shift+N', click: command('new-folder') },
          { label: 'Open Selection', accelerator: 'CmdOrCtrl+O', click: command('open-selection') },
          { label: 'Quick Preview', click: command('quick-preview') },
          { label: 'Get Info…', accelerator: 'CmdOrCtrl+I', click: command('info') },
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
          { label: 'Commands…', accelerator: 'CmdOrCtrl+K', click: command('palette') },
          { label: 'Find File…', accelerator: 'CmdOrCtrl+F', click: command('find-file') },
          { label: 'Go to Folder…', accelerator: 'CmdOrCtrl+L', click: command('go-to') },
          {
            label: 'Show / Hide Sidebar',
            accelerator: 'CmdOrCtrl+Alt+S',
            click: command('toggle-sidebar'),
          },
          {
            label: 'Show / Hide Hidden Files',
            accelerator: 'CmdOrCtrl+Shift+.',
            click: command('hidden'),
          },
          { type: 'separator' },
          { label: 'Frame All Planes', accelerator: 'CmdOrCtrl+0', click: command('frame-all') },
          { label: 'Dock / Reveal', accelerator: 'CmdOrCtrl+Return', click: command('dock') },
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
  await disposing;
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
      // Owned packaged-app verification keeps RAF alive while macOS occludes
      // its test window. Normal launches retain background throttling.
      backgroundThrottling: process.env.VIEWER_RENDER_TEST !== '1',
    },
  });
  const createdWindow = window;
  let closePending = false;
  const services = new Desktop(window, app.getPath('userData'), trusted);
  desktop = services;
  protocol.handle('viewer-resource', (request) => services.resources.response(request));
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
    protocol.unhandle('viewer-resource');
    desktop = null;
    window = null;
    disposing = services.dispose().catch((error) => console.error('Desktop cleanup failed', error));
  });
  menu();
  await window.loadURL(devURL || 'viewer-app://app/index.html');
  window.show();
}
app.on('open-file', (event, file) => {
  event.preventDefault();
  if (desktop) desktop.open([file]);
  else pendingPaths.push(file);
});
app.whenReady().then(async () => {
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
  if (!window) void createWindow();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void (async () => {
    await desktop?.flush();
    await desktop?.operations.close();
    await disposing;
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
