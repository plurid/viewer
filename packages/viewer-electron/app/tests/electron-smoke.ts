/** Runs the actual packaged macOS application against disposable synthetic files. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  await click('[aria-label="Parent folder"]');
  await until(text, (value) => value.includes('Reference files.zip'), 'return to Studio');
  await click(fileSelector(path.join(fixture.files, 'Documents')), 2);
  await until(text, (value) => value.includes('Project brief.pdf'), 'documents');
  await preview(path.join(fixture.files, 'Documents', 'Project notes.md'), 'A wider view');
  await closePreview();
  await preview(path.join(fixture.files, 'Documents', 'Project brief.pdf'), 'Searchable PDF text');
  await click('[aria-label="Search PDF text"]');
  await command('Input.insertText', { text: 'Searchable' });
  await until(text, (value) => value.includes('1 matching pages'), 'PDF text search');
  await closePreview();
  await click('[aria-label="Parent folder"]');
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
  await click('[aria-label="Switch to light look"]');
  await preview(path.join(fixture.files, 'Data', 'Materials.json'), 'materials');
  await click('[aria-label="Expand materials"]');
  await click('[aria-label="Expand 0"]');
  await until(text, (value) => value.includes('Brushed aluminum'), 'light JSON tree');
  await snapshot('json-light.png');
  await closePreview();
  await click('[aria-label="Parent folder"]');
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
  await click('[aria-label="Parent folder"]');
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
  await click('[aria-label="Switch to dark look"]');
  await preview(path.join(fixture.files, 'Data', 'Inventory.csv'), 'Small, medium');
  await closePreview();
  await preview(path.join(fixture.files, 'Data', 'Malformed.json'), 'Invalid JSON');
  await closePreview();
  await click('[aria-label="Parent folder"]');
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
  await click('[aria-label="Parent folder"]');
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
  await click('[aria-label="Parent folder"]');
  await until(text, (value) => value.includes('Reference files.zip'), 'return after media');

  const source = path.join(fixture.files, 'README.md'),
    destination = path.join(fixture.files, 'Transfers');
  assert.equal((await job({ kind: 'copy', sources: [source], destination })).status, 'completed');
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

  await click('[aria-label="Grid view"]');
  assert.equal(await evaluate('document.querySelectorAll(".file-tile").length > 0'), true);
  await click('[aria-label="Columns view"]');
  await click(fileSelector(path.join(fixture.files, 'Documents')));
  await until(text, (value) => value.includes('Project brief.pdf'), 'column child folder');
  await preview(path.join(fixture.files, 'Documents', 'Project notes.md'), 'A wider view');
  await closePreview();
  await click('[aria-label="Gallery view"]');
  await click(fileSelector(source));
  await until(
    text,
    (value) => value.includes('Synthetic files for local Viewer verification.'),
    'gallery preview',
  );
  await click('[aria-label="List view"]');
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
  const transforms = () =>
    evaluate<string>(
      'JSON.stringify(Array.from(document.querySelectorAll(".workspace-surface [style*=transform]")).map(element=>element.getAttribute("style")))',
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
    await click('[aria-label="Frame all planes"]');
    await settleCamera();
    await snapshot(`user-1456x${height}.png`);
  }
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('[aria-label="Frame all planes"]');
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
  await click('[aria-label="Dock or reveal active plane"]');
  await settleCamera();
  await click('.model-viewer [aria-label="Frame model"]');
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
  await click('[aria-label="Switch to light look"]');
  await until(text, (value) => value.includes('1 meshes'), 'model after look change');
  await settleCamera();
  await delay(300);
  await snapshot('desktop-light.png');
  await click('[aria-label="Switch to dark look"]');
  // Closing an explorer also closes its linked preview. History restores both
  // their engine nodes and host records, including redo, without orphan tabs.
  await click('[aria-label="Dock or reveal active plane"]');
  await click('.plane-tabs button:first-child');
  await settleCamera();
  await click('[data-plurid-plane] [aria-label="Close plane"]');
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-tabs button").length'),
    (count) => count === 0,
    'closed linked branch',
  );
  await click('[aria-label="Undo arrangement"]');
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-tabs button").length'),
    (count) => count === 2,
    'undo closed branch',
  );
  await click('[aria-label="Redo arrangement"]');
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-tabs button").length'),
    (count) => count === 0,
    'redo closed branch',
  );
  await click('[aria-label="Undo arrangement"]');
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-tabs button").length'),
    (count) => count === 2,
    'restore closed branch again',
  );
  // Verify real workspace switching without sharing an engine adapter.
  await click('[aria-label="New workspace"]');
  await command('Input.insertText', { text: 'Second workspace' });
  await click('dialog .primary');
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-tabs button").length'),
    (count) => count === 1,
    'new workspace',
  );
  await evaluate(
    `(()=>{const select=document.querySelector('[aria-label="Workspace"]');select.value=${JSON.stringify(fixture.state.activeWorkspace)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-tabs button").length'),
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
  await click('[aria-label="Switch to light look"]');
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
