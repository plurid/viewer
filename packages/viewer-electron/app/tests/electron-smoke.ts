/** Runs the actual packaged macOS application against disposable synthetic files. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createFixtures, sizedImageFixture } from './fixtures';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import { repeatedPreviewFixture } from './workspace-fixtures';
import { formatBytes } from '../src/domain/files';
import { panelDrawing } from './dxf-fixtures';
import { reactCommitProbe } from './react-commits';
import type { OperationJob, SavedState } from '../src/domain/contracts';
import { trashTemporary, trashFixtureEntry } from '../tools/temporary';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Routine functional checks never show or activate the test app. Physical
// compositor profiling requires a separately requested foreground run.
const foreground = process.env.VIEWER_TEST_FOREGROUND === '1';
const execNative = promisify(execFile);
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.join(appRoot, `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`);
const fixture = await createFixtures();
if (process.env.VIEWER_TEST_SCENARIO === 'daily-file-work')
  await writeFile(path.join(fixture.files, 'Images', 'Wide.png'), sizedImageFixture(2048, 1280));
if (process.env.VIEWER_TEST_SCENARIO === 'refinements') {
  const require = createRequire(import.meta.url);
  await writeFile(
    path.join(fixture.files, 'Cube.step'),
    await readFile(
      path.join(
        path.dirname(require.resolve('occt-import-js/package.json')),
        'test/testfiles/simple-basic-cube/cube.stp',
      ),
    ),
  );
  await writeFile(path.join(fixture.files, 'Broken.step'), 'not a STEP file');
  await writeFile(
    path.join(fixture.files, 'Printed.3mf'),
    zipSync({
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>',
      ),
      '3D/3dmodel.model': strToU8(
        '<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
      ),
    }),
  );
  await writeFile(
    path.join(fixture.files, 'Triangle.ply'),
    'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n',
  );
  if (process.env.VIEWER_TEST_STEP_FILE)
    await writeFile(
      path.join(fixture.files, 'User panel.step'),
      await readFile(process.env.VIEWER_TEST_STEP_FILE),
    );
}
if (process.env.VIEWER_TEST_SCENARIO === 'model-lighting') {
  const require = createRequire(import.meta.url);
  const model =
    process.env.VIEWER_TEST_STEP_FILE ||
    path.join(
      path.dirname(require.resolve('occt-import-js/package.json')),
      'test/testfiles/simple-basic-cube/cube.stp',
    );
  await writeFile(path.join(fixture.files, 'Models', 'Lighting.step'), await readFile(model));
}
if (process.env.VIEWER_TEST_SCENARIO === 'drawings-workspaces') {
  await writeFile(path.join(fixture.files, 'Panel.dxf'), panelDrawing);
  await writeFile(path.join(fixture.files, 'Broken.dxf'), '0\nSECTION\n');
  if (process.env.VIEWER_TEST_DXF_FILE)
    await writeFile(
      path.join(fixture.files, 'User panel.dxf'),
      await readFile(process.env.VIEWER_TEST_DXF_FILE),
    );
  fixture.state.workspaces.push({
    id: 'engineering-fixture',
    name: 'Engineering',
    panes: [],
    roots: [],
    arrangement: {},
  });
}
const longFilename =
  '2000, J. E. Rehder, The mastery and uses of fire in antiquity, McGill-Queen’s University Press, notes and references for the publication naming workflow.txt';
if (process.env.VIEWER_TEST_SCENARIO === 'chrome')
  await writeFile(
    path.join(fixture.files, longFilename),
    'Generated long-filename layout fixture.',
  );
if (process.env.VIEWER_TEST_SCENARIO === 'file-workflows') {
  for (const folder of ['Source', 'Target', 'Peer'])
    await mkdir(path.join(fixture.files, 'Transfers', folder));
  await writeFile(
    path.join(fixture.files, 'Transfers', 'Source', 'Note.txt'),
    'Generated clipboard and drag fixture.',
  );
}
const profile = path.join(fixture.root, 'profile');
await mkdir(profile);
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(fixture.state));
await writeFile(
  path.join(profile, 'settings-v1.json'),
  JSON.stringify({
    version: 1,
    revision: 0,
    settings: {
      ...defaultSettings(fixture.files),
      appearance: fixture.state.look,
      ...(process.env.VIEWER_TEST_SCENARIO === 'foundations'
        ? {
            terminals: {
              ...defaultSettings(fixture.files).terminals,
              profiles: [
                { id: 'login', name: 'Fixture shell', executable: '/bin/sh', args: [], env: {} },
              ],
            },
            customActions: [
              {
                id: 'inspect-path',
                name: 'Inspect path',
                aliases: ['ip'],
                icon: 'code',
                shortcut: '',
                order: 0,
                pinned: true,
                when: { target: 'any', extensions: [], min: 0, max: 10000 },
                executor: {
                  kind: 'executable',
                  executable: '/usr/bin/printf',
                  args: ['%s\\n', '{directory}'],
                  perItem: false,
                },
              },
            ],
          }
        : {}),
    },
    ui: normalizePreferences(fixture.state.ui),
  }),
);
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
    env: {
      ...process.env,
      VIEWER_DATA_DIRECTORY: profile,
      VIEWER_RENDER_TEST: '1',
      VIEWER_BACKGROUND_TEST: foreground ? '0' : '1',
      ...(process.env.VIEWER_TEST_SCENARIO === 'store-file-services'
        ? { VIEWER_TEST_FILE_THREADS: '1' }
        : {}),
    },
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
  throw new Error(
    `Timed out: ${label}. Last observation: ${(typeof last === 'object' && !(last instanceof Error) ? JSON.stringify(last) : String(last)).slice(0, 2000)}`,
  );
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
let settingsMode = false;
let pausedWorker: number | undefined;
let settingsSocket: WebSocket | undefined;
let settingsNext = 0;
const settingsPending = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
async function settingsCommand<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!settingsSocket || settingsSocket.readyState !== WebSocket.OPEN) {
    const target = await until(
      async () =>
        (
          (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
            url: string;
            webSocketDebuggerUrl: string;
          }[]
        ).find((target) => target.url.includes('window=settings')),
      Boolean,
      'native Settings target',
    );
    settingsSocket = new WebSocket(target!.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      settingsSocket!.addEventListener('open', () => resolve(), { once: true });
      settingsSocket!.addEventListener(
        'error',
        () => reject(new Error('Settings debugging connection failed')),
        { once: true },
      );
    });
    settingsSocket.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data));
      const pending = settingsPending.get(reply.id);
      if (pending) {
        settingsPending.delete(reply.id);
        if (reply.error) pending.reject(new Error(reply.error.message));
        else pending.resolve(reply.result);
      }
    });
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++settingsNext;
    const timeout = setTimeout(() => {
      settingsPending.delete(id);
      reject(new Error(`Settings CDP timeout: ${method}`));
    }, 15000);
    settingsPending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    settingsSocket!.send(JSON.stringify({ id, method, params }));
  });
}
async function settingsEvaluate<T>(expression: string): Promise<T> {
  const result = await settingsCommand<{ result: { value: T }; exceptionDetails?: unknown }>(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
  );
  if (result.exceptionDetails)
    throw new Error('Settings evaluation failed: ' + JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
/**
 * Changes a setting the workspace window may not (search content, agents) where a person changes it:
 * in the Settings window. The settings service refuses those from the workspace (`workspaceMayPatch`).
 */
async function patchInSettings(patches: string): Promise<void> {
  await evaluate('window.viewer.openSettings()');
  await until(
    () => settingsEvaluate<boolean>('!!document.querySelector(".settings-window")'),
    Boolean,
    'native Settings for a setting changed there',
  );
  await settingsEvaluate(
    `(async () => { const current = await window.viewer.settingsGet(); await window.viewer.settingsPatch(${patches}, current.revision); })()`,
  );
}
async function openSettingsProbe() {
  settingsMode = true;
  await until(
    () => settingsEvaluate<boolean>('!!document.querySelector(".settings-window")'),
    Boolean,
    'loaded native Settings',
  );
}
const text = () =>
  settingsMode
    ? settingsEvaluate<string>('document.body.innerText')
    : evaluate<string>('document.body.innerText');
