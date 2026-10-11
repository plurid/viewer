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
import { repeatedPreviewFixture } from './workspace-fixtures';
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
      if (error instanceof Error && error.message.includes('SyntaxError')) throw error;
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
async function activateTestWindow(): Promise<void> {
  // Activate our PID: Launch Services can select a user's already-running Viewer
  // instead, leaving this disposable instance's native paint loop suspended.
  await command('Page.bringToFront');
  await until(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const activation = spawn('osascript', [
          '-l',
          'JavaScript',
          '-e',
          `ObjC.import('AppKit'); if (!$.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid}).activateWithOptions(2)) throw new Error('Activation failed');`,
        ]);
        activation.once('error', reject);
        activation.once('exit', (code) => resolve(code === 0));
      }),
    Boolean,
    'native test window registration and activation',
    5000,
  );
}
async function reloadPage(): Promise<void> {
  await evaluate('window.__qaReloadPending = true');
  await command('Page.reload');
  await until(
    () =>
      evaluate<boolean>(
        '!window.__qaReloadPending && document.readyState === "complete" && !!document.querySelector("[data-plurid-plane]")',
      ),
    Boolean,
    'new document after reload',
  );
  await activateTestWindow();
}
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
  const windowsVirtualKeyCode = key === 'Enter' ? 13 : key === 'Escape' ? 27 : undefined;
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
  });
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
  });
}
async function setting(label: string): Promise<void> {
  await evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.settings-row')).find(row => row.textContent.trim() === ${JSON.stringify(label)});
    const input = row?.querySelector('input');
    if (!input) throw new Error('Missing setting ' + ${JSON.stringify(label)});
    input.dataset.qaSetting = ${JSON.stringify(label)};
    input.scrollIntoView({ block: 'nearest' });
  })()`);
  await click(`[data-qa-setting=${JSON.stringify(label)}]`);
}
async function tab(label: string): Promise<void> {
  await until(
    () => evaluate<boolean>('!!document.querySelector(".settings-dialog[open]")'),
    (present) => present,
    'open Settings dialog',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.settings-tabs button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`,
  );
}
/** Read the public application ref from React's test-only fiber; never expose it in production. */
async function captureEngine(): Promise<void> {
  assert.equal(
    await evaluate(`(() => {
    const element = document.querySelector('[data-viewer-plane]');
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber'));
    for (let fiber = element[key]; fiber; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const api = hook.memoizedState?.current;
        if (api?.camera?.frame && api?.tree?.get) { window.__qaEngine = api; return true; }
      }
    }
    return false;
  })()`),
    true,
  );
}
async function restoredEngine(count: number): Promise<void> {
  await until(
    () => evaluate<boolean>('!!document.querySelector("[data-viewer-plane]")'),
    Boolean,
    'restored plane controls',
  );
  await captureEngine();
  await until(
    () => evaluate<number>('window.__qaEngine.inspect().planes.length'),
    (value) => value === count,
    'restored engine topology, including culled planes',
  );
}
const enginePlaneIDs = () =>
  evaluate<string>(
    'JSON.stringify(window.__qaEngine.inspect().planes.map(plane=>plane.planeID).sort())',
  );
