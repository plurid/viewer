/** Runs the actual packaged macOS application against disposable synthetic files. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixtures } from './fixtures';
import type { OperationJob, SavedState } from '../src/domain/contracts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(
  appRoot,
  `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`,
);
const fixture = await createFixtures();
const profile = path.join(fixture.root, 'profile');
await mkdir(profile);
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(fixture.state));
const captureRoot = path.resolve(appRoot, '../../..', '.impeccable/review');
await mkdir(captureRoot, { recursive: true });
const listener = net.createServer();
await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as net.AddressInfo).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const child = spawn(
  binary,
  [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--disable-features=MacWebContentsOcclusion',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
  {
    env: { ...process.env, VIEWER_DATA_DIRECTORY: profile, VIEWER_RENDER_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let log = '';
child.stdout.on('data', (value) => {
  log += String(value);
});
child.stderr.on('data', (value) => {
  log += String(value);
});
let socket: WebSocket | undefined;
let nextID = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const exceptions: string[] = [];
const rendererLog: string[] = [];
async function until<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  label: string,
  timeout = 20000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      last = value;
      if (accepts(value)) return value;
    } catch (error) {
      last = error;
    }
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Viewer exited unexpectedly (${child.exitCode ?? child.signalCode}): ${log.slice(-3000)}`,
      );
    await delay(100);
  }
  throw new Error(`Timed out: ${label}. Last observation: ${String(last).slice(0, 2000)}`);
}
function command<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const id = ++nextID;
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    socket!.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate<T>(expression: string): Promise<T> {
  const value = await command<{
    result: { value: T };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (value.exceptionDetails)
    throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result.value;
}
const text = () => evaluate<string>('document.body.innerText');
const fileSelector = (file: string) => `[data-file-path=${JSON.stringify(file)}]`;
async function click(selector: string, count = 1): Promise<void> {
  const point = await evaluate<{ x: number; y: number; hit: boolean }>(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing control: ' + ${JSON.stringify(selector)}); const rect = element.getBoundingClientRect(); const x=rect.x+rect.width/2,y=rect.y+rect.height/2; return { x, y, hit:element.contains(document.elementFromPoint(x,y)) }; })()`,
  );
  assert.equal(
    point.hit,
    true,
    `Control must be hit-testable: ${selector} at ${point.x}, ${point.y}`,
  );
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      buttons: 1,
      clickCount,
      x: point.x,
      y: point.y,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      clickCount,
      x: point.x,
      y: point.y,
    });
  }
}
async function key(key: string, code: string, modifiers = 0): Promise<void> {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}
async function contextMenu(selector: string): Promise<void> {
  const point = await evaluate<{ x: number; y: number }>(
    `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'right',
    buttons: 2,
    clickCount: 1,
    ...point,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'right',
    buttons: 0,
    clickCount: 1,
    ...point,
  });
  await until(
    () =>
      evaluate<boolean>('document.activeElement?.getAttribute("aria-label") === "Search actions"'),
    (value) => value,
    'autofocused contextual search',
  );
}
async function inventory(): Promise<string[]> {
  const entries = await readdir(fixture.files, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const relative = path.relative(fixture.files, file);
      if (entry.isDirectory()) return `${relative}/`;
      if (entry.isSymbolicLink()) return `${relative} -> ${await readlink(file)}`;
      return `${relative}: ${createHash('sha256')
        .update(await readFile(file))
        .digest('hex')}`;
    }),
  ).then((entries) => entries.sort());
}
async function paletteCommand(label: string): Promise<void> {
  await click('[aria-label="Commands (⌘K)"]');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Search commands"]')`),
    (present) => present,
    'focused command palette',
  );
  await command('Input.insertText', { text: label });
  await until(
    () =>
      evaluate<string>(
        `document.querySelector('.command-result[aria-selected="true"]')?.textContent || ""`,
      ),
    (text) => text.includes(label),
    `command ${label}`,
  );
  await key('Enter', 'Enter');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Search commands"]')`),
    (present) => !present,
    'closed command palette',
  );
  await delay(60);
}
async function appearance(look: 'dark' | 'light'): Promise<void> {
  await paletteCommand('Settings');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Appearance"]')`),
    (present) => present,
    'appearance setting',
  );
  await evaluate(
    `(() => { const field = document.querySelector('[aria-label="Appearance"]'); field.value=${JSON.stringify(look)}; field.dispatchEvent(new Event('change', { bubbles:true })); })()`,
  );
  await until(
    () => evaluate<string>('document.documentElement.dataset.look'),
    (value) => value === look,
    'changed appearance',
  );
  await click('dialog [aria-label="Close"]');
}
async function preview(file: string, expected: string): Promise<void> {
  await click(fileSelector(file));
  await key(' ', 'Space');
  await until(text, (value) => value.includes(expected), `preview ${path.basename(file)}`);
  console.log(`Preview: ${path.basename(file)}`);
}
async function closePreview(): Promise<void> {
  await click('dialog [aria-label="Close"]');
}
async function snapshot(name: string, clip?: Record<string, number>): Promise<string> {
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const value = await command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip } : {}),
  });
  const buffer = Buffer.from(value.data, 'base64');
  await writeFile(path.join(captureRoot, name), buffer);
  return createHash('sha256').update(buffer).digest('hex');
}
async function settleCamera(): Promise<void> {
  let prior = '',
    stable = 0;
  await until(
    async () => {
      const state = await evaluate<{ transform: string; moving: boolean }>(
        '({transform:JSON.stringify(Array.from(document.querySelectorAll(".workspace-surface [style*=transform]")).map(element=>element.getAttribute("style"))),moving:!!document.querySelector("[data-plurid-motion], .workspace-surface [style*=will-change]") || Array.from(document.querySelectorAll("[data-plurid-plane]")).some(element => {for(let parent=element;parent && parent.closest(".workspace-surface");parent=parent.parentElement){if(Number(getComputedStyle(parent).opacity)<0.99)return true;}return false;})})',
      );
      stable = state.transform === prior && !state.moving ? stable + 1 : 0;
      prior = state.transform;
      return stable;
    },
    (count) => count >= 4,
    'settled spatial camera',
  );
}
async function job(request: Record<string, unknown>): Promise<OperationJob> {
  const id = await evaluate<string>(`window.viewer.operate(${JSON.stringify(request)})`);
  return until(
    () => evaluate<OperationJob[]>(`window.viewer.jobs()`),
    (jobs) =>
      jobs.some(
        (job) => job.id === id && ['completed', 'failed', 'cancelled'].includes(job.status),
      ),
    'file operation',
  ).then((jobs) => jobs.find((job) => job.id === id)!);
}
try {
  const target = await until(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await response.json()) as { type: string; webSocketDebuggerUrl: string }[];
    },
    (targets) => targets.some((target) => target.type === 'page'),
    'packaged application startup',
  );
  socket = new WebSocket(target.find((target) => target.type === 'page')!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true });
    socket!.addEventListener(
      'error',
      () => reject(new Error('Could not connect to Viewer debugging endpoint')),
      { once: true },
    );
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      params?: { exceptionDetails?: { text?: string; exception?: { description?: string } } };
    };
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(message.error.message));
      else entry?.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown')
      exceptions.push(
        message.params?.exceptionDetails?.exception?.description ||
          message.params?.exceptionDetails?.text ||
          'Renderer exception',
      );
    if (message.method === 'Runtime.consoleAPICalled')
      rendererLog.push(JSON.stringify(message.params));
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values())
      entry.reject(new Error('Native debugging target closed.'));
    pending.clear();
  });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Page.bringToFront');
  // Launch Services activation makes the real window visible to macOS's occlusion
  // detector. CDP focus alone leaves RAF suspended when another app covers it.
  await new Promise<void>((resolve, reject) => {
    const activation = spawn('open', ['-a', path.resolve(binary, '../../..')]);
    activation.once('error', reject);
    activation.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Could not activate the Viewer test window')),
    );
  });
  await until(
    () => evaluate<string>('document.visibilityState'),
    (value) => value === 'visible',
    'visible native window',
  );
  await until(text, (value) => value.includes('Reference files.zip'), 'initial fixture folder');
  await settleCamera();
  assert.equal(await evaluate('location.protocol'), 'viewer-app:');
  assert.deepEqual(
    await evaluate(
      '({require:typeof window.require, process:typeof window.process, bridge:typeof window.viewer})',
    ),
    { require: 'undefined', process: 'undefined', bridge: 'object' },
  );
  await snapshot('desktop-native-initial.png');

  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("[data-plurid-plane]")).backfaceVisibility',
    ),
    'visible',
  );
  assert.equal(
    await evaluate(
      '!!document.querySelector(".wordmark, .workspace-tabs, .workspace-footer, .folder-toolbar, .search-row, .breadcrumb-row, .operations-panel, .operations-button")',
    ),
    false,
    'Initial shell has no branding, redundant toolbars, permanent operations or search rows',
  );
  await key('k', 'KeyK', 4);
  await until(
    () =>
      evaluate<boolean>('document.activeElement?.getAttribute("aria-label") === "Search commands"'),
    (value) => value,
    'keyboard command palette',
  );
  await command('Input.insertText', { text: 'Settings' });
  await snapshot('palette-native.png');
  await key('Enter', 'Enter');
  await until(
    text,
    (value) => value.includes('Settings') && value.includes('Appearance'),
    'Settings from keyboard',
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".settings-tabs button")).find(button=>button.textContent === "Space").click()',
  );
  await snapshot('settings-native.png');
  await click('.settings-content input');
  await until(
    () =>
      evaluate<string>(
        'getComputedStyle(document.querySelector("[data-plurid-plane]")).backfaceVisibility',
      ),
    (value) => value === 'hidden',
    'plane backs setting',
  );
  await click('.settings-content input');
  await until(
    () =>
      evaluate<string>(
        'getComputedStyle(document.querySelector("[data-plurid-plane]")).backfaceVisibility',
      ),
    (value) => value === 'visible',
    'visible plane backs restored',
  );
  await click('dialog [aria-label="Close"]');

  const readme = path.join(fixture.files, 'README.md');
  await contextMenu(fileSelector(readme));
  await command('Input.insertText', { text: 'rn' });
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]")?.textContent || ""',
      ),
    (value) => value.startsWith('Rename'),
    'two-letter Rename alias',
  );
  await key('Enter', 'Enter');
  await until(
    () => evaluate<string>('document.querySelector("dialog input")?.value || ""'),
    (value) => value === 'README.md',
    'clicked target captured for rename',
  );
  await click('dialog [aria-label="Close"]');
  await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
  assert.match(
    await evaluate<string>(
      'document.querySelector(".context-menu .command-result")?.textContent || ""',
    ),
    /^Rename/,
  );
  assert.equal(
    await evaluate(
      'Array.from(document.querySelectorAll(".context-menu .command-result-text > span")).filter(item => item.textContent === "Rename…").length',
    ),
    1,
  );
  await snapshot('context-native.png');
  await key('Escape', 'Escape');
  // The header actions resolve the current selection through the same registry.
  await click('[aria-label="Folder actions"]');
  await command('Input.insertText', { text: 'rn' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate<string>('document.querySelector("dialog input")?.value || ""'),
    (value) => value === 'Models',
    'header menu uses selected folder',
  );
  await click('dialog [aria-label="Close"]');

  const sidebarJobs = await evaluate<OperationJob[]>('window.viewer.jobs()');
  const favorites =
    '.sidebar-group:has(.location[title=' +
    JSON.stringify(path.join(fixture.files, 'Models')) +
    '])';
  await click(`${favorites} .sidebar-section-title`);
  assert.equal(
    await evaluate(`!!document.querySelector(${JSON.stringify(favorites + ' .location')})`),
    false,
  );
  // Find the now-collapsed section by its title rather than its hidden contents.
  await evaluate(
    'Array.from(document.querySelectorAll(".sidebar-section-title")).find(button=>button.textContent.includes("Favorites")).click()',
  );
  await evaluate(
    '(() => { const transfer=new DataTransfer(); const titles=Array.from(document.querySelectorAll(".sidebar-section-title")); const source=titles.find(button=>button.textContent.includes("Favorites")); const target=titles.find(button=>button.textContent.includes("Locations")); source.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:transfer})); target.closest("section").dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:transfer})); })()',
  );
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll(".sidebar-section-title")).map(button=>button.textContent.trim())',
    ),
    ['Favorites', 'Locations', 'Recent'],
  );
  await evaluate(
    `(() => { const transfer=new DataTransfer(); const source=document.querySelector('.location[title=${JSON.stringify(path.join(fixture.files, 'Documents'))}]'); const target=document.querySelector('.location[title=${JSON.stringify(path.join(fixture.files, 'Models'))}]'); source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer})); target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer})); })()`,
  );
  assert.deepEqual(
    await evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(favorites + ' .location')})).map(button => button.textContent.trim())`,
    ),
    ['Documents', 'Models'],
  );
  // A folder row offers a separate shortcut payload, so Favorites never moves a file.
  await evaluate(
    `(() => { const transfer=new DataTransfer(); document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, 'Images')))}).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer})); document.querySelector(${JSON.stringify(favorites)}).dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer})); })()`,
  );
  await until(
    () =>
      evaluate<boolean>(
        `!!document.querySelector('.location[title=${JSON.stringify(path.join(fixture.files, 'Images'))}]')`,
      ),
    (value) => value,
    'folder shortcut drop',
  );
  await contextMenu(
    '.location[title=' + JSON.stringify(path.join(fixture.files, 'Documents')) + ']',
  );
  await command('Input.insertText', { text: 'Rename shortcut' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate<string>('document.querySelector("dialog input")?.value || ""'),
    (value) => value === 'Documents',
    'shortcut alias dialog',
  );
  await command('Input.insertText', { text: 'Project documents' });
  await click('dialog .primary');
  await until(text, (value) => value.includes('Project documents'), 'shortcut alias');
  assert.deepEqual(
    await evaluate('window.viewer.jobs()'),
    sidebarJobs,
    'Sidebar changes must not start filesystem operations',
  );
  await click('[aria-label="Sidebar width"]');
  await key('ArrowRight', 'ArrowRight');
  assert.equal(
    await evaluate('document.querySelector(".sidebar-resizer").getAttribute("aria-valuenow")'),
    '220',
  );
  await click('[aria-label="Hide sidebar"]');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".location-sidebar")'),
    (value) => !value,
    'hidden sidebar',
  );
  await click('[aria-label="Show sidebar"]');
  await paletteCommand('Frame all planes');
  await settleCamera();
  await snapshot('sidebar-native.png');
  await key('f', 'KeyF', 4);
  await until(
    () =>
      evaluate<boolean>(
        'document.activeElement?.getAttribute("aria-label") === "Find file by name"',
      ),
    (value) => value,
    'contextual file finder',
  );
  await command('Input.insertText', { text: 'Project brief.pdf' });
  await evaluate(
    'Array.from(document.querySelectorAll("dialog button")).find(button=>button.textContent === "Include subfolders").click()',
  );
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]")?.textContent || ""',
      ),
    (value) => value.includes('Project brief.pdf'),
    'subtree file search in palette',
  );
  await snapshot('file-finder-native.png');
  await key('Escape', 'Escape');
  console.log(
    'Interface: contextual search and recency, Cmd+K, Settings, sidebar collapse/reorder/shortcut aliases/hide/resize.',
  );

  await click(fileSelector(path.join(fixture.files, 'Models')), 2);
  await until(text, (value) => value.includes('Triangle.glb'), 'model folder');
  await click(fileSelector(path.join(fixture.files, 'Models', 'Triangle alias.glb')));
  assert.equal(await evaluate('document.querySelector(".symlink-mark")?.tagName'), 'svg');
  await snapshot('selected-alias-dark.png');
  for (const extension of ['glb', 'gltf', 'obj', 'stl', 'fbx']) {
    await preview(
      path.join(fixture.files, 'Models', `Triangle.${extension}`),
      '1 meshes · 1 triangles · 3 vertices',
    );
    await closePreview();
  }
  await preview(path.join(fixture.files, 'Models', 'Malformed.glb'), 'Model could not be loaded');
  await closePreview();
  await preview(
    path.join(fixture.files, 'Models', 'Missing-assets.gltf'),
    'Model could not be loaded',
  );
  await closePreview();
  await paletteCommand('Parent folder');
  await until(text, (value) => value.includes('Reference files.zip'), 'return to Studio');
  await click(fileSelector(path.join(fixture.files, 'Documents')), 2);
  await until(text, (value) => value.includes('Project brief.pdf'), 'documents');
  await preview(path.join(fixture.files, 'Documents', 'Project notes.md'), 'A wider view');
  await closePreview();
  await preview(path.join(fixture.files, 'Documents', 'Project brief.pdf'), 'Searchable PDF text');
  await click('[aria-label="Search PDF"]');
  await click('[aria-label="Search PDF text"]');
  await command('Input.insertText', { text: 'Searchable' });
  await until(text, (value) => value.includes('1 matching pages'), 'PDF text search');
  await closePreview();
  await paletteCommand('Parent folder');
  await until(text, (value) => value.includes('Reference files.zip'), 'Studio archive files');
  for (const extension of ['zip', 'tar', 'tar.gz']) {
    await preview(path.join(fixture.files, `Reference files.${extension}`), 'notes.md');
    await click('dialog .archive-row');
    await until(
      text,
      (value) =>
        value.includes(
          extension === 'zip' ? 'Local archive preview' : 'An entry preview without extraction.',
        ),
      'archive entry',
    );
    await click('[aria-label="Back to archive"]');
    await closePreview();
  }
  await click(fileSelector(path.join(fixture.files, 'Data')), 2);
  await until(text, (value) => value.includes('Inventory.csv'), 'data');
  await preview(path.join(fixture.files, 'Data', 'Materials.json'), 'materials');
  await click('[aria-label="Expand materials"]');
  await click('[aria-label="Expand 0"]');
  await until(text, (value) => value.includes('Brushed aluminum'), 'expanded JSON tree');
  await closePreview();
  await appearance('light');
  await preview(path.join(fixture.files, 'Data', 'Materials.json'), 'materials');
  await click('[aria-label="Expand materials"]');
  await click('[aria-label="Expand 0"]');
  await until(text, (value) => value.includes('Brushed aluminum'), 'light JSON tree');
  await snapshot('json-light.png');
  await closePreview();
  await paletteCommand('Parent folder');
  await until(
    () =>
      evaluate<boolean>(
        `!!document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, 'Source')))})`,
      ),
    (present) => present,
    'return before light code',
  );
  await click(fileSelector(path.join(fixture.files, 'Source')), 2);
  await until(text, (value) => value.includes('workspace.ts'), 'source code folder');
  await preview(path.join(fixture.files, 'Source', 'workspace.ts'), 'export interface Workspace');
  await snapshot('code-light.png');
  await closePreview();
  await paletteCommand('Parent folder');
  await until(
    () =>
      evaluate<boolean>(
        `!!document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, 'Data')))})`,
      ),
    (present) => present,
    'return before data',
  );
  await click(fileSelector(path.join(fixture.files, 'Data')), 2);
  await until(text, (value) => value.includes('Inventory.csv'), 'return to data folder');
  await appearance('dark');
  await preview(path.join(fixture.files, 'Data', 'Inventory.csv'), 'Small, medium');
  await closePreview();
  await preview(path.join(fixture.files, 'Data', 'Malformed.json'), 'Invalid JSON');
  await closePreview();
  await paletteCommand('Parent folder');
  await until(
    text,
    (value) => value.includes('Reference files.zip'),
    'return before image preview',
  );
  await click(fileSelector(path.join(fixture.files, 'Images')), 2);
  await until(text, (value) => value.includes('Color.png'), 'images');
  await preview(path.join(fixture.files, 'Images', 'Color.png'), '64 × 64');
  await click('[aria-label="Zoom in"]');
  assert.match(await text(), /125%/);
  await closePreview();
  await preview(path.join(fixture.files, 'Images', 'Reference.svg'), '800 × 600');
  await closePreview();
  await paletteCommand('Parent folder');
  await until(
    text,
    (value) => value.includes('Reference files.zip'),
    'return before media preview',
  );
  await click(fileSelector(path.join(fixture.files, 'Media')), 2);
  await until(text, (value) => value.includes('Tone.wav'), 'media');
  for (const file of ['Tone.wav', 'Color.webm']) {
    await preview(path.join(fixture.files, 'Media', file), 'Audio / video');
    await until(
      () => evaluate<number>('document.querySelector("dialog audio, dialog video")?.duration || 0'),
      (value) => value >= 1,
      `decoded ${file}`,
    );
    await evaluate(
      'window.__qaMedia=document.querySelector("dialog audio, dialog video"); window.__qaMedia.muted=true; window.__qaMedia.play()',
    );
    await closePreview();
    assert.equal(
      await evaluate('window.__qaMedia.paused && !window.__qaMedia.hasAttribute("src")'),
      true,
    );
    await evaluate('window.__qaMedia=null');
  }
  await paletteCommand('Parent folder');
  await until(text, (value) => value.includes('Reference files.zip'), 'return after media');

  const source = path.join(fixture.files, 'README.md'),
    destination = path.join(fixture.files, 'Transfers');
  assert.equal((await job({ kind: 'copy', sources: [source], destination })).status, 'completed');
  const workspaceWidth = await evaluate<number>(
    'document.querySelector(".workspace-surface").clientWidth',
  );
  const collisionID = await evaluate<string>(
    `window.viewer.operate(${JSON.stringify({ kind: 'copy', sources: [source], destination })})`,
  );
  await until(
    () => evaluate<OperationJob[]>('window.viewer.jobs()'),
    (jobs) => jobs.some((job) => job.id === collisionID && job.status === 'collision'),
    'pending collision',
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".operations-button")'),
    (value) => value,
    'conditional operations control',
  );
  await click('.operations-button');
  await until(text, (value) => value.includes('already exists.'), 'collision popover');
  assert.equal(
    await evaluate('document.querySelector(".workspace-surface").clientWidth'),
    workspaceWidth,
    'Operations must not reduce workspace width',
  );
  await snapshot('operations-native.png');
  await evaluate(
    'Array.from(document.querySelectorAll(".collision-actions button")).find(button=>button.textContent === "Replace").click()',
  );
  await until(text, (value) => value.includes('Replace existing item?'), 'protected replacement');
  await click('dialog [aria-label="Close"]');
  await evaluate(
    'Array.from(document.querySelectorAll(".collision-actions button")).find(button=>button.textContent === "Skip").click()',
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".operations-button, .operations-panel")'),
    (value) => !value,
    'operations control removed after completion',
  );
  await paletteCommand('Recent file operations');
  await until(text, (value) => value.includes('completed'), 'explicit operation history');
  await click('[aria-label="Close operations"]');
  const renamed = await job({
    kind: 'rename',
    sources: [path.join(destination, 'README.md')],
    name: 'Copied notes.md',
  });
  assert.equal(renamed.undoable, true);
  await evaluate(`window.viewer.undo(${JSON.stringify(renamed.id)})`);
  assert.equal(
    await readFile(path.join(destination, 'README.md'), 'utf8'),
    '# Studio\n\nSynthetic files for local Viewer verification.\n',
  );
  const grant = await evaluate<{ id: string; url: string }>(
    `window.viewer.resource(${JSON.stringify(source)})`,
  );
  const scopeResult = await evaluate<{
    range: number;
    csp: string;
    escaped: number;
    network: boolean;
  }>(
    `(async()=>{ const response=await fetch(${JSON.stringify(grant.url)}, {headers:{Range:'bytes=0-3'}}); const escaped=await fetch(${JSON.stringify(`viewer-resource://${grant.id}/asset/%2e%2e%2foutside`)}); let network=false; try{await fetch('https://example.com');network=true}catch{} return {range:response.status,csp:response.headers.get('content-security-policy'),escaped:escaped.status,network};})()`,
  );
  assert.equal(scopeResult.range, 206);
  assert.equal(scopeResult.escaped, 403);
  assert.equal(scopeResult.network, false);
  assert.match(scopeResult.csp, /sandbox/);
  await evaluate(`window.viewer.release(${JSON.stringify(grant.id)})`);
  const validation = await evaluate<boolean>(
    `window.viewer.stat('relative-path').then(()=>false,()=>true)`,
  );
  assert.equal(validation, true);

  await paletteCommand('Grid view');
  assert.equal(await evaluate('document.querySelectorAll(".file-tile").length > 0'), true);
  await paletteCommand('Columns view');
  await click(fileSelector(path.join(fixture.files, 'Documents')));
  await until(text, (value) => value.includes('Project brief.pdf'), 'column child folder');
  await preview(path.join(fixture.files, 'Documents', 'Project notes.md'), 'A wider view');
  await closePreview();
  await paletteCommand('Gallery view');
  await click(fileSelector(source));
  await until(
    text,
    (value) => value.includes('Synthetic files for local Viewer verification.'),
    'gallery preview',
  );
  await paletteCommand('List view');
  await click(fileSelector(path.join(fixture.files, 'Models')), 2);
  await until(text, (value) => value.includes('Triangle.glb'), 'linked preview folder');
  await preview(
    path.join(fixture.files, 'Models', 'Triangle.glb'),
    '1 meshes · 1 triangles · 3 vertices',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Open linked plane').click()`,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-plurid-plane]").length'),
    (count) => count === 2,
    'linked spatial preview',
  );
  await settleCamera();
  assert.equal(await evaluate('document.querySelector(".model-stage canvas") !== null'), true);
  assert.equal(
    await evaluate('!!document.querySelector(".plane-module-controls .preview-toolbar")'),
    true,
    'Preview controls belong in the plane header',
  );
  await paletteCommand('Show wireframe');
  await paletteCommand('Hide wireframe');
  const transforms = () =>
    evaluate<string>(
      'JSON.stringify(Array.from(document.querySelectorAll(".workspace-surface [style*=transform]")).map(element=>getComputedStyle(element).transform))',
    );
  const beforeTransform = await transforms();
  const bounds = await evaluate<{
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  }>(
    '(()=>{const rect=document.querySelector(".model-stage canvas").getBoundingClientRect();return{x:Math.max(0,rect.x),y:Math.max(0,rect.y),width:Math.min(rect.width,innerWidth-Math.max(0,rect.x)),height:Math.min(rect.height,innerHeight-Math.max(0,rect.y)),scale:1}})()',
  );
  const beforeImage = await snapshot('model-before-orbit.png', bounds);
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...point,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    button: 'left',
    buttons: 1,
    x: point.x + 70,
    y: point.y + 30,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    x: point.x + 70,
    y: point.y + 30,
  });
  await delay(700);
  assert.equal(await transforms(), beforeTransform, 'Model orbit must not move the file planes');
  assert.notEqual(
    await snapshot('model-after-orbit.png', bounds),
    beforeImage,
    'Model orbit should change the rendered view',
  );
  await snapshot('desktop-native.png');
  // Include both viewport sizes observed in the user's browser session.
  for (const height of [935, 879]) {
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1456,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await paletteCommand('Frame all planes');
    await settleCamera();
    await snapshot(`user-1456x${height}.png`);
  }
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await paletteCommand('Frame all planes');
  await settleCamera();
  const framed = await evaluate<{ view: number[]; planes: number[][] }>(
    '(()=>{const bounds=element=>{const r=element.getBoundingClientRect();return[r.left,r.top,r.right,r.bottom]};return{view:bounds(document.querySelector(".workspace-surface")),planes:Array.from(document.querySelectorAll("[data-plurid-plane], .plane-controls")).map(bounds)}})()',
  );
  for (const plane of framed.planes) {
    assert.ok(
      plane[0] >= framed.view[0] - 1 &&
        plane[1] >= framed.view[1] - 1 &&
        plane[2] <= framed.view[2] + 1 &&
        plane[3] <= framed.view[3] + 1,
      `Frame all must contain planes and their controls after resize: ${JSON.stringify(framed)}`,
    );
  }
  await snapshot('compact-native-initial.png');
  await paletteCommand('Dock plane');
  await settleCamera();
  await click('.plane-module-controls [aria-label="Frame model"]');
  await delay(200);
  assert.equal(
    await evaluate(
      '(()=>{const button=document.querySelector(".preview-info button");const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) && r.right<=innerWidth && r.bottom<=innerHeight;})()',
    ),
    true,
    'Dock navigation must leave the external-app action visible and reachable',
  );
  await snapshot('compact-native-docked.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await appearance('light');
  await until(text, (value) => value.includes('1 meshes'), 'model after look change');
  await settleCamera();
  await delay(300);
  await snapshot('desktop-light.png');
  await appearance('dark');
  // Closing an explorer also closes its linked preview. History restores both
  // their engine nodes and host records, including redo, without orphan tabs.
  await paletteCommand('Reveal space');
  await paletteCommand('Models');
  await settleCamera();
  await click('[data-plurid-plane]:has(.folder-explorer) [aria-label="Close plane"]');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 0,
    'closed linked branch',
  );
  await paletteCommand('Undo arrangement');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 2,
    'undo closed branch',
  );
  await paletteCommand('Redo arrangement');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 0,
    'redo closed branch',
  );
  await paletteCommand('Undo arrangement');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 2,
    'restore closed branch again',
  );
  // Verify real workspace switching without sharing an engine adapter.
  await paletteCommand('New workspace');
  await command('Input.insertText', { text: 'Second workspace' });
  await click('dialog .primary');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 1,
    'new workspace',
  );
  const filesBeforeDelete = await inventory();
  const jobsBeforeDelete = await evaluate<OperationJob[]>('window.viewer.jobs()');
  await paletteCommand('Delete workspace');
  await until(
    text,
    (value) => value.includes('Second workspace') && value.includes('1 open plane'),
    'workspace deletion confirmation',
  );
  await snapshot('workspace-delete-native.png');
  await click('dialog [aria-label="Close"]');
  await paletteCommand('Delete workspace');
  await click('dialog .danger');
  await until(
    () => evaluate<string>('document.querySelector(".workspace-switcher")?.textContent || ""'),
    (value) => value.trim() === fixture.state.workspaces[0].name,
    'layout-only deletion switches workspace',
  );
  assert.deepEqual(
    await inventory(),
    filesBeforeDelete,
    'Workspace deletion must preserve every fixture file, folder and symlink',
  );
  assert.deepEqual(
    await evaluate('window.viewer.jobs()'),
    jobsBeforeDelete,
    'Workspace deletion must preserve file jobs',
  );
  await paletteCommand('Undo workspace deletion');
  await until(
    () => evaluate<string>('document.querySelector(".workspace-switcher")?.textContent || ""'),
    (value) => value.trim() === 'Second workspace',
    'workspace recovery',
  );
  assert.deepEqual(await inventory(), filesBeforeDelete, 'Recovery must preserve fixture contents');
  await paletteCommand(fixture.state.workspaces[0].name);
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 2,
    'switched workspace restored',
  );
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) => state.activeWorkspace === fixture.state.activeWorkspace,
    'workspace switch persisted',
  );
  await command('Page.reload');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-plurid-plane]").length'),
    (count) => count === 2,
    'restored planes after reload',
  );
  const state = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  assert.equal(state.workspaces[0].panes.length, 2);
  assert.ok(
    Object.keys(state.workspaces[0].arrangement).length > 0,
    'Engine arrangement must be persisted',
  );
  assert.deepEqual(exceptions, []);
  // A native application quit exercises the renderer/main flush handshake, even
  // when the 400ms persistence debounce has not fired.
  await appearance('light');
  assert.equal(await evaluate('document.documentElement.dataset.look'), 'light');
  // Electron's renderer window.close() bypasses BrowserWindow's native close
  // event. Browser.close drives app.quit(), including before-quit and close.
  void command('Browser.close').catch(() => undefined);
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) => state.look === 'light',
    'flush on native window close',
  );
  await until(
    async () => child.exitCode,
    (code) => code === 0,
    'native application quit',
  );
  console.log(
    'Packaged Electron verification passed: previews, file jobs and undo, four explorer views, model gesture isolation, IPC/resource boundaries, and workspace restoration.',
  );
} catch (error) {
  console.error(error);
  console.error('Renderer diagnostics:', rendererLog.slice(-10), exceptions);
  console.error(log.slice(-3500));
  if (socket?.readyState === WebSocket.OPEN) {
    console.error(
      await evaluate(
        '({visibility:document.visibilityState,focus:document.hasFocus(),motion:document.querySelector("[data-plurid-motion]")?.getAttribute("data-plurid-motion"),canvas:Array.from(document.querySelectorAll("canvas")).map(canvas=>({width:canvas.width,height:canvas.height})),textLayers:Array.from(document.querySelectorAll(".textLayer")).map(layer=>layer.innerHTML.slice(0,200))})',
      ).catch(() => 'No diagnostic DOM'),
    );
    await snapshot('failure.png').catch(() => undefined);
  }
  if (socket?.readyState === WebSocket.OPEN)
    console.error(await text().catch(() => 'Renderer unavailable'));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await rm(fixture.root, { recursive: true, force: true });
}