const fileSelector = (file: string) => `[data-file-path=${JSON.stringify(file)}]`;
async function activateTestWindow(): Promise<void> {
  if (!foreground) return;
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
async function verifyBackgroundApp(): Promise<void> {
  if (foreground || process.platform !== 'darwin') return;
  const { stdout } = await execNative(
    'osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import('AppKit');const instance=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid});JSON.stringify({active:Boolean(instance.active),policy:Number(instance.activationPolicy)});`,
    ],
    { timeout: 5000 },
  );
  assert.deepEqual(JSON.parse(stdout.trim()), { active: false, policy: 1 });
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
async function click(selector: string, count = 1, modifiers = 0): Promise<void> {
  if (settingsMode && selector === 'dialog [aria-label="Close"]') {
    // Closing destroys this CDP target before it necessarily acknowledges the
    // evaluation. Observe the actual close rather than awaiting that reply.
    void settingsEvaluate('window.close()').catch(() => undefined);
    await until(
      async () =>
        (
          (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { url: string }[]
        ).some((target) => target.url.includes('window=settings')),
      (present) => !present,
      'flushed and closed native Settings',
    );
    settingsSocket?.close();
    settingsSocket = undefined;
    settingsMode = false;
    await activateTestWindow();
    await verifyBackgroundApp();
    return;
  }
  if (selector.startsWith('.context-menu') || selector.startsWith('.context-submenu')) {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`,
    );
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  }
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
      modifiers,
      x: point.x,
      y: point.y,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      clickCount,
      modifiers,
      x: point.x,
      y: point.y,
    });
  }
}
/** A choice menu's button (ui/ChoiceMenu.tsx), by the name it shares with its menu. */
const choiceButton = (label: string) =>
  JSON.stringify(`button[aria-label=${JSON.stringify(label)}]`);
/** Chooses in a choice menu as a person does: its button, then the value's row. */
async function choose(
  label: string,
  value: string,
  run: <T>(expression: string) => Promise<T> = evaluate,
): Promise<void> {
  const row = JSON.stringify(`.choice-menu [data-menu-id=${JSON.stringify('choice:' + value)}]`);
  await run(`document.querySelector(${choiceButton(label)}).click()`);
  await until(() => run<boolean>(`!!document.querySelector(${row})`), Boolean, `${label} menu`);
  await run(`document.querySelector(${row}).click()`);
}
/** The values a choice menu offers, read from it open; it is closed again. */
async function choiceValues(
  label: string,
  run: <T>(expression: string) => Promise<T> = evaluate,
): Promise<string[]> {
  await run(`document.querySelector(${choiceButton(label)}).click()`);
  const values = await until(
    () =>
      run<string[]>(
        `Array.from(document.querySelectorAll('.choice-menu [data-menu-id]'),row=>row.dataset.menuId.slice('choice:'.length))`,
      ),
    (values) => values.length > 0,
    `${label} menu`,
  );
  await run(`document.querySelector(${choiceButton(label)}).click()`);
  return values;
}
async function key(
  key: string,
  code: string,
  modifiers = 0,
  commands: string[] = [],
): Promise<void> {
  const keyCodes: Record<string, number> = {
    Enter: 13,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  };
  const windowsVirtualKeyCode =
    keyCodes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined);
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
    commands,
  });
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
  });
}
async function setting(label: string, wait = true): Promise<void> {
  const revision = await settingsEvaluate<number>(
    'window.viewer.settingsGet().then(value => value.revision)',
  );
  await settingsEvaluate(
    `(() => { const row = Array.from(document.querySelectorAll('.settings-row')).find(row => row.querySelector('span')?.firstChild?.textContent.trim() === ${JSON.stringify(label)}); const input = row?.querySelector('input'); if (!input) throw new Error('Missing setting'); input.click(); })()`,
  );
  if (wait)
    await until(
      () => evaluate<number>('window.viewer.settingsGet().then(value => value.revision)'),
      (value) => value > revision,
      `live setting ${label}`,
    );
}
async function tab(label: string): Promise<void> {
  if (!settingsMode) await evaluate('window.viewer.openSettings()');
  await openSettingsProbe();
  const category =
    ({ Appearance: 'Browsing', Sidebar: 'Navigation' } as Record<string, string>)[label] || label;
  await until(
    () =>
      settingsEvaluate<boolean>(
        `Array.from(document.querySelectorAll('.settings-navigation button')).some(button => button.textContent.trim() === ${JSON.stringify(category)})`,
      ),
    Boolean,
    `Settings category ${category}`,
  );
  await settingsEvaluate(
    `Array.from(document.querySelectorAll('.settings-navigation button')).find(button => button.textContent.trim() === ${JSON.stringify(category)}).click()`,
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
async function verifyDailyFileWork(): Promise<void> {
  const note = path.join(fixture.files, 'README.md');
  const models = path.join(fixture.files, 'Models');
  const content = await readFile(note);
  await evaluate('document.querySelector(".folder-explorer").focus()');
  await key('Shift', 'ShiftLeft', 12);
  await key('Meta', 'MetaLeft', 12);
  assert.equal(
    await evaluate('!!document.querySelector("dialog[open]")'),
    false,
    'Command + Shift alone must not create a folder',
  );
  await key('N', 'KeyN', 12);
  await until(
    () =>
      evaluate<boolean>(
        'document.querySelector("dialog[open]")?.getAttribute("aria-label") === "New folder"',
      ),
    Boolean,
    'actual New Folder binding',
  );
  await key('Escape', 'Escape');

  const trashJobs = () => evaluate<OperationJob[]>('window.viewer.jobs()');
  const trashNote = async (confirm: boolean) => {
    const prior = new Set((await trashJobs()).map((job) => job.id));
    await click(fileSelector(note));
    await key('Backspace', 'Backspace', 4);
    if (confirm) {
      await until(
        () => evaluate<boolean>('!!document.querySelector(".trash-dialog[open]")'),
        Boolean,
        'Trash confirmation',
      );
      assert.deepEqual(
        await evaluate(
          'Array.from(document.querySelectorAll(".trash-dialog kbd")).map(key=>key.textContent)',
        ),
        ['Esc', 'Enter'],
      );
      assert.equal(
        await evaluate('document.activeElement?.getAttribute("aria-label")'),
        'Move to Trash',
      );
      await snapshot('desktop-native-trash-keyboard.png');
      await key('Enter', 'Enter');
    } else assert.equal(await evaluate('!!document.querySelector(".trash-dialog")'), false);
    const job = await until(
      trashJobs,
      (jobs) =>
        jobs.some(
          (job) =>
            !prior.has(job.id) &&
            job.kind === 'trash' &&
            ['completed', 'failed'].includes(job.status),
        ),
      'native Trash result',
    ).then((jobs) => jobs.find((job) => !prior.has(job.id) && job.kind === 'trash')!);
    assert.equal(job.status, 'completed', JSON.stringify(job.errors));
    await assert.rejects(lstat(note), { code: 'ENOENT' });
    await evaluate(`window.viewer.undo(${JSON.stringify(job.id)})`);
    await until(
      async () => {
        try {
          return (await readFile(note)).equals(content);
        } catch {
          return false;
        }
      },
      Boolean,
      'Trash Undo contents',
    );
    await until(
      () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(note))})`),
      Boolean,
      'restored file row',
    );
  };
  await click(fileSelector(note));
  await key('Backspace', 'Backspace', 4);
  await until(
    () => evaluate<boolean>('!!document.querySelector(".trash-dialog[open]")'),
    Boolean,
    'cancelable Trash dialog',
  );
  await key('Escape', 'Escape');
  assert.ok((await readFile(note)).equals(content), 'Escape preserves the file');
  await trashNote(true);
  await tab('Browsing');
  await setting('Confirm before moving to Trash');
  await click('dialog [aria-label="Close"]');
  await trashNote(false);
  await tab('Browsing');
  await setting('Confirm before moving to Trash');
  await click('dialog [aria-label="Close"]');

  await click(fileSelector(models));
  await evaluate(
    'window.__qaSizes = []; window.__qaSizeOff = window.viewer.onEvent(event => { if(event.type === "folder-size") window.__qaSizes.push(event.task); });',
  );
  await paletteCommand('Calculate Size');
  const measured = await until(
    () => evaluate<import('../src/domain/metadata').FolderSizeTask[]>('window.__qaSizes'),
    (tasks) => tasks.some((task) => task.status === 'completed'),
    'folder size',
  ).then((tasks) => tasks.find((task) => task.status === 'completed')!);
  await until(
    () =>
      evaluate<string>(
        `document.querySelector(${JSON.stringify(fileSelector(models))})?.querySelector('[data-column="size"]')?.textContent || ''`,
      ),
    (value) => value === formatBytes(measured.bytes),
    'folder size in Size column',
  );
  await click(fileSelector(note), 1, 4);
  const noteEntry = await evaluate<{ size: number }>(`window.viewer.stat(${JSON.stringify(note)})`);
  await until(
    () => evaluate<string>('document.querySelector(".folder-status .selection-size").textContent'),
    (value) => value === formatBytes(measured.bytes + noteEntry.size),
    'mixed-selection measured total',
  );
  await snapshot('desktop-native-measured-selection.png');
  await evaluate('window.__qaSizeOff();');

  await paletteCommand('Columns view');
  await click(fileSelector(note));
  await until(
    () => evaluate<string>('document.querySelector(".column-preview")?.dataset.previewPath || ""'),
    (value) => value === note,
    'root-column inline preview',
  );
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".column-preview .preview-host")?.dataset.previewModule || ""',
      ),
    (value) => value === 'text',
    'inline Markdown renderer',
  );
  await snapshot('desktop-native-column-preview.png');
  await click(fileSelector(models));
  assert.equal(
    await evaluate('!!document.querySelector(".column-preview")'),
    false,
    'Selecting a folder removes the old preview',
  );
  const children = await evaluate<{ entries: { path: string; directory: boolean }[] }>(
    `window.viewer.list(${JSON.stringify(models)})`,
  );
  const child = children.entries.find((file) => !file.directory && file.path.endsWith('.obj'))!;
  await until(
    () =>
      evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(child.path))})`),
    Boolean,
    'child column',
  );
  await click(fileSelector(child.path));
  await until(
    () => evaluate<string>('document.querySelector(".column-preview")?.dataset.previewPath || ""'),
    (value) => value === child.path,
    'nested-column inline preview',
  );
  await until(
    () => evaluate<boolean>('!!document.querySelector(".column-preview canvas")'),
    Boolean,
    'nested 3D model preview',
  );
  await snapshot('desktop-native-column-model.png');

  await evaluate(
    'window.__qaEngine.camera.dock(window.__qaEngine.tree.get()[0].planeID, {animate:false})',
  );
  await settleCamera();
  const docked = await evaluate<string>('window.__qaEngine.camera.docked()');
  await click(
    `.location-sidebar button[title=${JSON.stringify(path.join(fixture.files, 'Documents'))}]`,
  );
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".folder-explorer")?.getAttribute("aria-label") || ""',
      ),
    (value) => value === 'Folder ' + path.join(fixture.files, 'Documents'),
    'sidebar folder navigation',
  );
  await settleCamera();
  assert.equal(
    await evaluate('window.__qaEngine.camera.docked()'),
    docked,
    'Sidebar navigation must retain docking',
  );
  await key('ArrowUp', 'ArrowUp', 4);
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(note))})`),
    Boolean,
    'return to fixture parent',
  );
  await settleCamera();
  assert.equal(await evaluate('window.__qaEngine.camera.docked()'), docked);

  await command('Emulation.setDeviceMetricsOverride', {
    width: 2560,
    height: 1440,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const wideImage = path.join(fixture.files, 'Images', 'Wide.png');
  await click(fileSelector(path.join(fixture.files, 'Images')));
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(wideImage))})`),
    Boolean,
    'generated large image column',
  );
  await click(fileSelector(wideImage));
  await key(' ', 'Space');
  await until(
    () =>
      evaluate<boolean>(
        'document.querySelector(".quick-preview-dialog .image-stage img")?.naturalWidth === 2048',
      ),
    Boolean,
    'large image decode',
  );
  const imageFit = await evaluate<{
    imageWidth: number;
    imageHeight: number;
    stageWidth: number;
    stageHeight: number;
  }>(
    `(()=>{const i=document.querySelector('.quick-preview-dialog .image-stage img').getBoundingClientRect(),s=document.querySelector('.quick-preview-dialog .image-stage').getBoundingClientRect();return {imageWidth:i.width,imageHeight:i.height,stageWidth:s.width,stageHeight:s.height};})()`,
  );
  assert.ok(
    imageFit.imageWidth / imageFit.stageWidth >= 0.8 ||
      imageFit.imageHeight / imageFit.stageHeight >= 0.8,
    'Large image uses its preview area: ' + JSON.stringify(imageFit),
  );
  await snapshot('desktop-native-large-image-preview.png');
  await key('Escape', 'Escape');
  await click(fileSelector(note));
  await key(' ', 'Space');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".quick-preview-dialog[open]")'),
    Boolean,
    'large-display Quick Preview',
  );
  const bounds = await evaluate<{
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  }>(
    `(()=>{const r=document.querySelector('.quick-preview-dialog').getBoundingClientRect();return {width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})()`,
  );
  assert.ok(
    bounds.width / bounds.viewportWidth >= 0.85 && bounds.height / bounds.viewportHeight >= 0.83,
    JSON.stringify(bounds),
  );
  await snapshot('desktop-native-large-quick-preview.png');
  await key('Escape', 'Escape');
  await key('n', 'KeyN', 4);
  await until(
    () => evaluate<number>('window.__qaEngine.tree.get().length'),
    (count) => count === 2,
    'large-display new plane',
  );
  await settleCamera();
  const newPlane = await evaluate<{
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  }>(
    `(()=>{const id=window.__qaEngine.tree.get()[1].planeID;const r=document.querySelector('[data-plurid-plane='+JSON.stringify(id)+']').getBoundingClientRect();return {width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})()`,
  );
  assert.ok(
    newPlane.width / newPlane.viewportWidth >= 0.75 &&
      newPlane.height / newPlane.viewportHeight >= 0.75,
    'New plane must use the large display: ' + JSON.stringify(newPlane),
  );
  await snapshot('desktop-native-large-plane.png');
  await paletteCommand('Close plane');
  await until(
    () => evaluate<number>('window.__qaEngine.tree.get().length'),
    (count) => count === 1,
    'closed generated root',
  );
  await evaluate(
    'window.__qaEngine.camera.dock(window.__qaEngine.tree.get()[0].planeID, {animate:false})',
  );
  await settleCamera();
  await click(fileSelector(note));
  await command('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await key(' ', 'Space');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".quick-preview-dialog[open]")'),
    Boolean,
    'small-display Quick Preview',
  );
  assert.equal(
    await evaluate(
      '(()=>{const r=document.querySelector(".quick-preview-dialog").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()',
    ),
    true,
  );
  await snapshot('desktop-native-small-quick-preview.png');
  await key('Escape', 'Escape');
  await command('Emulation.clearDeviceMetricsOverride');
  console.log(
    'Daily file work: exact shortcut keys, Trash preference/Enter/Escape/Undo, shared folder sizes, inline column previews, retained docking and responsive Quick Preview.',
  );
}

async function verifySelectionReliability(): Promise<void> {
  const rows = await evaluate<string[]>(
    'Array.from(document.querySelectorAll(".folder-explorer [data-file-path]")).map(row=>row.dataset.filePath)',
  );
  assert.ok(rows.length > 4);
  await click(fileSelector(rows[3]));
  await settleCamera();
  const camera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
  await key('ArrowUp', 'ArrowUp', 8);
  await key('ArrowUp', 'ArrowUp', 8);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll(".folder-explorer [data-file-path][aria-selected=true]")).map(row=>row.dataset.filePath)',
    ),
    rows.slice(1, 4),
    'Repeated Shift+Up must extend from the moving cursor, not the end of the selected range',
  );
  assert.equal(
    await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
    camera,
    'File selection must not rotate the spatial camera',
  );
  await key('ArrowDown', 'ArrowDown', 8);
  assert.equal(
    await evaluate('document.querySelectorAll(".folder-explorer [aria-selected=true]").length'),
    2,
    'Reversing direction shrinks the range',
  );
  const blank = await evaluate<{ x: number; y: number }>(
    `(() => { const r=document.querySelector('.folder-explorer .file-scroll').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.bottom-12}; })()`,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...blank,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    ...blank,
  });
  assert.equal(
    await evaluate('document.querySelectorAll(".folder-explorer [aria-selected=true]").length'),
    0,
    'Clicking empty file space clears the selection',
  );
  await click(fileSelector(path.join(fixture.files, 'Models')));
  assert.equal(
    await evaluate('document.querySelector(".folder-status").textContent.includes("0 B")'),
    false,
    'Unmeasured folders must never be reported as zero bytes',
  );
  await evaluate(
    `window.__qaSizes = []; window.__qaSizeOff = window.viewer.onEvent(event => { if(event.type === 'folder-size') window.__qaSizes.push(event.task); });`,
  );
  await paletteCommand('Calculate Size');
  const measured = await until(
    () => evaluate<import('../src/domain/metadata').FolderSizeTask[]>('window.__qaSizes'),
    (tasks) => tasks.some((task) => task.status === 'completed'),
    'background folder measurement',
  ).then((tasks) => tasks.find((task) => task.status === 'completed')!);
  assert.ok(measured.bytes > 0 && measured.files > 0 && measured.folders === 1);
  await until(
    () => evaluate<string>('document.querySelector(".selection-size").textContent'),
    (value) => value.includes(formatBytes(measured.bytes)),
    'measured folder footer',
  );
  await paletteCommand('Get info…');
  assert.ok(
    (await text()).includes(formatBytes(measured.bytes)),
    'File information reuses the measured folder total',
  );
  await snapshot('desktop-native-folder-size.png');
  await click('dialog [aria-label="Close"]');
  await evaluate('window.__qaSizeOff(); delete window.__qaSizeOff; delete window.__qaSizes;');
  await contextMenu(fileSelector(path.join(fixture.files, 'README.md')));
  await command('Input.insertText', { text: 'ow' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".open-with-dialog")'),
    Boolean,
    'contextual Open With',
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".application-option").length'),
    (value) => value > 0,
    'native compatible applications',
  );
  assert.equal(
    await evaluate('document.activeElement.getAttribute("aria-label")'),
    'Search applications',
  );
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
  await command('Input.insertText', { text: 'no such application xyz' });
  await until(
    () => evaluate<number>('document.querySelectorAll(".application-option").length'),
    (value) => value === 0,
    'filtered application list',
  );
  assert.equal(
    await evaluate('document.querySelector(".open-with-dialog [type=submit]").disabled'),
    true,
  );
  await snapshot('desktop-native-open-with-empty.png');
  await key('a', 'KeyA', 4, ['selectAll']);
  await key('Backspace', 'Backspace');
  await until(
    () => evaluate<number>('document.querySelectorAll(".application-option").length'),
    (value) => value > 0,
    'restored compatible applications',
  );
  await snapshot('desktop-native-open-with.png');
  await key('Escape', 'Escape');
  await click(fileSelector(path.join(fixture.files, 'Models')));
  // A blank-space menu owns no files, even while a file remains highlighted.
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'right',
    buttons: 2,
    clickCount: 1,
    ...blank,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'right',
    buttons: 0,
    clickCount: 1,
    ...blank,
  });
  await until(
    () => evaluate<boolean>('!!document.querySelector(".context-menu")'),
    Boolean,
    'background contextual actions',
  );
  assert.equal(
    await evaluate(
      'Array.from(document.querySelectorAll(".context-menu .command-result")).some(row => row.textContent.includes("Rename"))',
    ),
    false,
  );
  await key('Escape', 'Escape');
  await key('Escape', 'Escape');
  console.log(
    'Reliability: range reversal, camera ownership, deselection, target-free background menus, measured folder sizes and native compatible-app search.',
  );
}

async function verifyFoundations(): Promise<void> {
  const folderID = fixture.state.workspaces[0].panes[0].id;
  const rootNode = () =>
    `window.__qaEngine.tree.get().find(node=>node.routeDivisions.plane.parameters.id===${JSON.stringify(folderID)})`;
  await key('3', 'Digit3', 4);
  await until(
    () => evaluate<number>('document.querySelectorAll(".file-column").length'),
    (count) => count > 0,
    'Finder columns shortcut',
  );
  const edge = '.browser-column-resizer';
  await click(edge);
  await key('ArrowRight', 'ArrowRight', 8);
  await until(
    () =>
      evaluate<number>(
        `window.viewer.settingsGet().then(value=>value.settings.folders[${JSON.stringify(fixture.files)}]?.columnWidth)`,
      ),
    (width) => width === 330,
    'keyboard browser column resize persisted',
  );
  await click(fileSelector(path.join(fixture.files, 'Transfers')));
  await key('ArrowRight', 'ArrowRight');
  await until(
    () => evaluate<number>('document.querySelectorAll(".file-column").length'),
    (count) => count === 2,
    'Finder Right enters the selected folder',
  );
  await key('ArrowLeft', 'ArrowLeft');
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll(".file-column [aria-selected=true]")).map(el=>el.dataset.filePath)',
    ),
    [path.join(fixture.files, 'Transfers')],
    'Finder Left returns selection to the parent folder',
  );
  await key('1', 'Digit1', 4);
  await click(fileSelector(path.join(fixture.files, 'Transfers')));
  await key('ArrowDown', 'ArrowDown', 4);
  await until(
    () => evaluate<string>('document.querySelector(".plane-title")?.textContent || ""'),
    (name) => name.includes('Transfers'),
    'Cmd Down enters a list folder',
  );
  await key('3', 'Digit3', 4);
  await key('ArrowUp', 'ArrowUp', 4);
  await until(
    () => evaluate<number>('document.querySelectorAll(".file-head").length'),
    (count) => count > 0,
    'parent restores its own List view',
  );
  await evaluate('document.querySelector(".file-scroll").click()');
  await paletteCommand('Open terminal plane');
  await until(
    () =>
      evaluate<string[]>(
        'Array.from(document.querySelectorAll(".terminal-plane")).map(el=>el.dataset.terminalId)',
      ),
    (ids) => ids.length === 1,
    'embedded terminal lazy mount',
  );
  const terminalID = await evaluate<string>(
    'document.querySelector(".terminal-plane").dataset.terminalId',
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".terminal-plane .xterm-screen").length'),
    (count) => count === 1,
    'packaged xterm ready',
  );
  await evaluate(
    `window.viewer.terminalWrite(${JSON.stringify(terminalID)},${JSON.stringify("printf 'PTY_%s\\n' READY; stty size\r")})`,
  );
  await until(
    () =>
      evaluate<string>('document.querySelector(".terminal-plane .xterm-rows")?.textContent || ""'),
    (text) => text.includes('PTY_READY'),
    'real PTY output',
  );
  await evaluate(
    `window.viewer.terminalWrite(${JSON.stringify(terminalID)},${JSON.stringify('sleep 30\r')})`,
  );
  await delay(100);
  await evaluate(
    `window.viewer.terminalWrite(${JSON.stringify(terminalID)},${JSON.stringify("\u0003printf 'INTERRUPT%s\\n' ED\r")})`,
  );
  await until(
    () =>
      evaluate<string>('document.querySelector(".terminal-plane .xterm-rows")?.textContent || ""'),
    (text) => text.includes('INTERRUPTED'),
    'Ctrl C interrupts the foreground PTY command',
  );
  const child = await evaluate<{ parent: string; child: string; angle: number }>(
    `(() => { const parent=${rootNode()};const child=parent.children.find(node=>node.routeDivisions.plane.parameters.id===${JSON.stringify(terminalID)});return {parent:parent.planeID,child:child.planeID,angle:Math.abs(child.location.rotateY-parent.location.rotateY)}; })()`,
  );
  assert.ok(child.child, 'Terminal belongs to the originating root');
  assert.ok(Math.abs(child.angle - 90.1) < 0.001, 'Terminal opens at 90.1 degrees to its parent');
  await snapshot('desktop-native-terminal.png');
  await paletteCommand('New folder plane');
  await until(
    () => evaluate<number>('window.__qaEngine.tree.get().length'),
    (count) => count === 2,
    'new root from terminal context',
  );
  await paletteCommand('Open terminal plane');
  await until(
    () => evaluate<number>('window.__qaEngine.tree.get().flatMap(node=>node.children||[]).length'),
    (count) => count === 2,
    'each root owns its terminal',
  );
  const terminals = await evaluate<string[]>(
    'window.__qaEngine.tree.get().flatMap(root=>(root.children||[]).filter(node=>node.route.includes("terminals")).map(node=>node.routeDivisions.plane.parameters.id))',
  );
  assert.equal(new Set(terminals).size, 2);
  await settleCamera();
  await evaluate(
    'window.__qaEngine.focus();window.__qaEngine.selection.clear();window.__qaEngine.camera.moveBy({pan:{x:100000,y:0}},{animate:false})',
  );
  await until(
    () =>
      evaluate<boolean>(
        `!document.querySelector('.terminal-plane[data-terminal-id="${terminalID}"]')`,
      ),
    Boolean,
    'inactive terminal React view detaches outside the camera',
  );
  // Exceed the flow-control high-water mark while no terminal React view is mounted.
  await evaluate(
    `window.viewer.terminalWrite(${JSON.stringify(terminalID)},${JSON.stringify("yes CULL_OUTPUT_abcdefghijklmnopqrstuvwxyz | head -c 1200000; printf '\\nSURVIVED_%s\\n' CULL\r")})`,
  );
  await delay(300);
  await paletteCommand('Frame all planes');
  await settleCamera();
  await until(
    () => evaluate<string>('document.body.textContent'),
    (text) => text.includes('SURVIVED_CULL'),
    'terminal screen and PTY survive culling',
  );
  for (const category of ['Terminals', 'Configuration', 'Agents']) {
    await tab(category);
    await snapshot('desktop-native-' + category.toLowerCase() + '.png');
  }
  await tab('Actions');
  await settingsEvaluate(
    '(() => { const summary=Array.from(document.querySelectorAll("details summary")).find(el=>el.textContent.includes("Inspect path"));summary.click();summary.scrollIntoView({block:"start"}); })()',
  );
  await snapshot('desktop-native-custom-action.png');
  await click('dialog [aria-label="Close"]');
  const configPath = path.join(profile, 'config.jsonc');
  const config = parse(await readFile(configPath, 'utf8'));
  config.settings.folders[fixture.files].mode = 'grid';
  await writeFile(
    configPath,
    '// Native external editor fixture.\n' + JSON.stringify(config, null, 2),
  );
  await until(
    () => evaluate<number>('document.querySelectorAll(".grid-scroll").length'),
    (count) => count > 0,
    'external configuration edit reaches all matching roots',
  );
  await patchInSettings(
    `[{path:'settings.agents.enabled',value:true},{path:'settings.agents.roots',value:[${JSON.stringify(fixture.root)}]}]`,
  );
  const agentCall = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const connection = JSON.parse(
      await readFile(path.join(profile, 'agent-connection-v1.json'), 'utf8'),
    );
    const token = JSON.parse(await readFile(path.join(profile, 'agent-token-v1.json'), 'utf8'));
    return new Promise<T>((resolve, reject) => {
      const stream = net.createConnection(connection.socket);
      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error('Fixture MCP request timed out.'));
      }, 10000);
      let data = '';
      stream.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      stream.on('connect', () =>
        stream.write(
          JSON.stringify({
            id: 1,
            token,
            request: { method: 'tools/call', params: { name, arguments: args } },
          }) + '\n',
        ),
      );
      stream.on('data', (chunk) => {
        data += chunk.toString();
        if (!data.includes('\n')) return;
        clearTimeout(timer);
        stream.end();
        const reply = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (reply.error) reject(new Error(reply.error));
        else resolve(JSON.parse(reply.value.content[0].text));
      });
    });
  };
  await click(`[data-file-owner=${JSON.stringify(folderID)}] .file-scroll`);
  // Agents see only allow-listed commands; executables and terminals are never offered.
  const catalog = await until(
    () => agentCall<{ commands: { id: string }[] }>('list_commands'),
    (value) => value.commands.some((command) => command.id === 'refresh'),
    'agent command catalog uses the focused file context',
  );
  for (const id of ['open-terminal-plane', 'custom.inspect-path'])
    assert.ok(
      !catalog.commands.some((command) => command.id === id),
      `${id} is not offered to agents`,
    );
  await assert.rejects(
    () => agentCall('propose_command', { commandID: 'custom.inspect-path' }),
    /Agents cannot run shell scripts, executables or terminal profiles/,
  );
  await assert.rejects(
    () => agentCall('propose_command', { commandID: 'open-terminal-plane' }),
    /terminal execution is unavailable/,
  );
  const proposal = await agentCall<{ id: string; requiresUserReview: boolean }>('propose_command', {
    commandID: 'refresh',
  });
  assert.equal(proposal.requiresUserReview, true);
  await until(
    () =>
      evaluate<boolean>(
        'Array.from(document.querySelectorAll("dialog[open] button")).some(button=>button.textContent==="Reject")',
      ),
    Boolean,
    'agent action review appears before execution',
  );
  await snapshot('desktop-native-agent-review.png');
  // Approving would open the desktop's own confirmation, which hidden checks cannot answer.
  await evaluate(
    'Array.from(document.querySelectorAll("dialog[open] button")).find(button=>button.textContent==="Reject").click()',
  );
  await until(
    () => agentCall<{ status: string }>('get_proposal', { id: proposal.id }),
    (result) => result.status === 'rejected',
    'a rejected agent action never runs',
  );
  await assert.rejects(
    () => agentCall('propose_config', { patches: [{ path: 'executionApprovals', value: [] }] }),
    /Agents cannot change/,
  );
  await evaluate(
    'window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:"settings.folders",value:{}}],s.revision))',
  );
  await reloadPage();
  await until(
    () => evaluate<boolean>('!!document.querySelector("[data-viewer-plane]")'),
    Boolean,
    'reloaded workspace',
  );
  assert.deepEqual(
    await evaluate('window.viewer.settingsGet().then(value=>value.settings.folders)'),
    {},
    'cleared folder overrides stay cleared after reopening',
  );
  await verifyBackgroundApp();
  assert.deepEqual(exceptions, []);
  console.log(
    'Native foundations verified: folder preferences, Finder keys, columns resize, real PTYs, independent roots, Ctrl C, culling, and JSONC live reload.',
  );
}

async function verifyConfiguredChrome(): Promise<void> {
  const unchanged = await inventory();
  const view = '.plane-controls [aria-label="View mode"]';
  for (let index = 0; index < 2; index++) {
    await click(view);
    assert.equal(await evaluate('document.querySelectorAll(".context-menu").length'), 1);
    assert.equal(
      await evaluate(
        `document.querySelector(${JSON.stringify(view)}).getAttribute('aria-expanded')`,
      ),
      'true',
    );
    await click(view);
    assert.equal(await evaluate('document.querySelectorAll(".context-menu").length'), 0);
    assert.equal(
      await evaluate(
        `document.querySelector(${JSON.stringify(view)}).getAttribute('aria-expanded')`,
      ),
      'false',
    );
  }
  await click(view);
  await key('Escape', 'Escape');
  await click(view);
  await evaluate('document.body.click()');
  await key('Escape', 'Escape');
  await tab('Space');
  const controls = [
    'Navigation button',
    'Back button',
    'Forward button',
    'View menu',
    'Folder search',
    'Frame plane button',
    'Dock plane button',
    'Actions menu',
    'Close plane button',
  ];
  for (const control of controls) await setting(control);
  await until(
    () => evaluate<number>('document.querySelectorAll(".plane-controls button").length'),
    (count) => count === 0,
    'all toolbar controls can be hidden independently',
  );
  await settingsEvaluate(
    `Array.from(document.querySelectorAll('.settings-page h2')).find(heading => heading.textContent === 'Plane toolbar').scrollIntoView({block:'start'})`,
  );
  await snapshot('desktop-native-toolbar-settings.png');
  for (const control of controls) await setting(control);
  await tab('Browsing');
  for (const column of ['Date modified', 'Kind', 'Size']) await setting(column);
  await until(
    () => evaluate<number>('document.querySelectorAll(".file-head [data-column]").length'),
    (count) => count === 1,
    'metadata columns can all be hidden while Name remains visible',
  );
  for (const column of ['Date modified', 'Kind', 'Size', 'Date created', 'Extension'])
    await setting(column);
  await until(
    () => evaluate<number>('document.querySelectorAll(".file-head [data-column]").length'),
    (count) => count === 6,
    'optional created and extension columns appear',
  );
  for (const column of ['Date created', 'Extension']) await setting(column);
  await click('dialog [aria-label="Close"]');
  await evaluate(`(() => {
    const table=document.querySelector('.file-table');
    const key=Object.getOwnPropertyNames(table).find(key=>key.startsWith('__reactFiber$'));
    const owner=key && table[key]?.return;
    if(typeof owner?.type !== 'function') throw new Error('Production file-table owner unavailable');
    window.__qaFileTableType=owner.type;
    window.__qaFileTableCommits=0;
  })()`);
  const widths = () =>
    evaluate<number[]>(
      `Array.from(document.querySelectorAll('.file-head [data-column]')).map(cell=>cell.offsetWidth)`,
    );
  const before = await widths();
  const edge = await evaluate<{ x: number; y: number }>(
    `(() => { const r=document.querySelector('[aria-label="Resize Name column"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    button: 'none',
    buttons: 0,
    ...edge,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...edge,
  });
  // The first expansion can introduce a horizontal scrollbar and change the
  // virtual list's viewport height. Settle that required layout work before
  // measuring whether subsequent pointer moves trigger React renders.
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    button: 'left',
    buttons: 1,
    x: edge.x + 25,
    y: edge.y,
  });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await until(
    async () => {
      const before = await evaluate<number>('window.__qaFileTableCommits');
      await delay(100);
      return (await evaluate<number>('window.__qaFileTableCommits')) === before;
    },
    Boolean,
    'renderer settled before measuring column resize',
  );
  const resizeViewportHeight = await evaluate<number>(
    'document.querySelector(".file-scroll").clientHeight',
  );
  const commits = await evaluate<number>('window.__qaFileTableCommits');
  for (let index = 2; index <= 5; index++) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: edge.x + index * 25,
      y: edge.y,
    });
    // Separate rendered frames prevent batching from concealing a per-move
    // state update. These moves retain the same vertical viewport.
    await evaluate('new Promise(requestAnimationFrame)');
  }
  assert.equal(
    await evaluate('document.querySelector(".file-scroll").clientHeight'),
    resizeViewportHeight,
    'The measured resize moves retain the virtual list viewport height',
  );
  assert.equal(
    await evaluate('window.__qaFileTableCommits'),
    commits,
    'Resizing should not rerender the file list on every pointer movement',
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    x: edge.x + 125,
    y: edge.y,
  });
  const after = await widths();
  assert.ok(after[0] > before[0] + 50, `Name column grew from ${before[0]} to ${after[0]}`);
  assert.deepEqual(after.slice(1), before.slice(1));
  await until(
    () =>
      evaluate<number>(
        `window.viewer.settingsGet().then(value=>value.settings.folders[${JSON.stringify(fixture.files)}]?.list?.widths?.name ?? 0)`,
      ),
    (value) => value === after[0],
    'resized width persisted to settings',
  );
  await until(
    () => evaluate<number>('window.__qaFileTableCommits'),
    (value) => value > commits,
    'the scoped React probe observes the actual width commit on release',
  );
  await evaluate('window.__qaFileTableType=undefined');
  await click('[aria-label="Resize Name column"]', 2);
  await until(
    () =>
      evaluate<number>(
        `window.viewer.settingsGet().then(value=>value.settings.folders[${JSON.stringify(fixture.files)}]?.list?.widths?.name ?? 0)`,
      ),
    (value) => value === 0,
    'double-click restores flexible Name width',
  );
  await tab('Browsing');
  await setting('Wrap long filenames');
  await click('dialog [aria-label="Close"]');
  await evaluate(
    `document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, longFilename)))}).scrollIntoView({block:'nearest'})`,
  );
  const fullName = await evaluate<{ title: string; wraps: boolean }>(
    `(() => { const text=document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, longFilename)))}).querySelector('.filename');return {title:text.title,wraps:text.offsetHeight>parseFloat(getComputedStyle(text).lineHeight)*1.5}; })()`,
  );
  assert.equal(fullName.title, longFilename);
  assert.equal(fullName.wraps, true);
  await snapshot('desktop-native-list-wrap.png');
  await tab('Browsing');
  await setting('Wrap long filenames');
  await click('dialog [aria-label="Close"]');
  await until(
    () =>
      evaluate<number>(
        `document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, longFilename)))}).parentElement.offsetHeight`,
      ),
    (height) => height === 36,
    'disabling wrapping restores the normal virtual row height',
    3000,
  );
  await click(fileSelector(path.join(fixture.files, 'README.md')));
  await key('Enter', 'Enter');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Rename actions"]')`),
    Boolean,
    'rename action picker',
  );
  assert.deepEqual(await choiceValues('Rename actions'), ['recipe.rename', 'recipe.batch-rename']);
  await snapshot('desktop-native-rename-actions.png');
  await click('dialog [aria-label="Close"]');
  await click(fileSelector(path.join(fixture.files, 'Documents')), 2);
  const book = path.join(fixture.files, 'Documents', 'Book.epub');
  await until(text, (value) => value.includes('Book.epub'), 'book listing for rename');
  await click(fileSelector(book));
  await key('Enter', 'Enter');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Rename actions"]')`),
    Boolean,
    'book rename action picker',
  );
  // Exercise selection changing independently after the modal captured its target.
  await evaluate(
    `document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, 'Documents', 'Project notes.md')))}).click()`,
  );
  await choose('Rename actions', 'recipe.book-name');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".action-config")'),
    Boolean,
    'rename modal transfers to action setup',
  );
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 1);
  await click('.action-config .primary');
  const plans = await until(
    () => evaluate<import('../src/domain/services').ActionPlan[]>('window.viewer.actionList()'),
    (plans) => plans.some((plan) => plan.recipeID === 'book-name' && plan.status === 'review'),
    'rename action produces a review proposal',
  );
  const plan = plans.find((plan) => plan.recipeID === 'book-name' && plan.status === 'review')!;
  assert.deepEqual(plan.context.sources, [book]);
  assert.equal(
    path.basename(plan.rows[0].destination),
    '2000, J. E. Rehder, Fire in antiquity, Fixture Press.epub',
  );
  assert.deepEqual(
    await inventory(),
    unchanged,
    'Choosing a rename action must not apply any file change',
  );
  await click('dialog [aria-label="Close"]');
  console.log(
    'Configured chrome: toolbar toggles, view-menu toggle, column visibility/resize/wrapping, captured-target rename action review.',
  );
}