async function drag(selector: string): Promise<void> {
  const point = await evaluate<{ x: number; y: number }>(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...point,
  });
  for (let i = 1; i <= 8; i++) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: point.x + i * 8,
      y: point.y + 2,
    });
    await delay(20);
  }
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    x: point.x + 64,
    y: point.y + 2,
  });
  await delay(250);
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
    () =>
      evaluate<boolean>('document.activeElement?.getAttribute("aria-label") === "Search commands"'),
    (present) => present,
    'focused command palette',
  );
  await command('Input.insertText', { text: label });
  await until(
    () =>
      evaluate<{ query: string; selected: string }>(
        `({query:document.querySelector('[aria-label="Search commands"]')?.getAttribute('value') || '',selected:document.querySelector('.command-result[aria-selected="true"]')?.textContent || ''})`,
      ),
    (value) => value.query === label && value.selected.includes(label),
    `command ${label}`,
  );
  await key('Enter', 'Enter');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Search commands"]')`),
    (present) => !present,
    'closed command palette',
  );
  // The menu closes before its action runs on the next animation frame. Waiting
  // for two paints observes that action even when a native frame takes >60ms.
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
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
  // A stable DOM observation is meaningful only after the native window paints;
  // otherwise an occluded window can look idle with recovery still queued.
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  let prior = '',
    stable = 0;
  await until(
    async () => {
      const state = await evaluate<{ transform: string; moving: boolean; ready: boolean }>(
        `({transform:JSON.stringify(Array.from(document.querySelectorAll('[data-plurid-plane]')).map(element=>getComputedStyle(element).transform)),moving:window.__qaEngine ? window.__qaEngine.camera.motion() !== 'idle' : !!document.querySelector('[data-plurid-motion]'),ready:(!window.__qaEngine || window.__qaEngine.getSnapshot().space.resolvedLayout) && getComputedStyle(document.querySelector('[data-plurid-entity="PluridSpace"]')).opacity === '1'})`,
      );
      stable = state.ready && state.transform === prior && !state.moving ? stable + 1 : 0;
      prior = state.transform;
      return stable;
    },
    (count) => count >= 4,
    'settled spatial camera',
  );
}
async function verifyRestoredPreviews(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const untouched = await inventory();
  const restore = async (state: SavedState, count: number) => {
    await delay(800);
    await evaluate(`window.viewer.save(${JSON.stringify(state)})`);
    await reloadPage();
    await restoredEngine(count);
    await settleCamera();
  };
  const containedActive = (id = 'legacy-preview-3') =>
    evaluate<boolean>(`(() => {
      const surface = document.querySelector('.workspace-surface').getBoundingClientRect();
      const plane = document.querySelector(${JSON.stringify(`[data-plurid-plane]:has([data-viewer-plane=${JSON.stringify(id)}])`)}).getBoundingClientRect();
      return plane.left >= surface.left && plane.top >= surface.top && plane.right <= surface.right && plane.bottom <= surface.bottom;
    })()`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await restore(repeatedPreviewFixture(fixture.files), 4);
    assert.equal(
      await containedActive(),
      true,
      `Restoration ${attempt + 1} must recover an offscreen active plane instead of replaying a clipped oblique view: ${await evaluate('JSON.stringify({camera:window.__qaEngine.camera.get(),resolved:window.__qaEngine.getSnapshot().space.resolvedLayout,view:window.__qaEngine.inspect().view,planes:window.__qaEngine.inspect().planes.map(plane=>({id:plane.planeID,width:plane.width,height:plane.height,location:plane.location}))})')}`,
    );
  }
  const planeIDs = await enginePlaneIDs();
  await evaluate(
    'window.__qaEngine.camera.frame({planeID:window.__qaEngine.tree.get()[0].planeID},{animate:false})',
  );
  await settleCamera();
  const image = fileSelector(path.join(fixture.files, 'Images', 'Color.png'));
  await click(image, 2);
  await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(image)});
    for (let count=0;count<3;count++) row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  })()`);
  await settleCamera();
  assert.equal(
    await enginePlaneIDs(),
    planeIDs,
    'Normal repeated activation of a restored image never adds another preview',
  );
  const reopened = await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) => state.workspaces[0].activePane?.startsWith('legacy-preview-') === true,
    'existing preview chosen for reopening',
  );
  const reopenedID = reopened.workspaces[0].activePane!;
  assert.equal(await containedActive(reopenedID), true);
  const geometry = await evaluate<string>(
    `JSON.stringify(window.__qaEngine.tree.get()[0].children.find(node => node.routeDivisions.plane.parameters.id === ${JSON.stringify(reopenedID)}).location)`,
  );
  const history = await evaluate<number>('window.__qaEngine.history.get().undoDepth');
  await paletteCommand('Consolidate repeated previews');
  await until(
    () => evaluate<number>('window.__qaEngine.inspect().planes.length'),
    (count) => count === 2,
    'consolidated repeated image previews',
  );
  await settleCamera();
  assert.equal(await containedActive(reopenedID), true);
  assert.equal(
    await evaluate('JSON.stringify(window.__qaEngine.tree.get()[0].children[0].location)'),
    geometry,
    'Recovery keeps the active preview and its placement',
  );
  assert.equal(await evaluate('window.__qaEngine.history.get().undoDepth'), history + 1);
  await paletteCommand('Undo arrangement');
  await until(
    () => evaluate<number>('window.__qaEngine.inspect().planes.length'),
    (count) => count === 4,
    'one undo restores every consolidated preview',
  );
  await paletteCommand('Redo arrangement');
  await until(
    () => evaluate<number>('window.__qaEngine.inspect().planes.length'),
    (count) => count === 2,
    'redo preview recovery',
  );
  // A deliberate oblique view that fits remains exact on reopen. Recovery is not
  // a blanket reset of users' saved camera arrangements.
  await evaluate(
    'window.__qaEngine.camera.moveBy({absolute:{yaw:-74,pitch:8,scale:0.6}},{animate:false})',
  );
  await settleCamera();
  assert.equal(await containedActive(reopenedID), true);
  const viewpoint = await evaluate<string>('window.__qaEngine.getViewpoint({version:2})');
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) =>
      Object.values(state.workspaces[0].arrangement).some(
        (value) => JSON.parse(value).space.camera.yaw === -74,
      ),
    'deliberate camera view persisted',
  );
  await reloadPage();
  await restoredEngine(2);
  await settleCamera();
  assert.equal(await evaluate('window.__qaEngine.getViewpoint({version:2})'), viewpoint);
  await evaluate(
    'window.__qaEngine.camera.frame({planeID:window.__qaEngine.tree.get()[0].planeID},{animate:false})',
  );
  await settleCamera();
  await click(fileSelector(path.join(fixture.files, 'Images', 'Color.png')));
  await paletteCommand('Open another plane');
  await until(
    () => evaluate<number>('window.__qaEngine.inspect().planes.length'),
    (count) => count === 3,
    'explicit independent image preview',
  );
  await settleCamera();
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) =>
      state.workspaces[0].panes.some((pane) => pane.type === 'preview' && pane.keepSeparate),
    'explicit copies retain their purpose in saved metadata',
  );
  await reloadPage();
  await restoredEngine(3);
  await settleCamera();
  await click('[aria-label="Commands (⌘K)"]');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".command-results")'),
    Boolean,
    'commands after restoring explicit copy',
  );
  await command('Input.insertText', { text: 'Consolidate repeated previews' });
  await until(
    () =>
      evaluate<string>(
        `document.querySelector('[aria-label="Search commands"]').getAttribute('value')`,
      ),
    (value) => value === 'Consolidate repeated previews',
    'query for unavailable consolidation after reopening an intentional copy',
  );
  assert.equal(
    await evaluate(
      'Array.from(document.querySelectorAll(".command-result")).some(row => row.textContent.includes("Consolidate repeated previews"))',
    ),
    false,
    'Explicit copies must be excluded from recovery',
  );
  await key('Escape', 'Escape');
  assert.deepEqual(
    await inventory(),
    untouched,
    'Preview recovery never changes filesystem contents',
  );
  await snapshot('desktop-native-workspace-recovered.png');
  await restore(original, original.workspaces[0].panes.length);
}
async function verifyRootPlanes(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const untouched = await inventory();
  const jobs = await evaluate<OperationJob[]>('window.viewer.jobs()');
  const saved = () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState);
  const roots = async (count: number) => {
    await restoredEngine(count);
    await settleCamera();
    return until(
      saved,
      (state) => state.workspaces[0].roots.length === count,
      `${count} saved roots`,
    );
  };
  const controls = (id: string) => `[data-viewer-plane=${JSON.stringify(id)}]`;
  const folder = (id: string) => `[data-plurid-plane]:has(${controls(id)}) .folder-plane`;
  assert.equal(original.ui?.version, 3);
  assert.equal(original.ui.sidebar.visible, false);
  assert.equal(original.workspaces[0].panes[0].type, 'folder');
  assert.equal(await evaluate('!!document.querySelector(".app-main > .location-sidebar")'), false);
  assert.equal(await evaluate('!!document.querySelector(".folder-plane .location-sidebar")'), true);
  const backups = (await readdir(profile)).filter((name) =>
    name.includes('before-plane-navigation-v3'),
  );
  assert.ok(backups.length >= 1);
  assert.equal(
    await readFile(path.join(profile, backups[0]), 'utf8'),
    JSON.stringify(fixture.state),
  );
  // Old engine snapshots may carry these choices independently of the host UI.
  await evaluate(
    `window.__qaEngine.pubsub.publish({topic:'configuration',data:{elements:{plane:{backface:'hidden'}},space:{navigation:{childFraming:'pair'}}}})`,
  );
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.elements.plane.backface'),
    'visible',
  );
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.space.navigation.childFraming'),
    'plane',
  );

  const first = original.workspaces[0].roots[0];
  const firstEngineID = await enginePlaneIDs();
  await click('[aria-label="New folder plane (⌘N)"]');
  let state = await roots(2);
  const second = state.workspaces[0].roots[1];
  assert.equal(state.workspaces[0].panes.find((pane) => pane.id === second)?.path, fixture.files);
  assert.ok(JSON.parse(await enginePlaneIDs()).includes(JSON.parse(firstEngineID)[0]));
  await click(`${controls(second)} [aria-label="Hide plane navigation"]`);
  assert.equal(
    await evaluate(
      `!!document.querySelector(${JSON.stringify(folder(second) + ' .location-sidebar')})`,
    ),
    false,
  );
  await click(`${controls(second)} [aria-label="Show plane navigation"]`);
  await click(`${folder(second)} .sidebar-resizer`);
  await key('ArrowRight', 'ArrowRight');
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(folder(second) + ' .sidebar-resizer')}).getAttribute('aria-valuenow')`,
    ),
    '220',
  );
  await click(
    `${folder(second)} .location[title=${JSON.stringify(path.join(fixture.files, 'Models'))}]`,
  );
  state = await until(
    saved,
    (value) =>
      value.workspaces[0].panes.find((pane) => pane.id === second)?.path.endsWith('/Models') ===
      true,
    'independent root navigation',
  );
  assert.equal(state.workspaces[0].panes.find((pane) => pane.id === first)?.path, fixture.files);
  const documents = path.join(fixture.files, 'Documents');
  await contextMenu(`${folder(second)} .location[title=${JSON.stringify(documents)}]`);
  await command('Input.insertText', { text: 'Open in new root plane' });
  await key('Enter', 'Enter');
  state = await roots(3);
  assert.equal(
    state.workspaces[0].panes.find((pane) => pane.id === state.workspaces[0].roots[2])?.path,
    documents,
  );
  await key('n', 'KeyN', 4);
  await roots(4);
  await paletteCommand('New folder plane');
  state = await roots(5);
  await click(`${controls(state.workspaces[0].roots[4])} [aria-label="Folder actions"]`);
  await command('Input.insertText', { text: 'New folder plane' });
  await key('Enter', 'Enter');
  await roots(6);
  // Two additions in one React batch must retain both roots and all earlier engine IDs.
  await evaluate(
    `(() => { const button = document.querySelector('[aria-label="New folder plane (⌘N)"]'); button.click(); button.click(); })()`,
  );
  state = await roots(8);
  assert.equal(new Set(state.workspaces[0].roots).size, 8);
  assert.equal(
    await evaluate('window.__qaEngine.tree.get().every(plane => !plane.parentPlaneID)'),
    true,
  );
  const allRootIDs = await enginePlaneIDs();
  await reloadPage();
  await restoredEngine(8);
  await settleCamera();
  assert.equal(await enginePlaneIDs(), allRootIDs);
  state = await saved();
  const resized = state.workspaces[0].panes.find((pane) => pane.id === second);
  assert.equal(resized?.type === 'folder' && resized.sidebar?.width, 220);
  assert.equal(resized?.type === 'folder' && resized.history.length, 2);
  assert.equal(state.workspaces[0].panes.find((pane) => pane.id === first)?.path, fixture.files);

  const last = state.workspaces[0].roots[7];
  await contextMenu(
    `${folder(last)} .location[title=${JSON.stringify(path.join(fixture.files, 'Models'))}]`,
  );
  await command('Input.insertText', { text: 'Open in new root plane' });
  await key('Enter', 'Enter');
  state = await roots(9);
  const previewOwner = state.workspaces[0].roots[8];
  await paletteCommand('Parent folder');
  await until(text, (value) => value.includes('Reference files.zip'), 'root parent folder');
  await click(`${folder(previewOwner)} ${fileSelector(path.join(fixture.files, 'Images'))}`, 2);
  await until(text, (value) => value.includes('Color.png'), 'root image directory');
  await click(
    `${folder(previewOwner)} ${fileSelector(path.join(fixture.files, 'Images', 'Color.png'))}`,
    2,
  );
  await restoredEngine(10);
  await settleCamera();
  state = await until(
    saved,
    (value) => value.workspaces[0].panes.some((pane) => pane.type === 'preview'),
    'linked image preview',
  );
  const previewID = state.workspaces[0].panes.find((pane) => pane.type === 'preview')!.id;
  const face = async (hostID: string, keyboard = false) => {
    const engineID = await evaluate<string>(
      `window.__qaEngine.inspect().planes.find(plane => plane.route.endsWith('/' + ${JSON.stringify(hostID)})).planeID`,
    );
    const minimap = `[data-plurid-minimap-plane=${JSON.stringify(engineID)}]`;
    if (keyboard) {
      await evaluate(`document.querySelector(${JSON.stringify(minimap)}).focus()`);
      await key('Enter', 'Enter');
    } else {
      // Dense maps have overlapping generous hit boxes. Find an exposed point
      // belonging to this real native button, rather than clicking another plane.
      const point = await evaluate<{ x: number; y: number } | null>(`(() => {
        const button = document.querySelector(${JSON.stringify(minimap)});
        const rect = button.getBoundingClientRect();
        for (let y=rect.top+1; y<rect.bottom; y+=2) for (let x=rect.left+1; x<rect.right; x+=2)
          if (button.contains(document.elementFromPoint(x,y))) return {x,y};
        return null;
      })()`);
      assert.ok(point, 'Minimap plane has an exposed clickable target');
      await command('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        buttons: 1,
        clickCount: 1,
        ...point,
      });
      await command('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        buttons: 0,
        clickCount: 1,
        ...point,
      });
    }
    await settleCamera();
    const facing = await evaluate<{ yaw: number; pitch: number; roll: number }>(`(() => {
      const camera = window.__qaEngine.camera.get();
      const node = window.__qaEngine.inspect().planes.find(plane => plane.planeID === ${JSON.stringify(engineID)});
      return { yaw: camera.yaw + node.location.rotateY, pitch: camera.pitch + node.location.rotateX, roll: camera.roll };
    })()`);
    for (const value of Object.values(facing))
      assert.ok(Math.abs(value) < 0.01, `Minimap must face ${hostID}: ${JSON.stringify(facing)}`);
    await until(
      saved,
      (value) => value.workspaces[0].activePane === hostID,
      'minimap command context',
    );
  };
  await face(previewOwner);
  await face(previewID);
  await face(previewOwner, true);
  const topology = await enginePlaneIDs();
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.space.navigation.childFraming'),
    'plane',
  );
  await snapshot('desktop-native-root-navigation.png');

  // The browser's projected positions are independent evidence of pointer movement
  // in local plane units, including a tilted and zoomed camera.
  await evaluate(
    'window.__qaEngine.camera.moveBy({absolute:{yaw:12,pitch:6,roll:8,scale:0.65}},{animate:false})',
  );
  await settleCamera();
  const camera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
  const handle = folder(previewOwner) + ' .sidebar-resizer';
  const points = await evaluate<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    hit: boolean;
  }>(`(() => {
    const sidebar = document.querySelector(${JSON.stringify(folder(previewOwner) + ' .location-sidebar')});
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;pointer-events:none;width:0;height:0;top:50%';
    sidebar.append(probe);
    const position = (x) => { probe.style.left = x + 'px'; const r = probe.getBoundingClientRect(); return {x:r.x,y:r.y}; };
    const start = position(sidebar.clientWidth);
    const end = position(sidebar.clientWidth + 64);
    probe.remove();
    return { start, end, hit:document.querySelector(${JSON.stringify(handle)}).contains(document.elementFromPoint(start.x,start.y)) };
  })()`);
  assert.equal(points.hit, true, 'Projected sidebar handle must be usable');
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...points.start,
  });
  for (let step = 1; step <= 8; step++) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: points.start.x + ((points.end.x - points.start.x) * step) / 8,
      y: points.start.y + ((points.end.y - points.start.y) * step) / 8,
    });
    await delay(20);
  }
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    ...points.end,
  });
  assert.ok(
    Math.abs(
      Number(
        await evaluate(
          `document.querySelector(${JSON.stringify(handle)}).getAttribute('aria-valuenow')`,
        ),
      ) - 274,
    ) <= 2,
  );
  assert.equal(
    await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
    camera,
    'Sidebar resize must not move the camera',
  );
  await paletteCommand('Frame plane');
  await settleCamera();
  await paletteCommand('Dock plane');
  await settleCamera();
  await command('Emulation.setDeviceMetricsOverride', {
    width: 420,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await settleCamera();
  assert.equal(
    await evaluate(
      `!!document.querySelector(${JSON.stringify(folder(previewOwner) + ' .location-sidebar')})`,
    ),
    true,
  );
  const narrow = await evaluate<{ sidebar: number; plane: number; overflow: boolean }>(`(() => {
    const plane = document.querySelector(${JSON.stringify(folder(previewOwner))});
    const list = plane.querySelector('.file-scroll');
    return { sidebar:plane.querySelector('.location-sidebar').offsetWidth,plane:plane.clientWidth,overflow:list.scrollWidth > list.clientWidth };
  })()`);
  assert.ok(narrow.sidebar <= narrow.plane / 2 + 1);
  assert.equal(narrow.overflow, false);
  await click(`${controls(previewOwner)} [aria-label="Hide plane navigation"]`);
  await click(`${controls(previewOwner)} [aria-label="Show plane navigation"]`);
  await snapshot('desktop-native-navigation-narrow-docked.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await paletteCommand('Reveal space');
  await settleCamera();
  assert.equal(await enginePlaneIDs(), topology);
  assert.deepEqual(await evaluate('window.viewer.jobs()'), jobs);
  assert.deepEqual(
    await inventory(),
    untouched,
    'Roots, navigation and minimap never change files',
  );
  await delay(800);
  await evaluate(`window.viewer.save(${JSON.stringify(original)})`);
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  console.log(
    'Root planes: +, Cmd+N, Commands, plane actions, shortcut roots, independent history, rapid additions, reload, minimap facing, projected resizing and narrow docked navigation.',
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
    if (message.method === 'Runtime.consoleAPICalled') {
      const entry = message.params as {
        type?: string;
        args?: { value?: unknown; description?: string }[];
      };
      rendererLog.push(
        JSON.stringify({
          type: entry.type,
          args: entry.args?.map((arg) => arg.value ?? arg.description),
        }),
      );
    }
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values())
      entry.reject(new Error('Native debugging target closed.'));
    pending.clear();
  });
  await command('Runtime.enable');
  await command('Page.enable');
  // The user's other windows can legitimately take native focus during this
  // isolated run. Keep browser focus deterministic without activating their app.
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await activateTestWindow();
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
  const untouched = await inventory();
  await captureEngine();
  await verifyRestoredPreviews();
  await verifyRootPlanes();
  await click('[aria-label="Show window navigation"]');
  await paletteCommand('Frame plane');
  await settleCamera();
  assert.deepEqual(
    await evaluate(`({
    toolbar: !!document.querySelector('[data-plurid-entity="PluridToolbar"]'),
    minimap: !!document.querySelector('[data-plurid-minimap]'),
    viewcube: !!document.querySelector('[data-plurid-overlay="viewcube"]'),
  })`),
    { toolbar: true, minimap: true, viewcube: true },
  );

  // The first press on the title selects the engine plane before its gesture listener.
  const firstLocation = await evaluate<string>(
    'JSON.stringify(window.__qaEngine.tree.get()[0].location)',
  );
  const firstCamera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
  await drag('.plane-heading');
  assert.notEqual(
    await evaluate('JSON.stringify(window.__qaEngine.tree.get()[0].location)'),
    firstLocation,
  );
  assert.equal(await evaluate('JSON.stringify(window.__qaEngine.camera.get())'), firstCamera);
  assert.equal(await evaluate('window.__qaEngine.selection.get().length'), 1);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label^="resize plane"]')`), true);
  await paletteCommand('Frame plane');
  await settleCamera();
  await click('[aria-label="Rotate mode"]');
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.space.transformMode'),
    'ROTATION',
  );
  await paletteCommand('Finish spatial tool');
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.space.transformMode'),
    'ALL',
  );
  await paletteCommand('Translate space');
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.space.transformMode'),
    'TRANSLATION',
  );
  await key('Escape', 'Escape');
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.space.transformMode'),
    'ALL',
  );

  await click('.plane-controls [aria-label="Search this folder"]');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Find files');
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
  await command('Input.insertText', { text: 'README' });
  await click('.plane-controls [aria-label="Close search"]');
  assert.equal(await evaluate('!!document.querySelector(".search-row")'), false);
  assert.equal(
    await evaluate('document.activeElement.classList.contains("folder-explorer")'),
    true,
  );
  await click('.plane-controls [aria-label="Search this folder"]');
  assert.equal(await evaluate('document.querySelector(".search-row input").value'), '');
  await click('.plane-controls [aria-label="Close search"]');

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
  const dimensions = [];
  for (const category of ['Appearance', 'Sidebar', 'Space']) {
    await tab(category);
    dimensions.push(
      await evaluate(
        '(() => { const r = document.querySelector(".settings-dialog").getBoundingClientRect(); return [r.width, r.height]; })()',
      ),
    );
  }
  assert.deepEqual(dimensions, [
    [500, 540],
    [500, 540],
    [500, 540],
  ]);
  await snapshot('settings-native.png');
  for (const [label, selector] of [
    ['Show bottom toolbar', '[data-plurid-entity="PluridToolbar"]'],
    ['Show minimap', '[data-plurid-minimap]'],
    ['Show viewcube', '[data-plurid-overlay="viewcube"]'],
  ]) {
    await setting(label);
    await until(
      () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
      (value) => !value,
      label,
    );
  }
  await click('dialog [aria-label="Close"]');
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (state) =>
      state.ui?.version === 3 &&
      !state.ui.space.toolbar &&
      !state.ui.space.minimap &&
      !state.ui.space.viewcube,
    'disabled spatial controls saved',
  );
  await reloadPage();
  await until(
    text,
    (value) => value.includes('Reference files.zip'),
    'restored controls preferences',
  );
  await captureEngine();
  await settleCamera();
  assert.equal(
    await evaluate(
      '!!document.querySelector("[data-plurid-minimap], [data-plurid-overlay=viewcube], [data-plurid-entity=PluridToolbar]")',
    ),
    false,
  );
  await paletteCommand('Settings');
  await tab('Space');
  for (const label of ['Show bottom toolbar', 'Show minimap', 'Show viewcube'])
    await setting(label);
  await setting('Show resize handles');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label^="resize plane"]')`), false);
  await setting('Show resize handles');
  await setting('Drag planes by their title');
  await click('dialog [aria-label="Close"]');
  const stationary = await evaluate<string>(
    'JSON.stringify(window.__qaEngine.tree.get()[0].location)',
  );
  await drag('.plane-heading');
  assert.equal(
    await evaluate('JSON.stringify(window.__qaEngine.tree.get()[0].location)'),
    stationary,
  );
  await paletteCommand('Settings');
  await tab('Space');
  await setting('Drag planes by their title');
  await setting('Show plane headers');
  assert.equal(await evaluate('!!document.querySelector(".plane-controls")'), false);
  await setting('Show plane headers');
  assert.equal((await text()).includes('Show plane backs'), false);
  assert.equal(
    await evaluate('window.__qaEngine.getSnapshot().configuration.elements.plane.backface'),
    'visible',
  );
  await click('dialog [aria-label="Close"]');
  await click('.plane-controls [aria-label="Hide plane navigation"]');
  await paletteCommand('Show plane navigation');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".folder-plane .location-sidebar")'),
    (value) => value,
    'in-plane navigation',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".folder-plane .sidebar-resizer").getAttribute("aria-valuenow")',
    ),
    '210',
  );
  await click('.folder-plane .sidebar-resizer');
  await key('ArrowRight', 'ArrowRight');
  assert.equal(
    await evaluate(
      'document.querySelector(".folder-plane .sidebar-resizer").getAttribute("aria-valuenow")',
    ),
    '220',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".app-main > .location-sidebar .sidebar-resizer").getAttribute("aria-valuenow")',
    ),
    '210',
  );
  await click(
    `.folder-plane .location[title=${JSON.stringify(path.join(fixture.files, 'Models'))}]`,
  );
  await until(text, (value) => value.includes('Triangle.glb'), 'in-plane shortcut navigation');
  await paletteCommand('Parent folder');
  await paletteCommand('Hide plane navigation');
  assert.deepEqual(
    await inventory(),
    untouched,
    'Plane controls and navigation preserve every fixture file',
  );

  const readme = path.join(fixture.files, 'README.md');
  await contextMenu(fileSelector(readme));
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
  assert.equal(await evaluate('getComputedStyle(document.activeElement).boxShadow'), 'none');
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
  const favorites = '.app-main > .location-sidebar .sidebar-group[aria-label="Favorites"]';
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
  await click('[aria-label="Hide window navigation"]');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".location-sidebar")'),
    (value) => !value,
    'hidden sidebar',
  );
  await click('[aria-label="Show window navigation"]');
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
  const facing = await evaluate<{ yaw: number; rotateY: number }>(
    '({yaw:window.__qaEngine.camera.get().yaw,rotateY:window.__qaEngine.tree.get()[0].children[0].location.rotateY})',
  );
  assert.ok(
    Math.abs(((facing.yaw + facing.rotateY + 540) % 360) - 180) < 0.1,
    `New plane must face the camera: ${JSON.stringify(facing)}`,
  );
  await paletteCommand('Models');
  await settleCamera();
  const modelFile = path.join(fixture.files, 'Models', 'Triangle.glb');
  // Repeated activation reuses the original linked node, including a rapid repeated event.
  const branch = await evaluate<string>('JSON.stringify(window.__qaEngine.tree.get())');
  await evaluate(`(() => { const row = document.querySelector(${JSON.stringify(fileSelector(modelFile))});
    for (let i = 0; i < 3; i++) row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
  await settleCamera();
  assert.equal(await evaluate('document.querySelectorAll("[data-viewer-plane]").length'), 2);
  assert.equal(await evaluate('JSON.stringify(window.__qaEngine.tree.get())'), branch);
  await paletteCommand('Models');
  await settleCamera();
  await click(fileSelector(modelFile));
  await paletteCommand('Open another plane');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 3,
    'intentional second view',
  );
  await settleCamera();
  await paletteCommand('Close plane');
  await until(
    () => evaluate<number>('document.querySelectorAll("[data-viewer-plane]").length'),
    (count) => count === 2,
    'closed second view',
  );
  await paletteCommand('Triangle.glb');
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
  await reloadPage();
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