async function verifyColumnWorkflows(): Promise<void> {
  await paletteCommand('Columns view');
  await click(fileSelector(path.join(fixture.files, 'Data')));
  await key('ArrowDown', 'ArrowDown');
  const selected = await evaluate<string>(
    'document.querySelector(".file-row.is-selected")?.getAttribute("data-file-path") || ""',
  );
  assert.equal(path.basename(selected), 'Documents');
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".file-column:nth-child(2) .column-title")?.textContent || ""',
      ),
    (title) => title === 'Documents',
    'arrow selection reveals the selected folder column',
    3000,
  );
  await key('ArrowRight', 'ArrowRight');
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".file-row.is-selected")?.getAttribute("data-file-path") || ""',
      ),
    (value) => path.dirname(value) === path.join(fixture.files, 'Documents'),
    'Right selects inside the folder',
  );
  await evaluate(
    'window.__qaEngine.focus();window.__qaEngine.selection.clear();window.__qaEngine.camera.moveBy({pan:{x:100000,y:0}},{animate:false})',
  );
  await until(
    () => evaluate<boolean>('!document.querySelector(".folder-explorer")'),
    Boolean,
    'offscreen column explorer detaches',
    5000,
  );
  await evaluate(
    'window.__qaEngine.camera.frame({planeID:window.__qaEngine.tree.get()[0].planeID},{animate:false})',
  );
  await settleCamera();
  await until(text, (value) => value.includes('Project brief.pdf'), 'column branch reattaches');
  await evaluate('document.querySelector(".folder-explorer").focus()');
  await key('ArrowDown', 'ArrowDown');
  assert.equal(
    path.dirname(
      await evaluate<string>(
        'document.querySelector(".file-row.is-selected").getAttribute("data-file-path")',
      ),
    ),
    path.join(fixture.files, 'Documents'),
    'the child column keeps keyboard ownership after Plurid detachment',
  );
  await key('ArrowLeft', 'ArrowLeft');
  assert.equal(
    await evaluate(
      'document.querySelector(".file-row.is-selected").getAttribute("data-file-path")',
    ),
    path.join(fixture.files, 'Documents'),
  );
  await click(fileSelector(path.join(fixture.files, 'Transfers')), 2);
  await until(
    text,
    (value) => value.includes('Source') && value.includes('Target'),
    'transfer fixtures',
  );
  // Presentation belongs to the folder, so this new fixture starts with the
  // default List view rather than inheriting its parent's Columns override.
  await paletteCommand('Columns view');
  const source = path.join(fixture.files, 'Transfers', 'Source');
  const target = path.join(fixture.files, 'Transfers', 'Target');
  const peer = path.join(fixture.files, 'Transfers', 'Peer');
  await click(fileSelector(source));
  await until(
    () =>
      evaluate<boolean>(`!!document.querySelector('.file-column[data-folder-path="${source}"]')`),
    Boolean,
    'Source is shown as a browsing column before copying',
  );
  await key('c', 'KeyC', 4);
  await until(
    () => evaluate<{ paths: string[] } | null>('window.viewer.clipboardRead()'),
    (value) => value?.paths[0] === source,
    'Command-C captures the selected folder',
  );
  await click(fileSelector(target));
  await until(
    () =>
      evaluate<boolean>(`!!document.querySelector('.file-column[data-folder-path="${target}"]')`),
    Boolean,
    'Target is shown as the paste destination column',
  );
  await key('v', 'KeyV', 4);
  await until(
    async () => {
      try {
        return await readFile(path.join(target, 'Source', 'Note.txt'), 'utf8');
      } catch {
        return '';
      }
    },
    (value) => value === 'Generated clipboard and drag fixture.',
    'Command-V copies the folder into the shown target column',
  );
  await click(fileSelector(source));
  await until(text, (value) => value.includes('Note.txt'), 'source column contents');
  // Use the production dragstart payload, then deliver trusted Chromium drop events.
  const payload = await evaluate<string>(`(() => {
    const row=document.querySelector(${JSON.stringify(fileSelector(source))});
    const data=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
    return data.getData('application/x-viewer-files');
  })()`);
  assert.deepEqual(JSON.parse(payload), [source]);
  const point = await evaluate<{ x: number; y: number }>(
    `(() => { const r=document.querySelector(${JSON.stringify(fileSelector(peer))}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
  );
  const data = {
    items: [{ mimeType: 'application/x-viewer-files', data: payload }],
    dragOperationsMask: 17,
  };
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await command('Input.dispatchDragEvent', { type, ...point, data });
  await until(
    async () => {
      try {
        return await readFile(path.join(peer, 'Source', 'Note.txt'), 'utf8');
      } catch {
        return '';
      }
    },
    (value) => value === 'Generated clipboard and drag fixture.',
    'folder drop moves into the folder under the pointer',
  );
  await until(
    () =>
      evaluate<string[]>(
        'Array.from(document.querySelectorAll(".file-column")).map(column=>column.dataset.folderPath)',
      ),
    (paths) => !paths.includes(source),
    'removal closes the obsolete column branch',
  );
  assert.equal(await evaluate('document.querySelectorAll(".file-row.is-selected").length'), 0);
  assert.equal((await text()).includes('Folder unavailable'), false);
  assert.equal(
    await readFile(path.join(target, 'Source', 'Note.txt'), 'utf8'),
    'Generated clipboard and drag fixture.',
  );
  await snapshot('desktop-native-column-workflows.png');
  console.log(
    'Column workflows: arrow reveal/traversal, folder copy/paste, folder drop, removed branch cleanup.',
  );
}

async function verifyListAlignment(): Promise<void> {
  const measure = () =>
    evaluate<{ name: string; delta: number }[]>(
      `(() => {
      const head=document.querySelector('.file-head'),row=document.querySelector('.file-row');
      const targets={name:'.filename',modified:'.file-date',created:'.file-created',kind:'.file-kind',extension:'.file-extension',size:'.file-size'};
      const textRect=element=>{const range=document.createRange();range.selectNodeContents(element);return range.getBoundingClientRect();};
      return Array.from(head.children).flatMap((cell)=>{
        if(getComputedStyle(cell).display==='none') return [];
        const column=cell.dataset.column;
        const heading=textRect(cell.querySelector('.column-label')),value=textRect(row.querySelector(targets[column]));
        return {name:cell.textContent.trim(),delta:column==='size'?heading.right-value.right:heading.left-value.left};
      });
    })()`,
    );
  for (const width of [960, 640, 420]) {
    await evaluate(
      `document.querySelector('.folder-explorer').style.width='${width}px';document.querySelector('.folder-explorer').style.flex='none'`,
    );
    for (const overflow of [false, true]) {
      await evaluate(
        `(() => { const list=document.querySelector('.file-scroll'); list.style.flex='none';list.style.height='${overflow ? 72 : 460}px';list.scrollTop=0; })()`,
      );
      await delay(100);
      const columns = await measure();
      for (const column of columns)
        assert.ok(
          Math.abs(column.delta) < 1,
          `${width}px, overflow ${overflow}, ${column.name}: offset ${column.delta}px`,
        );
      assert.equal(
        await evaluate(
          'document.querySelector(".file-scroll").scrollWidth > document.querySelector(".file-scroll").clientWidth',
        ),
        false,
      );
      assert.equal(
        await evaluate(
          'document.querySelector(".file-scroll").scrollHeight > document.querySelector(".file-scroll").clientHeight',
        ),
        overflow,
      );
      console.log('List alignment:', { width, overflow, columns });
    }
  }
  await evaluate(
    `document.querySelector('.folder-explorer').style.removeProperty('width');document.querySelector('.folder-explorer').style.removeProperty('flex');document.querySelector('.file-scroll').style.removeProperty('height');document.querySelector('.file-scroll').style.removeProperty('flex');`,
  );
  await snapshot('desktop-native-list-alignment.png');
}

async function verifyPreviewFooter(): Promise<void> {
  const file = path.join(fixture.files, 'README.md');
  const choices = await evaluate<import('../src/domain/metadata').ApplicationChoices>(
    `window.viewer.applications([${JSON.stringify(file)}])`,
  );
  await preview(file, 'Synthetic files for local Viewer verification.');
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".quick-preview .open-default-button")?.textContent || ""',
      ),
    (label) => label === (choices.defaultName ? `Open in ${choices.defaultName}` : 'Open'),
    'the Quick Preview open control names the actual default application',
  );
  assert.equal(await evaluate('document.querySelectorAll(".wide-dialog footer").length'), 1);
  assert.equal(
    await evaluate('document.querySelectorAll(".quick-preview .preview-info").length'),
    0,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.wide-dialog [aria-label="Open file in default app"]').length`,
    ),
    0,
  );
  await snapshot('desktop-native-quick-preview-footer.png');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const bounds = await evaluate<{ overflow: boolean; bottom: number; height: number }>(
    `(() => { const footer=document.querySelector('.quick-preview-footer');return {overflow:footer.scrollWidth>footer.clientWidth,bottom:footer.getBoundingClientRect().bottom,height:innerHeight}; })()`,
  );
  assert.equal(bounds.overflow, false);
  assert.ok(bounds.bottom <= bounds.height);
  await snapshot('desktop-native-quick-preview-footer-minimum.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await closePreview();
}

async function verifySettingsScroll(): Promise<void> {
  await evaluate('window.viewer.openSettings()');
  await openSettingsProbe();
  await tab('Actions');
  const rectangles = () =>
    settingsEvaluate<number[]>(
      `Array.from(document.querySelectorAll('.settings-recipe summary')).flatMap(element=>{const r=element.getBoundingClientRect();return [r.x,r.width];})`,
    );
  const collapsed = await rectangles();
  await settingsEvaluate('document.querySelector(".settings-recipe summary").click()');
  await until(
    () =>
      settingsEvaluate(
        'document.querySelector(".settings-page").scrollHeight > document.querySelector(".settings-page").clientHeight',
      ),
    Boolean,
    'expanded Actions require scrolling',
  );
  assert.deepEqual(
    await rectangles(),
    collapsed,
    'A scrollbar must not move Settings fields sideways',
  );
  await snapshot('desktop-native-settings-actions-expanded.png');
  await settingsEvaluate('document.querySelector(".settings-recipe summary").click()');
  assert.deepEqual(await rectangles(), collapsed);
  await snapshot('desktop-native-settings-actions-collapsed.png');
  const initialAppearance = await settingsEvaluate<string>(
    'window.viewer.settingsGet().then(snapshot => snapshot.settings.appearance)',
  );
  await settingsCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const appearance of ['dark', 'light']) {
    await settingsEvaluate(`(async () => {
      const snapshot = await window.viewer.settingsGet();
      await window.viewer.settingsPatch([{path:'settings.appearance',value:${JSON.stringify(appearance)}}], snapshot.revision);
    })()`);
    await until(
      () => settingsEvaluate<string>('document.documentElement.dataset.look'),
      (look) => look === appearance,
      'Settings focus appearance',
    );
    await settingsEvaluate('document.querySelector(".settings-navigation button").focus()');
    await settingsCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    await settingsCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    const focus = await settingsEvaluate<{
      label: string;
      keyboard: boolean;
      outline: string;
      color: string;
      accent: string;
      background: string;
      raised: string;
    }>(`(() => {
      const button = document.activeElement, style = getComputedStyle(button);
      const swatch = document.createElement('span');
      swatch.style.color = 'var(--accent)'; swatch.style.background = 'var(--raised)';
      document.body.append(swatch);
      const accent = getComputedStyle(swatch).color, raised = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      return {label:button.textContent.trim(), keyboard:button.matches(':focus-visible'),
        outline:style.outlineStyle, color:style.color, accent, background:style.backgroundColor, raised};
    })()`);
    assert.equal(focus.label, 'Navigation', 'Tab must move to the next Settings control');
    assert.equal(focus.keyboard, true);
    assert.equal(focus.outline, 'none', 'Keyboard feedback must preserve the ring-free design');
    assert.equal(focus.background, focus.raised, 'Keyboard focus must visibly fill its control');
    assert.equal(focus.color, focus.accent);
    await snapshot(`desktop-native-settings-keyboard-focus-${appearance}.png`);
  }
  await settingsEvaluate(`(async () => {
    const snapshot = await window.viewer.settingsGet();
    await window.viewer.settingsPatch([{path:'settings.appearance',value:${JSON.stringify(initialAppearance)}}], snapshot.revision);
  })()`);
  await click('dialog [aria-label="Close"]');
}

async function verifyIndependentSizeCalculation(): Promise<void> {
  const { stdout } = await execNative('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
  const worker = stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .find(
      (match) =>
        match &&
        Number(match[2]) === child.pid &&
        match[3].includes('--utility-sub-type=node.mojom.NodeService'),
    );
  assert.ok(worker, 'The isolated index worker is running');
  pausedWorker = Number(worker[1]);
  process.kill(pausedWorker, 'SIGSTOP');
  try {
    await click(fileSelector(path.join(fixture.files, 'Models')));
    await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
    await command('Input.insertText', { text: 'cs' });
    await key('Enter', 'Enter');
    await until(
      () => evaluate<string>('document.querySelector(".selection-size").textContent'),
      (label) => /KB|MB|GB/.test(label),
      'Calculate Size completes while the index worker is stalled',
      8000,
    );
    await snapshot('desktop-native-independent-folder-size.png');
  } finally {
    process.kill(pausedWorker, 'SIGCONT');
    pausedWorker = undefined;
  }
}

async function verifyAnchoredPreviews(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const folder = path.join(fixture.root, 'Anchor tests');
  await mkdir(folder);
  await Promise.all(
    Array.from({ length: 320 }, (_, i) =>
      writeFile(path.join(folder, `${String(i).padStart(3, '0')}.txt`), 'preview fixture'),
    ),
  );
  const seeded = structuredClone(original);
  const base = seeded.workspaces[0].panes.find((pane) => pane.type === 'folder')!;
  seeded.workspaces[0] = {
    ...seeded.workspaces[0],
    roots: ['qa-anchor-root'],
    activePane: 'qa-anchor-root',
    arrangement: {},
    panes: [{ ...base, id: 'qa-anchor-root', path: folder, history: [folder], historyIndex: 0 }],
  };
  await evaluate(`window.viewer.save(${JSON.stringify(seeded)})`);
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  await evaluate('document.querySelector(".folder-explorer").focus()');
  await key('End', 'End');
  const source = path.join(folder, '319.txt');
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(source))})`),
    Boolean,
    'virtualized last file',
  );
  await evaluate('document.querySelector(".file-scroll").scrollTop=0');
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(source))})`),
    (value) => !value,
    'unmounted selected source row',
  );
  await paletteCommand('Open linked plane');
  await until(
    () => evaluate<number>('window.__qaEngine.tree.get()[0].children.length'),
    (value) => value === 1,
    'preview beside a revealed virtual source',
  );
  await settleCamera();
  const nodes = await evaluate<{
    parent: { rotateX: number; rotateY: number; translateY: number };
    child: { rotateX: number; rotateY: number; translateY: number };
    link: { x: number; y: number };
    offset: number;
    angle: number;
  }>(
    `(() => { const root=window.__qaEngine.tree.get()[0],child=root.children[0]; return {parent:root.location,child:child.location,link:child.linkCoordinates,offset:child.bridgeOffset,angle:child.planeAngle}; })()`,
  );
  assert.equal(nodes.angle, 90.1);
  assert.ok(Math.abs(nodes.child.rotateY - nodes.parent.rotateY - 90.1) < 0.01);
  assert.equal(nodes.parent.rotateX, nodes.child.rotateX);
  assert.ok(
    Math.abs(nodes.child.translateY - nodes.parent.translateY - nodes.link.y - nodes.offset) < 1,
  );
  await evaluate(
    'window.__qaEngine.camera.frame({planeID:window.__qaEngine.tree.get()[0].planeID},{animate:false})',
  );
  await settleCamera();
  const expected = await evaluate<number>(
    `(() => { const row=document.querySelector(${JSON.stringify(fileSelector(source))}); const plane=row.closest('[data-plurid-plane]'); const r=row.getBoundingClientRect(),p=plane.getBoundingClientRect(); return (r.y+r.height/2-p.y)*plane.offsetHeight/p.height; })()`,
  );
  assert.ok(
    Math.abs(nodes.link.y - expected) < 3,
    `Preview must use the visible source row: ${JSON.stringify({ actual: nodes.link.y, expected })}`,
  );
  await snapshot('desktop-native-file-anchored-preview.png');
  for (const mode of ['Grid', 'Columns', 'Gallery', 'List']) {
    await evaluate('document.querySelector(".folder-explorer").focus()');
    await paletteCommand(`${mode} view`);
    await evaluate('document.querySelector(".folder-explorer").focus()');
    const camera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
    await key('End', 'End');
    await key('ArrowUp', 'ArrowUp', 8);
    await key('ArrowUp', 'ArrowUp', 8);
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    assert.ok(
      (await evaluate<number>(
        'document.querySelectorAll(".folder-explorer [data-file-path][aria-selected=true]").length',
      )) > 1,
      `${mode} range selection`,
    );
    assert.equal(
      await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
      camera,
      `${mode} keys must not rotate the camera`,
    );
    await key('Escape', 'Escape');
  }
  await evaluate(`window.viewer.save(${JSON.stringify(original)})`);
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  console.log(
    'Anchoring: a scrolled-out virtual source is revealed before spawning a 90.1° parent-relative preview at its row; all four views own range keys.',
  );
}

/** Observations, not timing assertions: compositor stalls can occur without a JS long task. */
async function profileNativeInteractions(): Promise<void> {
  const samples: Record<string, unknown>[] = [];
  const begin = () =>
    evaluate(`(() => {
    const probe = window.__qaPerf = {frames:[],tasks:[],commits:window.__qaCommits,emissions:0,started:performance.now(),stopped:false};
    let last=performance.now();
    const frame=time=>{if(probe.stopped)return;probe.frames.push(time-last);last=time;probe.raf=requestAnimationFrame(frame);};
    probe.raf=requestAnimationFrame(frame);
    probe.off=window.__qaEngine.store.subscribe(()=>probe.emissions++);
    probe.observer=new PerformanceObserver(list=>probe.tasks.push(...list.getEntries().map(entry=>entry.duration)));
    probe.observer.observe({entryTypes:['longtask']});
  })()`);
  const finish = async (workload: string) => {
    const result = await evaluate<Record<string, unknown>>(`(() => {
      const probe=window.__qaPerf;probe.stopped=true;cancelAnimationFrame(probe.raf);probe.off();
      probe.tasks.push(...probe.observer.takeRecords().map(entry=>entry.duration));probe.observer.disconnect();
      const frames=probe.frames.slice(1).sort((a,b)=>a-b);
      const result={milliseconds:performance.now()-probe.started,commits:window.__qaCommits-probe.commits,emissions:probe.emissions,frames:frames.length,p95:frames[Math.floor((frames.length-1)*.95)]||0,worst:frames.at(-1)||0,longTasks:probe.tasks.length,longestTask:Math.max(0,...probe.tasks)};
      delete window.__qaPerf;return result;
    })()`);
    samples.push({ workload, ...result });
    console.log('Native performance:', JSON.stringify({ workload, ...result }));
  };
  for (let sample = 1; sample <= 3; sample++) {
    const camera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
    await begin();
    await contextMenu(fileSelector(path.join(fixture.files, 'README.md')));
    const point = await evaluate<{ x: number; y: number }>(
      `(() => { const r=document.querySelector('.context-menu .command-results').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    for (let i = 0; i < 24; i++) {
      await command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        buttons: 0,
        x: point.x + (i % 2),
        y: point.y,
      });
      await command('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        deltaX: 0,
        deltaY: i % 12 < 6 ? 60 : -60,
        ...point,
      });
      await delay(20);
    }
    await finish(`menu-wheel-${sample}`);
    assert.equal(
      await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
      camera,
      'Contextual wheel scrolling cannot move the spatial camera',
    );
    await key('Escape', 'Escape');
  }
  const before = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
  const point = await evaluate<{ x: number; y: number }>(
    `(() => { const r=document.querySelector('.workspace-surface').getBoundingClientRect();return {x:r.x+14,y:r.y+r.height/2}; })()`,
  );
  await begin();
  for (let i = 0; i < 24; i++) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      modifiers: 8,
      deltaX: 4,
      deltaY: 8,
      ...point,
    });
    await delay(20);
  }
  await settleCamera();
  await finish('camera-wheel');
  assert.notEqual(
    await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
    before,
    'Camera profile must exercise actual rotation',
  );
  await paletteCommand('Frame plane');
  await settleCamera();
  await key('Escape', 'Escape');
  await writeFile(
    path.join(captureRoot, 'native-reliability-performance.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch,
        samples,
      },
      null,
      2,
    ),
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
async function verifyGroupedMenuAndModels(): Promise<void> {
  await paletteCommand('Dock plane');
  const readme = fileSelector(path.join(fixture.files, 'README.md'));
  await contextMenu(readme);
  assert.equal(
    await evaluate('document.querySelectorAll(".context-menu [data-menu-id^=view-]").length'),
    0,
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.context-menu [data-menu-id^="column."]').length`),
    0,
  );
  assert.equal(await evaluate('document.querySelectorAll(".context-submenu").length'), 0);
  await snapshot('desktop-native-context-grouped.png');
  await click('.context-menu [data-menu-id="menu.View"]');
  await until(
    () => evaluate<number>('document.querySelectorAll(".context-submenu").length'),
    (count) => count === 1,
    'View submenu',
  );
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll(".context-submenu [data-menu-id^=view-]"), element => element.dataset.menuId).sort()',
    ),
    [
      'view-columns',
      'view-gallery',
      'view-grid',
      'view-list',
      'view-map',
      'view-side-by-side',
      'view-stacked',
    ],
  );
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.context-menu-content [id]')).every(element=>!/[\\t\\n\\r ]/.test(element.id))`,
    ),
    true,
    'submenu accessible IDs contain no whitespace',
  );
  await click('.context-submenu [data-menu-id="menu.Columns"]');
  await until(
    () => evaluate<number>('document.querySelectorAll(".context-submenu").length'),
    (count) => count === 2,
    'Columns submenu',
  );
  await snapshot('desktop-native-context-columns.png');
  const flyoutBounds = await evaluate<{ left: number; right: number }[]>(
    `Array.from(document.querySelectorAll('.context-menu, .context-submenu')).map(menu=>{const r=menu.getBoundingClientRect();return {left:r.left,right:r.right};})`,
  );
  assert.ok(flyoutBounds[1].right <= flyoutBounds[0].left + 2);
  assert.ok(flyoutBounds[2].right <= flyoutBounds[1].left + 2);
  assert.equal(
    await evaluate('document.activeElement.getAttribute("aria-label")'),
    'Search actions',
  );
  await key('Escape', 'Escape');
  assert.equal(await evaluate('document.querySelectorAll(".context-submenu").length'), 1);
  await key('ArrowLeft', 'ArrowLeft');
  assert.equal(await evaluate('document.querySelectorAll(".context-submenu").length'), 0);
  await key('ArrowRight', 'ArrowRight');
  assert.equal(await evaluate('document.querySelectorAll(".context-submenu").length'), 1);
  // Typing traverses the full catalog immediately, including a third-level command.
  await command('Input.insertText', { text: 'date created' });
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".context-menu .command-result[aria-selected=true]")?.dataset.menuId || ""',
      ),
    (id) => id === 'column.created',
    'search through hidden column commands',
  );
  assert.equal(await evaluate('document.querySelectorAll(".context-submenu").length'), 0);
  await key('Enter', 'Enter');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".file-head [data-column=created]")'),
    Boolean,
    'searched column command executes',
  );
  await contextMenu(readme);
  await command('Input.insertText', { text: 'rn' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate<string>('document.querySelector("dialog input")?.value || ""'),
    (value) => value === 'README.md',
    'grouped menu retains rename target',
  );
  await click('dialog [aria-label="Close"]');
  await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".context-menu .command-result")?.textContent || ""',
      ),
    (label) => /^Rename/.test(label),
    'recent rename is promoted',
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".context-menu [data-menu-id=rename]").length'),
    1,
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(\'.context-menu [data-menu-id="recent.rename"]\').length',
    ),
    1,
  );
  await key('Escape', 'Escape');
  await until(
    () => evaluate<number>('document.querySelectorAll(".context-menu").length'),
    (count) => count === 0,
    'closed recent context menu',
  );

  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // The list is docked: use a blank-space invocation near the lower-right viewport edge.
  await evaluate(
    `document.querySelector('.folder-explorer .file-scroll').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:765,clientY:545}));`,
  );
  await until(
    () =>
      evaluate<boolean>('document.activeElement?.getAttribute("aria-label") === "Search actions"'),
    Boolean,
    'autofocused edge context menu',
  );
  await click('.context-menu [data-menu-id="menu.View"]');
  await click('.context-submenu [data-menu-id="menu.Columns"]');
  const bounds = await evaluate<{ left: number; top: number; right: number; bottom: number }[]>(
    `Array.from(document.querySelectorAll('.context-menu, .context-submenu')).map(menu=>{const r=menu.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};})`,
  );
  assert.equal(bounds.length, 3);
  for (const rect of bounds) {
    assert.ok(
      rect.left >= 8 && rect.top >= 8 && rect.right <= 772 && rect.bottom <= 552,
      JSON.stringify(rect),
    );
  }
  await snapshot('desktop-native-context-minimum.png');
  // Reproduce the delayed docking focus even if the viewport's own effect has settled.
  await evaluate(
    `document.querySelector('[data-plurid-entity="PluridPlaneContent"]').focus({preventScroll:true})`,
  );
  assert.equal(
    await evaluate('document.activeElement?.getAttribute("aria-label")'),
    'Search actions',
    'flyouts retain the search input at minimum size',
  );
  // All flyouts are one dismissal boundary; clicking inside keeps the menu open.
  for (const count of [1, 0]) {
    await key('Escape', 'Escape');
    await until(
      () => evaluate<number>('document.querySelectorAll(".context-submenu").length'),
      (value) => value === count,
      `edge submenu dismissal: ${count} remaining`,
    );
  }
  await key('Escape', 'Escape');
  await until(
    () => evaluate<number>('document.querySelectorAll(".context-menu").length'),
    (count) => count === 0,
    'edge menu dismissal',
  );
  assert.equal(await evaluate('document.querySelectorAll(".context-menu").length'), 0);
  await command('Emulation.clearDeviceMetricsOverride');

  await tab('Models');
  await until(
    () =>
      settingsEvaluate<boolean>(`!!document.querySelector(${choiceButton('New model provider')})`),
    Boolean,
    'provider picker',
  );
  assert.equal(
    (await choiceValues('New model provider', settingsEvaluate)).length,
    8,
    'complete provider picker',
  );
  await snapshot('desktop-native-models-empty.png');
  for (const kind of ['zai', 'deepseek', 'qwen', 'gemini', 'openrouter']) {
    await choose('New model provider', kind, settingsEvaluate);
    await settingsEvaluate(
      `Array.from(document.querySelectorAll('.settings-provider-add button')).find(button=>button.textContent.trim()==='Add provider').click()`,
    );
  }
  await until(
    () =>
      settingsEvaluate<string[]>(
        'window.viewer.settingsGet().then(value=>value.settings.providers.map(provider=>provider.kind))',
      ),
    (kinds) => kinds.length === 5,
    'all five provider profiles persisted',
  );
  assert.deepEqual(
    await settingsEvaluate(
      'window.viewer.settingsGet().then(value=>value.settings.providers.map(provider=>provider.kind))',
    ),
    ['zai', 'deepseek', 'qwen', 'gemini', 'openrouter'],
  );
  assert.equal(
    await settingsEvaluate(
      `document.querySelector('[data-provider-kind=zai] [aria-label="Provider endpoint"]').value`,
    ),
    'https://api.z.ai/api/paas/v4',
  );
  assert.equal(
    await settingsEvaluate(
      `document.querySelector('[data-provider-kind=gemini] [aria-label="Provider endpoint"]').readOnly`,
    ),
    true,
  );
  assert.equal(
    await settingsEvaluate(
      `document.querySelector('[data-provider-kind=qwen] [aria-label="Provider endpoint"]').readOnly`,
    ),
    false,
  );
  assert.deepEqual(
    await settingsEvaluate('window.viewer.settingsGet().then(value=>value.credentials)'),
    [],
  );
  assert.equal(
    await settingsEvaluate(
      'Array.from(document.querySelectorAll(".settings-provider [type=checkbox]")).every(input=>!input.checked)',
    ),
    true,
  );
  await snapshot('desktop-native-models-providers.png');
  await settingsEvaluate(
    'Array.from(document.querySelectorAll("[data-provider-kind=deepseek] button")).find(button => button.textContent.trim() === "Connect and load models").click()',
  );
  await until(
    () => settingsEvaluate<string>('document.querySelector(".settings-error")?.textContent || ""'),
    (value) => value.includes('API key'),
    'missing provider key is actionable',
  );
  await settingsEvaluate(
    'document.querySelector("[data-provider-kind=qwen]").scrollIntoView({block:"start"})',
  );
  await snapshot('desktop-native-models-qwen.png');
  await click('dialog [aria-label="Close"]');
  console.log(
    'Grouped menus: flyouts, keyboard return, global search, recent actions, captured targets and minimum-window bounds. Models: all five new provider presets persisted with content off and no credentials.',
  );
}
async function verifyModelLighting(): Promise<void> {
  await paletteCommand('Dock plane');
  await click(fileSelector(path.join(fixture.files, 'Models')), 2);
  await until(text, (value) => value.includes('Lighting.step'), 'Lighting fixture folder');
  const observations: { look: string; view: number; geometry: number; blackFraction: number }[] =
    [];
  for (const look of ['dark', 'light'] as const) {
    await appearance(look);
    await preview(path.join(fixture.files, 'Models', 'Lighting.step'), 'Wireframe');
    const dimensions = await until(
      () => evaluate<string>('document.querySelector(".model-dimensions").textContent'),
      (value) => /mm$/.test(value),
      'STEP conversion and model framing complete',
    );
    await click('[aria-label="Frame model"]');
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const worldCamera = await evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
    for (let view = 0; view < 5; view++) {
      if (view === 4) {
        await command('Emulation.setDeviceMetricsOverride', {
          width: 780,
          height: 560,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        );
        await click('[aria-label="Frame model"]');
        await evaluate(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        );
      }
      const bounds = await evaluate<{
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
      }>(`(() => {
        const r=document.querySelector('.model-stage canvas').getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};
      })()`);
      if (view > 0 && view < 4) {
        const [dx, dy] = [
          [0.5, 0],
          [0, -0.28],
          [0.2, 0.2],
        ][view - 1];
        const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        await command('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          buttons: 1,
          clickCount: 1,
          ...start,
        });
        for (let step = 1; step <= 8; step++) {
          await command('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            button: 'left',
            buttons: 1,
            x: start.x + (dx * bounds.height * step) / 8,
            y: start.y + (dy * bounds.height * step) / 8,
          });
          await delay(16);
        }
        await command('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          buttons: 0,
          clickCount: 1,
          x: start.x + dx * bounds.height,
          y: start.y + dy * bounds.height,
        });
        await delay(600);
      }
      // Cropped CDP captures temporarily resize offscreen WebGL surfaces. Capture
      // the settled viewport, then crop its bitmap without touching the renderer.
      const { data } = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      const stats = await evaluate<{ geometry: number; blackFraction: number }>(`(async () => {
        const image=new Image();image.src='data:image/png;base64,${data}';await image.decode();
        const bounds=${JSON.stringify(bounds)},scale=image.width/innerWidth;
        const canvas=document.createElement('canvas');canvas.width=Math.round(bounds.width*scale);canvas.height=Math.round(bounds.height*scale);
        const context=canvas.getContext('2d');context.drawImage(image,bounds.x*scale,bounds.y*scale,bounds.width*scale,bounds.height*scale,0,0,canvas.width,canvas.height);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
        const background=pixels.slice(0,3);let geometry=0,black=0;
        for(let i=0;i<pixels.length;i+=4) {
          const rgb=pixels.slice(i,i+3);
          if(Math.max(...rgb.map((value,index)=>Math.abs(value-background[index])))>18) {
            geometry++;
            if(Math.max(...rgb)<24) black++;
          }
        }
        return {geometry,blackFraction:geometry ? black/geometry : 1};
      })()`);
      observations.push({ look, view, ...stats });
      console.log('Model lighting:', observations.at(-1));
      assert.ok(stats.geometry > 500, 'Lighting check contains rendered geometry');
      assert.equal(
        await evaluate('document.querySelector(".model-dimensions").textContent'),
        dimensions,
      );
      if (view < 4)
        assert.equal(
          await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
          worldCamera,
          'Model orbit does not rotate the Plurid camera',
        );
      if (view === 0 || view === 2 || view === 4)
        await snapshot(`desktop-native-model-lighting-${look}-${view}.png`);
    }
    await command('Emulation.clearDeviceMetricsOverride');
    await closePreview();
  }
  for (const observation of observations)
    assert.ok(
      observation.blackFraction < 0.01,
      `CAD faces remain readable while orbiting: ${JSON.stringify(observation)}`,
    );
  for (const extension of ['glb', 'stl']) {
    await preview(
      path.join(fixture.files, 'Models', `Triangle.${extension}`),
      '1 meshes · 1 triangles · 3 vertices',
    );
    await closePreview();
  }
}
async function verifyRefinements(): Promise<void> {
  await paletteCommand('Dock plane');
  const readme = path.join(fixture.files, 'README.md');
  // Preserve all pasteboard items/types, including images and rich text, without logging them.
  const previousClipboard = await execNative(
    '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      `
    ObjC.import('AppKit');
    const items=$.NSPasteboard.generalPasteboard.pasteboardItems, saved=[];
    for(let i=0;i<items.count;i++) {
      const item=items.objectAtIndex(i), types=item.types, fields=[];
      for(let j=0;j<types.count;j++) {
        const type=ObjC.unwrap(types.objectAtIndex(j)), data=item.dataForType(type);
        if(data) fields.push([type,ObjC.unwrap(data.base64EncodedStringWithOptions(0))]);
      }
      saved.push(fields);
    }
    JSON.stringify(saved);
  `,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  )
    .then((result) => result.stdout)
    .catch(() => {
      throw new Error('Could not preserve the test clipboard.');
    });
  let copiedText = '';
  try {
    await evaluate(`window.viewer.clipboardWrite([${JSON.stringify(readme)}], true)`);
    await contextMenu(fileSelector(readme));
    await click('.context-menu [data-menu-id="copy-path"]');
    copiedText = readme;
    await until(
      async () => (await execNative('/usr/bin/pbpaste')).stdout,
      (value) => value === copiedText,
      'Copy path writes the selected file pathname',
    );
    await until(
      () => evaluate('window.viewer.clipboardRead()'),
      (value) => value === null,
      'Copy path clears an earlier cut operation',
    );
    await contextMenu(fileSelector(readme));
    assert.equal(
      await evaluate('document.querySelectorAll(\'[data-menu-id="recent.copy-path"]\').length'),
      1,
    );
    assert.equal(
      await evaluate('document.querySelectorAll(\'[data-menu-id="copy-path"]\').length'),
      1,
    );
    await snapshot('desktop-native-additive-recents.png');
    await command('Input.insertText', { text: 'copy path' });
    assert.equal(
      await evaluate(
        'document.querySelectorAll(\'.context-menu [data-menu-id="copy-path"]\').length',
      ),
      1,
      'Search has one result per command',
    );
    await key('Escape', 'Escape');
    await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
    await click('.context-menu [data-menu-id="copy-path"]');
    copiedText = path.join(fixture.files, 'Models');
    await until(
      async () => (await execNative('/usr/bin/pbpaste')).stdout,
      (value) => value === copiedText,
      'Copy path writes folder pathname',
    );
    await evaluate(
      `document.querySelector('.file-scroll').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:420}))`,
    );
    await until(
      () =>
        evaluate<boolean>('!!document.querySelector(\'.context-menu [data-menu-id="copy-path"]\')'),
      Boolean,
      'Copy path is available in the current folder menu',
    );
    await click('.context-menu [data-menu-id="copy-path"]');
    copiedText = fixture.files;
    await until(
      async () => (await execNative('/usr/bin/pbpaste')).stdout,
      (value) => value === copiedText,
      'Background menu copies current folder pathname',
    );
  } finally {
    // Restore only our last write; preserve anything the user copied during this check.
    if (copiedText && (await execNative('/usr/bin/pbpaste')).stdout === copiedText) {
      const restoreFile = path.join(fixture.root, 'clipboard-restore.json');
      await writeFile(restoreFile, previousClipboard, { mode: 0o600 });
      await execNative('/usr/bin/osascript', [
        '-l',
        'JavaScript',
        '-e',
        `
        ObjC.import('AppKit'); ObjC.import('Foundation');
        const saved=JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(${JSON.stringify(restoreFile)},$.NSUTF8StringEncoding,null)));
        const board=$.NSPasteboard.generalPasteboard, items=$.NSMutableArray.alloc.init;
        for(const fields of saved) {
          const item=$.NSPasteboardItem.alloc.init;
          for(const [type,encoded] of fields) item.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(encoded,0),type);
          items.addObject(item);
        }
        board.clearContents;
        if(saved.length) board.writeObjects(items);
      `,
      ]).catch(() => {
        throw new Error('Could not restore the test clipboard.');
      });
      await trashFixtureEntry(restoreFile);
    }
  }
  const headerGap = await evaluate<number>(
    `(() => {const name=document.querySelector('.file-heading[data-column=name] .column-label').getBoundingClientRect(); const next=document.querySelector('.file-heading[data-column=modified] .column-label').getBoundingClientRect(); return next.left-name.right;})()`,
  );
  assert.ok(headerGap >= 12, 'Sort-button paint has a gutter before the next column');
  await evaluate(`document.querySelector('.file-heading[data-column=name] .column-label').focus()`);
  await snapshot('desktop-native-header-gutter.png');

  await preview(path.join(fixture.files, 'Cube.step'), 'Wireframe');
  await until(
    () => evaluate<string>('document.querySelector(".model-dimensions")?.textContent || ""'),
    (value) => value === '300 × 300 × 300 mm',
    'Packaged STEP worker renders physical dimensions',
    60000,
  );
  await click('.model-viewer button[aria-pressed=false]');
  await until(
    () =>
      evaluate<boolean>(
        'Array.from(document.querySelectorAll(".model-viewer button")).some(button => button.textContent === "Measure" && button.getAttribute("aria-pressed") === "true")',
      ),
    Boolean,
    'enabled surface measurement',
  );
  const center = await evaluate<{ x: number; y: number }>(
    `(() => { const r=document.querySelector('.model-stage canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  for (const offset of [-20, 20]) {
    const point = { x: center.x + offset, y: center.y };
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
  await until(
    () => evaluate<string>('document.querySelector(".model-measurement")?.textContent || ""'),
    (value) => /^Distance: [1-9]/.test(value),
    'Surface-point distance measurement',
  );
  await snapshot('desktop-native-step-measure.png');
  await closePreview();
  await preview(path.join(fixture.files, 'Printed.3mf'), 'Wireframe');
  await until(
    () => evaluate<string>('document.querySelector(".model-dimensions")?.textContent || ""'),
    (value) => value === '25.4 × 25.4 × 25.4 mm',
    '3MF inch coordinates normalize to millimeters',
  );
  await snapshot('desktop-native-printing-3mf.png');
  await closePreview();
  await preview(path.join(fixture.files, 'Triangle.ply'), 'Wireframe');
  await until(
    () => evaluate<string>('document.querySelector(".model-dimensions")?.textContent || ""'),
    (value) => value === '1 × 1 × 0 units',
    'PLY geometry renders with explicit unknown units',
  );
  await closePreview();
  await preview(path.join(fixture.files, 'Broken.step'), 'Model could not be loaded');
  await closePreview();
  if (process.env.VIEWER_TEST_STEP_FILE) {
    await evaluate(
      `document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, 'User panel.step')))}).scrollIntoView({block:'center'})`,
    );
    await preview(path.join(fixture.files, 'User panel.step'), 'Wireframe');
    await until(
      () => evaluate<string>('document.querySelector(".model-dimensions")?.textContent || ""'),
      (value) => /mm$/.test(value),
      'Read-only copy of the user STEP model renders',
    );
    await snapshot('desktop-native-user-step.png');
    await closePreview();
  }
  await evaluate('document.querySelector(".file-scroll").scrollTop=0');
  await until(
    () =>
      evaluate<boolean>(`(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const row=document.querySelector(${JSON.stringify(fileSelector(path.join(fixture.files, 'Models')))});
      const scroll=document.querySelector('.file-scroll');
      return !!row && row.getBoundingClientRect().top >= scroll.getBoundingClientRect().top && row.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom;
    })()`),
    Boolean,
    'Models row settles after virtual scrolling',
  );
  await click(fileSelector(path.join(fixture.files, 'Models')), 2);
  await until(text, (value) => value.includes('Triangle.glb'), 'Model fixture folder opened');
  for (const extension of ['glb', 'gltf', 'obj', 'stl', 'fbx']) {
    await preview(
      path.join(fixture.files, 'Models', `Triangle.${extension}`),
      '1 meshes · 1 triangles · 3 vertices',
    );
    await closePreview();
  }
  await paletteCommand('Parent folder');
  await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
  await command('Input.insertText', { text: 'Open in another plane' });
  await key('Enter', 'Enter');
  await restoredEngine(2);
  await paletteCommand('Dock plane');
  await until(
    () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState),
    (state) =>
      state.workspaces[0].roots.length === 2 &&
      state.workspaces[0].panes.at(-1)?.path === path.join(fixture.files, 'Models'),
    'Folder opens as an independent root',
  );
  await contextMenu(fileSelector(path.join(fixture.files, 'Models', 'Triangle.stl')));
  await command('Input.insertText', { text: 'Open in another plane' });
  await key('Enter', 'Enter');
  await restoredEngine(3);
  await until(
    () => evaluate<number>('window.__qaEngine.tree.get().length'),
    (count) => count === 3,
    'File opens as an independent root',
  );
  assert.equal(
    await evaluate('window.__qaEngine.tree.get().every(node=>!node.children?.length)'),
    true,
  );

  await tab('Models');
  for (const look of ['dark', 'light']) {
    await settingsEvaluate(
      `window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([{path:'settings.appearance',value:${JSON.stringify(look)}}],snapshot.revision))`,
    );
    await until(
      () => settingsEvaluate<string>('document.documentElement.dataset.look'),
      (value) => value === look,
      'settings appearance ' + look,
    );
    for (const width of [900, 760]) {
      await settingsCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height: width === 760 ? 540 : 640,
        deviceScaleFactor: 1,
        mobile: false,
      });
      for (const category of [
        'Models',
        'Actions',
        'Agents',
        'Navigation',
        'Space',
        'Browsing',
        'Terminals',
        'Configuration',
        'Shortcuts',
        'Previews',
        'Search',
        'Permissions',
        'Privacy',
      ]) {
        await tab(category);
        assert.equal(
          await settingsEvaluate(
            'document.querySelector(".settings-page").scrollWidth > document.querySelector(".settings-page").clientWidth',
          ),
          false,
          `${width}px ${category} has no horizontal overflow`,
        );
        const gaps = await settingsEvaluate<number[]>(
          `Array.from(document.querySelectorAll('.settings-actions')).flatMap(actions=>{const before=actions.previousElementSibling;if(before?.matches('p'))return [actions.getBoundingClientRect().top-before.getBoundingClientRect().bottom];return [];})`,
        );
        assert.ok(
          gaps.every((gap) => gap >= 15),
          `${width}px ${category} separates descriptions from actions`,
        );
        await snapshot(`desktop-native-settings-${category.toLowerCase()}-${width}-${look}.png`);
        if (category === 'Agents')
          assert.ok(
            (await settingsEvaluate<number>(
              'document.querySelector(".settings-wide-field .choice-button").clientWidth',
            )) >= 240,
            'Authorized-folder choice fits its placeholder',
          );
        if (category === 'Space') {
          assert.equal(
            await settingsEvaluate('document.querySelectorAll(".settings-toolbar-preview").length'),
            10,
          );
          await settingsEvaluate(
            'document.querySelector(".settings-toolbar-preview").scrollIntoView({block:"start"})',
          );
          await snapshot(`desktop-native-settings-toolbar-${width}-${look}.png`);
        }
      }
    }
  }
  await settingsEvaluate(
    'window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([{path:"settings.appearance",value:"dark"}],snapshot.revision))',
  );
  await tab('Agents');
  await settingsEvaluate(
    `window.viewer.settingsGet().then(value=>window.viewer.settingsPatch([{path:'settings.agents.roots',value:[${JSON.stringify(path.join(fixture.files, 'Folder with a deliberately long descriptive name for permissions and display'))}]}],value.revision))`,
  );
  await until(
    () =>
      settingsEvaluate<string>(
        'document.querySelector(".settings-field-detail")?.textContent || ""',
      ),
    (value) => value.includes('deliberately long'),
    'Authorized-folder path remains fully readable',
  );
  await snapshot('desktop-native-settings-long-path.png');
  await tab('Space');
  await setting('Navigation button');
  await setting('Back button');
  await settingsEvaluate(
    'document.querySelector(".settings-toolbar-preview").scrollIntoView({block:"start"})',
  );
  assert.equal(
    await settingsEvaluate(
      'document.querySelectorAll(".settings-toolbar-preview[data-enabled=false]").length',
    ),
    2,
  );
  await snapshot('desktop-native-settings-toolbar-states.png');
  await setting('Navigation button');
  await setting('Back button');
  await tab('Browsing');
  await settingsEvaluate(`window.viewer.settingsGet().then(value=>window.viewer.settingsPatch([
    {path:'settings.browsing.newPlaneLocation',value:'custom'}, {path:'settings.browsing.newPlanePath',value:${JSON.stringify(path.join(fixture.files, 'Documents'))}},
    {path:'settings.browsing.emptyWorkspaceLocation',value:'custom'}, {path:'settings.browsing.emptyWorkspacePath',value:${JSON.stringify(path.join(fixture.files, 'Data'))}}
  ],value.revision))`);
  await until(
    () => settingsEvaluate<number>('document.querySelectorAll(".settings-folder-choice").length'),
    (count) => count === 2,
    'Independent custom starting folders',
  );
  await settingsEvaluate(
    `document.querySelector('[aria-label="New folder planes start in"]').closest('.settings-row').scrollIntoView({block:'start'})`,
  );
  await snapshot('desktop-native-independent-plane-settings.png');
  await click('dialog [aria-label="Close"]');
  const empty = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  empty.workspaces[0].panes = [];
  empty.workspaces[0].roots = [];
  empty.workspaces[0].activePane = undefined;
  empty.workspaces[0].arrangement = {};
  await evaluate(`window.viewer.save(${JSON.stringify(empty)})`);
  await command('Page.reload');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".empty-actions .primary:not(:disabled)")'),
    Boolean,
    'Empty workspace action',
  );
  await click('.empty-actions .primary');
  await restoredEngine(1);
  await until(
    () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState),
    (state) => state.workspaces[0].panes[0]?.path === path.join(fixture.files, 'Data'),
    'Empty button uses its own configured folder',
  );
  await click('[aria-label="New folder plane (⌘N)"]');
  await restoredEngine(2);
  await until(
    () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState),
    (state) => state.workspaces[0].panes.at(-1)?.path === path.join(fixture.files, 'Documents'),
    'Workspace plus uses the populated-workspace preference',
  );
  console.log(
    'Refinements: additive recents, text path clipboard, independent roots, STEP/3MF/PLY and measurements, all Settings categories at normal/minimum sizes, toolbar states and separate first-plane preference.',
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
/**
 * EDITING TEXT (2026-10-23): a file edited where it is previewed and saved with ⌘S, the version it
 * replaced in the Trash and back with Undo, and a scratch plane's text kept in the profile as it is
 * typed. Save As uses the native save panel, which this harness does not drive.
 */
async function verifyTextEditing(): Promise<void> {
  const note = path.join(fixture.files, 'Edited note.md');
  await writeFile(note, '# Before\n');
  await until(text, (value) => value.includes('Edited note.md'), 'listed note');
  await click(fileSelector(note), 2);
  const saved = () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState);
  await until(
    saved,
    (state) =>
      state.workspaces[0]!.panes.some((pane) => pane.type === 'preview' && pane.path === note),
    'note preview plane',
  );
  const edit = 'button[title="Edit Text (⌘E)"]';
  await until(
    () => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(edit)})`),
    Boolean,
    'Edit offered',
  );
  await click(edit);
  await until(
    () => evaluate<boolean>('document.activeElement?.classList.contains("cm-content") === true'),
    Boolean,
    'focused editor',
  );
  await command('Input.insertText', { text: 'After ' });
  await key('s', 'KeyS', 4);
  await until(
    () => readFile(note, 'utf8'),
    (value) => value === 'After # Before\n',
    'saved note',
  );
  const jobs = await evaluate<OperationJob[]>('window.viewer.jobs()');
  const save = jobs.findLast((job) => job.kind === 'rewrite');
  assert.equal(save?.status, 'completed', JSON.stringify(save?.errors));
  assert.equal(save?.undoable, true);
  await evaluate(`window.viewer.undo(${JSON.stringify(save!.id)})`);
  await until(
    () => readFile(note, 'utf8'),
    (value) => value === '# Before\n',
    'Undo put back the version the save replaced',
  );
  await key('t', 'KeyT', 4);
  await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'scratch'),
    'scratch plane',
  );
  await until(
    () =>
      evaluate<boolean>(
        '!!document.activeElement?.closest("[data-scratch-plane]") && document.activeElement.classList.contains("cm-content")',
      ),
    Boolean,
    'focused scratch editor',
  );
  await command('Input.insertText', { text: 'scratch text' });
  await until(
    () => evaluate<{ buffers: { kind: string; bytes: number }[] }>('window.viewer.bufferList()'),
    (list) => list.buffers.some((buffer) => buffer.kind === 'scratch' && buffer.bytes === 12),
    'scratch text kept in the profile',
  );
  console.log('Text editing: saved, undone, and scratch text kept.');
}
/** Additional release checks against the actual signed Electron bundle. Files remain untouched. */
async function verifyPublishedPlaneInput(): Promise<void> {
  const sourceID = fixture.state.workspaces[0].roots[0];
  const plane = (id: string) =>
    `[data-plurid-plane]:has([data-viewer-plane=${JSON.stringify(id)}])`;
  const folders = () =>
    evaluate<{
      canvas: { x: number; y: number; width: number; height: number };
      planes: { id: string; x: number; y: number; width: number; height: number }[];
    }>(`(() => {
    const bounds = el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    return {canvas:bounds(document.querySelector('.workspace-surface')),planes:Array.from(document.querySelectorAll('[data-plurid-plane]:has(.folder-plane)')).map(el=>({id:el.querySelector('[data-viewer-plane]').dataset.viewerPlane,...bounds(el)}))};
  })()`);
  const camera = () => evaluate<string>('JSON.stringify(window.__qaEngine.camera.get())');
  const near = (actual: number, expected: number, label: string) =>
    assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} vs ${expected}`);
  const roots = (count: number) =>
    until(folders, (value) => value.planes.length === count, `${count} folder planes`);
  await paletteCommand('View side by side');
  await roots(2);
  await settleCamera();
  let layout = await folders();
  let ordered = layout.planes.toSorted((a, b) => a.x - b.x);
  near(ordered[0].x, layout.canvas.x + 8, 'left inset');
  near(ordered[1].x + ordered[1].width, layout.canvas.x + layout.canvas.width - 8, 'right inset');
  near(ordered[0].width, ordered[1].width, 'equal side-by-side widths');
  near(ordered[1].x - ordered[0].x - ordered[0].width, 12, 'side-by-side gap');
  const peerID = ordered.find((item) => item.id !== sourceID)!.id;
  await click(
    `${plane(peerID)} .location[title=${JSON.stringify(path.join(fixture.files, 'Documents'))}]`,
  );
  await until(
    () =>
      evaluate<string>(
        `document.querySelector(${JSON.stringify(plane(peerID) + ' .plane-heading')}).title`,
      ),
    (value) => value.endsWith('/Documents'),
    'independent peer navigation',
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(plane(sourceID) + ' .plane-heading')}).title`,
    ),
    fixture.files,
  );
  await click(`${plane(peerID)} [aria-label="Close plane"]`);
  await roots(1);
  await paletteCommand('Full width');
  await settleCamera();
  layout = await folders();
  near(layout.planes[0].width, layout.canvas.width - 16, 'remaining plane full width');
  await paletteCommand('Undo arrangement');
  await settleCamera();
  near((await folders()).planes[0].width, ordered[0].width, 'Undo full width');
  await paletteCommand('Undo arrangement');
  await roots(2);
  await paletteCommand('Undo arrangement');
  await roots(1);
  await paletteCommand('View stacked');
  await roots(2);
  await settleCamera();
  layout = await folders();
  ordered = layout.planes.toSorted((a, b) => a.y - b.y);
  for (const item of ordered) near(item.width, layout.canvas.width - 16, 'stacked full width');
  near(ordered[0].height, ordered[1].height, 'equal stacked heights');
  near(ordered[1].y - ordered[0].y - ordered[0].height, 12, 'stacked gap');
  const top = plane(ordered[0].id);
  const scrollTop = () =>
    evaluate<number>(
      `document.querySelector(${JSON.stringify(top + ' .sidebar-scroll')}).scrollTop`,
    );
  const point = () =>
    evaluate<{ x: number; y: number }>(
      `(()=>{const r=document.querySelector(${JSON.stringify(top + ' .sidebar-scroll')}).getBoundingClientRect();return{x:r.x+60,y:r.y+80};})()`,
    );
  const wheel = async (deltaY: number, modifiers = 0) =>
    command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...(await point()),
      deltaX: 0,
      deltaY,
      modifiers,
    });
  await key('Escape', 'Escape');
  let before = await camera();
  const originalScroll = await scrollTop();
  await wheel(-60);
  await until(camera, (value) => value !== before, 'hover scroll moves camera');
  await settleCamera();
  assert.equal(
    await scrollTop(),
    originalScroll,
    'Hover scroll must not scroll the unselected sidebar',
  );
  await click(`${top} .plane-heading`);
  await until(
    () =>
      evaluate<boolean>(
        `document.querySelector(${JSON.stringify(top + ' [data-viewer-plane]')}).dataset.scrollSelected==='true'`,
      ),
    Boolean,
    'clicked plane owns scrolling',
  );
  before = await camera();
  await wheel(90);
  await until(scrollTop, (value) => value > originalScroll + 50, 'selected sidebar scrolls');
  assert.equal(await camera(), before, 'Selected plane scroll must not move the camera');
  await key('Escape', 'Escape');
  const selectedScroll = await scrollTop();
  before = await camera();
  await wheel(30);
  await until(camera, (value) => value !== before, 'Escape releases plane scrolling');
  await settleCamera();
  assert.equal(await scrollTop(), selectedScroll, 'Released sidebar must not keep scrolling');
  await paletteCommand('Frame plane');
  await settleCamera();
  await click(`${top} .plane-heading`);
  await paletteCommand('Fill workspace');
  await settleCamera();
  const note = path.join(fixture.files, 'README.md');
  await click(`${top} ${fileSelector(note)}`);
  await key(' ', 'Space');
  await until(
    () => evaluate<boolean>('!!document.querySelector("dialog[open]")'),
    Boolean,
    'Space preview',
  );
  before = await camera();
  const previewPoint = await evaluate<{ x: number; y: number }>(
    `(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...previewPoint,
    deltaX: 0,
    deltaY: 120,
    modifiers: 8,
  });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(
    await camera(),
    before,
    'Quick Preview must isolate navigation-modified wheel input',
  );
  await closePreview();
  await snapshot('desktop-native-published-plane-input.png');
  console.log(
    'Published Plurid native checks passed: side-by-side and stacked full-width tiling, independent navigation, close/full-width and arrangement Undo, hover/selected/Escape wheel routing, and modal preview isolation.',
  );
}

async function verifySpatialTools(): Promise<void> {
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
}
async function appearance(look: 'dark' | 'light'): Promise<void> {
  await paletteCommand('Settings');
  await openSettingsProbe();
  await tab('Browsing');
  await until(
    () => settingsEvaluate<boolean>(`!!document.querySelector('[aria-label="Appearance"]')`),
    (present) => present,
    'appearance setting',
  );
  await settingsEvaluate(
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
  await until(
    () =>
      evaluate<boolean>(
        `document.querySelector(${JSON.stringify(fileSelector(file))})?.getAttribute('aria-selected') === 'true'`,
      ),
    Boolean,
    `selected preview source ${path.basename(file)}`,
  );
  await key(' ', 'Space');
  await until(text, (value) => value.includes(expected), `preview ${path.basename(file)}`);
  console.log(`Preview: ${path.basename(file)}`);
}
async function verifyDrawingsAndWorkspaces(): Promise<void> {
  await preview(path.join(fixture.files, 'Panel.dxf'), 'Click geometry');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('.dxf-viewer[data-dxf-entities="6"]')`),
    Boolean,
    'parsed drawing in worker',
  );
  assert.equal(await evaluate('document.querySelector(".dxf-viewer").dataset.dxfUnits'), '4');
  const checkDrawingToolbar = async (selector: string, height: number) => {
    const controls = await evaluate<{ height: number; center: number }[]>(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(el=>({height:el.offsetHeight,center:el.getBoundingClientRect().top+el.getBoundingClientRect().height/2}))`,
    );
    assert.ok(controls.length >= 5, 'All drawing tools are present');
    assert.ok(
      controls.every((control) => control.height === height),
      `Drawing buttons and selectors share a ${height}px height: ${JSON.stringify(controls)}`,
    );
    assert.ok(
      Math.max(...controls.map((control) => control.center)) -
        Math.min(...controls.map((control) => control.center)) <
        1,
      'Drawing controls align vertically',
    );
  };
  await checkDrawingToolbar('.quick-preview .preview-toolbar > button', 30);
  assert.equal(
    await evaluate<number>('document.querySelector(".dxf-info").offsetHeight'),
    34,
    'Quick Preview retains the compact drawing status bar',
  );
  assert.equal(
    await evaluate<boolean>(`(()=>{
      const guide=document.querySelector('.dxf-guidance > span:first-child').getBoundingClientRect();
      const units=document.querySelector('.dxf-units').getBoundingClientRect();
      return units.left>=guide.right && units.left-guide.right<12;
    })()`),
    true,
    'Drawing units stay beside the instructions',
  );
  const tool = async (value: string) => {
    await choose('Drawing tool', value);
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
  };
  const corners = () =>
    evaluate<{ x: number; y: number }[]>(
      `(()=>{const s=document.querySelector('.dxf-stage').getBoundingClientRect(),scale=Math.min((s.width-80)/200,(s.height-80)/100);return [[0,0],[200,0],[200,100],[0,100]].map(([x,y])=>({x:s.left+s.width/2+(x-100)*scale,y:s.top+s.height/2-(y-50)*scale}));})()`,
    );
  const pick = async (point: { x: number; y: number }) => {
    assert.equal(
      await evaluate(`document.elementFromPoint(${point.x},${point.y})?.tagName`),
      'CANVAS',
      'Every measured vertex remains hit-testable, including while an area draft is open',
    );
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
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
  };
  await tool('distance');
  const points = await corners();
  await pick(points[0]);
  await pick(points[1]);
  await until(
    () =>
      evaluate<string>('document.querySelector("[data-dxf-last-measurement]")?.textContent || ""'),
    (value) => value.includes('200 mm'),
    'snapped model-space distance',
  );
  await tool('angle');
  await pick(points[1]);
  await pick(points[0]);
  await pick(points[3]);
  await until(
    () =>
      evaluate<string>('document.querySelector("[data-dxf-last-measurement]")?.textContent || ""'),
    (value) => value.includes('90.00°'),
    'three-point angle',
  );
  await tool('area');
  for (const point of points) await pick(point);
  await key('Enter', 'Enter');
  await until(
    () =>
      evaluate<string>('document.querySelector("[data-dxf-last-measurement]")?.textContent || ""'),
    (value) => value.includes('20,000 mm²'),
    'closed polygon area',
  );
  await click('[aria-label="Show drawing details"]');
  assert.equal(await evaluate('document.querySelectorAll(".dxf-measurement").length'), 3);
  await choose('Drawing measurement units', '1');
  await until(
    () =>
      evaluate<string>('document.querySelector("[data-dxf-last-measurement]")?.textContent || ""'),
    (value) => value.includes('31 in²'),
    'square unit conversion',
  );
  // Opening details changes the drawing viewport: fit mode must reframe, not clip geometry.
  await tool('distance');
  const detailPoints = await corners();
  await pick(detailPoints[0]);
  await pick(detailPoints[1]);
  await until(
    () =>
      evaluate<string>('document.querySelector("[data-dxf-last-measurement]")?.textContent || ""'),
    (value) => value.includes('7.874 in'),
    'fitted drawing retains true coordinates after opening details',
  );
  await snapshot('desktop-native-dxf-measurements.png');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const compactPoints = await corners();
  await pick(compactPoints[0]);
  await pick(compactPoints[1]);
  await until(
    () => evaluate<number>('document.querySelectorAll(".dxf-measurement").length'),
    (count) => count === 5,
    'fitted drawing remains measurable after window resize',
  );
  const compactBounds = await evaluate<{ overflow: boolean; bottom: number }>(
    `(()=>{const viewer=document.querySelector('.dxf-viewer');return {overflow:viewer.scrollWidth>viewer.clientWidth,bottom:viewer.getBoundingClientRect().bottom};})()`,
  );
  assert.equal(compactBounds.overflow, false);
  assert.ok(compactBounds.bottom <= 560);
  // Observe actual canvas text placements rather than duplicating its placement calculation.
  await evaluate(`(()=>{
    const ctx=document.querySelector('.dxf-stage canvas').getContext('2d');
    const original=ctx.fillText.bind(ctx);
    window.__qaDrawingLabels=[];
    ctx.fillText=(value,x,y,...args)=>{
      window.__qaDrawingLabels.push({value,x,y,width:ctx.measureText(value).width});
      original(value,x,y,...args);
    };
    window.__qaDrawingRestore=()=>{ctx.fillText=original;};
  })()`);
  await click('[aria-label="Fit drawing"]');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(
    await evaluate<boolean>(`(()=>{
      const readout=document.querySelector('.dxf-readout');
      const label=window.__qaDrawingLabels.find(row=>row.value==='31 in²');
      return !!label && (label.x>=readout.offsetLeft+readout.offsetWidth ||
        label.x+label.width<=readout.offsetLeft ||
        label.y-14>=readout.offsetTop+readout.offsetHeight || label.y<=readout.offsetTop);
    })()`),
    true,
    'The complete area annotation stays outside the floating readout in the minimum window',
  );
  await evaluate('window.__qaDrawingRestore()');
  await snapshot('desktop-native-dxf-minimum.png');
  await tool('area');
  for (const point of compactPoints.slice(0, 3)) await pick(point);
  assert.equal(
    await evaluate<boolean>(`(()=>{
      const row=document.querySelector('.dxf-info').getBoundingClientRect();
      const finish=document.querySelector('.dxf-draft-controls button');
      const actions=document.querySelector('.dxf-draft-controls').getBoundingClientRect();
      const units=document.querySelector('.dxf-units').getBoundingClientRect();
      const instructions=document.querySelector('.dxf-guidance > span:first-child');
      return !finish.disabled && actions.right<=row.right && actions.top>=row.top &&
        actions.bottom<=row.bottom && units.right<=actions.left &&
        instructions.title.includes('Enter') && document.querySelector('.dxf-info').offsetHeight===34;
    })()`),
    true,
    'Area instructions, units and enabled draft controls fit in the minimum window',
  );
  await snapshot('desktop-native-dxf-draft-minimum.png');
  await click('[aria-label="Cancel measurement"]');
  await tool('distance');
  await command('Emulation.clearDeviceMetricsOverride');
  const setLook = async (look: 'dark' | 'light') => {
    await evaluate(
      `window.viewer.settingsGet().then(s=>window.viewer.settingsPatch([{path:'settings.appearance',value:${JSON.stringify(look)}}],s.revision))`,
    );
    await until(
      () => evaluate<string>('document.documentElement.dataset.look'),
      (value) => value === look,
      'drawing appearance update',
    );
    await until(
      () =>
        evaluate<boolean>(`(()=>{
        const canvas=document.querySelector('.dxf-stage canvas');
        const probe=document.createElement('canvas').getContext('2d');
        probe.fillStyle=getComputedStyle(canvas).getPropertyValue('--field').trim();
        probe.fillRect(0,0,1,1);
        const expected=probe.getImageData(0,0,1,1).data;
        const pixels=canvas.getContext('2d').getImageData(0,0,8,8).data;
        for(let i=0;i<pixels.length;i+=4)
          if(pixels[i]===expected[0] && pixels[i+1]===expected[1] && pixels[i+2]===expected[2]) return true;
        return false;
      })()`),
      Boolean,
      `canvas painted the live ${look} palette`,
    );
  };
  await setLook('light');
  await snapshot('desktop-native-dxf-light.png');
  await setLook('dark');
  const camera = await evaluate('JSON.stringify(window.__qaEngine.camera.get())');
  await click('.dxf-stage canvas');
  await key('ArrowRight', 'ArrowRight', 8);
  assert.equal(
    await evaluate('JSON.stringify(window.__qaEngine.camera.get())'),
    camera,
    'Drawing keys do not rotate the Plurid camera',
  );
  await evaluate('document.querySelector(".dxf-layer input").click()');
  await click('[aria-label="Fit drawing"]');
  await evaluate('document.querySelector(".dxf-layer input").click()');
  await closePreview();
  await preview(path.join(fixture.files, 'Broken.dxf'), 'Drawing could not be loaded');
  await closePreview();
  // Exercise the same module in an actual linked Plurid plane with header controls.
  await click(fileSelector(path.join(fixture.files, 'Panel.dxf')), 2);
  await settleCamera();
  await until(
    () =>
      evaluate<boolean>(
        `!!document.querySelector('.plane-module-controls [aria-label="Drawing tool"]')`,
      ),
    Boolean,
    'drawing tools in plane header',
  );
  await checkDrawingToolbar('.plane-module-controls .preview-toolbar > button', 28);
  await paletteCommand('Measure distance');
  await until(
    () =>
      evaluate<string>(
        `document.querySelector(${choiceButton('Drawing tool')})?.textContent || ''`,
      ),
    (value) => value === 'Distance',
    'searchable preview measurement command',
  );
  assert.equal(
    await evaluate<boolean>(`(()=>{
      const host=document.querySelector('.preview-host[data-preview-module="dxf"]');
      const name=host.querySelector('.preview-filename').getBoundingClientRect();
      const details=host.querySelector('.preview-file-details').getBoundingClientRect();
      const guide=host.querySelector('.dxf-guidance').getBoundingClientRect();
      const open=host.querySelector('.preview-info button').getBoundingClientRect();
      return Math.abs(name.left-guide.left)<1 && details.left>=name.right &&
        details.left-name.right<12 && details.right<open.left;
    })()`),
    true,
    'Linked drawing filename, type and size form one aligned group before the external-open action',
  );
  await snapshot('desktop-native-dxf-plane.png');
  if (process.env.VIEWER_TEST_DXF_FILE) {
    await paletteCommand('Close plane');
    await preview(path.join(fixture.files, 'User panel.dxf'), 'Click geometry');
    await until(
      () => evaluate<boolean>(`!!document.querySelector('.dxf-viewer[data-dxf-entities="5"]')`),
      Boolean,
      'user drawing geometry',
    );
    await click('[aria-label="Show drawing details"]');
    await snapshot('desktop-native-dxf-user-panel.png');
    await closePreview();
  }
  await paletteCommand('Change workspace');
  await until(
    () => evaluate<string>('document.activeElement?.getAttribute("aria-label") || ""'),
    (value) => value === 'Search workspaces',
    'workspace picker focus',
  );
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll(".command-result")).map(row=>row.textContent.trim())',
    ).then((value) =>
      (value as string[]).map((row) =>
        row.includes('Engineering') ? 'Engineering' : row.includes('Studio') ? 'Studio' : row,
      ),
    ),
    ['Studio', 'Engineering'],
  );
  await snapshot('desktop-native-workspace-picker.png');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const pickerBounds = await evaluate<{ bottom: number; overflow: boolean }>(
    `(()=>{const picker=document.querySelector('.command-palette');return {bottom:picker.getBoundingClientRect().bottom,overflow:picker.scrollWidth>picker.clientWidth};})()`,
  );
  assert.ok(pickerBounds.bottom <= 560);
  assert.equal(pickerBounds.overflow, false);
  await snapshot('desktop-native-workspace-picker-minimum.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await key('Escape', 'Escape');
  await until(
    () => evaluate<string>('document.activeElement?.getAttribute("aria-label") || ""'),
    (value) => value === 'Search commands',
    'workspace picker Escape returns to commands',
  );
  await command('Input.insertText', { text: 'Engineering' });
  await key('Enter', 'Enter');
  await until(
    () =>
      evaluate<string>(
        'document.querySelector(".workspace-menu-button")?.textContent || document.body.innerText',
      ),
    (value) => value.includes('Engineering'),
    'direct name switches workspace',
  );
  await paletteCommand('Change workspace');
  await until(
    () => evaluate<string>('document.activeElement?.getAttribute("aria-label") || ""'),
    (value) => value === 'Search workspaces',
    'workspace picker after switch',
  );
  await command('Input.insertText', { text: 'Studio' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate<string>('document.body.innerText'),
    (value) => value.includes('Studio'),
    'filtered workspace restores original planes',
  );
  console.log(
    'Drawing and workspace checks: worker parsing, snapped distance/angle/area, units, layers, gesture isolation, linked header commands, invalid files, and workspace picker/direct name switching.',
  );
}
async function closePreview(): Promise<void> {
  await click('dialog [aria-label="Close"]');
}
async function snapshot(name: string, clip?: Record<string, number>): Promise<string> {
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const capture = settingsMode ? settingsCommand : command;
  const value = await capture<{ data: string }>('Page.captureScreenshot', {
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
  await until(
    () => evaluate<{ running: boolean; count: number }>('window.viewer.indexStatus()'),
    (status) => !status.running && status.count > 10,
    'packaged SQLite utility index',
  );
  assert.equal(
    await evaluate(
      `window.viewer.indexedQuery({ query: 'Book ext:epub', root: ${JSON.stringify(fixture.files)} }).then(result => result.entries.length)`,
    ),
    1,
  );
  const restore = async (state: SavedState, count: number) => {
    await delay(800);
    await evaluate(`window.viewer.save(${JSON.stringify(state)})`);
    await reloadPage();
    await restoredEngine(count);
    await settleCamera();
  };
  const containedActive = (id = 'reused-preview-3') =>
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
    (state) => state.workspaces[0].activePane?.startsWith('reused-preview-') === true,
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
  await paletteCommand('Open in another plane');
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
async function verifyServiceWorkflows(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const unchanged = await inventory();
  const documents = path.join(fixture.files, 'Documents');
  const book = path.join(documents, 'Book.epub');
  const bookBytes = await readFile(book);
  const document = await evaluate<{
    text: string;
    evidence: { source: string; text: string }[];
  }>(`(async () => {
    const source = await window.viewer.resource(${JSON.stringify(path.join(documents, 'Project brief.pdf'))});
    try { return await window.viewer.document(source.id); } finally { await window.viewer.release(source.id); }
  })()`);
  assert.ok(document.text.includes('Searchable PDF text'));
  assert.equal(
    document.evidence.some((item) => item.source.startsWith('OCR page')),
    false,
    'Ordinary document reading leaves OCR opt-in',
  );
  const inspected = await evaluate<{ evidence: { source: string; text: string }[] }>(
    `window.viewer.inspect(${JSON.stringify(path.join(documents, 'Project brief.pdf'))}, true, true)`,
  );
  assert.ok(
    inspected.evidence.some(
      (item) => item.source.startsWith('OCR page') && item.text.includes('Viewer preview fixture'),
    ),
    'Explicit OCR uses the packaged local helper and returns recognized text',
  );
  await click(fileSelector(documents), 2);
  await until(text, (value) => value.includes('Book.epub'), 'book fixture listing');
  await click(fileSelector(book));
  await click('.plane-controls [aria-label="Frame plane"]');
  await settleCamera();
  await key(' ', 'Space');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".quick-preview .epub-viewer")'),
    Boolean,
    'Space after the frame control',
  );
  await key('Escape', 'Escape');
  await click(fileSelector(book));
  await paletteCommand('Rename as book');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".action-config")'),
    Boolean,
    'book action configuration',
  );
  await click('.action-config .primary');
  const plan = await until(
    () => evaluate<import('../src/domain/services').ActionPlan[]>('window.viewer.actionList()'),
    (plans) => plans.some((plan) => plan.recipeID === 'book-name' && plan.status === 'review'),
    'local book proposal',
  ).then((plans) =>
    plans.find((plan) => plan.recipeID === 'book-name' && plan.status === 'review')!,
  );
  assert.equal(
    path.basename(plan.rows[0].destination),
    '2000, J. E. Rehder, Fire in antiquity, Fixture Press.epub',
  );
  assert.deepEqual(await inventory(), unchanged, 'Creating a proposal must not modify files');
  await until(
    () => evaluate<boolean>(`!!document.querySelector('[aria-label="Evidence for Book.epub"]')`),
    Boolean,
    'rendered proposal',
  );
  const destinationSelector = '[aria-label="Destination for Book.epub"]';
  assert.equal(
    await evaluate<string>(`document.querySelector(${JSON.stringify(destinationSelector)}).value`),
    path.basename(plan.rows[0].destination),
    'Review must show the complete proposed filename ahead of its directory',
  );
  await click(destinationSelector);
  await evaluate(`window.viewer.textEdit('selectAll')`);
  await until(
    () =>
      evaluate<boolean>(
        `(() => { const input = document.querySelector(${JSON.stringify(destinationSelector)}); return input.selectionStart === 0 && input.selectionEnd === input.value.length; })()`,
      ),
    Boolean,
    'native Select All in review input',
  );
  // CDP bypasses Cocoa key bindings; pass the native editing command explicitly.
  await key('a', 'KeyA', 4, ['selectAll']);
  const editedName = '2000, J. E. Rehder, Reviewed title, Fixture Press.epub';
  await command('Input.insertText', { text: editedName });
  await click('[aria-label="Edit path for Book.epub"]');
  assert.equal(
    await evaluate<string>(`document.querySelector(${JSON.stringify(destinationSelector)}).value`),
    path.join(documents, editedName),
    'Filename edits retain the intended destination directory',
  );
  await click(destinationSelector);
  await key('a', 'KeyA', 4, ['selectAll']);
  await command('Input.insertText', { text: plan.rows[0].destination });
  await click('[aria-label="Edit filename for Book.epub"]');
  await click('[aria-label="Evidence for Book.epub"]');
  await snapshot('action-review-native.png');
  await click('.task-dialog footer .primary');
  await until(
    () =>
      evaluate<import('../src/domain/services').ActionPlan>(
        `window.viewer.actionGet(${JSON.stringify(plan.id)})`,
      ),
    (plan) => plan.status === 'completed',
    'apply reviewed book rename',
  );
  assert.deepEqual(await readFile(plan.rows[0].destination), bookBytes);
  await click('.task-dialog footer button');
  await until(
    () =>
      evaluate<import('../src/domain/services').ActionPlan>(
        `window.viewer.actionGet(${JSON.stringify(plan.id)})`,
      ),
    (plan) => !plan.undoable,
    'undo reviewed rename',
  );
  assert.deepEqual(await inventory(), unchanged);
  await closePreview();
  await paletteCommand('Parent folder');
  await evaluate(
    `(async () => { const snapshot = await window.viewer.settingsGet(); await window.viewer.settingsPatch([{ path: 'settings.savedSearches', value: [{id:'qa-publications', name:'Publication files', query:'ext:pdf,epub', root:${JSON.stringify(fixture.files)}, recursive:true}] }], snapshot.revision); })()`,
  );
  await paletteCommand('Publication files');
  await restoredEngine(2);
  await settleCamera();
  await until(
    () => evaluate<boolean>('!!document.querySelector(".search-explorer [data-file-path]")'),
    Boolean,
    'indexed search root',
  );
  await snapshot('search-native.png');
  await click(`.search-explorer ${fileSelector(book)}`);
  await key(' ', 'Space');
  await until(
    () => evaluate<boolean>('!!document.querySelector(".quick-preview .epub-viewer")'),
    Boolean,
    'Quick Preview from virtual search',
  );
  await key('Escape', 'Escape');
  await contextMenu(`.search-explorer ${fileSelector(book)}`);
  await command('Input.insertText', { text: 'Get info' });
  await key('Enter', 'Enter');
  await until(
    text,
    (value) => value.includes('File information'),
    'shared search result file information',
  );
  await closePreview();
  await patchInSettings(
    `[{path:'settings.search.contentRoots',value:[${JSON.stringify(documents)}]}]`,
  );
  await until(
    () =>
      evaluate<import('../src/domain/services').IndexedResult>(
        `window.viewer.indexedQuery({query:'local chapter fixture',content:true,root:${JSON.stringify(documents)}})`,
      ),
    (result) => result.entries.some((file) => file.path === book),
    'explicitly granted local document-text indexing',
  );
  await patchInSettings(
    `[{path:'settings.search.contentRoots',value:[]},{path:'settings.search.paused',value:true}]`,
  );
  await until(
    () =>
      evaluate<import('../src/domain/services').IndexedResult>(
        `window.viewer.indexedQuery({query:'local chapter fixture',content:true,root:${JSON.stringify(documents)}})`,
      ),
    (result) => !result.entries.length,
    'revoking text permission clears stored content while paused',
  );
  await patchInSettings(`[{path:'settings.search.paused',value:false}]`);
  await paletteCommand('Settings');
  for (const category of ['Browsing', 'Search', 'Actions', 'Models', 'Agents', 'Shortcuts']) {
    await tab(category);
    await snapshot('settings-' + category.toLowerCase() + '-native.png');
  }
  await patchInSettings(
    `[{path:'settings.agents.enabled',value:true},{path:'settings.agents.roots',value:[${JSON.stringify(documents)}]}]`,
  );
  const configuration = JSON.parse(
    await settingsEvaluate<string>('window.viewer.agentToken()'),
  ) as {
    mcpServers: { viewer: { env: Record<string, string> } };
  };
  const agent = spawn(binary, ['--mcp'], {
    env: { ...process.env, ...configuration.mcpServers.viewer.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let agentOutput = '';
  agent.stdout.on('data', (chunk) => {
    agentOutput += String(chunk);
  });
  let agentErrors = '';
  agent.stderr.on('data', (chunk) => {
    agentErrors += String(chunk);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    agent.once('error', reject);
    agent.once('exit', resolve);
  });
  try {
    agent.stdin.end(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '1' },
          },
        },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'read_metadata', arguments: { path: book } },
        },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'read_metadata',
            arguments: { path: path.join(fixture.files, 'README.md') },
          },
        },
      ]
        .map((request) => JSON.stringify(request))
        .join('\n') + '\n',
    );
    const code = await Promise.race([
      exited,
      delay(15000).then(() => {
        throw new Error('Packaged MCP client timed out');
      }),
    ]);
    assert.equal(code, 0, agentErrors);
    assert.ok(agentOutput.trim(), `Packaged MCP client answered nothing. ${agentErrors}`);
    const replies = agentOutput
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(replies.find((reply) => reply.id === 1)?.result.serverInfo.name, 'viewer');
    const tools = replies
      .find((reply) => reply.id === 2)
      ?.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(tools.includes('run_action'));
    assert.ok(!tools.some((name: string) => /apply|trash|delete/.test(name)));
    assert.equal(
      JSON.parse(replies.find((reply) => reply.id === 3).result.content[0].text).path,
      book,
    );
    assert.ok(
      replies.find((reply) => reply.id === 4)?.error.message.includes('authorized folders'),
    );
  } finally {
    if (agent.exitCode === null && agent.signalCode === null) agent.kill('SIGKILL');
    await patchInSettings(
      `[{path:'settings.agents.enabled',value:false},{path:'settings.agents.roots',value:[]}]`,
    );
  }
  await click('dialog [aria-label="Close"]');
  await delay(800);
  await assert.rejects(readFile(path.join(profile, 'credentials-v1.json')), { code: 'ENOENT' });
  await evaluate(`window.viewer.save(${JSON.stringify(original)})`);
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  assert.deepEqual(await inventory(), unchanged);
  console.log(
    'Services: packaged PDF extraction and OCR, Space after Frame, book proposal/review/apply/Undo, indexed virtual search, shared result commands and modeless Settings.',
  );
}
async function verifyIndependentPreviewRevocation(): Promise<void> {
  const documents = path.join(fixture.files, 'Documents');
  const images = path.join(fixture.files, 'Images');
  const file = path.join(documents, 'Project notes.md');
  const resource = await evaluate<import('../src/domain/contracts').Resource>(
    `window.viewer.resource(${JSON.stringify(file)})`,
  );
  const original = await evaluate(`window.viewer.read(${JSON.stringify(resource.id)})`);
  await click(fileSelector(documents), 2);
  await preview(file, 'A wider view');
  await evaluate('window.viewer.openSettings()');
  await openSettingsProbe();
  try {
    await settingsEvaluate(`window.viewer.fileAccessRevoke(${JSON.stringify(images)})`);
    assert.deepEqual(
      await evaluate(`window.viewer.read(${JSON.stringify(resource.id)})`),
      original,
      'Revoking Images must preserve an existing Documents resource',
    );
    assert.ok(
      await evaluate(
        'document.querySelector(".quick-preview")?.textContent.includes("A wider view")',
      ),
    );
    // Ordinary-runtime permission denial is sufficient to detect stale decoded
    // UI bytes. Genuine PowerBox authorization is a separate signed scenario.
    await chmod(documents, 0o000);
    assert.ok(
      await evaluate(
        'document.querySelector(".quick-preview")?.textContent.includes("A wider view")',
      ),
    );
    await settingsEvaluate(`window.viewer.fileAccessRevoke(${JSON.stringify(documents)})`);
    await until(
      () => evaluate<string>('document.querySelector(".quick-preview")?.textContent || ""'),
      (value) => value.includes('File unavailable') && !value.includes('A wider view'),
      'revoked preview disposes its decoded text and shows the access error',
    );
    await click('dialog [aria-label="Close"]');
    await snapshot('desktop-native-preview-access-revoked.png');
  } finally {
    await chmod(documents, 0o700);
    if (settingsMode) await click('dialog [aria-label="Close"]');
    await evaluate(`window.viewer.release(${JSON.stringify(resource.id)})`);
    await closePreview();
    await paletteCommand('Parent folder');
  }
  console.log(
    'Preview permissions: unrelated resources/decoded UI remain usable; revoked text is disposed through the real Settings API.',
  );
}

async function verifyStoreFileServices(): Promise<void> {
  await verifyIndependentPreviewRevocation();
  const task = await evaluate<import('../src/domain/metadata').FolderSizeTask>(
    `window.viewer.folderSizeStart([${JSON.stringify(path.join(fixture.files, 'Models'))}])`,
  );
  const measured = await until(
    () =>
      evaluate<import('../src/domain/metadata').FolderSizeTask>(
        `window.viewer.folderSizeGet(${JSON.stringify(task.id)})`,
      ),
    (value) => value.status === 'completed',
    'thread-backed recursive size calculation',
  );
  assert.ok(measured.bytes > 0);
  const deniedPDF = path.join(fixture.files, 'Documents', 'Denied.pdf');
  await writeFile(
    deniedPDF,
    await readFile(path.join(fixture.files, 'Documents', 'Project brief.pdf')),
  );
  try {
    await chmod(deniedPDF, 0o000);
    const failure = await evaluate<{ code: string }>(`(async () => {
      const resource = await window.viewer.resource(${JSON.stringify(deniedPDF)});
      try {
        return await window.viewer.document(resource.id).then(() => ({ code: 'UNEXPECTED_SUCCESS' }), error => ({ code: error.code, message: error.message }));
      } finally { await window.viewer.release(resource.id); }
    })()`);
    assert.ok(
      ['EACCES', 'EPERM'].includes(failure.code),
      'Reader permissions survive the worker and IPC boundaries: ' + JSON.stringify(failure),
    );
  } finally {
    await chmod(deniedPDF, 0o600);
    await trashFixtureEntry(deniedPDF);
  }
  await verifyServiceWorkflows();
  const { stdout } = await execNative('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
  assert.ok(
    !stdout.split('\n').some((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return (
        match &&
        Number(match[2]) === child.pid &&
        match[3].includes('--utility-sub-type=node.mojom.NodeService')
      );
    }),
    'Store file services use main-process threads, not a separate Node utility process',
  );
  const restricted = path.join(fixture.files, 'Access required');
  await mkdir(restricted);
  try {
    await chmod(restricted, 0o000);
    await until(
      () =>
        evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(restricted))})`),
      Boolean,
      'new permission fixture appears in the watched folder',
    );
    await click(fileSelector(restricted), 2);
    await until(
      () =>
        evaluate<boolean>(
          `[...document.querySelectorAll('.folder-error button')].some(button => button.textContent.includes('Allow folder access'))`,
        ),
      Boolean,
      'actionable native folder access control',
    );
    assert.ok((await text()).includes('Folder access required'));
    assert.ok(!(await text()).includes('This folder is empty'));
    await snapshot('desktop-native-folder-access.png');
    await chmod(restricted, 0o700);
    await evaluate(`window.dispatchEvent(new Event('viewer:refresh'))`);
    await until(
      text,
      (value) => !value.includes('Folder access required'),
      'granted folder reloads',
    );
    await delay(500);
    const recovered = path.join(restricted, 'Recovered.txt');
    await writeFile(recovered, 'Generated watcher recovery fixture.');
    await until(
      () =>
        evaluate<boolean>(`!!document.querySelector(${JSON.stringify(fileSelector(recovered))})`),
      Boolean,
      'watch resumes after folder permission recovery',
    );
    await snapshot('desktop-native-folder-access-recovered.png');
  } finally {
    await chmod(restricted, 0o700);
    await paletteCommand('Parent folder');
    await trashTemporary(restricted);
  }
  await verifyBackgroundApp();
  assert.deepEqual(exceptions, []);
  console.log(
    'Store reader strategy verified on the ordinary runtime: real thread-backed SQLite/indexing, recursive sizes, PDF/EPUB extraction, OCR over stdin, reviewed actions/Undo, and permission-error UI. Apple security-scoped bookmarks still require the signed MAS development runtime.',
  );
}

async function verifyPreviewOwnership(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const before = await inventory();
  const folderPath = path.join(fixture.files, 'Images');
  const image = path.join(folderPath, 'Color.png');
  const base = original.workspaces[0].panes.find((pane) => pane.type === 'folder')!;
  const seeded = structuredClone(original);
  seeded.workspaces[0] = {
    ...seeded.workspaces[0],
    roots: ['qa-root-one', 'qa-root-two'],
    activePane: 'qa-root-one',
    arrangement: {},
    panes: ['qa-root-one', 'qa-root-two'].map((id) => ({
      ...base,
      id,
      path: folderPath,
      history: [folderPath],
      historyIndex: 0,
    })),
  };
  await evaluate(`window.viewer.save(${JSON.stringify(seeded)})`);
  await reloadPage();
  await restoredEngine(2);
  const face = async (id: string) => {
    await evaluate(
      `(() => { const info = window.__qaEngine.inspect().planes.find(plane=>plane.route.endsWith('/'+${JSON.stringify(id)})); window.__qaEngine.tree.open(info.planeID); window.__qaEngine.camera.frame({planeID:info.planeID},{animate:false}); })()`,
    );
    await settleCamera();
    await until(
      () => evaluate<boolean>(`!!document.querySelector('[data-viewer-plane="${id}"]')`),
      Boolean,
      'root available after culling',
    );
    await evaluate(
      `document.querySelector('[data-viewer-plane="${id}"]').closest('[data-plurid-plane]').dataset.qaOwner=${JSON.stringify(id)}`,
    );
  };
  const readTree = () =>
    evaluate<{ id: string; children: string[] }[]>(
      `window.__qaEngine.tree.get().map(plane=>({id:plane.routeDivisions.plane.parameters.id||plane.routeDivisions.path.parameters.id,children:(plane.children||[]).map(child=>child.routeDivisions.plane.parameters.id||child.routeDivisions.path.parameters.id)}))`,
    );
  for (const id of ['qa-root-one', 'qa-root-two']) {
    await face(id);
    await click(`[data-qa-owner="${id}"] ${fileSelector(image)}`, 2);
    await until(
      readTree,
      (tree) => tree.find((root) => root.id === id)?.children.length === 1,
      `${id} owns its preview`,
    );
    await delay(1200);
    await settleCamera();
  }
  const owned = await readTree();
  assert.notEqual(owned[0].children[0], owned[1].children[0]);
  await face('qa-root-two');
  await click(`[data-qa-owner="qa-root-two"] ${fileSelector(image)}`, 2);
  await delay(650);
  assert.deepEqual(await readTree(), owned, 'reopening a file stays inside its own root');
  await delay(800);
  const identities = await enginePlaneIDs();
  await reloadPage();
  await restoredEngine(4);
  assert.equal(await enginePlaneIDs(), identities);
  assert.deepEqual(await readTree(), owned, 'root ownership survives saved-layout reopening');
  assert.deepEqual(await inventory(), before);
  await evaluate(`window.viewer.save(${JSON.stringify(original)})`);
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  console.log(
    'Preview ownership: independent same-file children in two roots, same-root reuse and exact restoration without duplicates.',
  );
}
async function verifyRootPlanes(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const untouched = await inventory();
  await until(
    () => evaluate<{ running: boolean; count: number }>('window.viewer.indexStatus()'),
    (status) => !status.running && status.count > 10,
    'packaged SQLite utility index',
  );
  assert.equal(
    await evaluate(
      `window.viewer.indexedQuery({ query: 'Book ext:epub', root: ${JSON.stringify(fixture.files)} }).then(result => result.entries.length)`,
    ),
    1,
  );
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
async function verifyEntryAndPalette(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const settings = await evaluate<{
    revision: number;
    settings: {
      browsing: {
        newPlaneLocation: string;
        newPlanePath: string;
        emptyWorkspaceLocation: string;
        emptyWorkspacePath: string;
      };
    };
  }>('window.viewer.settingsGet()');
  await evaluate('window.viewer.openSettings()');
  await openSettingsProbe();
  await until(
    () =>
      settingsEvaluate<boolean>(
        `Array.from(document.querySelectorAll('.settings-navigation button')).some(button => button.textContent.trim() === 'Browsing')`,
      ),
    Boolean,
    'Settings categories ready',
  );
  await settingsEvaluate(
    `Array.from(document.querySelectorAll('.settings-navigation button')).find(button => button.textContent.trim() === 'Browsing').click()`,
  );
  await until(
    () =>
      settingsEvaluate<boolean>(
        `!!document.querySelector('[aria-label="New folder planes start in"]')`,
      ),
    Boolean,
    'new-plane folder preference',
  );
  // a choice is a searchable menu (2026-10-23): open it, then choose the row
  await settingsEvaluate(
    `document.querySelector('[aria-label="New folder planes start in"]').click()`,
  );
  await until(
    () =>
      settingsEvaluate<boolean>(`!!document.querySelector('.command-result[title="Downloads"]')`),
    Boolean,
    'new-plane folder choices',
  );
  await settingsEvaluate(`document.querySelector('.command-result[title="Downloads"]').click()`);
  await until(
    () =>
      evaluate<{ settings: { browsing: { newPlaneLocation: string } } }>(
        'window.viewer.settingsGet()',
      ),
    (snapshot) => snapshot.settings.browsing.newPlaneLocation === 'downloads',
    'folder preference propagated from Settings',
  );
  await evaluate(`window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([
    {path:'settings.browsing.newPlaneLocation',value:'custom'},
    {path:'settings.browsing.newPlanePath',value:${JSON.stringify(fixture.files)}},
    {path:'settings.browsing.emptyWorkspaceLocation',value:'custom'},
    {path:'settings.browsing.emptyWorkspacePath',value:${JSON.stringify(path.join(fixture.files, 'Data'))}}
  ],snapshot.revision))`);
  await until(
    () => settingsEvaluate<string>('document.body.innerText'),
    (body) => body.includes(fixture.files) && body.includes('Change folder…'),
    'custom starting folder in Settings',
  );
  await snapshot('desktop-native-new-plane-settings.png');
  await click('dialog [aria-label="Close"]');
  const empty = structuredClone(original);
  empty.workspaces[0].panes = [];
  empty.workspaces[0].roots = [];
  empty.workspaces[0].activePane = undefined;
  empty.workspaces[0].arrangement = {};
  await evaluate(`window.viewer.save(${JSON.stringify(empty)})`);
  await command('Page.reload');
  await until(
    () =>
      evaluate<boolean>(
        'document.readyState === "complete" && !!document.querySelector(".empty-actions .primary:not(:disabled)")',
      ),
    Boolean,
    'empty workspace can create a root directly',
  );
  await snapshot('desktop-native-empty-workspace.png');
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="New folder planes start in"]')`),
    null,
    'The starting-folder preference belongs only in Settings',
  );
  await click('.empty-actions .primary');
  await restoredEngine(1);
  await settleCamera();
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (value) =>
      value.workspaces[0].panes.length === 1 &&
      value.workspaces[0].panes[0].path === path.join(fixture.files, 'Data'),
    'empty-state root uses its separate configured folder',
  );
  await click('[aria-label="New folder plane (⌘N)"]');
  await restoredEngine(2);
  await key('n', 'KeyN', 4);
  await restoredEngine(3);
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (value) =>
      value.workspaces[0].panes.length === 3 &&
      value.workspaces[0].panes[0].path === path.join(fixture.files, 'Data') &&
      value.workspaces[0].panes.slice(1).every((pane) => pane.path === fixture.files),
    'plus and Command-N use the populated-workspace preference',
  );
  await evaluate(`window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([
    {path:'settings.browsing.newPlaneLocation',value:${JSON.stringify(settings.settings.browsing.newPlaneLocation)}},
    {path:'settings.browsing.newPlanePath',value:${JSON.stringify(settings.settings.browsing.newPlanePath)}},
    {path:'settings.browsing.emptyWorkspaceLocation',value:${JSON.stringify(settings.settings.browsing.emptyWorkspaceLocation)}},
    {path:'settings.browsing.emptyWorkspacePath',value:${JSON.stringify(settings.settings.browsing.emptyWorkspacePath)}}
  ],snapshot.revision))`);
  await delay(800);
  await evaluate(`window.viewer.save(${JSON.stringify(original)})`);
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  await key('k', 'KeyK', 4);
  await until(
    () => evaluate<boolean>('!!document.querySelector(".command-palette[open]")'),
    Boolean,
    'anchored command palette',
  );
  const bounds = () =>
    evaluate<{
      top: number;
      left: number;
      width: number;
      height: number;
      bottom: number;
      inputTop: number;
      viewport: number;
    }>(
      `(() => { const dialog=document.querySelector('.command-palette');const r=dialog.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height,bottom:r.bottom,inputTop:dialog.querySelector('input').getBoundingClientRect().top,viewport:innerHeight}; })()`,
    );
  const expanded = await bounds();
  await snapshot('desktop-native-palette-expanded.png');
  await command('Input.insertText', { text: 'no-such-command-qa' });
  await until(
    () => text(),
    (body) => body.includes('No matching actions'),
    'empty command search',
  );
  const compact = await bounds();
  assert.ok(expanded.height > compact.height + 100);
  assert.equal(compact.top, expanded.top);
  assert.equal(compact.inputTop, expanded.inputTop);
  assert.equal(compact.left, expanded.left);
  assert.equal(compact.width, expanded.width);
  assert.ok(compact.top < compact.viewport / 3);
  await snapshot('desktop-native-palette-empty.png');
  await key('a', 'KeyA', 4, ['selectAll']);
  await key('Backspace', 'Backspace');
  await until(
    () => bounds(),
    (value) => value.height > compact.height + 100,
    'palette expands downward',
  );
  assert.equal((await bounds()).top, expanded.top);
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const narrow = await bounds();
  assert.ok(narrow.bottom <= narrow.viewport - 19, JSON.stringify(narrow));
  await key('Escape', 'Escape');
  await key('f', 'KeyF', 4);
  await until(
    () =>
      evaluate<number>(
        `document.querySelectorAll('.command-palette[open] .command-result').length`,
      ),
    (count) => count === 11,
    'file palette has enough results to scroll',
  );
  const finder = await bounds();
  assert.equal(finder.top, narrow.top);
  assert.ok(finder.bottom <= finder.viewport - 19, JSON.stringify(finder));
  assert.ok(
    await evaluate<boolean>(
      `(() => { const list=document.querySelector('.command-palette .command-results');return list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto'; })()`,
    ),
  );
  await snapshot('desktop-native-palette-small-window.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await key('Escape', 'Escape');
  console.log(
    'Workspace entry: direct root creation, starting-folder Settings, and palettes with a fixed search position and bounded scrolling.',
  );
}
async function verifyShutdown(): Promise<void> {
  // Stall only this isolated QA instance's read-only worker. A slow filesystem
  // or extraction must not leave an interactive window without its IPC bridge.
  await evaluate('window.viewer.openSettings()');
  await openSettingsProbe();
  settingsMode = false;
  const { stdout } = await execNative('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
  const worker = stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .find(
      (match) =>
        match &&
        Number(match[2]) === child.pid &&
        match[3].includes('--utility-sub-type=node.mojom.NodeService'),
    );
  assert.ok(worker, 'The owned file-services worker must be running');
  pausedWorker = Number(worker[1]);
  process.kill(pausedWorker, 'SIGSTOP');
  void command('Browser.close').catch(() => undefined);
  await delay(500);
  if (child.exitCode === null && socket?.readyState === WebSocket.OPEN) {
    const reply = await evaluate<string>(
      `window.viewer.jobs().then(() => 'available', error => error.message)`,
    ).catch(() => 'Window closed');
    assert.ok(!reply.includes('No handler registered'), reply);
  }
  await until(
    async () => child.exitCode,
    (code) => code === 0,
    'quit with an unresponsive file-services worker',
    8000,
  );
  assert.deepEqual(exceptions, []);
  console.log('Shutdown: the owned stalled worker cannot strand a window without its IPC bridge.');
}
async function verify(): Promise<void> {
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
  await until(
    () =>
      evaluate<boolean>(
        'document.readyState === "complete" && !!document.querySelector(".folder-explorer")',
      ),
    Boolean,
    'initial renderer before diagnostic reload',
  );
  // Count production React commits only in this disposable diagnostic renderer.
  await command('Page.addScriptToEvaluateOnNewDocument', {
    source: reactCommitProbe,
  });
  await reloadPage();
  // The user's other windows can legitimately take native focus during this
  // isolated run. Keep browser focus deterministic without activating their app.
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await activateTestWindow();
  if (foreground)
    await until(
      () => evaluate<string>('document.visibilityState'),
      (value) => value === 'visible',
      'visible native window',
    );
  await verifyBackgroundApp();
  console.log(
    foreground
      ? 'Native QA: foreground profiling.'
      : 'Native QA: hidden background windows; native focus unchanged.',
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
  await until(
    () => evaluate<{ running: boolean; count: number }>('window.viewer.indexStatus()'),
    (status) => !status.running && status.count > 10,
    'packaged SQLite utility index',
  );
  assert.equal(
    await evaluate(
      `window.viewer.indexedQuery({ query: 'Book ext:epub', root: ${JSON.stringify(fixture.files)} }).then(result => result.entries.length)`,
    ),
    1,
  );
  await captureEngine();
  if (process.env.VIEWER_TEST_SCENARIO === 'daily-file-work') {
    await verifyDailyFileWork();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'model-lighting') {
    await verifyModelLighting();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'refinements') {
    await verifyRefinements();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'drawings-workspaces') {
    await verifyDrawingsAndWorkspaces();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'menus-models') {
    await verifyGroupedMenuAndModels();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'foundations') {
    await verifyFoundations();
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'store-file-services') {
    await verifyStoreFileServices();
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'file-workflows') {
    await verifyColumnWorkflows();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'chrome') {
    await verifyConfiguredChrome();
    await verifyListAlignment();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'shutdown') {
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    await verifyShutdown();
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'alignment') {
    await verifyListAlignment();
    await verifyPreviewFooter();
    await verifySettingsScroll();
    await verifyBackgroundApp();
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'size') {
    await verifyIndependentSizeCalculation();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'entry') {
    await verifyEntryAndPalette();
    await verifyAnchoredPreviews();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'published-plane-input') {
    await verifyPublishedPlaneInput();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'text-editing') {
    await verifyTextEditing();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (process.env.VIEWER_TEST_SCENARIO === 'spatial') {
    await verifySpatialTools();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    console.log('Packaged spatial tools verified in isolation.');
    return;
  }
  await verifyListAlignment();
  await verifyPreviewFooter();
  await verifySettingsScroll();
  await verifyIndependentSizeCalculation();
  await verifyEntryAndPalette();
  await verifySelectionReliability();
  if (foreground) await profileNativeInteractions();
  await verifyAnchoredPreviews();
  await verifyServiceWorkflows();
  await verifyPreviewOwnership();
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
  await verifySpatialTools();

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
  await openSettingsProbe();
  await tab('Browsing');
  await until(text, (value) => value.includes('Appearance'), 'Settings from keyboard');
  const dimensions = [];
  for (const category of ['Appearance', 'Sidebar', 'Space']) {
    await tab(category);
    dimensions.push(await settingsEvaluate('([innerWidth, innerHeight])'));
  }
  assert.deepEqual(dimensions, [dimensions[0], dimensions[0], dimensions[0]]);
  assert.ok((dimensions[0] as number[])[0] >= 760);
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
    async () =>
      parse(await readFile(path.join(profile, 'config.jsonc'), 'utf8')) as {
        ui: NonNullable<SavedState['ui']>;
      },
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
  await setting('Drag planes by their title', false);
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
  await choose('Search scope', 'subfolders');
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
  await preview(path.join(fixture.files, 'Documents', 'Book.epub'), 'A local chapter fixture.');
  assert.equal(await evaluate('window.__epubUnsafe === undefined'), true);
  await snapshot('epub-native.png');
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
  await preview(path.join(fixture.files, 'Media', 'Malformed.mkv'), 'Media could not be played');
  assert.equal(
    await evaluate('!!document.querySelector(".quick-preview .native-open-actions")'),
    true,
  );
  await snapshot('desktop-native-media-error.png');
  await evaluate(
    `Array.from(document.querySelectorAll('.quick-preview button')).find(button=>button.textContent.trim()==='Retry').click()`,
  );
  await until(text, (value) => value.includes('Media could not be played'), 'media retry recovery');
  await closePreview();
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
  await paletteCommand('Open in another plane');
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
  await verifyBackgroundApp();
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
}
try {
  await verify();
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
  if (pausedWorker) {
    try {
      process.kill(pausedWorker, 'SIGCONT');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  settingsSocket?.close();
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await trashTemporary(fixture.root);
}
