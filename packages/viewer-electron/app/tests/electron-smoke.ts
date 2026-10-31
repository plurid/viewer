/** Runs the actual packaged macOS application against disposable synthetic files. */
import type { FolderSizeTask } from '../src/domain/files/metadata';
import type { SettingsPatch } from '../src/domain/services';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { PageExpression } from './native/runtime/page-function';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { repeatedPreviewFixture } from './workspace-fixtures';
import { formatBytes } from '../src/domain/files/entries';
import { tileTree } from '../src/domain/workspaces/tiling';
import { uiPreferencesVersion } from '../src/domain/preferences/ui';
import { reactCommitProbe } from './react-commits';
import type { OperationJob, RendererOperationRequest, SavedState } from '../src/domain/contracts';
import { trashTemporary } from '../tools/temporary';
import { prepareOwnedApplication } from './native/runtime/owned-application';
import { restoreClipboard } from './native/runtime/clipboard';
import {
  createScenarioFixtures,
  longFilename,
  scenarioSettings,
} from './native/fixtures/scenarios';
import { assertPerformanceMode, profileNativeInteractions } from './native/scenarios/performance';
import { verifyMilestones } from './native/scenarios/milestones';
import { pageCall } from './native/runtime/page-function';
import {
  animationFrames,
  buttonState,
  click as clickElement,
  countOf,
  exists,
  focus,
  patchSettings,
  pressButton,
  textOf,
  valueOf,
} from './native/runtime/page';

/**
 * What the smoke leaves on the page: the engine ref from `captureEngine`, and the probes each step
 * installs before it reads them.
 */
interface SmokeWindow {
  __qaEngine: PluridApplicationHandle;
  __qaReloadPending?: boolean;
  __qaSizes: FolderSizeTask[];
  __qaSizeOff: () => void;
  __qaFileTableType?: unknown;
  __qaFileTableCommits: number;
  __qaDrawingLabels: { value: string; x: number; y: number; width: number }[];
  __qaDrawingRestore: () => void;
  __qaMedia: HTMLMediaElement | null;
  /** Set only if an EPUB's own script ran. */
  __epubUnsafe?: unknown;
}

/** The text of the first match; refuses a missing element. */
const requiredText = (selector: string) =>
  pageCall((selector: string) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error('Nothing matches: ' + selector);
    return element.textContent;
  }, selector);

/** The value of the first matching field; refuses a missing element. */
const requiredValue = (selector: string) =>
  pageCall((selector: string) => {
    const field = document.querySelector<HTMLInputElement>(selector);
    if (!field) throw new Error('Nothing matches: ' + selector);
    return field.value;
  }, selector);

/** An attribute of the first match, null without it; refuses a missing element. */
const requiredAttribute = (selector: string, name: string) =>
  pageCall(
    (selector: string, name: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Nothing matches: ' + selector);
      return element.getAttribute(name);
    },
    selector,
    name,
  );

const bodyText = () => document.body.innerText;
const openSettings = () => window.viewer.openSettings();
const viewerJobs = () => window.viewer.jobs();
const activeLabel = () => document.activeElement?.getAttribute('aria-label') ?? '';
const searchingCommands = () =>
  document.activeElement?.getAttribute('aria-label') === 'Search commands';
const searchingActions = () =>
  document.activeElement?.getAttribute('aria-label') === 'Search actions';
/** The engine camera as JSON, to compare positions. */
const cameraJSON = () => JSON.stringify((window as unknown as SmokeWindow).__qaEngine.camera.get());
const firstLocationJSON = () =>
  JSON.stringify((window as unknown as SmokeWindow).__qaEngine.tree.get()[0].location);
const planeCount = () => (window as unknown as SmokeWindow).__qaEngine.tree.get().length;
const dockedPlane = () => (window as unknown as SmokeWindow).__qaEngine.camera.docked();
function dockFirstPlane() {
  const engine = (window as unknown as SmokeWindow).__qaEngine;
  engine.camera.dock(engine.tree.get()[0].planeID, { animate: false });
}
function frameFirstPlane() {
  const engine = (window as unknown as SmokeWindow).__qaEngine;
  engine.camera.frame({ planeID: engine.tree.get()[0].planeID }, { animate: false });
}
const inspectedPlaneCount = () =>
  (window as unknown as SmokeWindow).__qaEngine.inspect().planes.length;
const pageLook = () => document.documentElement.dataset.look;
const saveState = (state: SavedState) => window.viewer.save(state);

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Routine functional checks never show or activate the test app. Physical
// compositor profiling requires a separately requested foreground run.
const foreground = process.env.VIEWER_TEST_FOREGROUND === '1';
const scenario = process.env.VIEWER_TEST_SCENARIO;
// With VIEWER_TEST_NO_REMOVAL=1 the packaged app refuses every Trash move (AGENTS.md), including
// the replaced version a save keeps for Undo: scenarios check the refusal and that files stay.
const removalBlocked = process.env.VIEWER_TEST_NO_REMOVAL === '1';
assertPerformanceMode(scenario, foreground);
const execNative = promisify(execFile);
const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.join(appRoot, `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`);
const fixture = await createScenarioFixtures({
  scenario,
  stepFile: process.env.VIEWER_TEST_STEP_FILE,
  dxfFile: process.env.VIEWER_TEST_DXF_FILE,
});
const profile = path.join(fixture.root, 'profile');
const owned = await prepareOwnedApplication({
  binary,
  profile,
  mode: foreground ? 'foreground' : 'hidden',
  label: 'electron-smoke',
  evidenceRoot: path.join(appRoot, 'out/native-evidence'),
  environment:
    scenario === 'store-file-services'
      ? { VIEWER_TEST_FILE_THREADS: '1' }
      : scenario === 'foundations'
        ? { SHELL: '/bin/sh' }
        : undefined,
});
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(stateFile, JSON.stringify(fixture.state));
await writeFile(
  path.join(profile, 'settings-v1.json'),
  JSON.stringify(scenarioSettings(fixture, scenario)),
);
const captureRoot = path.join(owned.evidenceDirectory, 'screenshots');
await mkdir(captureRoot, { recursive: true });
const launched = await owned.launch();
const { child, port } = launched;
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
        `Viewer exited unexpectedly (${child.exitCode ?? child.signalCode}): ${launched.output().slice(-3000)}`,
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
function evaluate<R>(expression: PageExpression<R>): Promise<Awaited<R>>;
async function evaluate(expression: string): Promise<unknown> {
  const value = await command<{
    result: { value: unknown };
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
function settingsEvaluate<R>(expression: PageExpression<R>): Promise<Awaited<R>>;
async function settingsEvaluate(expression: string): Promise<unknown> {
  const result = await settingsCommand<{ result: { value: unknown }; exceptionDetails?: unknown }>(
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
async function patchInSettings(...patches: SettingsPatch[]): Promise<void> {
  await evaluate(pageCall(openSettings));
  await until(
    () => settingsEvaluate(exists('.settings-window')),
    Boolean,
    'native Settings for a setting changed there',
  );
  await settingsEvaluate(patchSettings(...patches));
}
async function openSettingsProbe() {
  settingsMode = true;
  await until(
    () => settingsEvaluate(exists('.settings-window')),
    Boolean,
    'loaded native Settings',
  );
}
const text = () =>
  settingsMode ? settingsEvaluate(pageCall(bodyText)) : evaluate(pageCall(bodyText));
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
/** A new document replaced the one `reloadPage` marked, and it shows planes. */
function reloaded() {
  return (
    !(window as unknown as SmokeWindow).__qaReloadPending &&
    document.readyState === 'complete' &&
    !!document.querySelector('[data-plurid-plane]')
  );
}
async function reloadPage(): Promise<void> {
  await evaluate(
    pageCall(() => {
      (window as unknown as SmokeWindow).__qaReloadPending = true;
    }),
  );
  await command('Page.reload');
  await until(() => evaluate(pageCall(reloaded)), Boolean, 'new document after reload');
  await activateTestWindow();
}
/** The centre of the first match and whether a pointer there reaches it; refuses a missing one. */
function hitPoint(selector: string) {
  const element = document.querySelector(selector);
  if (!element) throw new Error('Missing control: ' + selector);
  const rect = element.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const target = document.elementFromPoint(x, y);
  return { x, y, hit: element.contains(target), target: target?.outerHTML.slice(0, 1000) };
}
async function click(selector: string, count = 1, modifiers = 0): Promise<void> {
  if (settingsMode && selector === 'dialog [aria-label="Close"]') {
    // Closing destroys this CDP target before it necessarily acknowledges the
    // evaluation. Observe the actual close rather than awaiting that reply.
    void settingsEvaluate(pageCall(() => window.close())).catch(() => undefined);
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
      pageCall(
        (selector: string) =>
          document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
        selector,
      ),
    );
    await evaluate(animationFrames(1));
  }
  const point = await evaluate(pageCall(hitPoint, selector));
  assert.equal(
    point.hit,
    true,
    `Control must be hit-testable: ${selector} at ${point.x}, ${point.y}; hit ${point.target}`,
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
const choiceButton = (label: string) => `button[aria-label=${JSON.stringify(label)}]`;
/** Page code in the workspace window (`evaluate`) or in Settings (`settingsEvaluate`). */
type PageRunner = typeof evaluate;
/** Chooses in a choice menu as a person does: its button, then the value's row. */
async function choose(label: string, value: string, run: PageRunner = evaluate): Promise<void> {
  const row = `.choice-menu [data-menu-id=${JSON.stringify('choice:' + value)}]`;
  await run(clickElement(choiceButton(label)));
  await until(() => run(exists(row)), Boolean, `${label} menu`);
  await run(clickElement(row));
}
const choiceMenuValues = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.choice-menu [data-menu-id]'), (row) =>
    row.dataset.menuId!.slice('choice:'.length),
  );
/** The values a choice menu offers, read from it open; it is closed again. */
async function choiceValues(label: string, run: PageRunner = evaluate): Promise<string[]> {
  await run(clickElement(choiceButton(label)));
  const values = await until(
    () => run(pageCall(choiceMenuValues)),
    (values) => values.length > 0,
    `${label} menu`,
  );
  await run(clickElement(choiceButton(label)));
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
const settingsRevision = () => window.viewer.settingsGet().then((value) => value.revision);
/** Clicks the input of the Settings row labelled `label`. */
function toggleSetting(label: string) {
  const row = Array.from(document.querySelectorAll('.settings-row')).find(
    (row) => row.querySelector('span')?.firstChild?.textContent?.trim() === label,
  );
  const input = row?.querySelector('input');
  if (!input) throw new Error('Missing setting');
  input.click();
}
async function setting(label: string, wait = true): Promise<void> {
  const revision = await settingsEvaluate(pageCall(settingsRevision));
  await settingsEvaluate(pageCall(toggleSetting, label));
  if (wait)
    await until(
      () => evaluate(pageCall(settingsRevision)),
      (value) => value > revision,
      `live setting ${label}`,
    );
}
/** Whether Settings lists the category `label`; with `press`, opens it and throws when missing. */
function categoryButton(label: string, press: boolean) {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.settings-navigation button'),
  ).find((button) => button.textContent.trim() === label);
  if (press) button!.click();
  return !!button;
}
async function tab(label: string): Promise<void> {
  if (!settingsMode) await evaluate(pageCall(openSettings));
  await openSettingsProbe();
  const category =
    ({ Appearance: 'Browsing', Sidebar: 'Navigation' } as Record<string, string>)[label] || label;
  await until(
    () => settingsEvaluate(pageCall(categoryButton, category, false)),
    Boolean,
    `Settings category ${category}`,
  );
  await settingsEvaluate(pageCall(categoryButton, category, true));
}
/** A React hook state; a ref holding the engine has `camera.frame` and `tree.get`. */
interface Hook {
  memoizedState: { current?: { camera?: { frame?: unknown }; tree?: { get?: unknown } } } | null;
  next: Hook | null;
}
interface Fiber {
  memoizedState: Hook | null;
  return: Fiber | null;
}
/** Leaves the engine ref found through React's fiber on the page as `window.__qaEngine`. */
function findEngine(): boolean {
  const element = document.querySelector('[data-viewer-plane]')!;
  const key = Object.keys(element).find((key) => key.startsWith('__reactFiber'))!;
  for (
    let fiber = (element as unknown as Record<string, Fiber | null>)[key] ?? null;
    fiber;
    fiber = fiber.return
  ) {
    for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const api = hook.memoizedState?.current;
      if (api?.camera?.frame && api?.tree?.get) {
        (window as unknown as SmokeWindow).__qaEngine = api as PluridApplicationHandle;
        return true;
      }
    }
  }
  return false;
}
/** Read the public application ref from React's test-only fiber; never expose it in production. */
async function captureEngine(): Promise<void> {
  assert.equal(await evaluate(pageCall(findEngine)), true);
}
/** Collects folder-size tasks in `window.__qaSizes` until `window.__qaSizeOff()`. */
function collectFolderSizes() {
  const page = window as unknown as SmokeWindow;
  page.__qaSizes = [];
  page.__qaSizeOff = window.viewer.onEvent((event) => {
    if (event.type === 'folder-size') page.__qaSizes.push(event.task);
  });
}
const columnPreviewPath = () =>
  document.querySelector<HTMLElement>('.column-preview')?.dataset.previewPath || '';
/** The Quick Preview image's size beside its stage's. */
function quickPreviewImageFit() {
  const image = document
      .querySelector('.quick-preview-dialog .image-stage img')!
      .getBoundingClientRect(),
    stage = document.querySelector('.quick-preview-dialog .image-stage')!.getBoundingClientRect();
  return {
    imageWidth: image.width,
    imageHeight: image.height,
    stageWidth: stage.width,
    stageHeight: stage.height,
  };
}
function quickPreviewSize() {
  const rect = document.querySelector('.quick-preview-dialog')!.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  };
}
function secondPlaneSize() {
  const id = (window as unknown as SmokeWindow).__qaEngine.tree.get()[1].planeID;
  const rect = document
    .querySelector('[data-plurid-plane=' + JSON.stringify(id) + ']')!
    .getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  };
}
async function verifyDailyFileWork(): Promise<void> {
  const note = path.join(fixture.files, 'README.md');
  const models = path.join(fixture.files, 'Models');
  const content = await readFile(note);
  await evaluate(focus('.folder-explorer'));
  await key('Shift', 'ShiftLeft', 12);
  await key('Meta', 'MetaLeft', 12);
  assert.equal(
    await evaluate(exists('dialog[open]')),
    false,
    'Command + Shift alone must not create a folder',
  );
  await key('n', 'KeyN', 4);
  await until(
    () =>
      evaluate(
        pageCall(
          () => document.querySelector('dialog[open]')?.getAttribute('aria-label') === 'New folder',
        ),
      ),
    Boolean,
    'actual New Folder binding',
  );
  await key('Escape', 'Escape');

  const trashJobs = () => evaluate(pageCall(viewerJobs));
  const trashNote = async (confirm: boolean) => {
    const prior = new Set((await trashJobs()).map((job) => job.id));
    await click(fileSelector(note));
    await key('Backspace', 'Backspace', 4);
    if (confirm) {
      await until(() => evaluate(exists('.trash-dialog[open]')), Boolean, 'Trash confirmation');
      assert.deepEqual(
        await evaluate(
          pageCall(() =>
            Array.from(document.querySelectorAll('.trash-dialog kbd'), (key) => key.textContent),
          ),
        ),
        ['Esc', 'Enter'],
      );
      assert.equal(await evaluate(pageCall(activeLabel)), 'Move to Trash');
      await snapshot('desktop-native-trash-keyboard.png');
      await key('Enter', 'Enter');
    } else assert.equal(await evaluate(exists('.trash-dialog')), false);
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
    if (removalBlocked) {
      assert.equal(job.status, 'failed');
      assert.match(job.errors[0]?.message ?? '', /^Automated native tests cannot move /);
      assert.ok((await readFile(note)).equals(content), 'A refused Trash move keeps the file');
      return;
    }
    assert.equal(job.status, 'completed', JSON.stringify(job.errors));
    await assert.rejects(lstat(note), { code: 'ENOENT' });
    await evaluate(pageCall((id: string) => window.viewer.undo(id), job.id));
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
    await until(() => evaluate(exists(fileSelector(note))), Boolean, 'restored file row');
  };
  await click(fileSelector(note));
  await key('Backspace', 'Backspace', 4);
  await until(() => evaluate(exists('.trash-dialog[open]')), Boolean, 'cancelable Trash dialog');
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
  await evaluate(pageCall(collectFolderSizes));
  await paletteCommand('Calculate Size');
  const measured = await until(
    () => evaluate(pageCall(folderSizes)),
    (tasks) => tasks.some((task) => task.status === 'completed'),
    'folder size',
  ).then((tasks) => tasks.find((task) => task.status === 'completed')!);
  await until(
    () =>
      evaluate(
        pageCall(
          (row: string) =>
            document.querySelector(row)?.querySelector('[data-column="size"]')?.textContent || '',
          fileSelector(models),
        ),
      ),
    (value) => value === formatBytes(measured.bytes),
    'folder size in Size column',
  );
  await click(fileSelector(note), 1, 4);
  const noteEntry = await evaluate(pageCall((file: string) => window.viewer.stat(file), note));
  await until(
    () => evaluate(requiredText('.folder-status .selection-size')),
    (value) => value === formatBytes(measured.bytes + noteEntry.size),
    'mixed-selection measured total',
  );
  await snapshot('desktop-native-measured-selection.png');
  await evaluate(pageCall(() => (window as unknown as SmokeWindow).__qaSizeOff()));

  await paletteCommand('Columns view');
  await click(fileSelector(note));
  await until(
    () => evaluate(pageCall(columnPreviewPath)),
    (value) => value === note,
    'root-column inline preview',
  );
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.querySelector<HTMLElement>('.column-preview .preview-host')?.dataset
              .previewModule || '',
        ),
      ),
    (value) => value === 'text',
    'inline Markdown renderer',
  );
  await snapshot('desktop-native-column-preview.png');
  await click(fileSelector(models));
  assert.equal(
    await evaluate(exists('.column-preview')),
    false,
    'Selecting a folder removes the old preview',
  );
  const children = await evaluate(pageCall((folder: string) => window.viewer.list(folder), models));
  const child = children.entries.find((file) => !file.directory && file.path.endsWith('.obj'))!;
  await until(() => evaluate(exists(fileSelector(child.path))), Boolean, 'child column');
  await click(fileSelector(child.path));
  await until(
    () => evaluate(pageCall(columnPreviewPath)),
    (value) => value === child.path,
    'nested-column inline preview',
  );
  await until(() => evaluate(exists('.column-preview canvas')), Boolean, 'nested 3D model preview');
  await snapshot('desktop-native-column-model.png');

  await evaluate(pageCall(dockFirstPlane));
  await settleCamera();
  const docked = await evaluate(pageCall(dockedPlane));
  await click(
    `.location-sidebar button[title=${JSON.stringify(path.join(fixture.files, 'Documents'))}]`,
  );
  await until(
    () =>
      evaluate(
        pageCall(
          () => document.querySelector('.folder-explorer')?.getAttribute('aria-label') || '',
        ),
      ),
    (value) => value === 'Folder ' + path.join(fixture.files, 'Documents'),
    'sidebar folder navigation',
  );
  await settleCamera();
  assert.equal(
    await evaluate(pageCall(dockedPlane)),
    docked,
    'Sidebar navigation must retain docking',
  );
  await key('ArrowUp', 'ArrowUp', 4);
  await until(() => evaluate(exists(fileSelector(note))), Boolean, 'return to fixture parent');
  await settleCamera();
  assert.equal(await evaluate(pageCall(dockedPlane)), docked);

  await command('Emulation.setDeviceMetricsOverride', {
    width: 2560,
    height: 1440,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const wideImage = path.join(fixture.files, 'Images', 'Wide.png');
  await click(fileSelector(path.join(fixture.files, 'Images')));
  await until(
    () => evaluate(exists(fileSelector(wideImage))),
    Boolean,
    'generated large image column',
  );
  await click(fileSelector(wideImage));
  await key(' ', 'Space');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.querySelector<HTMLImageElement>('.quick-preview-dialog .image-stage img')
              ?.naturalWidth === 2048,
        ),
      ),
    Boolean,
    'large image decode',
  );
  const imageFit = await evaluate(pageCall(quickPreviewImageFit));
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
    () => evaluate(exists('.quick-preview-dialog[open]')),
    Boolean,
    'large-display Quick Preview',
  );
  const bounds = await evaluate(pageCall(quickPreviewSize));
  assert.ok(
    bounds.width / bounds.viewportWidth >= 0.85 && bounds.height / bounds.viewportHeight >= 0.83,
    JSON.stringify(bounds),
  );
  await snapshot('desktop-native-large-quick-preview.png');
  await key('Escape', 'Escape');
  await key('N', 'KeyN', 12);
  await until(
    () => evaluate(pageCall(planeCount)),
    (count) => count === 2,
    'large-display new plane',
  );
  await settleCamera();
  const newPlane = await evaluate(pageCall(secondPlaneSize));
  assert.ok(
    newPlane.width / newPlane.viewportWidth >= 0.75 &&
      newPlane.height / newPlane.viewportHeight >= 0.75,
    'New plane must use the large display: ' + JSON.stringify(newPlane),
  );
  await snapshot('desktop-native-large-plane.png');
  await paletteCommand('Close plane');
  await until(
    () => evaluate(pageCall(planeCount)),
    (count) => count === 1,
    'closed generated root',
  );
  await evaluate(pageCall(dockFirstPlane));
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
    () => evaluate(exists('.quick-preview-dialog[open]')),
    Boolean,
    'small-display Quick Preview',
  );
  assert.equal(
    await evaluate(
      pageCall(() => {
        const rect = document.querySelector('.quick-preview-dialog')!.getBoundingClientRect();
        return (
          rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
        );
      }),
    ),
    true,
  );
  await snapshot('desktop-native-small-quick-preview.png');
  await key('Escape', 'Escape');
  await command('Emulation.clearDeviceMetricsOverride');
  console.log(
    'Daily file work: exact shortcut keys, Trash preference/Enter/Escape/' +
      (removalBlocked ? 'refusal in automated runs' : 'Undo') +
      ', shared folder sizes, inline column previews, retained docking and responsive Quick Preview.',
  );
}

/** The `data-file-path` of every match. */
const filePaths = (selector: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector), (row) => row.dataset.filePath!);
const folderSizes = () => (window as unknown as SmokeWindow).__qaSizes;
function stopFolderSizes() {
  const page = window as unknown as Partial<SmokeWindow>;
  page.__qaSizeOff!();
  delete page.__qaSizeOff;
  delete page.__qaSizes;
}
/** A point in the empty space below the folder rows. */
function blankFileSpace() {
  const rect = document.querySelector('.folder-explorer .file-scroll')!.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.bottom - 12 };
}
const focusOutline = () => getComputedStyle(document.activeElement!).outlineStyle;
async function verifySelectionReliability(): Promise<void> {
  const rows = await evaluate(pageCall(filePaths, '.folder-explorer [data-file-path]'));
  assert.ok(rows.length > 4);
  await click(fileSelector(rows[3]));
  await settleCamera();
  const camera = await evaluate(pageCall(cameraJSON));
  await key('ArrowUp', 'ArrowUp', 8);
  await key('ArrowUp', 'ArrowUp', 8);
  await evaluate(animationFrames(2));
  assert.deepEqual(
    await evaluate(pageCall(filePaths, '.folder-explorer [data-file-path][aria-selected=true]')),
    rows.slice(1, 4),
    'Repeated Shift+Up must extend from the moving cursor, not the end of the selected range',
  );
  assert.equal(
    await evaluate(pageCall(cameraJSON)),
    camera,
    'File selection must not rotate the spatial camera',
  );
  await key('ArrowDown', 'ArrowDown', 8);
  assert.equal(
    await evaluate(countOf('.folder-explorer [aria-selected=true]')),
    2,
    'Reversing direction shrinks the range',
  );
  const blank = await evaluate(pageCall(blankFileSpace));
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
    await evaluate(countOf('.folder-explorer [aria-selected=true]')),
    0,
    'Clicking empty file space clears the selection',
  );
  await click(fileSelector(path.join(fixture.files, 'Models')));
  assert.equal(
    await evaluate(
      pageCall(() => document.querySelector('.folder-status')!.textContent.includes('0 B')),
    ),
    false,
    'Unmeasured folders must never be reported as zero bytes',
  );
  await evaluate(pageCall(collectFolderSizes));
  await paletteCommand('Calculate Size');
  const measured = await until(
    () => evaluate(pageCall(folderSizes)),
    (tasks) => tasks.some((task) => task.status === 'completed'),
    'background folder measurement',
  ).then((tasks) => tasks.find((task) => task.status === 'completed')!);
  assert.ok(measured.bytes > 0 && measured.files > 0 && measured.folders === 1);
  await until(
    () => evaluate(requiredText('.selection-size')),
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
  await evaluate(pageCall(stopFolderSizes));
  await contextMenu(fileSelector(path.join(fixture.files, 'README.md')));
  await command('Input.insertText', { text: 'ow' });
  await key('Enter', 'Enter');
  await until(() => evaluate(exists('.open-with-dialog')), Boolean, 'contextual Open With');
  await until(
    () => evaluate(countOf('.application-option')),
    (value) => value > 0,
    'native compatible applications',
  );
  assert.equal(await evaluate(pageCall(activeLabel)), 'Search applications');
  assert.equal(await evaluate(pageCall(focusOutline)), 'none');
  await command('Input.insertText', { text: 'no such application xyz' });
  await until(
    () => evaluate(countOf('.application-option')),
    (value) => value === 0,
    'filtered application list',
  );
  assert.equal(
    await evaluate(
      pageCall(
        () =>
          document.querySelector<HTMLButtonElement>('.open-with-dialog [type=submit]')!.disabled,
      ),
    ),
    true,
  );
  await snapshot('desktop-native-open-with-empty.png');
  await key('a', 'KeyA', 4, ['selectAll']);
  await key('Backspace', 'Backspace');
  await until(
    () => evaluate(countOf('.application-option')),
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
  await until(() => evaluate(exists('.context-menu')), Boolean, 'background contextual actions');
  assert.equal(
    await evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.context-menu .command-result')).some((row) =>
          row.textContent.includes('Rename'),
        ),
      ),
    ),
    false,
  );
  await key('Escape', 'Escape');
  await key('Escape', 'Escape');
  console.log(
    'Reliability: range reversal, camera ownership, deselection, target-free background menus, measured folder sizes and native compatible-app search.',
  );
}

const terminalWrite = (id: string, data: string) => window.viewer.terminalWrite(id, data);
/** Writes once the plane's session has started: the plane shows its terminal first. False while
 * the session is still starting. */
const writeWhenStarted = (id: string, data: string) =>
  window.viewer.terminalWrite(id, data).then(
    () => true,
    (error: unknown) => {
      if (String(error).includes('Terminal is no longer available')) return false;
      throw error;
    },
  );
/** The root plane of pane `folderID`, its terminal child and the angle between them. */
function terminalBranch(folderID: string, terminalID: string) {
  const parent = (window as unknown as SmokeWindow).__qaEngine.tree
    .get()
    .find((node) => node.routeDivisions.plane.parameters.id === folderID)!;
  const child = parent.children!.find(
    (node) => node.routeDivisions.plane.parameters.id === terminalID,
  )!;
  return {
    parent: parent.planeID,
    child: child.planeID,
    angle: Math.abs(child.location.rotateY - parent.location.rotateY),
  };
}
/** Focuses the space, clears its selection and pans every plane out of view. */
function panAway() {
  const engine = (window as unknown as SmokeWindow).__qaEngine;
  engine.focus();
  engine.selection.clear();
  engine.camera.moveBy({ pan: { x: 100000, y: 0 } }, { animate: false });
}
async function verifyFoundations(): Promise<void> {
  const folderID = fixture.state.workspaces[0].panes[0].id;
  await key('3', 'Digit3', 4);
  await until(
    () => evaluate(countOf('.file-column')),
    (count) => count > 0,
    'Finder columns shortcut',
  );
  const edge = '.browser-column-resizer';
  await click(edge);
  await key('ArrowRight', 'ArrowRight', 8);
  await until(
    () =>
      evaluate(
        pageCall(
          (folder: string) =>
            window.viewer
              .settingsGet()
              .then((value) => value.settings.folders[folder]?.columnWidth),
          fixture.files,
        ),
      ),
    (width) => width === 330,
    'keyboard browser column resize persisted',
  );
  await click(fileSelector(path.join(fixture.files, 'Transfers')));
  await key('ArrowRight', 'ArrowRight');
  await until(
    () => evaluate(countOf('.file-column')),
    (count) => count === 2,
    'Finder Right enters the selected folder',
  );
  await key('ArrowLeft', 'ArrowLeft');
  assert.deepEqual(
    await evaluate(pageCall(filePaths, '.file-column [aria-selected=true]')),
    [path.join(fixture.files, 'Transfers')],
    'Finder Left returns selection to the parent folder',
  );
  // As in Finder, List view opens the folder Columns has open: with a file selected, its own.
  await click(fileSelector(path.join(fixture.files, 'README.md')));
  await key('1', 'Digit1', 4);
  await until(
    () => evaluate(countOf('.file-head')),
    (count) => count > 0,
    'List view of the folder Columns had open',
  );
  await click(fileSelector(path.join(fixture.files, 'Transfers')));
  await key('ArrowDown', 'ArrowDown', 4);
  await until(
    () => evaluate(textOf('.plane-title')),
    (name) => name.includes('Transfers'),
    'Cmd Down enters a list folder',
  );
  await key('3', 'Digit3', 4);
  await key('ArrowUp', 'ArrowUp', 4);
  await until(
    () => evaluate(countOf('.file-head')),
    (count) => count > 0,
    'parent restores its own List view',
  );
  await evaluate(clickElement('.file-scroll'));
  await paletteCommand('Open terminal plane');
  await until(
    () =>
      evaluate(
        pageCall(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>('.terminal-plane'),
            (plane) => plane.dataset.terminalId!,
          ),
        ),
      ),
    (ids) => ids.length === 1,
    'embedded terminal lazy mount',
  );
  const terminalID = await evaluate(
    pageCall(() => document.querySelector<HTMLElement>('.terminal-plane')!.dataset.terminalId!),
  );
  await until(
    () => evaluate(countOf('.terminal-plane .xterm-screen')),
    (count) => count === 1,
    'packaged xterm ready',
  );
  await until(
    () => evaluate(pageCall(writeWhenStarted, terminalID, "printf 'PTY_%s\\n' READY; stty size\r")),
    Boolean,
    'terminal session started',
  );
  await until(
    () => evaluate(textOf('.terminal-plane .xterm-rows')),
    (text) => text.includes('PTY_READY'),
    'real PTY output',
  );
  await evaluate(pageCall(terminalWrite, terminalID, 'sleep 30\r'));
  await delay(100);
  await evaluate(pageCall(terminalWrite, terminalID, "\u0003printf 'INTERRUPT%s\\n' ED\r"));
  await until(
    () => evaluate(textOf('.terminal-plane .xterm-rows')),
    (text) => text.includes('INTERRUPTED'),
    'Ctrl C interrupts the foreground PTY command',
  );
  const child = await evaluate(pageCall(terminalBranch, folderID, terminalID));
  assert.ok(child.child, 'Terminal belongs to the originating root');
  assert.ok(Math.abs(child.angle - 90.1) < 0.001, 'Terminal opens at 90.1 degrees to its parent');
  await snapshot('desktop-native-terminal.png');
  await paletteCommand('New folder plane');
  await until(
    () => evaluate(pageCall(planeCount)),
    (count) => count === 2,
    'new root from terminal context',
  );
  await paletteCommand('Open terminal plane');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            (window as unknown as SmokeWindow).__qaEngine.tree
              .get()
              .flatMap((node) => node.children || []).length,
        ),
      ),
    (count) => count === 2,
    'each root owns its terminal',
  );
  const terminals = await evaluate(
    pageCall(() =>
      (window as unknown as SmokeWindow).__qaEngine.tree
        .get()
        .flatMap((root) =>
          (root.children || [])
            .filter((node) => node.route.includes('terminals'))
            .map((node) => node.routeDivisions.plane.parameters.id),
        ),
    ),
  );
  assert.equal(new Set(terminals).size, 2);
  await settleCamera();
  await evaluate(pageCall(panAway));
  await until(
    () =>
      evaluate(
        pageCall(
          (id: string) => !document.querySelector(`.terminal-plane[data-terminal-id="${id}"]`),
          terminalID,
        ),
      ),
    Boolean,
    'inactive terminal React view detaches outside the camera',
  );
  // Exceed the flow-control high-water mark while no terminal React view is mounted.
  await evaluate(
    pageCall(
      terminalWrite,
      terminalID,
      "yes CULL_OUTPUT_abcdefghijklmnopqrstuvwxyz | head -c 1200000; printf '\\nSURVIVED_%s\\n' CULL\r",
    ),
  );
  await delay(300);
  await paletteCommand('Frame all planes');
  await settleCamera();
  await until(
    () => evaluate(pageCall(() => document.body.textContent)),
    (text) => text.includes('SURVIVED_CULL'),
    'terminal screen and PTY survive culling',
  );
  for (const category of ['Terminals', 'Configuration', 'Agents']) {
    await tab(category);
    await snapshot('desktop-native-' + category.toLowerCase() + '.png');
  }
  await tab('Actions');
  await settingsEvaluate(
    pageCall(() => {
      const summary = Array.from(document.querySelectorAll<HTMLElement>('details summary')).find(
        (element) => element.textContent.includes('Inspect path'),
      )!;
      summary.click();
      summary.scrollIntoView({ block: 'start' });
    }),
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
    () => evaluate(countOf('.grid-scroll')),
    (count) => count > 0,
    'external configuration edit reaches all matching roots',
  );
  await patchInSettings(
    { path: 'settings.agents.enabled', value: true },
    { path: 'settings.agents.roots', value: [fixture.root] },
  );
  // Hidden smoke must exercise the pending-consent boundary. It cannot manufacture
  // a native approval; authorized protocol/review checks run in native/agent-consent.ts.
  const pendingAgentAccess = await settingsEvaluate(
    pageCall(() => window.viewer.agentAccess({ kind: 'state' })),
  );
  assert.equal(pendingAgentAccess.enabled, false);
  assert.deepEqual(pendingAgentAccess.roots, []);
  assert.equal(pendingAgentAccess.pending.enable, true);
  assert.ok(pendingAgentAccess.pending.roots.includes(fixture.root));
  await assert.rejects(readFile(path.join(profile, 'agent-connection-v1.json')), {
    code: 'ENOENT',
  });
  await patchInSettings(
    { path: 'settings.agents.enabled', value: false },
    { path: 'settings.agents.roots', value: [] },
  );
  console.log(
    'Agent smoke: requested access stays unapproved; genuine consent has a separate operator scenario.',
  );
  await evaluate(patchSettings({ path: 'settings.folders', value: {} }));
  await reloadPage();
  await until(() => evaluate(exists('[data-viewer-plane]')), Boolean, 'reloaded workspace');
  assert.deepEqual(
    await evaluate(
      pageCall(() => window.viewer.settingsGet().then((value) => value.settings.folders)),
    ),
    {},
    'cleared folder overrides stay cleared after reopening',
  );
  await verifyBackgroundApp();
  assert.deepEqual(exceptions, []);
  console.log(
    'Native foundations verified: folder preferences, Finder keys, columns resize, real PTYs, independent roots, Ctrl C, culling, and JSONC live reload.',
  );
}

/** Starts counting commits of the production file table (tests/react-commits.ts reads the type). */
function watchFileTable() {
  const table = document.querySelector('.file-table')!;
  const key = Object.getOwnPropertyNames(table).find((key) => key.startsWith('__reactFiber$'));
  const fibers = table as unknown as Record<string, { return?: { type?: unknown } } | undefined>;
  const owner = key ? fibers[key]?.return : undefined;
  if (typeof owner?.type !== 'function') throw new Error('Production file-table owner unavailable');
  const page = window as unknown as SmokeWindow;
  page.__qaFileTableType = owner.type;
  page.__qaFileTableCommits = 0;
}
const fileTableCommits = () => (window as unknown as SmokeWindow).__qaFileTableCommits;
/** The centre of the first match. */
function centreOf(selector: string) {
  const rect = document.querySelector(selector)!.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
const nameColumnWidth = (folder: string) =>
  window.viewer
    .settingsGet()
    .then((value) => value.settings.folders[folder]?.list?.widths?.name ?? 0);
async function verifyConfiguredChrome(): Promise<void> {
  const unchanged = await inventory();
  const view = '.plane-controls [aria-label="View mode"]';
  for (let index = 0; index < 2; index++) {
    await click(view);
    assert.equal(await evaluate(countOf('.context-menu')), 1);
    assert.equal(await evaluate(requiredAttribute(view, 'aria-expanded')), 'true');
    await click(view);
    assert.equal(await evaluate(countOf('.context-menu')), 0);
    assert.equal(await evaluate(requiredAttribute(view, 'aria-expanded')), 'false');
  }
  await click(view);
  await key('Escape', 'Escape');
  await click(view);
  await evaluate(pageCall(() => document.body.click()));
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
    'Pinned tools',
    'Actions menu',
    'Close plane button',
  ];
  const preset = () =>
    settingsEvaluate(
      pageCall(
        () =>
          document.querySelector('[data-setting-path="ui.space.headerControls"] .choice-button')
            ?.textContent ?? '',
      ),
    );
  // a fresh profile's header is Essential: Layout and “What can I do here?” are in “…”
  assert.equal(await preset(), 'Essential');
  for (const control of controls) await setting(control);
  await until(
    () => evaluate(countOf('.plane-controls button')),
    (count) => count === 0,
    'all toolbar controls can be hidden independently',
  );
  assert.equal(await preset(), 'Custom');
  await settingsEvaluate(
    pageCall(() =>
      Array.from(document.querySelectorAll('.settings-page h2'))
        .find((heading) => heading.textContent === 'Plane toolbar')!
        .scrollIntoView({ block: 'start' }),
    ),
  );
  await snapshot('desktop-native-toolbar-settings.png');
  for (const control of controls) await setting(control);
  await until(preset, (value) => value === 'Essential', 'the Essential toolbar is back');
  await tab('Browsing');
  for (const column of ['Date modified', 'Kind', 'Size']) await setting(column);
  await until(
    () => evaluate(countOf('.file-head [data-column]')),
    (count) => count === 1,
    'metadata columns can all be hidden while Name remains visible',
  );
  for (const column of ['Date modified', 'Kind', 'Size', 'Date created', 'Extension'])
    await setting(column);
  await until(
    () => evaluate(countOf('.file-head [data-column]')),
    (count) => count === 6,
    'optional created and extension columns appear',
  );
  for (const column of ['Date created', 'Extension']) await setting(column);
  await click('dialog [aria-label="Close"]');
  await evaluate(pageCall(watchFileTable));
  const widths = () =>
    evaluate(
      pageCall(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>('.file-head [data-column]'),
          (cell) => cell.offsetWidth,
        ),
      ),
    );
  const before = await widths();
  const edge = await evaluate(pageCall(centreOf, '[aria-label="Resize Name column"]'));
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
  await evaluate(animationFrames(2));
  await until(
    async () => {
      const before = await evaluate(pageCall(fileTableCommits));
      await delay(100);
      return (await evaluate(pageCall(fileTableCommits))) === before;
    },
    Boolean,
    'renderer settled before measuring column resize',
  );
  const resizeViewportHeight = await evaluate(
    pageCall(() => document.querySelector('.file-scroll')!.clientHeight),
  );
  const commits = await evaluate(pageCall(fileTableCommits));
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
    await evaluate(animationFrames(1));
  }
  assert.equal(
    await evaluate(pageCall(() => document.querySelector('.file-scroll')!.clientHeight)),
    resizeViewportHeight,
    'The measured resize moves retain the virtual list viewport height',
  );
  assert.equal(
    await evaluate(pageCall(fileTableCommits)),
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
    () => evaluate(pageCall(nameColumnWidth, fixture.files)),
    (value) => value === after[0],
    'resized width persisted to settings',
  );
  await until(
    () => evaluate(pageCall(fileTableCommits)),
    (value) => value > commits,
    'the scoped React probe observes the actual width commit on release',
  );
  await evaluate(
    pageCall(() => {
      (window as unknown as SmokeWindow).__qaFileTableType = undefined;
    }),
  );
  await click('[aria-label="Resize Name column"]', 2);
  await until(
    () => evaluate(pageCall(nameColumnWidth, fixture.files)),
    (value) => value === 0,
    'double-click restores flexible Name width',
  );
  await tab('Browsing');
  await setting('Wrap long filenames');
  await click('dialog [aria-label="Close"]');
  await evaluate(
    pageCall(
      (row: string) => document.querySelector(row)!.scrollIntoView({ block: 'nearest' }),
      fileSelector(path.join(fixture.files, longFilename)),
    ),
  );
  const fullName = await evaluate(
    pageCall(
      (row: string) => {
        const text = document.querySelector(row)!.querySelector<HTMLElement>('.filename')!;
        return {
          title: text.title,
          wraps: text.offsetHeight > parseFloat(getComputedStyle(text).lineHeight) * 1.5,
        };
      },
      fileSelector(path.join(fixture.files, longFilename)),
    ),
  );
  assert.equal(fullName.title, longFilename);
  assert.equal(fullName.wraps, true);
  await snapshot('desktop-native-list-wrap.png');
  await tab('Browsing');
  await setting('Wrap long filenames');
  await click('dialog [aria-label="Close"]');
  await until(
    () =>
      evaluate(
        pageCall(
          (row: string) => document.querySelector(row)!.parentElement!.offsetHeight,
          fileSelector(path.join(fixture.files, longFilename)),
        ),
      ),
    (height) => height === 36,
    'disabling wrapping restores the normal virtual row height',
    3000,
  );
  await click(fileSelector(path.join(fixture.files, 'README.md')));
  await key('Enter', 'Enter');
  await until(
    () => evaluate(exists('[aria-label="Rename actions"]')),
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
    () => evaluate(exists('[aria-label="Rename actions"]')),
    Boolean,
    'book rename action picker',
  );
  // Exercise selection changing independently after the modal captured its target.
  await evaluate(
    clickElement(fileSelector(path.join(fixture.files, 'Documents', 'Project notes.md'))),
  );
  await choose('Rename actions', 'recipe.book-name');
  await until(
    () => evaluate(exists('.action-config')),
    Boolean,
    'rename modal transfers to action setup',
  );
  assert.equal(await evaluate(countOf('dialog[open]')), 1);
  await click('.action-config .primary');
  const plans = await until(
    () => evaluate(pageCall(() => window.viewer.actionList())),
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

const selectedFilePath = () =>
  document.querySelector('.file-row.is-selected')?.getAttribute('data-file-path') || '';
/** The drag payload a row's production dragstart handler writes. */
function dragPayload(row: string) {
  const data = new DataTransfer();
  document
    .querySelector(row)!
    .dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
  return data.getData('application/x-viewer-files');
}
async function verifyColumnWorkflows(): Promise<void> {
  await paletteCommand('Columns view');
  await click(fileSelector(path.join(fixture.files, 'Data')));
  await key('ArrowDown', 'ArrowDown');
  const selected = await evaluate(pageCall(selectedFilePath));
  assert.equal(path.basename(selected), 'Documents');
  await until(
    () => evaluate(textOf('.file-column:nth-child(2) .column-title')),
    (title) => title === 'Documents',
    'arrow selection reveals the selected folder column',
    3000,
  );
  await key('ArrowRight', 'ArrowRight');
  await until(
    () => evaluate(pageCall(selectedFilePath)),
    (value) => path.dirname(value) === path.join(fixture.files, 'Documents'),
    'Right selects inside the folder',
  );
  await evaluate(pageCall(panAway));
  await until(
    () => evaluate(pageCall(() => !document.querySelector('.folder-explorer'))),
    Boolean,
    'offscreen column explorer detaches',
    5000,
  );
  await evaluate(pageCall(frameFirstPlane));
  await settleCamera();
  await until(text, (value) => value.includes('Project brief.pdf'), 'column branch reattaches');
  await evaluate(focus('.folder-explorer'));
  await key('ArrowDown', 'ArrowDown');
  assert.equal(
    path.dirname((await evaluate(requiredAttribute('.file-row.is-selected', 'data-file-path')))!),
    path.join(fixture.files, 'Documents'),
    'the child column keeps keyboard ownership after Plurid detachment',
  );
  await key('ArrowLeft', 'ArrowLeft');
  assert.equal(
    await evaluate(requiredAttribute('.file-row.is-selected', 'data-file-path')),
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
    () => evaluate(exists(`.file-column[data-folder-path="${source}"]`)),
    Boolean,
    'Source is shown as a browsing column before copying',
  );
  await key('c', 'KeyC', 4);
  await until(
    () => evaluate(pageCall(() => window.viewer.clipboardRead())),
    (value) => value?.paths[0] === source,
    'Command-C captures the selected folder',
  );
  await click(fileSelector(target));
  await until(
    () => evaluate(exists(`.file-column[data-folder-path="${target}"]`)),
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
  const payload = await evaluate(pageCall(dragPayload, fileSelector(source)));
  assert.deepEqual(JSON.parse(payload), [source]);
  const point = await evaluate(pageCall(centreOf, fileSelector(peer)));
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
      evaluate(
        pageCall(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>('.file-column'),
            (column) => column.dataset.folderPath!,
          ),
        ),
      ),
    (paths) => !paths.includes(source),
    'removal closes the obsolete column branch',
  );
  assert.equal(await evaluate(countOf('.file-row.is-selected')), 0);
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

/** Each shown column heading's text edge minus its first row's: left edges, right for Size. */
function columnOffsets() {
  const head = document.querySelector('.file-head')!,
    row = document.querySelector('.file-row')!;
  const targets: Record<string, string> = {
    name: '.filename',
    modified: '.file-date',
    created: '.file-created',
    kind: '.file-kind',
    extension: '.file-extension',
    size: '.file-size',
  };
  const textRect = (element: Element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect();
  };
  return Array.from(head.children as HTMLCollectionOf<HTMLElement>).flatMap((cell) => {
    if (getComputedStyle(cell).display === 'none') return [];
    const column = cell.dataset.column!;
    const heading = textRect(cell.querySelector('.column-label')!),
      value = textRect(row.querySelector(targets[column]!)!);
    return {
      name: cell.textContent.trim(),
      delta: column === 'size' ? heading.right - value.right : heading.left - value.left,
    };
  });
}
async function verifyListAlignment(): Promise<void> {
  const measure = () => evaluate(pageCall(columnOffsets));
  for (const width of [960, 640, 420]) {
    await evaluate(
      pageCall((width: number) => {
        const explorer = document.querySelector<HTMLElement>('.folder-explorer')!;
        explorer.style.width = width + 'px';
        explorer.style.flex = 'none';
      }, width),
    );
    for (const overflow of [false, true]) {
      await evaluate(
        pageCall(
          (height: number) => {
            const list = document.querySelector<HTMLElement>('.file-scroll')!;
            list.style.flex = 'none';
            list.style.height = height + 'px';
            list.scrollTop = 0;
          },
          overflow ? 72 : 460,
        ),
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
          pageCall(() => {
            const list = document.querySelector('.file-scroll')!;
            return list.scrollWidth > list.clientWidth;
          }),
        ),
        false,
      );
      assert.equal(
        await evaluate(
          pageCall(() => {
            const list = document.querySelector('.file-scroll')!;
            return list.scrollHeight > list.clientHeight;
          }),
        ),
        overflow,
      );
      console.log('List alignment:', { width, overflow, columns });
    }
  }
  await evaluate(
    pageCall(() => {
      const explorer = document.querySelector<HTMLElement>('.folder-explorer')!.style,
        list = document.querySelector<HTMLElement>('.file-scroll')!.style;
      explorer.removeProperty('width');
      explorer.removeProperty('flex');
      list.removeProperty('height');
      list.removeProperty('flex');
    }),
  );
  await snapshot('desktop-native-list-alignment.png');
}

async function verifyPreviewFooter(): Promise<void> {
  const file = path.join(fixture.files, 'README.md');
  const choices = await evaluate(
    pageCall((file: string) => window.viewer.applications([file]), file),
  );
  await preview(file, 'Synthetic files for local Viewer verification.');
  await until(
    () => evaluate(textOf('.quick-preview .open-default-button')),
    (label) => label === (choices.defaultName ? `Open in ${choices.defaultName}` : 'Open'),
    'the Quick Preview open control names the actual default application',
  );
  assert.equal(await evaluate(countOf('.wide-dialog footer')), 1);
  assert.equal(await evaluate(countOf('.quick-preview .preview-info')), 0);
  assert.equal(await evaluate(countOf('.wide-dialog [aria-label="Open file in default app"]')), 0);
  await snapshot('desktop-native-quick-preview-footer.png');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 780,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const bounds = await evaluate(
    pageCall(() => {
      const footer = document.querySelector('.quick-preview-footer')!;
      return {
        overflow: footer.scrollWidth > footer.clientWidth,
        bottom: footer.getBoundingClientRect().bottom,
        height: innerHeight,
      };
    }),
  );
  assert.equal(bounds.overflow, false);
  assert.ok(bounds.bottom <= bounds.height);
  await snapshot('desktop-native-quick-preview-footer-minimum.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await closePreview();
}

/** The focused control's label, keyboard focus and colours, beside the theme's accent and fill. */
function focusedControl() {
  const button = document.activeElement!,
    style = getComputedStyle(button);
  const swatch = document.createElement('span');
  swatch.style.color = 'var(--accent)';
  swatch.style.background = 'var(--raised)';
  document.body.append(swatch);
  const accent = getComputedStyle(swatch).color,
    raised = getComputedStyle(swatch).backgroundColor;
  swatch.remove();
  return {
    label: button.textContent.trim(),
    keyboard: button.matches(':focus-visible'),
    outline: style.outlineStyle,
    color: style.color,
    accent,
    background: style.backgroundColor,
    raised,
  };
}
async function verifySettingsScroll(): Promise<void> {
  await evaluate(pageCall(openSettings));
  await openSettingsProbe();
  await tab('Actions');
  const rectangles = () =>
    settingsEvaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.settings-recipe summary')).flatMap((element) => {
          const rect = element.getBoundingClientRect();
          return [rect.x, rect.width];
        }),
      ),
    );
  const collapsed = await rectangles();
  await settingsEvaluate(clickElement('.settings-recipe summary'));
  await until(
    () =>
      settingsEvaluate(
        pageCall(() => {
          const page = document.querySelector('.settings-page')!;
          return page.scrollHeight > page.clientHeight;
        }),
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
  await settingsEvaluate(clickElement('.settings-recipe summary'));
  assert.deepEqual(await rectangles(), collapsed);
  await snapshot('desktop-native-settings-actions-collapsed.png');
  const initialAppearance = await settingsEvaluate(
    pageCall(() => window.viewer.settingsGet().then((snapshot) => snapshot.settings.appearance)),
  );
  await settingsCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const appearance of ['dark', 'light']) {
    await settingsEvaluate(patchSettings({ path: 'settings.appearance', value: appearance }));
    await until(
      () => settingsEvaluate(pageCall(pageLook)),
      (look) => look === appearance,
      'Settings focus appearance',
    );
    await settingsEvaluate(focus('.settings-navigation button'));
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
    const focused = await settingsEvaluate(pageCall(focusedControl));
    assert.equal(focused.label, 'Navigation', 'Tab must move to the next Settings control');
    assert.equal(focused.keyboard, true);
    assert.equal(focused.outline, 'none', 'Keyboard feedback must preserve the ring-free design');
    assert.equal(
      focused.background,
      focused.raised,
      'Keyboard focus must visibly fill its control',
    );
    assert.equal(focused.color, focused.accent);
    await snapshot(`desktop-native-settings-keyboard-focus-${appearance}.png`);
  }
  await settingsEvaluate(patchSettings({ path: 'settings.appearance', value: initialAppearance }));
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
      () => evaluate(requiredText('.selection-size')),
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

/** The first root's location and its first child's, with the bridge between them. */
function firstBranch() {
  const root = (window as unknown as SmokeWindow).__qaEngine.tree.get()[0],
    child = root.children![0];
  return {
    parent: root.location,
    child: child.location,
    link: child.linkCoordinates!,
    offset: child.bridgeOffset!,
    angle: child.planeAngle,
  };
}
/** The vertical centre of a row in its plane's own coordinates. */
function rowCentreInPlane(row: string) {
  const element = document.querySelector(row)!;
  const plane = element.closest<HTMLElement>('[data-plurid-plane]')!;
  const r = element.getBoundingClientRect(),
    p = plane.getBoundingClientRect();
  return ((r.y + r.height / 2 - p.y) * plane.offsetHeight) / p.height;
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
  await evaluate(pageCall(saveState, seeded));
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  await evaluate(focus('.folder-explorer'));
  await key('End', 'End');
  const source = path.join(folder, '319.txt');
  await until(() => evaluate(exists(fileSelector(source))), Boolean, 'virtualized last file');
  await evaluate(
    pageCall(() => {
      document.querySelector('.file-scroll')!.scrollTop = 0;
    }),
  );
  await until(
    () => evaluate(exists(fileSelector(source))),
    (value) => !value,
    'unmounted selected source row',
  );
  await paletteCommand('Open linked plane');
  await until(
    () =>
      evaluate(
        pageCall(
          () => (window as unknown as SmokeWindow).__qaEngine.tree.get()[0].children!.length,
        ),
      ),
    (value) => value === 1,
    'preview beside a revealed virtual source',
  );
  await settleCamera();
  const nodes = await evaluate(pageCall(firstBranch));
  assert.equal(nodes.angle, 90.1);
  assert.ok(Math.abs(nodes.child.rotateY - nodes.parent.rotateY - 90.1) < 0.01);
  assert.equal(nodes.parent.rotateX, nodes.child.rotateX);
  assert.ok(
    Math.abs(nodes.child.translateY - nodes.parent.translateY - nodes.link.y - nodes.offset) < 1,
  );
  await evaluate(pageCall(frameFirstPlane));
  await settleCamera();
  const expected = await evaluate(pageCall(rowCentreInPlane, fileSelector(source)));
  assert.ok(
    Math.abs(nodes.link.y - expected) < 3,
    `Preview must use the visible source row: ${JSON.stringify({ actual: nodes.link.y, expected })}`,
  );
  await snapshot('desktop-native-file-anchored-preview.png');
  for (const mode of ['Grid', 'Columns', 'Gallery', 'List']) {
    await evaluate(focus('.folder-explorer'));
    await paletteCommand(`${mode} view`);
    await evaluate(focus('.folder-explorer'));
    const camera = await evaluate(pageCall(cameraJSON));
    await key('End', 'End');
    await key('ArrowUp', 'ArrowUp', 8);
    await key('ArrowUp', 'ArrowUp', 8);
    await evaluate(animationFrames(2));
    assert.ok(
      (await evaluate(countOf('.folder-explorer [data-file-path][aria-selected=true]'))) > 1,
      `${mode} range selection`,
    );
    assert.equal(
      await evaluate(pageCall(cameraJSON)),
      camera,
      `${mode} keys must not rotate the camera`,
    );
    await key('Escape', 'Escape');
  }
  await evaluate(pageCall(saveState, original));
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  console.log(
    'Anchoring: a scrolled-out virtual source is revealed before spawning a 90.1° parent-relative preview at its row; all four views own range keys.',
  );
}

async function restoredEngine(count: number): Promise<void> {
  await until(() => evaluate(exists('[data-viewer-plane]')), Boolean, 'restored plane controls');
  await captureEngine();
  await until(
    () => evaluate(pageCall(inspectedPlaneCount)),
    (value) => value === count,
    'restored engine topology, including culled planes',
  );
}
const enginePlaneIDs = () =>
  evaluate(
    pageCall(() =>
      JSON.stringify(
        (window as unknown as SmokeWindow).__qaEngine
          .inspect()
          .planes.map((plane) => plane.planeID)
          .sort(),
      ),
    ),
  );
async function drag(selector: string): Promise<void> {
  const point = await evaluate(pageCall(centreOf, selector));
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
  const point = await evaluate(pageCall(centreOf, selector));
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
    () => evaluate(pageCall(searchingActions)),
    (value) => value,
    'autofocused contextual search',
  );
}
/** The edges of the open context menu and its flyouts, in order. */
const menuBounds = () =>
  Array.from(document.querySelectorAll('.context-menu, .context-submenu'), (menu) => {
    const rect = menu.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  });
const providerKinds = () =>
  window.viewer
    .settingsGet()
    .then((value) => value.settings.providers.map((provider) => provider.kind));
const endpointReadOnly = (kind: string) =>
  document.querySelector<HTMLInputElement>(
    `[data-provider-kind=${kind}] [aria-label="Provider endpoint"]`,
  )!.readOnly;
async function verifyGroupedMenuAndModels(): Promise<void> {
  await paletteCommand('Dock plane');
  const readme = fileSelector(path.join(fixture.files, 'README.md'));
  await contextMenu(readme);
  assert.equal(await evaluate(countOf('.context-menu [data-menu-id^=view-]')), 0);
  assert.equal(await evaluate(countOf('.context-menu [data-menu-id^="column."]')), 0);
  assert.equal(await evaluate(countOf('.context-submenu')), 0);
  await snapshot('desktop-native-context-grouped.png');
  await click('.context-menu [data-menu-id="menu.View"]');
  await until(
    () => evaluate(countOf('.context-submenu')),
    (count) => count === 1,
    'View submenu',
  );
  assert.deepEqual(
    await evaluate(
      pageCall(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>('.context-submenu [data-menu-id^=view-]'),
          (element) => element.dataset.menuId!,
        ).sort(),
      ),
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
      pageCall(() =>
        Array.from(document.querySelectorAll('.context-menu-content [id]')).every(
          (element) => !/[\t\n\r ]/.test(element.id),
        ),
      ),
    ),
    true,
    'submenu accessible IDs contain no whitespace',
  );
  await click('.context-submenu [data-menu-id="menu.Columns"]');
  await until(
    () => evaluate(countOf('.context-submenu')),
    (count) => count === 2,
    'Columns submenu',
  );
  await snapshot('desktop-native-context-columns.png');
  const flyoutBounds = await evaluate(pageCall(menuBounds));
  assert.ok(flyoutBounds[1].right <= flyoutBounds[0].left + 2);
  assert.ok(flyoutBounds[2].right <= flyoutBounds[1].left + 2);
  assert.equal(await evaluate(pageCall(activeLabel)), 'Search actions');
  await key('Escape', 'Escape');
  assert.equal(await evaluate(countOf('.context-submenu')), 1);
  await key('ArrowLeft', 'ArrowLeft');
  assert.equal(await evaluate(countOf('.context-submenu')), 0);
  await key('ArrowRight', 'ArrowRight');
  assert.equal(await evaluate(countOf('.context-submenu')), 1);
  // Typing traverses the full catalog immediately, including a third-level command.
  await command('Input.insertText', { text: 'date created' });
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.querySelector<HTMLElement>('.context-menu .command-result[aria-selected=true]')
              ?.dataset.menuId || '',
        ),
      ),
    (id) => id === 'column.created',
    'search through hidden column commands',
  );
  assert.equal(await evaluate(countOf('.context-submenu')), 0);
  await key('Enter', 'Enter');
  await until(
    () => evaluate(exists('.file-head [data-column=created]')),
    Boolean,
    'searched column command executes',
  );
  await contextMenu(readme);
  await command('Input.insertText', { text: 'rn' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate(valueOf('dialog input')),
    (value) => value === 'README.md',
    'grouped menu retains rename target',
  );
  await click('dialog [aria-label="Close"]');
  await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
  await until(
    () => evaluate(textOf('.context-menu .command-result')),
    (label) => /^Rename/.test(label),
    'recent rename is promoted',
  );
  assert.equal(await evaluate(countOf('.context-menu [data-menu-id=rename]')), 1);
  assert.equal(await evaluate(countOf('.context-menu [data-menu-id="recent.rename"]')), 1);
  await key('Escape', 'Escape');
  await until(
    () => evaluate(countOf('.context-menu')),
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
    pageCall(() =>
      document.querySelector('.folder-explorer .file-scroll')!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 765,
          clientY: 545,
        }),
      ),
    ),
  );
  await until(() => evaluate(pageCall(searchingActions)), Boolean, 'autofocused edge context menu');
  await click('.context-menu [data-menu-id="menu.View"]');
  await click('.context-submenu [data-menu-id="menu.Columns"]');
  const bounds = await evaluate(pageCall(menuBounds));
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
    pageCall(() =>
      document
        .querySelector<HTMLElement>('[data-plurid-entity="PluridPlaneContent"]')!
        .focus({ preventScroll: true }),
    ),
  );
  assert.equal(
    await evaluate(pageCall(activeLabel)),
    'Search actions',
    'flyouts retain the search input at minimum size',
  );
  // All flyouts are one dismissal boundary; clicking inside keeps the menu open.
  for (const count of [1, 0]) {
    await key('Escape', 'Escape');
    await until(
      () => evaluate(countOf('.context-submenu')),
      (value) => value === count,
      `edge submenu dismissal: ${count} remaining`,
    );
  }
  await key('Escape', 'Escape');
  await until(
    () => evaluate(countOf('.context-menu')),
    (count) => count === 0,
    'edge menu dismissal',
  );
  assert.equal(await evaluate(countOf('.context-menu')), 0);
  await command('Emulation.clearDeviceMetricsOverride');

  await tab('Models');
  // Add model opens the provider picker; setting one up closes it again.
  const addModel = async () => {
    await until(
      () => settingsEvaluate(buttonState('Add model', '.models-introduction')),
      (state) => state === 'enabled',
      'Add model',
    );
    await settingsEvaluate(pressButton('Add model', '.models-introduction'));
    await until(
      () => settingsEvaluate(exists(choiceButton('New model provider'))),
      Boolean,
      'provider picker',
    );
  };
  await addModel();
  assert.equal(
    (await choiceValues('New model provider', settingsEvaluate)).length,
    9,
    'complete provider picker',
  );
  await snapshot('desktop-native-models-empty.png');
  for (const [index, kind] of ['zai', 'deepseek', 'qwen', 'gemini', 'openrouter'].entries()) {
    if (index) await addModel();
    await choose('New model provider', kind, settingsEvaluate);
    await settingsEvaluate(pressButton('Set up model', '.settings-provider-add'));
  }
  await until(
    () => settingsEvaluate(pageCall(providerKinds)),
    (kinds) => kinds.length === 5,
    'all five provider profiles persisted',
  );
  assert.deepEqual(await settingsEvaluate(pageCall(providerKinds)), [
    'zai',
    'deepseek',
    'qwen',
    'gemini',
    'openrouter',
  ]);
  assert.equal(
    await settingsEvaluate(
      requiredValue('[data-provider-kind=zai] [aria-label="Provider endpoint"]'),
    ),
    'https://api.z.ai/api/paas/v4',
  );
  assert.equal(await settingsEvaluate(pageCall(endpointReadOnly, 'gemini')), true);
  assert.equal(await settingsEvaluate(pageCall(endpointReadOnly, 'qwen')), false);
  assert.deepEqual(
    await settingsEvaluate(
      pageCall(() => window.viewer.settingsGet().then((value) => value.credentials)),
    ),
    [],
  );
  assert.equal(
    await settingsEvaluate(
      pageCall(() =>
        Array.from(
          document.querySelectorAll<HTMLInputElement>('.settings-provider [type=checkbox]'),
        ).every((input) => !input.checked),
      ),
    ),
    true,
  );
  await snapshot('desktop-native-models-providers.png');
  await settingsEvaluate(
    pageCall(() =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-provider-kind=deepseek] button'),
      )
        .find((button) => button.textContent.trim() === 'Connect and load models')!
        .click(),
    ),
  );
  await until(
    () => settingsEvaluate(textOf('.settings-error')),
    (value) => value.includes('API key'),
    'missing provider key is actionable',
  );
  await settingsEvaluate(
    pageCall(() =>
      document.querySelector('[data-provider-kind=qwen]')!.scrollIntoView({ block: 'start' }),
    ),
  );
  await snapshot('desktop-native-models-qwen.png');
  await click('dialog [aria-label="Close"]');
  console.log(
    'Grouped menus: flyouts, keyboard return, global search, recent actions, captured targets and minimum-window bounds. Models: all five new provider presets persisted with content off and no credentials.',
  );
}
function modelCanvasBounds() {
  const rect = document.querySelector('.model-stage canvas')!.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
}
/** Counts the pixels of a screenshot crop that differ from its first pixel, and the black ones. */
async function geometryStats(
  data: string,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const image = new Image();
  image.src = 'data:image/png;base64,' + data;
  await image.decode();
  const scale = image.width / innerWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  const context = canvas.getContext('2d')!;
  context.drawImage(
    image,
    bounds.x * scale,
    bounds.y * scale,
    bounds.width * scale,
    bounds.height * scale,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const background = pixels.slice(0, 3);
  let geometry = 0,
    black = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = pixels.slice(i, i + 3);
    if (Math.max(...rgb.map((value, index) => Math.abs(value - background[index]))) > 18) {
      geometry++;
      if (Math.max(...rgb) < 24) black++;
    }
  }
  return { geometry, blackFraction: geometry ? black / geometry : 1 };
}
/** Where a model plane's Frame model went: its header, or "…", which it leads once it gave way. */
type ModelFramePlace = 'header' | 'menu';
/**
 * Frames the previewed model as a person would: with the header's button, or, where a narrow
 * header gave the button way (DESIGN.md Header Spill Rule), with its row at the top of "…".
 */
async function frameModel(): Promise<ModelFramePlace> {
  const button = '[aria-label="Frame model"]';
  const away = `${button}[data-spilled]`;
  if (!(await evaluate(exists(away)))) {
    await click(button);
    return 'header';
  }
  await click(`[data-plurid-plane]:has(${away}) [aria-label="Preview actions"]`);
  await until(
    () => evaluate(requiredAttribute('.context-menu [data-menu-id]', 'data-menu-id')),
    (id) => id === 'preview.model-frame',
    'Frame model leads "…"',
  );
  await click('.context-menu [data-menu-id="preview.model-frame"]');
  return 'menu';
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
      () => evaluate(requiredText('.model-dimensions')),
      (value) => /mm$/.test(value),
      'STEP conversion and model framing complete',
    );
    await frameModel();
    await evaluate(animationFrames(2));
    const worldCamera = await evaluate(pageCall(cameraJSON));
    for (let view = 0; view < 5; view++) {
      if (view === 4) {
        await command('Emulation.setDeviceMetricsOverride', {
          width: 780,
          height: 560,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate(animationFrames(2));
        await frameModel();
        await evaluate(animationFrames(2));
      }
      const bounds = await evaluate(pageCall(modelCanvasBounds));
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
      const stats = await evaluate(pageCall(geometryStats, data, bounds));
      observations.push({ look, view, ...stats });
      console.log('Model lighting:', observations.at(-1));
      assert.ok(stats.geometry > 500, 'Lighting check contains rendered geometry');
      assert.equal(await evaluate(requiredText('.model-dimensions')), dimensions);
      if (view < 4)
        assert.equal(
          await evaluate(pageCall(cameraJSON)),
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
      '1 mesh · 1 triangle · 3 vertices',
    );
    await closePreview();
  }
}
/** The painted gap between the Name and Date modified labels, in page and plane pixels. */
function headerLabelGap() {
  const first = document.querySelector<HTMLElement>(
    '.file-heading[data-column=name] .column-label',
  )!;
  const next = document.querySelector('.file-heading[data-column=modified] .column-label')!;
  const bounds = first.getBoundingClientRect();
  const scale = bounds.width / first.offsetWidth;
  const painted = next.getBoundingClientRect().left - bounds.right;
  return { painted, local: painted / scale, scale };
}
/** After two frames, whether the row lies inside the file list's scrolled view. */
async function settledRowInView(row: string) {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const element = document.querySelector(row);
  const scroll = document.querySelector('.file-scroll')!;
  return (
    !!element &&
    element.getBoundingClientRect().top >= scroll.getBoundingClientRect().top &&
    element.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom
  );
}
const showToolbarPreview = () =>
  document.querySelector('.settings-toolbar-preview')!.scrollIntoView({ block: 'start' });
async function verifyRefinements(): Promise<void> {
  await paletteCommand('Dock plane');
  await settleCamera();
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
    await evaluate(pageCall((file: string) => window.viewer.clipboardWrite([file], true), readme));
    await contextMenu(fileSelector(readme));
    await click('.context-menu [data-menu-id="copy-path"]');
    copiedText = readme;
    await until(
      async () => (await execNative('/usr/bin/pbpaste')).stdout,
      (value) => value === copiedText,
      'Copy path writes the selected file pathname',
    );
    await until(
      () => evaluate(pageCall(() => window.viewer.clipboardRead())),
      (value) => value === null,
      'Copy path clears an earlier cut operation',
    );
    await contextMenu(fileSelector(readme));
    assert.equal(await evaluate(countOf('[data-menu-id="recent.copy-path"]')), 1);
    assert.equal(await evaluate(countOf('[data-menu-id="copy-path"]')), 1);
    await snapshot('desktop-native-additive-recents.png');
    await command('Input.insertText', { text: 'copy path' });
    assert.equal(
      await evaluate(countOf('.context-menu [data-menu-id="copy-path"]')),
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
      pageCall(() =>
        document.querySelector('.file-scroll')!.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 450,
            clientY: 420,
          }),
        ),
      ),
    );
    await until(
      () => evaluate(exists('.context-menu [data-menu-id="copy-path"]')),
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
    if (copiedText) await restoreClipboard(previousClipboard, copiedText);
  }
  const headerGap = await evaluate(pageCall(headerLabelGap));
  // Four-pixel margins on both labels leave an eight-pixel logical paint gap.
  // Camera projection and fractional layout must not change this layout assertion.
  assert.ok(
    headerGap.local >= 8 - 0.25,
    'Sort-button horizontal insets: ' + JSON.stringify(headerGap),
  );
  await evaluate(focus('.file-heading[data-column=name] .column-label'));
  await snapshot('desktop-native-header-gutter.png');

  await preview(path.join(fixture.files, 'Cube.step'), 'Wireframe');
  await until(
    () => evaluate(textOf('.model-dimensions')),
    (value) => value === '300 × 300 × 300 mm',
    'Packaged STEP worker renders physical dimensions',
    60000,
  );
  await click('.model-viewer button[aria-pressed=false]');
  await until(
    () =>
      evaluate(
        pageCall(() =>
          Array.from(document.querySelectorAll('.model-viewer button')).some(
            (button) =>
              button.textContent === 'Measure' && button.getAttribute('aria-pressed') === 'true',
          ),
        ),
      ),
    Boolean,
    'enabled surface measurement',
  );
  const center = await evaluate(pageCall(centreOf, '.model-stage canvas'));
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
    () => evaluate(textOf('.model-measurement')),
    (value) => /^Distance: [1-9]/.test(value),
    'Surface-point distance measurement',
  );
  await snapshot('desktop-native-step-measure.png');
  await closePreview();
  await preview(path.join(fixture.files, 'Printed.3mf'), 'Wireframe');
  await until(
    () => evaluate(textOf('.model-dimensions')),
    (value) => value === '25.4 × 25.4 × 25.4 mm',
    '3MF inch coordinates normalize to millimeters',
  );
  await snapshot('desktop-native-printing-3mf.png');
  await closePreview();
  await preview(path.join(fixture.files, 'Triangle.ply'), 'Wireframe');
  await until(
    () => evaluate(textOf('.model-dimensions')),
    (value) => value === '1 × 1 × 0 units',
    'PLY geometry renders with explicit unknown units',
  );
  await closePreview();
  await preview(path.join(fixture.files, 'Broken.step'), 'Model could not be loaded');
  await closePreview();
  if (process.env.VIEWER_TEST_STEP_FILE) {
    await evaluate(
      pageCall(
        (row: string) => document.querySelector(row)!.scrollIntoView({ block: 'center' }),
        fileSelector(path.join(fixture.files, 'User panel.step')),
      ),
    );
    await preview(path.join(fixture.files, 'User panel.step'), 'Wireframe');
    await until(
      () => evaluate(textOf('.model-dimensions')),
      (value) => /mm$/.test(value),
      'Read-only copy of the user STEP model renders',
    );
    await snapshot('desktop-native-user-step.png');
    await closePreview();
  }
  await evaluate(
    pageCall(() => {
      document.querySelector('.file-scroll')!.scrollTop = 0;
    }),
  );
  await until(
    () => evaluate(pageCall(settledRowInView, fileSelector(path.join(fixture.files, 'Models')))),
    Boolean,
    'Models row settles after virtual scrolling',
  );
  await click(fileSelector(path.join(fixture.files, 'Models')), 2);
  await until(text, (value) => value.includes('Triangle.glb'), 'Model fixture folder opened');
  for (const extension of ['glb', 'gltf', 'obj', 'stl', 'fbx']) {
    await preview(
      path.join(fixture.files, 'Models', `Triangle.${extension}`),
      '1 mesh · 1 triangle · 3 vertices',
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
    () => evaluate(pageCall(planeCount)),
    (count) => count === 3,
    'File opens as an independent root',
  );
  assert.equal(
    await evaluate(
      pageCall(() =>
        (window as unknown as SmokeWindow).__qaEngine.tree
          .get()
          .every((node) => !node.children?.length),
      ),
    ),
    true,
  );

  await tab('Models');
  for (const look of ['dark', 'light']) {
    await settingsEvaluate(patchSettings({ path: 'settings.appearance', value: look }));
    await until(
      () => settingsEvaluate(pageCall(pageLook)),
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
            pageCall(() => {
              const page = document.querySelector('.settings-page')!;
              return page.scrollWidth > page.clientWidth;
            }),
          ),
          false,
          `${width}px ${category} has no horizontal overflow`,
        );
        const gaps = await settingsEvaluate(
          pageCall(() =>
            Array.from(document.querySelectorAll('.settings-actions')).flatMap((actions) => {
              const before = actions.previousElementSibling;
              if (before?.matches('p'))
                return [
                  actions.getBoundingClientRect().top - before.getBoundingClientRect().bottom,
                ];
              return [];
            }),
          ),
        );
        assert.ok(
          gaps.every((gap) => gap >= 15),
          `${width}px ${category} separates descriptions from actions`,
        );
        await snapshot(`desktop-native-settings-${category.toLowerCase()}-${width}-${look}.png`);
        if (category === 'Agents')
          assert.ok(
            (await settingsEvaluate(
              pageCall(
                () => document.querySelector('.settings-wide-field .choice-button')!.clientWidth,
              ),
            )) >= 240,
            'Agent folder choice fits its placeholder',
          );
        if (category === 'Space') {
          assert.equal(await settingsEvaluate(countOf('.settings-toolbar-preview')), 10);
          await settingsEvaluate(pageCall(showToolbarPreview));
          await snapshot(`desktop-native-settings-toolbar-${width}-${look}.png`);
        }
      }
    }
  }
  await settingsEvaluate(patchSettings({ path: 'settings.appearance', value: 'dark' }));
  await tab('Agents');
  await settingsEvaluate(
    patchSettings({
      path: 'settings.agents.roots',
      value: [
        path.join(
          fixture.files,
          'Folder with a deliberately long descriptive name for permissions and display',
        ),
      ],
    }),
  );
  await settingsEvaluate(
    pageCall(() => {
      const summary = Array.from(document.querySelectorAll<HTMLElement>('details > summary')).find(
        (element) => element.textContent.trim() === 'Shared connection',
      )!;
      if (!(summary.parentElement as HTMLDetailsElement).open) summary.click();
    }),
  );
  await until(
    () =>
      settingsEvaluate(
        pageCall(
          () =>
            Array.from(document.querySelectorAll('.settings-location span')).find((element) =>
              element.textContent.includes('deliberately long'),
            )?.textContent || '',
        ),
      ),
    (value) => value.includes('deliberately long') && value.includes('Requested in config.jsonc'),
    'Requested agent-folder path remains visible without granting access',
  );
  assert.equal(
    await settingsEvaluate(
      pageCall(() => {
        const field = Array.from(document.querySelectorAll('.settings-location span')).find(
          (element) => element.textContent.includes('deliberately long'),
        )!;
        field.scrollIntoView({ block: 'center' });
        return field.scrollWidth > field.clientWidth;
      }),
    ),
    false,
    'Requested agent-folder path wraps within its row',
  );
  const requestedAccess = await settingsEvaluate(
    pageCall(() => window.viewer.agentAccess({ kind: 'state' })),
  );
  assert.equal(requestedAccess.enabled, false);
  assert.deepEqual(requestedAccess.roots, []);
  assert.equal(requestedAccess.pending.roots.length, 1);
  await snapshot('desktop-native-settings-long-path.png');
  await tab('Space');
  await setting('Navigation button');
  await setting('Back button');
  await settingsEvaluate(pageCall(showToolbarPreview));
  assert.equal(await settingsEvaluate(countOf('.settings-toolbar-preview[data-enabled=false]')), 2);
  await snapshot('desktop-native-settings-toolbar-states.png');
  await setting('Navigation button');
  await setting('Back button');
  await tab('Browsing');
  await settingsEvaluate(
    patchSettings(
      { path: 'settings.browsing.newPlaneLocation', value: 'custom' },
      { path: 'settings.browsing.newPlanePath', value: path.join(fixture.files, 'Documents') },
      { path: 'settings.browsing.emptyWorkspaceLocation', value: 'custom' },
      { path: 'settings.browsing.emptyWorkspacePath', value: path.join(fixture.files, 'Data') },
    ),
  );
  await until(
    () => settingsEvaluate(countOf('.settings-folder-choice')),
    (count) => count === 2,
    'Independent custom starting folders',
  );
  await settingsEvaluate(
    pageCall(() =>
      document
        .querySelector('[aria-label="New folder planes start in"]')!
        .closest('.settings-row')!
        .scrollIntoView({ block: 'start' }),
    ),
  );
  await snapshot('desktop-native-independent-plane-settings.png');
  await click('dialog [aria-label="Close"]');
  const empty = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  empty.workspaces[0].panes = [];
  empty.workspaces[0].roots = [];
  empty.workspaces[0].activePane = undefined;
  empty.workspaces[0].arrangement = {};
  await evaluate(pageCall(saveState, empty));
  await command('Page.reload');
  await until(
    () => evaluate(exists('.empty-actions .primary:not(:disabled)')),
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
  await click('[aria-label="New folder plane (⇧⌘N)"]');
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
/** The command palette's query and its selected result. */
function paletteState() {
  return {
    query: document.querySelector('[aria-label="Search commands"]')?.getAttribute('value') || '',
    selected: document.querySelector('.command-result[aria-selected="true"]')?.textContent || '',
  };
}
async function paletteCommand(label: string): Promise<void> {
  await click('[aria-label="Commands (⌘K)"]');
  await until(
    () => evaluate(pageCall(searchingCommands)),
    (present) => present,
    'focused command palette',
  );
  await command('Input.insertText', { text: label });
  await until(
    () => evaluate(pageCall(paletteState)),
    (value) => value.query === label && value.selected.includes(label),
    `command ${label}`,
  );
  await key('Enter', 'Enter');
  await until(
    () => evaluate(exists('[aria-label="Search commands"]')),
    (present) => !present,
    'closed command palette',
  );
  // The menu closes before its action runs on the next animation frame. Waiting
  // for two paints observes that action even when a native frame takes >60ms.
  await evaluate(animationFrames(2));
}
/**
 * Editing text: a file edited where it is previewed and saved with ⌘S, the version it
 * replaced in the Trash and back with Undo, and a scratch plane's text kept in the profile as it is
 * typed. Save As uses the native save panel, which this harness does not drive.
 */
/** The file query language: the folder filter reads terms, OR and -, keeps the
 * last query that read while one is half typed; :filter and :find take a query. */
const blurActive = () =>
  document.activeElement instanceof HTMLElement && document.activeElement.blur();
const commandLineFocused = () =>
  document.activeElement?.getAttribute('aria-label') === 'Command line';
const commandLineClosed = () => !document.querySelector('input[aria-label="Command line"]');
function selectCommandLine() {
  document.querySelector<HTMLInputElement>('input[aria-label="Command line"]')!.select();
}
async function verifyFileQueries(): Promise<void> {
  const shown = () =>
    evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('[data-file-path]'), (row) =>
          row.getAttribute('data-file-path')!.split('/').pop()!,
        ).sort(),
      ),
    );
  const filter = async (text: string) => {
    await evaluate(
      pageCall(() => {
        const input = document.querySelector<HTMLInputElement>('[aria-label="Find files"]')!;
        input.focus();
        input.select();
      }),
    );
    await command('Input.insertText', { text });
  };
  await click('[aria-label="Search this folder"]');
  await until(() => evaluate(exists('[aria-label="Find files"]')), Boolean, 'the folder filter');
  await filter('ext:md');
  await until(shown, (names) => names.join() === 'README.md', 'ext:md');
  await filter('kind:folder');
  await until(shown, (names) => names.length === 7 && !names.includes('README.md'), 'kind:folder');
  await filter('ext:tar OR ext:zip');
  await until(
    shown,
    (names) => names.join() === 'Reference files.tar,Reference files.zip',
    'ext:tar OR ext:zip',
  );
  // half typed: said under the filter, the last query that read still filtering
  await filter('ext:tar OR ext:zip size>');
  await until(
    () => evaluate(textOf('.search-problem')),
    (text) => text.includes('size>10mb'),
    'the problem said under the filter',
  );
  assert.deepEqual(await shown(), ['Reference files.tar', 'Reference files.zip']);
  await snapshot('filter-problem.png');
  await key('Escape', 'Escape');
  // the command line: :filter -kind:folder, then :find ext:md as a results plane
  const line = async (text: string) => {
    await evaluate(pageCall(blurActive));
    await key('b', 'KeyB', 2);
    await key(':', 'Semicolon', 8);
    await until(() => evaluate(pageCall(commandLineFocused)), Boolean, 'the command line');
    await command('Input.insertText', { text });
    await key('Enter', 'Enter');
    await until(() => evaluate(pageCall(commandLineClosed)), Boolean, `ran :${text}`);
  };
  await line('filter -kind:folder');
  await until(
    shown,
    (names) => names.length === 4 && names.every((name) => name.includes('.')),
    ':filter -kind:folder',
  );
  await snapshot('filter-line.png');
  await line('filter');
  await until(shown, (names) => names.length === 11, ':filter cleared');
  // a commander's pair: side by side, the other plane in Documents, ⌃⌘C copies there, < swaps
  await paletteCommand('View side by side');
  await until(
    () => evaluate(countOf('.plane-pair')),
    (count) => count === 2,
    'the two planes paired',
  );
  // a line runs once the palette has gone: each waits for what it did
  const titles = () =>
    evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.plane-title'), (title) => title.textContent),
      ),
    );
  const notice = () => evaluate(textOf('.notice'));
  await line('focus-pair');
  await line('cd Documents');
  await until(titles, (names) => names.includes('Documents'), ':cd Documents in the other plane');
  await line('focus-pair');
  await line('select README.md');
  await until(notice, (text) => text.includes('1 selected'), ':select README.md');
  await key('c', 'KeyC', 6);
  await until(
    () => evaluate(exists('[data-file-path$="/Documents/README.md"]')),
    Boolean,
    '⌃⌘C copied README.md to the other folder',
  );
  await snapshot('pair.png');
  const before = await titles();
  await key('b', 'KeyB', 2);
  await key('<', 'Comma', 8);
  await until(
    titles,
    (after) => after.join() === [...before].reverse().join(),
    'prefix < swapped the pair’s folders',
  );
  const planes = () => evaluate(countOf('[data-viewer-pane]'));
  const planeCount = await planes();
  await line('find ext:md');
  await until(planes, (count) => count === planeCount + 1, ':find opened a results plane');
  console.log(
    'File queries: ext:, kind:, OR, a half-typed term, :filter, a pair copying and swapping, :find.',
  );
}
/** The command line: prefix : opens it; lines split, set, repeat, report errors and
 * close every plane, unsaved text and all, with :qa!. */
async function verifyCommandLine(): Promise<void> {
  const saved = () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState);
  const blur = () => evaluate(pageCall(blurActive));
  const open = async () => {
    await blur();
    await key('b', 'KeyB', 2);
    await key(':', 'Semicolon', 8);
    await until(
      () => evaluate(pageCall(commandLineFocused)),
      (present) => present,
      'the command line after prefix :',
    );
  };
  const closed = () =>
    until(
      () => evaluate(pageCall(commandLineClosed)),
      (gone) => gone,
      'the command line closed',
    );
  const line = async (text: string) => {
    await open();
    await command('Input.insertText', { text });
    await key('Enter', 'Enter');
    await closed();
  };
  // what it can say, and completion
  await open();
  await command('Input.insertText', { text: 'help' });
  await until(
    () => evaluate(countOf('.command-palette .command-result')),
    (count) => count > 20,
    'help lists the verbs',
  );
  await snapshot('line-help.png');
  await evaluate(pageCall(selectCommandLine));
  await command('Input.insertText', { text: 'tab' });
  await key('Tab', 'Tab');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.querySelector('input[aria-label="Command line"]')?.getAttribute('value') ?? '',
        ),
      ),
    (value) => value.startsWith('tab'),
    'Tab completed',
  );
  await snapshot('line-completions.png');
  // > asks in words: without a model (or its permission), the way to one is offered
  await key('Escape', 'Escape');
  await key('Escape', 'Escape');
  await closed();
  await click('[aria-label="Commands (⌘K)"]');
  await until(() => evaluate(pageCall(searchingCommands)), Boolean, 'the palette');
  await command('Input.insertText', { text: '>sort by year' });
  await until(
    () => evaluate(textOf('.prompt-finder .command-result')),
    (text) => /Add a model|receive file names/.test(text),
    'the > mode offering a model',
  );
  await snapshot('prompt-mode.png');
  await key('Escape', 'Escape');
  await key('Escape', 'Escape');
  await open();
  await command('Input.insertText', { text: 'help' });
  // a line that does not parse points at its column and runs nothing
  await evaluate(pageCall(selectCommandLine));
  await command('Input.insertText', { text: 'vs | nosuch' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate(textOf('.line-error')),
    (text) => text.includes('Not a command: nosuch'),
    'the error under the line',
  );
  await snapshot('line-error.png');
  await key('Escape', 'Escape');
  await key('Escape', 'Escape');
  await closed();
  assert.equal((await saved()).workspaces[0]!.tiling, undefined);
  // :vs splits right; :2 tile-main-grow grows the main tile twice
  await line('vs');
  await until(
    async () => (await saved()).workspaces[0]!.tiling?.panes.length ?? 0,
    (count) => count === 2,
    ':vs tiled two planes',
  );
  await line('2 tile-main-grow');
  await until(
    async () => (await saved()).workspaces[0]!.tiling?.main ?? 0,
    (main) => Math.abs(main - (0.6 + 2 / 12)) < 0.001,
    ':2 tile-main-grow grew the main tile twice',
  );
  // :set nominimap | set minimap, by name; a first run's minimap waits for a third plane
  const minimap = () => evaluate(exists('[data-plurid-minimap]'));
  await line('set nominimapauto');
  await until(minimap, (shown) => shown, ':set nominimapauto');
  await line('set nominimap');
  await until(minimap, (shown) => !shown, ':set nominimap');
  await line('set minimap');
  await until(minimap, (shown) => shown, ':set minimap');
  // keys that speak lines: a key without the prefix bound for the session
  await line('bind -n M-m set minimap!');
  // a line runs once the palette has gone: the binding arrives a moment later
  await until(
    () =>
      evaluate(
        pageCall(() => window.viewer.sessionKeys().then((session) => session.bindings.length)),
      ),
    (count) => count === 1,
    ':bind kept for the session',
  );
  await blur();
  await key('µ', 'KeyM', 1);
  await until(minimap, (shown) => !shown, '⌥M ran :set minimap!');
  await key('µ', 'KeyM', 1);
  await until(minimap, (shown) => shown, '⌥M again');
  // prefix R: the resize mode, until Escape; 2 h grows the active right tile left twice
  const split = async () => {
    const tiling = (await saved()).workspaces[0]!.tiling;
    const tree = tiling && (tiling.tree ?? tileTree(tiling.panes, tiling.layout, tiling.main));
    return tree && 'ratio' in tree ? tree.ratio : 0;
  };
  const before = await split();
  await key('b', 'KeyB', 2);
  await key('R', 'KeyR', 8);
  await until(
    () => evaluate(textOf('.which-key')),
    (text) => text.includes('-- RESIZE --'),
    'the resize mode’s line',
  );
  await key('2', 'Digit2');
  await key('h', 'KeyH');
  await until(
    split,
    (now) => Math.abs(now - (before - 2 / 12)) < 0.001,
    '2 h moved the split between the tiles left twice',
  );
  await snapshot('line-mode.png');
  await key('Escape', 'Escape');
  await until(
    () => evaluate(pageCall(() => !document.querySelector('.which-key'))),
    (gone) => gone,
    'Escape left the mode',
  );
  // a command of your own, named for the session
  await line('command Mini set minimap!');
  await until(
    () =>
      evaluate(
        pageCall(() => window.viewer.sessionKeys().then((session) => session.aliases.length)),
      ),
    (count) => count === 1,
    ':command kept for the session',
  );
  await line('Mini');
  await until(minimap, (shown) => !shown, ':Mini ran');
  await line('Mini');
  await until(minimap, (shown) => shown, ':Mini again');
  // the palette shows each row's line, to learn by
  await click('[aria-label="Commands (⌘K)"]');
  await until(
    () => evaluate(pageCall(searchingCommands)),
    (present) => present,
    'focused command palette',
  );
  await command('Input.insertText', { text: 'grid' });
  await until(
    () => evaluate(textOf('.command-palette .command-line-hint')),
    (text) => text.startsWith(':'),
    'a row’s line beside it',
  );
  await snapshot('palette-line-hints.png');
  await key('Escape', 'Escape');
  // Settings keeps this session's keys and commands in config.jsonc
  await tab('Shortcuts');
  await until(
    () => settingsEvaluate(exists('.keymap-session')),
    Boolean,
    'this session’s keys in Settings',
  );
  await settingsEvaluate(
    pageCall(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.keymap-session button'))
        .find((button) => button.textContent.trim() === 'Keep')!
        .click(),
    ),
  );
  await until(
    () =>
      settingsEvaluate(
        pageCall(() =>
          window.viewer.settingsGet().then((value) => ({
            root: value.settings.keymap.root['Alt+m'] === 'set minimap!',
            command: value.settings.customActions.some(
              (action) => 'command' in action.executor && action.executor.command === 'Mini',
            ),
          })),
        ),
      ),
    (kept) => kept.root && kept.command,
    'Keep wrote them into config.jsonc',
  );
  await click('dialog [aria-label="Close"]');
  // :qa! closes every plane without asking about the scratch plane's text
  await blur();
  await key('t', 'KeyT', 4);
  await until(
    () => evaluate(exists('[data-scratch-plane] .cm-content')),
    (present) => present,
    'a scratch plane',
  );
  // it opens beside the tiles, perhaps past the window's edge: focused, not clicked
  await evaluate(focus('[data-scratch-plane] .cm-content'));
  await command('Input.insertText', { text: 'unsaved words' });
  await line('qa!');
  await until(
    () => evaluate(countOf('[data-viewer-pane]')),
    (count) => count === 0,
    ':qa! closed every plane',
  );
  console.log(
    'Command line: help, completion, errors, :vs, counts, :set, :bind -n, a mode, :command, Keep and :qa!.',
  );
}
/** Configuration and look: Focus mode, a workspace's own setting and a theme, in the
 * packaged app. */
async function verifyLook(): Promise<void> {
  const blur = () => evaluate(pageCall(blurActive));
  const chrome = () =>
    evaluate(
      pageCall(() => ({
        toolbar: !!document.querySelector('[data-plurid-entity="PluridToolbar"]'),
        minimap: !!document.querySelector('[data-plurid-minimap]'),
        titlebar: document.querySelector<HTMLElement>('.app-shell')?.dataset.titlebar ?? '',
      })),
    );
  await blur();
  // a first run is quiet: no space toolbar, and the minimap only once three planes are open
  assert.equal((await chrome()).toolbar, false);
  await paletteCommand('Show space toolbar');
  await paletteCommand('Turn off: Minimap only with 3 or more planes');
  await until(chrome, (now) => now.toolbar && now.minimap, 'the space toolbar and minimap shown');
  assert.deepEqual(await chrome(), { toolbar: true, minimap: true, titlebar: 'shown' });
  // ⇧⌘F: the chrome away, and back
  await key('f', 'KeyF', 12);
  await until(
    chrome,
    (now) => !now.toolbar && !now.minimap && now.titlebar === 'hidden',
    'Focus mode hides the chrome',
  );
  await key('f', 'KeyF', 12);
  await until(
    chrome,
    (now) => now.toolbar && now.minimap && now.titlebar === 'shown',
    'Focus mode left',
  );
  // this workspace's own: no minimap here, the general setting as it was
  await paletteCommand('This workspace: Hide minimap');
  await until(chrome, (now) => !now.minimap, 'the minimap hidden in this workspace');
  assert.equal(
    await evaluate(
      pageCall(() => window.viewer.settingsGet().then((value) => value.ui.space.minimap)),
    ),
    true,
  );
  await paletteCommand('Use the general settings in this workspace');
  await until(chrome, (now) => now.minimap, 'the general settings again');
  // settings apart in the palette: after the commands, a few, with their switches; `,` for them alone
  await click('[aria-label="Commands (⌘K)"]');
  await until(
    () => evaluate(pageCall(searchingCommands)),
    (present) => present,
    'focused command palette',
  );
  await command('Input.insertText', { text: 'grid' });
  const sections = await until(
    () =>
      evaluate(
        pageCall(() => ({
          headings: [...document.querySelectorAll('.command-palette .command-group')].map(
            (item) => item.textContent,
          ),
          switches: document.querySelectorAll('.command-palette .command-switch').length,
          first: document.querySelector('.command-result')?.textContent || '',
        })),
      ),
    (value) => value.headings.includes('Settings') && value.switches > 0,
    'a Settings section for grid',
  );
  assert.match(sections.first, /grid/i);
  await snapshot('palette-settings-section.png');
  await evaluate(
    pageCall(() =>
      document.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!.select(),
    ),
  );
  await command('Input.insertText', { text: ',' });
  await until(
    () => evaluate(countOf('.command-palette .is-setting')),
    (count) => count > 30,
    'every setting after a comma',
  );
  await snapshot('palette-settings-search.png');
  // a setting's choices are one row with its value; choosing it lists them
  await command('Input.insertText', { text: 'appearance' });
  await until(
    () =>
      evaluate(
        pageCall(() => ({
          label:
            document.querySelector(
              '.command-result[aria-selected="true"] .command-result-text > span',
            )?.textContent || '',
          value:
            document.querySelector('.command-result[aria-selected="true"] .command-value')
              ?.textContent || '',
        })),
      ),
    (row) => row.label === 'Appearance' && !!row.value,
    'Appearance as one row with its value',
  );
  await key('Enter', 'Enter');
  await until(
    () =>
      evaluate(
        pageCall(() =>
          [...document.querySelectorAll('.command-palette .command-result-text > span')].map(
            (item) => item.textContent,
          ),
        ),
      ),
    (labels) => labels.length === 3 && labels.every((label) => label?.startsWith('Appearance: ')),
    'the choices of Appearance',
  );
  await snapshot('palette-settings-choices.png');
  await key('Escape', 'Escape');
  await until(
    () => evaluate(exists('[aria-label="Search commands"]')),
    (present) => present,
    'back to the commands',
  );
  await key('Escape', 'Escape');
  // a theme: its accent is the page's
  await patchInSettings(
    {
      path: 'settings.themes',
      value: [
        {
          id: 'smoke',
          name: 'Smoke',
          look: 'dark',
          shell: { accent: '#ff8800' },
          syntax: {},
          terminal: {},
        },
      ],
    },
    { path: 'settings.theme', value: { dark: 'smoke', light: '' } },
  );
  await tab('Themes');
  await snapshot('themes-settings.png');
  await tab('Shortcuts');
  await snapshot('shortcuts-settings.png');
  await click('dialog [aria-label="Close"]');
  await until(
    () =>
      evaluate(
        pageCall(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
      ),
    (accent) => accent === '#ff8800',
    "the theme's accent on the page",
  );
  console.log("Look: Focus mode and back, a workspace's own minimap, and a theme's colours.");
}
/** The space: views flown back to, tmux-style tiling, Explode folder and layout
 * templates, in the packaged app. */
/** Each pane's plane rectangle, rounded. */
const paneRects = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-viewer-pane]'), (marker) => {
    const rect = marker.closest('[data-plurid-plane]')!.getBoundingClientRect();
    return {
      pane: marker.dataset.viewerPane!,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    };
  });
async function verifySpace(): Promise<void> {
  const saved = () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState);
  const blur = () => evaluate(pageCall(blurActive));
  const prefix = () => key('b', 'KeyB', 2);
  const camera = () =>
    evaluate(
      pageCall(() => {
        const camera = (window as unknown as SmokeWindow).__qaEngine.camera.get();
        return { x: Math.round(camera.offset.x), y: Math.round(camera.offset.y) };
      }),
    );
  const rects = () => evaluate(pageCall(paneRects));
  const tiles = async () => {
    const state = await saved();
    const tiling = state.workspaces[0]!.tiling;
    const all = await rects();
    return (tiling?.panes ?? []).map((id) => all.find((rect) => rect.pane === id)!).filter(Boolean);
  };
  await blur();
  // ⌃⌥⌘1 saves the camera as view 1; after the camera moves, ⌥⌘1 flies back
  const start = await camera();
  await key('1', 'Digit1', 7);
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            (window as unknown as SmokeWindow).__qaEngine.bookmarks
              .get()
              .filter((entry) => entry.source === 'bookmark').length,
        ),
      ),
    (count) => count === 1,
    'view 1 saved',
  );
  await evaluate(
    pageCall(() =>
      (window as unknown as SmokeWindow).__qaEngine.camera.moveBy({ pan: { x: 320, y: 160 } }),
    ),
  );
  await until(camera, (now) => now.x !== start.x || now.y !== start.y, 'the camera moved');
  await key('1', 'Digit1', 5);
  await until(
    camera,
    (now) => Math.abs(now.x - start.x) <= 2 && Math.abs(now.y - start.y) <= 2,
    'flown back to view 1',
  );
  // ⌃B %: the folder and a copy side by side; ⌃B Space: stacked
  await prefix();
  await key('%', 'Digit5', 8);
  await until(
    tiles,
    (list) =>
      list.length === 2 &&
      Math.abs(list[0]!.top - list[1]!.top) <= 2 &&
      list[0]!.right < list[1]!.left,
    'two planes tiled side by side',
  );
  await snapshot('tiled.png');
  await prefix();
  await key(' ', 'Space');
  await until(
    tiles,
    (list) =>
      list.length === 2 &&
      Math.abs(list[0]!.left - list[1]!.left) <= 2 &&
      list[0]!.bottom < list[1]!.top,
    'stacked by the next layout',
  );
  // ⌃B e: the active folder's subfolders as planes; ⌃B E: gone again
  const count = async () => (await saved()).workspaces[0]!.panes.length;
  const before = await count();
  await prefix();
  await key('e', 'KeyE');
  await until(count, (now) => now >= before + 3, 'subfolders opened as planes');
  await snapshot('exploded.png');
  await prefix();
  await key('E', 'KeyE', 8);
  await until(count, (now) => now === before, 'exploded planes collapsed');
  // a template of the planes in view, opened again tiled
  await paletteCommand('Save layout as template…');
  await until(() => evaluate(exists('dialog[open] input')), Boolean, 'the template name dialog');
  await command('Input.insertText', { text: 'Pair' });
  await click('dialog[open] footer .primary');
  await until(
    () =>
      evaluate(
        pageCall(() => window.viewer.settingsGet().then((value) => value.settings.layouts.length)),
      ),
    (layouts) => layouts === 1,
    'the template saved',
  );
  const panes = await count();
  await paletteCommand('Open layout “Pair”');
  await until(count, (now) => now === panes + 2, 'the template opened its planes');
  await until(tiles, (list) => list.length === 2, 'the template’s planes tiled');
  await prefix();
  await key('!', 'Digit1', 8);
  await until(
    () => saved().then((state) => !state.workspaces[0]!.tiling),
    Boolean,
    'tiling stopped',
  );
  console.log(
    'Space: a view flown back to, tiling split and relaid, Explode and Collapse, and a layout template.',
  );
}
/** The key layer: tmux's prefix and which-key, plane hints, the palette's calculator
 * and Record macro, in the packaged app. */
async function verifyKeys(): Promise<void> {
  const saved = () => readFile(stateFile, 'utf8').then((raw) => JSON.parse(raw) as SavedState);
  const blur = () => evaluate(pageCall(blurActive));
  const prefix = () => key('b', 'KeyB', 2);
  const whichKey = () => evaluate(countOf('.which-key-list li'));
  const activePlane = () =>
    evaluate(
      pageCall(
        () =>
          document.querySelector<HTMLElement>(
            '[data-plurid-plane][data-plurid-scroll-selected="true"] [data-viewer-pane]',
          )?.dataset.viewerPane ?? '',
      ),
    );
  await blur();
  // ⌃B ? lists every binding; Escape closes it
  await prefix();
  await key('?', 'Slash', 8);
  await until(whichKey, (count) => count >= 20, 'which-key lists the bindings');
  await snapshot('which-key.png');
  await key('Escape', 'Escape');
  await until(whichKey, (count) => count === 0, 'which-key closed');
  // ⌃B c: a terminal plane
  await prefix();
  await key('c', 'KeyC');
  await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'terminal'),
    'terminal plane by ⌃B c',
  );
  await until(() => evaluate(exists('.terminal-plane .xterm')), Boolean, 'terminal attached');
  await delay(400);
  await blur();
  // ⌃B f: a label on each plane; typing one makes it the active plane
  await prefix();
  await key('f', 'KeyF');
  const hints = await until(
    () =>
      evaluate(
        pageCall(() =>
          Array.from(document.querySelectorAll<HTMLElement>('.plane-hint'), (hint) => ({
            label: hint.textContent,
            pane: hint.dataset.pane!,
          })),
        ),
      ),
    (list) => list.length >= 2,
    'plane hints',
  );
  await snapshot('plane-hints.png');
  const current = await activePlane();
  const choice = hints.find((hint) => hint.pane !== current)!;
  for (const letter of choice.label) await key(letter, 'Key' + letter.toUpperCase());
  await until(activePlane, (id) => id === choice.pane, 'the hinted plane active');
  // ⌃B o: the next plane
  await prefix();
  await key('o', 'KeyO');
  await until(activePlane, (id) => !!id && id !== choice.pane, 'the next plane active');
  // the palette calculates
  await blur();
  await key('k', 'KeyK', 4);
  await until(() => evaluate(pageCall(searchingCommands)), Boolean, 'command palette');
  await command('Input.insertText', { text: '= 6*7' });
  await until(
    () => evaluate(textOf('.command-result')),
    (row) => row.includes('= 42'),
    'the calculator row',
  );
  await key('Escape', 'Escape');
  // ⌃B q records the commands run until ⌃B q again, then saves them as a sequence
  await blur();
  await prefix();
  await key('q', 'KeyQ');
  const recording = () => evaluate(textOf('.macro-recording'));
  await until(recording, (text) => text.includes('Recording'), 'recording a macro');
  await key('s', 'KeyS', 5);
  await until(recording, (text) => text.includes('1'), 'one command recorded');
  await key('s', 'KeyS', 5);
  await until(recording, (text) => text.includes('2'), 'two commands recorded');
  await prefix();
  await key('q', 'KeyQ');
  await until(() => evaluate(exists('dialog[open] input')), Boolean, 'the macro name dialog');
  // a key sent here carries no character, so it submits no form: Save is clicked
  await click('dialog[open] footer .primary');
  await until(
    () =>
      evaluate(
        pageCall(() =>
          window.viewer
            .settingsGet()
            .then((value) =>
              value.settings.customActions.flatMap((action) =>
                action.executor.kind === 'sequence' ? [action.executor.commands] : [],
              ),
            ),
        ),
      ),
    (sequences) =>
      sequences.some((commands) => commands.join() === 'toggle-sidebar,toggle-sidebar'),
    'the recorded macro saved as a sequence',
  );
  // Settings → Shortcuts: the prefix is recorded by pressing it; then ⌃A starts a sequence
  await tab('Shortcuts');
  await settingsEvaluate(clickElement('[aria-label="Prefix"]'));
  await until(
    () => settingsEvaluate(requiredText('[aria-label="Prefix"]')),
    (text) => text.includes('Press'),
    'the prefix listening',
  );
  for (const type of ['keyDown', 'keyUp'] as const)
    await settingsCommand('Input.dispatchKeyEvent', {
      type,
      key: 'a',
      code: 'KeyA',
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
  await until(
    () =>
      evaluate(
        pageCall(() => window.viewer.settingsGet().then((value) => value.settings.keymap.prefix)),
      ),
    (prefix) => prefix === 'Ctrl+A',
    'the prefix recorded as ⌃A',
  );
  await click('dialog [aria-label="Close"]');
  await blur();
  await key('a', 'KeyA', 2);
  await until(
    () => evaluate(textOf('.which-key-trail')),
    (trail) => trail === '⌃A',
    'which-key after ⌃A',
  );
  await key('Escape', 'Escape');
  console.log(
    'Keys: ⌃B and which-key, a terminal by ⌃B c, plane hints and the next plane, the calculator, a recorded macro, and the prefix set in Settings by pressing it.',
  );
}
/** The text toolbar holding the language choice: its items' labels and heights, its edge. */
function languageToolbar() {
  const bar = [...document.querySelectorAll('.text-editing-toolbar')].find((item) =>
    item.querySelector('[aria-label="Language"]'),
  );
  const items = [...(bar ? bar.children : [])];
  const choice = bar?.querySelector('[aria-label="Language"]');
  return {
    order: items.map((item) => item.getAttribute('aria-label') || item.textContent.trim()),
    heights: items.map((item) => Math.round(item.getBoundingClientRect().height)),
    edge: choice ? getComputedStyle(choice).borderTopColor : '',
  };
}
const spaceStyle = (property: 'backgroundColor' | 'backgroundImage') =>
  getComputedStyle(document.querySelector('[data-plurid-entity="PluridSpace"]')!)[property];
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
  await until(() => evaluate(exists(edit)), Boolean, 'Edit offered');
  await click(edit);
  await until(
    () =>
      evaluate(pageCall(() => document.activeElement?.classList.contains('cm-content') === true)),
    Boolean,
    'focused editor',
  );
  await command('Input.insertText', { text: 'After ' });
  await key('s', 'KeyS', 4);
  if (removalBlocked) {
    const refused = await until(
      () => evaluate(pageCall(viewerJobs)),
      (jobs) => jobs.some((job) => job.kind === 'rewrite' && job.status === 'failed'),
      'refused save',
    ).then((jobs) => jobs.findLast((job) => job.kind === 'rewrite')!);
    assert.match(refused.errors[0]?.message ?? '', /^Automated native tests cannot move /);
    assert.equal(await readFile(note, 'utf8'), '# Before\n', 'A refused save keeps the file');
  } else {
    await until(
      () => readFile(note, 'utf8'),
      (value) => value === 'After # Before\n',
      'saved note',
    );
    const jobs = await evaluate(pageCall(viewerJobs));
    const save = jobs.findLast((job) => job.kind === 'rewrite');
    assert.equal(save?.status, 'completed', JSON.stringify(save?.errors));
    assert.equal(save?.undoable, true);
    await evaluate(pageCall((id: string) => window.viewer.undo(id), save!.id));
    await until(
      () => readFile(note, 'utf8'),
      (value) => value === '# Before\n',
      'Undo put back the version the save replaced',
    );
  }
  await key('t', 'KeyT', 4);
  await until(
    saved,
    (state) => state.workspaces[0]!.panes.some((pane) => pane.type === 'scratch'),
    'scratch plane',
  );
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            !!document.activeElement?.closest('[data-scratch-plane]') &&
            document.activeElement!.classList.contains('cm-content'),
        ),
      ),
    Boolean,
    'focused scratch editor',
  );
  await command('Input.insertText', { text: 'scratch text' });
  await until(
    () => evaluate(pageCall(() => window.viewer.bufferList())),
    (list) => list.buffers.some((buffer) => buffer.kind === 'scratch' && buffer.bytes === 12),
    'scratch text kept in the profile',
  );
  // Find in text: Viewer's own find over the text, never CodeMirror's panel
  await key('f', 'KeyF', 4);
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            !!document.querySelector('[data-scratch-plane] .editor-find') &&
            document.activeElement?.getAttribute('aria-label') === 'Find',
        ),
      ),
    Boolean,
    "Viewer's find over the scratch text",
  );
  assert.equal(await evaluate(exists('.cm-search')), false);
  await command('Input.insertText', { text: 'text' });
  await until(
    () => evaluate(textOf('[data-scratch-plane] .editor-find-count')),
    (count) => count === '1 / 1',
    'find counts the match',
  );
  await snapshot('text-find.png');
  await key('Escape', 'Escape');
  await until(
    () => evaluate(pageCall(() => !document.querySelector('.editor-find'))),
    Boolean,
    'find closed',
  );
  // Save before the language choice, so the choice keeps its place; one height, filled to the edge
  const header = await evaluate(pageCall(languageToolbar));
  assert.deepEqual(header.order, ['Save…', 'Language']);
  assert.equal(new Set(header.heights).size, 1, JSON.stringify(header.heights));
  assert.equal(header.edge, 'rgba(0, 0, 0, 0)');
  // plurid's controls solid, and a see-through space only between planes
  assert.equal(
    await evaluate(
      pageCall(() =>
        getComputedStyle(document.querySelector('.workspace-surface [data-plurid-application]')!)
          .getPropertyValue('--plurid-opacity-persistent')
          .trim(),
      ),
    ),
    '1',
  );
  await patchInSettings({ path: 'ui.space.backdrop', value: 'blur' });
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.backdrop ?? '')),
    (backdrop) => backdrop === 'blur',
    'blurred backdrop applied',
  );
  const backdrop = await evaluate(
    pageCall(() => ({
      space: getComputedStyle(document.querySelector('[data-plurid-entity="PluridSpace"]')!)
        .backgroundColor,
      titlebar: getComputedStyle(document.querySelector('.app-titlebar')!).backgroundColor,
    })),
  );
  assert.match(backdrop.space, /\/ 0\.6\)|, 0\.6\)/, backdrop.space);
  assert.match(backdrop.titlebar, /^rgb\(/, backdrop.titlebar);
  await patchInSettings({ path: 'ui.space.backdrop', value: 'opaque' });
  // ⌥⌘T hides the title bar and shows it again; the grid; a workspace's own colour
  const titlebarState = () =>
    evaluate(
      pageCall(() => document.querySelector<HTMLElement>('.app-shell')?.dataset.titlebar ?? ''),
    );
  // the native menu takes ⌥⌘T anywhere; these keys reach the page itself, which leaves an
  // editor's keys to the editor
  await evaluate(pageCall(blurActive));
  await key('t', 'KeyT', 5);
  await until(titlebarState, (state) => state === 'hidden', 'title bar hidden by ⌥⌘T');
  await delay(300);
  assert.ok(
    (await evaluate(
      pageCall(() => document.querySelector('.app-titlebar')!.getBoundingClientRect().bottom),
    )) <= 1,
  );
  await key('t', 'KeyT', 5);
  await until(titlebarState, (state) => state === 'shown', 'title bar shown by ⌥⌘T');
  await paletteCommand('Workspace look…');
  await until(
    () => evaluate(exists('dialog [aria-label="Ocean"]')),
    Boolean,
    'workspace background dialog',
  );
  await click('dialog [aria-label="Ocean"]');
  await until(
    () => evaluate(pageCall(spaceStyle, 'backgroundColor')),
    (color) => color === 'rgb(15, 38, 51)',
    "the workspace's colour on its space",
  );
  await snapshot('workspace-background.png');
  await click('dialog footer .primary');
  await paletteCommand('Hide background grid');
  await until(
    () => evaluate(pageCall(spaceStyle, 'backgroundImage')),
    (image) => !image.includes('gradient'),
    'grid hidden',
  );
  await paletteCommand('Show background grid');
  // every setting is a command: plurid's minimap goes and comes back; always, not only from the
  // third plane as on a first run
  const minimap = () => evaluate(exists('[data-plurid-minimap]'));
  await paletteCommand('Turn off: Minimap only with 3 or more planes');
  await until(minimap, Boolean, 'the minimap shown always');
  await paletteCommand('Hide minimap');
  await until(minimap, (shown) => !shown, 'minimap hidden by its command');
  await paletteCommand('Show minimap');
  await until(minimap, Boolean, 'minimap shown by its command');
  await until(
    () => evaluate(pageCall(spaceStyle, 'backgroundImage')),
    (image) => image.includes('gradient'),
    'grid shown',
  );
  console.log(
    'Text editing: ' +
      (removalBlocked ? 'save refused in automated runs' : 'saved, undone') +
      ", scratch text kept, Viewer's find, and the header's Save; a see-through space between solid controls; the title bar hidden and shown, the grid, and a workspace's colour.",
  );
}
/** Additional release checks against the actual signed Electron bundle. Files remain untouched. */
/** The workspace surface's bounds and each folder plane's, with its pane id. */
function folderPlaneBounds() {
  const bounds = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  return {
    canvas: bounds(document.querySelector('.workspace-surface')!),
    planes: Array.from(
      document.querySelectorAll('[data-plurid-plane]:has(.folder-plane)'),
      (element) => ({
        id: element.querySelector<HTMLElement>('[data-viewer-plane]')!.dataset.viewerPlane!,
        ...bounds(element),
      }),
    ),
  };
}
const titleOf = (selector: string) => document.querySelector<HTMLElement>(selector)!.title;
async function verifyPublishedPlaneInput(): Promise<void> {
  const sourceID = fixture.state.workspaces[0].roots[0];
  const plane = (id: string) =>
    `[data-plurid-plane]:has([data-viewer-plane=${JSON.stringify(id)}])`;
  const folders = () => evaluate(pageCall(folderPlaneBounds));
  const camera = () => evaluate(pageCall(cameraJSON));
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
    () => evaluate(pageCall(titleOf, plane(peerID) + ' .plane-heading')),
    (value) => value.endsWith('/Documents'),
    'independent peer navigation',
  );
  assert.equal(
    await evaluate(pageCall(titleOf, plane(sourceID) + ' .plane-heading')),
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
    evaluate(
      pageCall(
        (selector: string) => document.querySelector(selector)!.scrollTop,
        top + ' .sidebar-scroll',
      ),
    );
  const point = () =>
    evaluate(
      pageCall((selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { x: rect.x + 60, y: rect.y + 80 };
      }, top + ' .sidebar-scroll'),
    );
  const wheel = async (deltaY: number, modifiers = 0) =>
    command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...(await point()),
      deltaX: 0,
      deltaY,
      modifiers,
    });
  // The palette returned focus to its ⌘K button, outside the space; Escape releases the plane that
  // holds the wheel only from inside it.
  await evaluate(focus(`${top} .folder-explorer`));
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
      evaluate(
        pageCall(
          (selector: string) =>
            document.querySelector<HTMLElement>(selector)!.dataset.scrollSelected === 'true',
          top + ' [data-viewer-plane]',
        ),
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
  await until(() => evaluate(exists('dialog[open]')), Boolean, 'Space preview');
  before = await camera();
  const previewPoint = await evaluate(pageCall(centreOf, 'dialog[open]'));
  await command('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...previewPoint,
    deltaX: 0,
    deltaY: 120,
    modifiers: 8,
  });
  await evaluate(animationFrames(2));
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

const transformMode = () =>
  (window as unknown as SmokeWindow).__qaEngine.getSnapshot().configuration.space.transformMode;
async function verifySpatialTools(): Promise<void> {
  // a first run has no space toolbar
  if (!(await evaluate(exists('[data-plurid-entity="PluridToolbar"]'))))
    await paletteCommand('Show space toolbar');
  await until(() => evaluate(exists('[aria-label="Rotate mode"]')), Boolean, 'the space toolbar');
  await click('[aria-label="Rotate mode"]');
  assert.equal(await evaluate(pageCall(transformMode)), 'ROTATION');
  await paletteCommand('Finish spatial tool');
  assert.equal(await evaluate(pageCall(transformMode)), 'ALL');
  await paletteCommand('Translate space');
  assert.equal(await evaluate(pageCall(transformMode)), 'TRANSLATION');
  await key('Escape', 'Escape');
  assert.equal(await evaluate(pageCall(transformMode)), 'ALL');
}
async function appearance(look: 'dark' | 'light'): Promise<void> {
  await paletteCommand('Settings');
  await openSettingsProbe();
  await tab('Browsing');
  await until(
    () => settingsEvaluate(exists('[aria-label="Appearance"]')),
    (present) => present,
    'appearance setting',
  );
  await choose('Appearance', look, settingsEvaluate);
  await until(
    () => evaluate(pageCall(pageLook)),
    (value) => value === look,
    'changed appearance',
  );
  await click('dialog [aria-label="Close"]');
}
async function preview(file: string, expected: string): Promise<void> {
  await click(fileSelector(file));
  await until(
    () =>
      evaluate(
        pageCall(
          (row: string) => document.querySelector(row)?.getAttribute('aria-selected') === 'true',
          fileSelector(file),
        ),
      ),
    Boolean,
    `selected preview source ${path.basename(file)}`,
  );
  await key(' ', 'Space');
  await until(text, (value) => value.includes(expected), `preview ${path.basename(file)}`);
  console.log(`Preview: ${path.basename(file)}`);
}
/** Where the fixture's 200 by 100 rectangle corners fall on the fitted drawing stage. */
function drawingCorners() {
  const stage = document.querySelector('.dxf-stage')!.getBoundingClientRect(),
    scale = Math.min((stage.width - 80) / 200, (stage.height - 80) / 100);
  return [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ].map(([x, y]) => ({
    x: stage.left + stage.width / 2 + (x - 100) * scale,
    y: stage.top + stage.height / 2 - (y - 50) * scale,
  }));
}
/** Records each label the drawing canvas paints in `window.__qaDrawingLabels`. */
function recordDrawingLabels() {
  const context = document.querySelector<HTMLCanvasElement>('.dxf-stage canvas')!.getContext('2d')!;
  const original = context.fillText.bind(context);
  const page = window as unknown as SmokeWindow;
  page.__qaDrawingLabels = [];
  context.fillText = (value, x, y, ...args) => {
    page.__qaDrawingLabels.push({ value, x, y, width: context.measureText(value).width });
    original(value, x, y, ...args);
  };
  page.__qaDrawingRestore = () => {
    context.fillText = original;
  };
}
/** Whether the area label lies outside the floating readout. */
function areaLabelClear() {
  const readout = document.querySelector<HTMLElement>('.dxf-readout')!;
  const label = (window as unknown as SmokeWindow).__qaDrawingLabels.find(
    (row) => row.value === '31 in²',
  );
  return (
    !!label &&
    (label.x >= readout.offsetLeft + readout.offsetWidth ||
      label.x + label.width <= readout.offsetLeft ||
      label.y - 14 >= readout.offsetTop + readout.offsetHeight ||
      label.y <= readout.offsetTop)
  );
}
/** Whether the draft controls, units and instructions fit the drawing status bar. */
function draftControlsFit() {
  const row = document.querySelector('.dxf-info')!.getBoundingClientRect();
  const finish = document.querySelector<HTMLButtonElement>('.dxf-draft-controls button')!;
  const actions = document.querySelector('.dxf-draft-controls')!.getBoundingClientRect();
  const units = document.querySelector('.dxf-units')!.getBoundingClientRect();
  const instructions = document.querySelector<HTMLElement>('.dxf-guidance > span:first-child')!;
  return (
    !finish.disabled &&
    actions.right <= row.right &&
    actions.top >= row.top &&
    actions.bottom <= row.bottom &&
    units.right <= actions.left &&
    instructions.title.includes('Enter') &&
    document.querySelector<HTMLElement>('.dxf-info')!.offsetHeight === 34
  );
}
/** Whether the drawing canvas's corner shows its `--field` colour. */
function paintsFieldColour() {
  const canvas = document.querySelector<HTMLCanvasElement>('.dxf-stage canvas')!;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = getComputedStyle(canvas).getPropertyValue('--field').trim();
  probe.fillRect(0, 0, 1, 1);
  const expected = probe.getImageData(0, 0, 1, 1).data;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, 8, 8).data;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] === expected[0] && pixels[i + 1] === expected[1] && pixels[i + 2] === expected[2])
      return true;
  return false;
}
/** Whether a linked drawing's name, details and guidance line up before its open action. */
function drawingHeaderAligned() {
  const host = document.querySelector('.preview-host[data-preview-module="dxf"]')!;
  const name = host.querySelector('.preview-filename')!.getBoundingClientRect();
  const details = host.querySelector('.preview-file-details')!.getBoundingClientRect();
  const guide = host.querySelector('.dxf-guidance')!.getBoundingClientRect();
  const open = host.querySelector('.preview-info button')!.getBoundingClientRect();
  return (
    Math.abs(name.left - guide.left) < 1 &&
    details.left >= name.right &&
    details.left - name.right < 12 &&
    details.right < open.left
  );
}
async function verifyDrawingsAndWorkspaces(): Promise<void> {
  await preview(path.join(fixture.files, 'Panel.dxf'), 'Click geometry');
  await until(
    () => evaluate(exists('.dxf-viewer[data-dxf-entities="6"]')),
    Boolean,
    'parsed drawing in worker',
  );
  assert.equal(
    await evaluate(
      pageCall(() => document.querySelector<HTMLElement>('.dxf-viewer')!.dataset.dxfUnits),
    ),
    '4',
  );
  const checkDrawingToolbar = async (selector: string, height: number, count: number) => {
    const controls = await evaluate(
      pageCall(
        (selector: string) =>
          Array.from(document.querySelectorAll<HTMLElement>(selector), (element) => ({
            height: element.offsetHeight,
            center:
              element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
          })),
        selector,
      ),
    );
    assert.ok(controls.length >= count, 'All drawing tools are present');
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
  await checkDrawingToolbar('.quick-preview .preview-toolbar > button', 30, 5);
  assert.equal(
    await evaluate(pageCall(() => document.querySelector<HTMLElement>('.dxf-info')!.offsetHeight)),
    34,
    'Quick Preview retains the compact drawing status bar',
  );
  assert.equal(
    await evaluate(
      pageCall(() => {
        const guide = document
          .querySelector('.dxf-guidance > span:first-child')!
          .getBoundingClientRect();
        const units = document.querySelector('.dxf-units')!.getBoundingClientRect();
        return units.left >= guide.right && units.left - guide.right < 12;
      }),
    ),
    true,
    'Drawing units stay beside the instructions',
  );
  const tool = async (value: string) => {
    await choose('Drawing tool', value);
    await evaluate(animationFrames(2));
  };
  const corners = () => evaluate(pageCall(drawingCorners));
  const pick = async (point: { x: number; y: number }) => {
    assert.equal(
      await evaluate(
        pageCall(
          (x: number, y: number) => document.elementFromPoint(x, y)?.tagName,
          point.x,
          point.y,
        ),
      ),
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
    () => evaluate(textOf('[data-dxf-last-measurement]')),
    (value) => value.includes('200 mm'),
    'snapped model-space distance',
  );
  await tool('angle');
  await pick(points[1]);
  await pick(points[0]);
  await pick(points[3]);
  await until(
    () => evaluate(textOf('[data-dxf-last-measurement]')),
    (value) => value.includes('90.00°'),
    'three-point angle',
  );
  await tool('area');
  for (const point of points) await pick(point);
  await key('Enter', 'Enter');
  await until(
    () => evaluate(textOf('[data-dxf-last-measurement]')),
    (value) => value.includes('20,000 mm²'),
    'closed polygon area',
  );
  await click('[aria-label="Show drawing details"]');
  assert.equal(await evaluate(countOf('.dxf-measurement')), 3);
  await choose('Drawing measurement units', '1');
  await until(
    () => evaluate(textOf('[data-dxf-last-measurement]')),
    (value) => value.includes('31 in²'),
    'square unit conversion',
  );
  // Opening details changes the drawing viewport: fit mode must reframe, not clip geometry.
  await tool('distance');
  const detailPoints = await corners();
  await pick(detailPoints[0]);
  await pick(detailPoints[1]);
  await until(
    () => evaluate(textOf('[data-dxf-last-measurement]')),
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
  await evaluate(animationFrames(2));
  const compactPoints = await corners();
  await pick(compactPoints[0]);
  await pick(compactPoints[1]);
  await until(
    () => evaluate(countOf('.dxf-measurement')),
    (count) => count === 5,
    'fitted drawing remains measurable after window resize',
  );
  const compactBounds = await evaluate(
    pageCall(() => {
      const viewer = document.querySelector('.dxf-viewer')!;
      return {
        overflow: viewer.scrollWidth > viewer.clientWidth,
        bottom: viewer.getBoundingClientRect().bottom,
      };
    }),
  );
  assert.equal(compactBounds.overflow, false);
  assert.ok(compactBounds.bottom <= 560);
  // Observe actual canvas text placements rather than duplicating its placement calculation.
  await evaluate(pageCall(recordDrawingLabels));
  await click('[aria-label="Fit drawing"]');
  await evaluate(animationFrames(2));
  assert.equal(
    await evaluate(pageCall(areaLabelClear)),
    true,
    'The complete area annotation stays outside the floating readout in the minimum window',
  );
  await evaluate(pageCall(() => (window as unknown as SmokeWindow).__qaDrawingRestore()));
  await snapshot('desktop-native-dxf-minimum.png');
  await tool('area');
  for (const point of compactPoints.slice(0, 3)) await pick(point);
  assert.equal(
    await evaluate(pageCall(draftControlsFit)),
    true,
    'Area instructions, units and enabled draft controls fit in the minimum window',
  );
  await snapshot('desktop-native-dxf-draft-minimum.png');
  await click('[aria-label="Cancel measurement"]');
  await tool('distance');
  await command('Emulation.clearDeviceMetricsOverride');
  const setLook = async (look: 'dark' | 'light') => {
    await evaluate(patchSettings({ path: 'settings.appearance', value: look }));
    await until(
      () => evaluate(pageCall(pageLook)),
      (value) => value === look,
      'drawing appearance update',
    );
    await until(
      () => evaluate(pageCall(paintsFieldColour)),
      Boolean,
      `canvas painted the live ${look} palette`,
    );
  };
  await setLook('light');
  await snapshot('desktop-native-dxf-light.png');
  await setLook('dark');
  const camera = await evaluate(pageCall(cameraJSON));
  await click('.dxf-stage canvas');
  await key('ArrowRight', 'ArrowRight', 8);
  assert.equal(
    await evaluate(pageCall(cameraJSON)),
    camera,
    'Drawing keys do not rotate the Plurid camera',
  );
  await evaluate(clickElement('.dxf-layer input'));
  await click('[aria-label="Fit drawing"]');
  await evaluate(clickElement('.dxf-layer input'));
  await closePreview();
  await preview(path.join(fixture.files, 'Broken.dxf'), 'Drawing could not be loaded');
  await closePreview();
  // Exercise the same module in an actual linked Plurid plane with header controls.
  await click(fileSelector(path.join(fixture.files, 'Panel.dxf')), 2);
  await settleCamera();
  await until(
    () => evaluate(exists('.plane-module-controls [aria-label="Drawing tool"]')),
    Boolean,
    'drawing tools in plane header',
  );
  // the plane's Essential header leaves the drawing grid to "…"
  await checkDrawingToolbar('.plane-module-controls .preview-toolbar > button', 28, 4);
  await paletteCommand('Measure distance');
  await until(
    () => evaluate(textOf(choiceButton('Drawing tool'))),
    (value) => value === 'Distance',
    'searchable preview measurement command',
  );
  assert.equal(
    await evaluate(pageCall(drawingHeaderAligned)),
    true,
    'Linked drawing filename, type and size form one aligned group before the external-open action',
  );
  await snapshot('desktop-native-dxf-plane.png');
  if (process.env.VIEWER_TEST_DXF_FILE) {
    await paletteCommand('Close plane');
    await preview(path.join(fixture.files, 'User panel.dxf'), 'Click geometry');
    await until(
      () => evaluate(exists('.dxf-viewer[data-dxf-entities="5"]')),
      Boolean,
      'user drawing geometry',
    );
    await click('[aria-label="Show drawing details"]');
    await snapshot('desktop-native-dxf-user-panel.png');
    await closePreview();
  }
  await paletteCommand('Change workspace');
  await until(
    () => evaluate(pageCall(activeLabel)),
    (value) => value === 'Search workspaces',
    'workspace picker focus',
  );
  assert.deepEqual(
    await evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.command-result'), (row) => row.textContent.trim()),
      ),
    ).then((value) =>
      value.map((row) =>
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
  const pickerBounds = await evaluate(
    pageCall(() => {
      const picker = document.querySelector('.command-palette')!;
      return {
        bottom: picker.getBoundingClientRect().bottom,
        overflow: picker.scrollWidth > picker.clientWidth,
      };
    }),
  );
  assert.ok(pickerBounds.bottom <= 560);
  assert.equal(pickerBounds.overflow, false);
  await snapshot('desktop-native-workspace-picker-minimum.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await key('Escape', 'Escape');
  await until(
    () => evaluate(pageCall(activeLabel)),
    (value) => value === 'Search commands',
    'workspace picker Escape returns to commands',
  );
  await command('Input.insertText', { text: 'Engineering' });
  await key('Enter', 'Enter');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.querySelector('.workspace-menu-button')?.textContent ||
            document.body.innerText,
        ),
      ),
    (value) => value.includes('Engineering'),
    'direct name switches workspace',
  );
  await paletteCommand('Change workspace');
  await until(
    () => evaluate(pageCall(activeLabel)),
    (value) => value === 'Search workspaces',
    'workspace picker after switch',
  );
  await command('Input.insertText', { text: 'Studio' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate(pageCall(bodyText)),
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
  await evaluate(animationFrames(2));
  const capture = settingsMode ? settingsCommand : command;
  const value = await capture<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip } : {}),
  });
  const buffer = Buffer.from(value.data, 'base64');
  await writeFile(path.join(captureRoot, name), buffer);
  return createHash('sha256').update(buffer).digest('hex');
}
/** The planes' transforms, whether the camera moves, and whether the space is laid out and shown. */
function cameraState() {
  const engine = (window as unknown as Partial<SmokeWindow>).__qaEngine;
  return {
    transform: JSON.stringify(
      Array.from(
        document.querySelectorAll('[data-plurid-plane]'),
        (element) => getComputedStyle(element).transform,
      ),
    ),
    moving: engine
      ? engine.camera.motion() !== 'idle'
      : !!document.querySelector('[data-plurid-motion]'),
    ready:
      (!engine || engine.getSnapshot().space.resolvedLayout) &&
      getComputedStyle(document.querySelector('[data-plurid-entity="PluridSpace"]')!).opacity ===
        '1',
  };
}
async function settleCamera(): Promise<void> {
  // A stable DOM observation is meaningful only after the native window paints;
  // otherwise an occluded window can look idle with recovery still queued.
  await evaluate(animationFrames(2));
  let prior = '',
    stable = 0;
  await until(
    async () => {
      const state = await evaluate(pageCall(cameraState));
      stable = state.ready && state.transform === prior && !state.moving ? stable + 1 : 0;
      prior = state.transform;
      return stable;
    },
    (count) => count >= 4,
    'settled spatial camera',
  );
}
const indexStatus = () => window.viewer.indexStatus();
const epubCount = (root: string) =>
  window.viewer
    .indexedQuery({ query: 'Book ext:epub', root })
    .then((result) => result.entries.length);
/** Whether the plane of pane `id` lies inside the workspace surface. */
function planeContained(id: string) {
  const surface = document.querySelector('.workspace-surface')!.getBoundingClientRect();
  const plane = document
    .querySelector(`[data-plurid-plane]:has([data-viewer-plane=${JSON.stringify(id)}])`)!
    .getBoundingClientRect();
  return (
    plane.left >= surface.left &&
    plane.top >= surface.top &&
    plane.right <= surface.right &&
    plane.bottom <= surface.bottom
  );
}
/** The camera, layout and planes, for a failure message. */
function engineReport() {
  const engine = (window as unknown as SmokeWindow).__qaEngine;
  return JSON.stringify({
    camera: engine.camera.get(),
    resolved: engine.getSnapshot().space.resolvedLayout,
    view: engine.inspect().view,
    planes: engine.inspect().planes.map((plane) => ({
      id: plane.planeID,
      width: plane.width,
      height: plane.height,
      location: plane.location,
    })),
  });
}
const undoDepth = () => (window as unknown as SmokeWindow).__qaEngine.history.get().undoDepth;
const currentViewpoint = () =>
  (window as unknown as SmokeWindow).__qaEngine.getViewpoint({ version: 2 });
/** Three rapid double-clicks on a row, as repeated activation sends them. */
function activateThrice(row: string) {
  const element = document.querySelector(row)!;
  for (let count = 0; count < 3; count++)
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}
async function verifyRestoredPreviews(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const untouched = await inventory();
  await until(
    () => evaluate(pageCall(indexStatus)),
    (status) => !status.running && status.count > 10,
    'packaged SQLite utility index',
  );
  assert.equal(await evaluate(pageCall(epubCount, fixture.files)), 1);
  const restore = async (state: SavedState, count: number) => {
    await delay(800);
    await evaluate(pageCall(saveState, state));
    await reloadPage();
    await restoredEngine(count);
    await settleCamera();
  };
  const containedActive = (id = 'reused-preview-3') => evaluate(pageCall(planeContained, id));
  for (let attempt = 0; attempt < 3; attempt++) {
    await restore(repeatedPreviewFixture(fixture.files), 4);
    assert.equal(
      await containedActive(),
      true,
      `Restoration ${attempt + 1} must recover an offscreen active plane instead of replaying a clipped oblique view: ${await evaluate(pageCall(engineReport))}`,
    );
  }
  const planeIDs = await enginePlaneIDs();
  await evaluate(pageCall(frameFirstPlane));
  await settleCamera();
  const image = fileSelector(path.join(fixture.files, 'Images', 'Color.png'));
  await click(image, 2);
  await evaluate(pageCall(activateThrice, image));
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
  const geometry = await evaluate(
    pageCall(
      (id: string) =>
        JSON.stringify(
          (window as unknown as SmokeWindow).__qaEngine.tree
            .get()[0]
            .children!.find((node) => node.routeDivisions.plane.parameters.id === id)!.location,
        ),
      reopenedID,
    ),
  );
  const history = await evaluate(pageCall(undoDepth));
  await paletteCommand('Consolidate repeated previews');
  await until(
    () => evaluate(pageCall(inspectedPlaneCount)),
    (count) => count === 2,
    'consolidated repeated image previews',
  );
  await settleCamera();
  assert.equal(await containedActive(reopenedID), true);
  assert.equal(
    await evaluate(
      pageCall(() =>
        JSON.stringify(
          (window as unknown as SmokeWindow).__qaEngine.tree.get()[0].children![0].location,
        ),
      ),
    ),
    geometry,
    'Recovery keeps the active preview and its placement',
  );
  assert.equal(await evaluate(pageCall(undoDepth)), history + 1);
  await paletteCommand('Undo arrangement');
  await until(
    () => evaluate(pageCall(inspectedPlaneCount)),
    (count) => count === 4,
    'one undo restores every consolidated preview',
  );
  await paletteCommand('Redo arrangement');
  await until(
    () => evaluate(pageCall(inspectedPlaneCount)),
    (count) => count === 2,
    'redo preview recovery',
  );
  // A deliberate oblique view that fits remains exact on reopen. Recovery is not
  // a blanket reset of users' saved camera arrangements.
  await evaluate(
    pageCall(() =>
      (window as unknown as SmokeWindow).__qaEngine.camera.moveBy(
        { absolute: { yaw: -74, pitch: 8, scale: 0.6 } },
        { animate: false },
      ),
    ),
  );
  await settleCamera();
  assert.equal(await containedActive(reopenedID), true);
  const viewpoint = await evaluate(pageCall(currentViewpoint));
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
  assert.equal(await evaluate(pageCall(currentViewpoint)), viewpoint);
  await evaluate(pageCall(frameFirstPlane));
  await settleCamera();
  await click(fileSelector(path.join(fixture.files, 'Images', 'Color.png')));
  await paletteCommand('Open in another plane');
  await until(
    () => evaluate(pageCall(inspectedPlaneCount)),
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
    () => evaluate(exists('.command-results')),
    Boolean,
    'commands after restoring explicit copy',
  );
  await command('Input.insertText', { text: 'Consolidate repeated previews' });
  await until(
    () => evaluate(requiredAttribute('[aria-label="Search commands"]', 'value')),
    (value) => value === 'Consolidate repeated previews',
    'query for unavailable consolidation after reopening an intentional copy',
  );
  assert.equal(
    await evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.command-result')).some((row) =>
          row.textContent.includes('Consolidate repeated previews'),
        ),
      ),
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
/** A document's text and evidence, read through a resource released afterwards. */
async function documentText(file: string) {
  const source = await window.viewer.resource(file);
  try {
    return await window.viewer.document(source.id);
  } finally {
    await window.viewer.release(source.id);
  }
}
const actionGet = (id: string) => window.viewer.actionGet(id);
const chapterQuery = (root: string) =>
  window.viewer.indexedQuery({ query: 'local chapter fixture', content: true, root });
async function verifyServiceWorkflows(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const unchanged = await inventory();
  const documents = path.join(fixture.files, 'Documents');
  const book = path.join(documents, 'Book.epub');
  const bookBytes = await readFile(book);
  const brief = await evaluate(pageCall(documentText, path.join(documents, 'Project brief.pdf')));
  assert.ok(brief.text.includes('Searchable PDF text'));
  assert.equal(
    brief.evidence.some((item) => item.source.startsWith('OCR page')),
    false,
    'Ordinary document reading leaves OCR opt-in',
  );
  const inspected = await evaluate(
    pageCall(
      (file: string) => window.viewer.inspect(file, true, true),
      path.join(documents, 'Project brief.pdf'),
    ),
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
    () => evaluate(exists('.quick-preview .epub-viewer')),
    Boolean,
    'Space after the frame control',
  );
  await key('Escape', 'Escape');
  await click(fileSelector(book));
  await paletteCommand('Rename as book');
  await until(() => evaluate(exists('.action-config')), Boolean, 'book action configuration');
  await click('.action-config .primary');
  const plan = await until(
    () => evaluate(pageCall(() => window.viewer.actionList())),
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
    () => evaluate(exists('[aria-label="Evidence for Book.epub"]')),
    Boolean,
    'rendered proposal',
  );
  const destinationSelector = '[aria-label="Destination for Book.epub"]';
  assert.equal(
    await evaluate(requiredValue(destinationSelector)),
    path.basename(plan.rows[0].destination),
    'Review must show the complete proposed filename ahead of its directory',
  );
  await click(destinationSelector);
  await evaluate(pageCall(() => window.viewer.textEdit('selectAll')));
  await until(
    () =>
      evaluate(
        pageCall((selector: string) => {
          const input = document.querySelector<HTMLInputElement>(selector)!;
          return input.selectionStart === 0 && input.selectionEnd === input.value.length;
        }, destinationSelector),
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
    await evaluate(requiredValue(destinationSelector)),
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
    () => evaluate(pageCall(actionGet, plan.id)),
    (plan) => plan.status === 'completed',
    'apply reviewed book rename',
  );
  assert.deepEqual(await readFile(plan.rows[0].destination), bookBytes);
  await click('.task-dialog footer button');
  await until(
    () => evaluate(pageCall(actionGet, plan.id)),
    (plan) => !plan.undoable,
    'undo reviewed rename',
  );
  assert.deepEqual(await inventory(), unchanged);
  await closePreview();
  await paletteCommand('Parent folder');
  await evaluate(
    patchSettings({
      path: 'settings.savedSearches',
      value: [
        {
          id: 'qa-publications',
          name: 'Publication files',
          query: 'ext:pdf,epub',
          root: fixture.files,
          recursive: true,
        },
      ],
    }),
  );
  await paletteCommand('Publication files');
  await restoredEngine(2);
  await settleCamera();
  await until(
    () => evaluate(exists('.search-explorer [data-file-path]')),
    Boolean,
    'indexed search root',
  );
  await snapshot('search-native.png');
  await click(`.search-explorer ${fileSelector(book)}`);
  await key(' ', 'Space');
  await until(
    () => evaluate(exists('.quick-preview .epub-viewer')),
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
  await patchInSettings({ path: 'settings.search.contentRoots', value: [documents] });
  await until(
    () => evaluate(pageCall(chapterQuery, documents)),
    (result) => result.entries.some((file) => file.path === book),
    'explicitly granted local document-text indexing',
  );
  await patchInSettings(
    { path: 'settings.search.contentRoots', value: [] },
    { path: 'settings.search.paused', value: true },
  );
  await until(
    () => evaluate(pageCall(chapterQuery, documents)),
    (result) => !result.entries.length,
    'revoking text permission clears stored content while paused',
  );
  await patchInSettings({ path: 'settings.search.paused', value: false });
  await paletteCommand('Settings');
  for (const category of ['Browsing', 'Search', 'Actions', 'Models', 'Agents', 'Shortcuts']) {
    await tab(category);
    await snapshot('settings-' + category.toLowerCase() + '-native.png');
  }
  await patchInSettings({ path: 'settings.agents.enabled', value: true });
  const configuration = JSON.parse(
    await settingsEvaluate(
      pageCall(
        (root: string) =>
          window.viewer
            .agentClients({
              kind: 'create',
              client: {
                name: 'Smoke metadata',
                roots: [root],
                capabilities: ['metadata'],
                budgets: { maxReadBytes: 1048576, maxTasks: 1 },
              },
            })
            // a created client's reply carries its configuration
            .then((reply) => (reply as { configuration: string }).configuration),
        documents,
      ),
    ),
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
    const access = await settingsEvaluate(
      pageCall(() => window.viewer.agentAccess({ kind: 'state' })),
    );
    assert.equal(access.enabled, false);
    assert.equal(access.pending.enable, true);
    assert.notEqual(
      code,
      0,
      'Configuration and named credentials cannot grant native broker approval.',
    );
    assert.equal(
      agentOutput.trim(),
      '',
      'An unapproved connection exposes no tools or file metadata.',
    );
    assert.ok(agentErrors.includes('approve agent access'), agentErrors);
    console.log(
      'Agent smoke: native approval remains pending; named credentials cannot enable the broker. Authorized protocol checks run in the service suite.',
    );
  } finally {
    if (agent.exitCode === null && agent.signalCode === null) agent.kill('SIGKILL');
    await patchInSettings(
      { path: 'settings.agents.enabled', value: false },
      { path: 'settings.agents.roots', value: [] },
    );
  }
  await click('dialog [aria-label="Close"]');
  await delay(800);
  await assert.rejects(readFile(path.join(profile, 'credentials-v1.json')), { code: 'ENOENT' });
  await evaluate(pageCall(saveState, original));
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  assert.deepEqual(await inventory(), unchanged);
  console.log(
    'Services: packaged PDF extraction and OCR, Space after Frame, book proposal/review/apply/Undo, indexed virtual search, shared result commands and modeless Settings.',
  );
}
const readResource = (id: string) => window.viewer.read(id);
const revokeAccess = (folder: string) => window.viewer.fileAccessRevoke(folder);
const previewShowsNotes = () =>
  document.querySelector('.quick-preview')?.textContent.includes('A wider view');
async function verifyIndependentPreviewRevocation(): Promise<void> {
  const documents = path.join(fixture.files, 'Documents');
  const images = path.join(fixture.files, 'Images');
  const file = path.join(documents, 'Project notes.md');
  const resource = await evaluate(pageCall((file: string) => window.viewer.resource(file), file));
  const original = await evaluate(pageCall(readResource, resource.id));
  await click(fileSelector(documents), 2);
  await preview(file, 'A wider view');
  await evaluate(pageCall(openSettings));
  await openSettingsProbe();
  try {
    await settingsEvaluate(pageCall(revokeAccess, images));
    assert.deepEqual(
      await evaluate(pageCall(readResource, resource.id)),
      original,
      'Revoking Images must preserve an existing Documents resource',
    );
    assert.ok(await evaluate(pageCall(previewShowsNotes)));
    // Ordinary-runtime permission denial is sufficient to detect stale decoded
    // UI bytes. Genuine PowerBox authorization is a separate signed scenario.
    await chmod(documents, 0o000);
    assert.ok(await evaluate(pageCall(previewShowsNotes)));
    await settingsEvaluate(pageCall(revokeAccess, documents));
    await until(
      () => evaluate(textOf('.quick-preview')),
      (value) => value.includes('File unavailable') && !value.includes('A wider view'),
      'revoked preview disposes its decoded text and shows the access error',
    );
    await click('dialog [aria-label="Close"]');
    await snapshot('desktop-native-preview-access-revoked.png');
  } finally {
    await chmod(documents, 0o700);
    if (settingsMode) await click('dialog [aria-label="Close"]');
    await evaluate(pageCall((id: string) => window.viewer.release(id), resource.id));
    await closePreview();
    await paletteCommand('Parent folder');
  }
  console.log(
    'Preview permissions: unrelated resources/decoded UI remain usable; revoked text is disposed through the real Settings API.',
  );
}

/** The error code a document read reports for an unreadable file. */
async function documentFailure(file: string) {
  const resource = await window.viewer.resource(file);
  try {
    return await window.viewer.document(resource.id).then(
      () => ({ code: 'UNEXPECTED_SUCCESS' }),
      (error: { code: string; message: string }) => ({
        code: error.code,
        message: error.message,
      }),
    );
  } finally {
    await window.viewer.release(resource.id);
  }
}
async function verifyStoreFileServices(): Promise<void> {
  await verifyIndependentPreviewRevocation();
  const task = await evaluate(
    pageCall(
      (folder: string) => window.viewer.folderSizeStart([folder]),
      path.join(fixture.files, 'Models'),
    ),
  );
  const measured = await until(
    () => evaluate(pageCall((id: string) => window.viewer.folderSizeGet(id), task.id)),
    (value) => value.status === 'completed',
    'thread-backed recursive size calculation',
  );
  assert.ok(measured.bytes > 0);
  const deniedPDF = path.join(fixture.root, 'Denied reader.pdf');
  await writeFile(
    deniedPDF,
    await readFile(path.join(fixture.files, 'Documents', 'Project brief.pdf')),
  );
  try {
    await chmod(deniedPDF, 0o000);
    const failure = await evaluate(pageCall(documentFailure, deniedPDF));
    assert.ok(
      ['EACCES', 'EPERM'].includes(failure.code),
      'Reader permissions survive the worker and IPC boundaries: ' + JSON.stringify(failure),
    );
  } finally {
    await chmod(deniedPDF, 0o600);
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
      () => evaluate(exists(fileSelector(restricted))),
      Boolean,
      'new permission fixture appears in the watched folder',
    );
    await click(fileSelector(restricted), 2);
    await until(
      () =>
        evaluate(
          pageCall(() =>
            [...document.querySelectorAll('.folder-error button')].some((button) =>
              button.textContent.includes('Allow folder access'),
            ),
          ),
        ),
      Boolean,
      'actionable native folder access control',
    );
    assert.ok((await text()).includes('Folder access required'));
    assert.ok(!(await text()).includes('This folder is empty'));
    await snapshot('desktop-native-folder-access.png');
    await chmod(restricted, 0o700);
    await evaluate(pageCall(() => window.dispatchEvent(new Event('viewer:refresh'))));
    await until(
      text,
      (value) => !value.includes('Folder access required'),
      'granted folder reloads',
    );
    await delay(500);
    const recovered = path.join(restricted, 'Recovered.txt');
    await writeFile(recovered, 'Generated watcher recovery fixture.');
    await until(
      () => evaluate(exists(fileSelector(recovered))),
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

/** Opens and frames the root plane whose route ends with pane `id`. */
function facePane(id: string) {
  const engine = (window as unknown as SmokeWindow).__qaEngine;
  const info = engine.inspect().planes.find((plane) => plane.route.endsWith('/' + id))!;
  engine.tree.open(info.planeID);
  engine.camera.frame({ planeID: info.planeID }, { animate: false });
}
/** Each root's pane id with its children's. */
const paneTree = () =>
  (window as unknown as SmokeWindow).__qaEngine.tree.get().map((plane) => ({
    id: plane.routeDivisions.plane.parameters.id || plane.routeDivisions.path.parameters.id,
    children: (plane.children || []).map(
      (child) =>
        child.routeDivisions.plane.parameters.id || child.routeDivisions.path.parameters.id,
    ),
  }));
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
  await evaluate(pageCall(saveState, seeded));
  await reloadPage();
  await restoredEngine(2);
  const face = async (id: string) => {
    await evaluate(pageCall(facePane, id));
    await settleCamera();
    await until(
      () => evaluate(exists(`[data-viewer-plane="${id}"]`)),
      Boolean,
      'root available after culling',
    );
    await evaluate(
      pageCall((id: string) => {
        document
          .querySelector(`[data-viewer-plane="${id}"]`)!
          .closest<HTMLElement>('[data-plurid-plane]')!.dataset.qaOwner = id;
      }, id),
    );
  };
  const readTree = () => evaluate(pageCall(paneTree));
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
  await evaluate(pageCall(saveState, original));
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  console.log(
    'Preview ownership: independent same-file children in two roots, same-root reuse and exact restoration without duplicates.',
  );
}
const openResource = (file: string) => window.viewer.resource(file);
const releaseResource = (id: string) => window.viewer.release(id);
/** A ranged read of a granted resource, a traversal out of it and an outside request. */
async function resourceScope(url: string, escape: string) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  const escaped = await fetch(escape);
  const network = await fetch('https://example.com').then(
    () => true,
    () => false,
  );
  return {
    range: response.status,
    csp: response.headers.get('content-security-policy')!,
    escaped: escaped.status,
    network,
  };
}
async function verifyResourceBoundaries(source: string): Promise<void> {
  const grant = await evaluate(pageCall(openResource, source));
  const scopeResult = await evaluate(
    pageCall(resourceScope, grant.url, `viewer-resource://${grant.id}/asset/%2e%2e%2foutside`),
  );
  assert.equal(scopeResult.range, 206);
  // A single-file grant exposes only its exact name, including for traversal requests.
  assert.equal(scopeResult.escaped, 404);
  assert.equal(scopeResult.network, false);
  assert.match(scopeResult.csp, /sandbox/);
  await evaluate(pageCall(releaseResource, grant.id));
  // Model grants can resolve companions, so their directory boundary rejects escape explicitly.
  const model = await evaluate(
    pageCall(openResource, path.join(fixture.files, 'Models', 'Triangle.gltf')),
  );
  try {
    assert.equal(
      await evaluate(
        pageCall(
          (url: string) => fetch(url).then((response) => response.status),
          `viewer-resource://${model.id}/asset/%2e%2e%2foutside`,
        ),
      ),
      403,
    );
  } finally {
    await evaluate(pageCall(releaseResource, model.id));
  }
  const validation = await evaluate(
    pageCall(() =>
      window.viewer.stat('relative-path').then(
        () => false,
        () => true,
      ),
    ),
  );
  assert.equal(validation, true);
}

async function verifyCapturedMenus(): Promise<void> {
  const readme = path.join(fixture.files, 'README.md');
  await contextMenu(fileSelector(readme));
  assert.equal(await evaluate(pageCall(focusOutline)), 'none');
  assert.equal(
    await evaluate(pageCall(() => getComputedStyle(document.activeElement!).boxShadow)),
    'none',
  );
  await command('Input.insertText', { text: 'rn' });
  await until(
    () => evaluate(textOf('.command-result[aria-selected=true]')),
    (value) => value.startsWith('Rename'),
    'two-letter Rename alias',
  );
  await key('Enter', 'Enter');
  await until(
    () => evaluate(valueOf('dialog input')),
    (value) => value === 'README.md',
    'clicked target captured for rename',
  );
  await click('dialog [aria-label="Close"]');
  await contextMenu(fileSelector(path.join(fixture.files, 'Models')));
  assert.match(await evaluate(textOf('.context-menu .command-result')), /^Rename/);
  // Recent is an extra shortcut; the action also keeps its ordinary menu position.
  assert.deepEqual(
    await evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.context-menu .command-result'))
          .filter(
            (item) => item.querySelector('.command-result-text > span')?.textContent === 'Rename…',
          )
          .map((item) => item.getAttribute('data-menu-id'))
          .sort(),
      ),
    ),
    ['recent.rename', 'rename'],
  );
  await snapshot('context-native.png');
  await key('Escape', 'Escape');
  await until(
    () => evaluate(pageCall(() => !document.querySelector('.context-menu-layer'))),
    Boolean,
    'context menu closed before header action',
  );
  // Frame can place a spatial header beneath the minimap's interactive dots.
  // Docking gives the captured-command check an unobstructed header.
  await paletteCommand('Dock plane');
  await settleCamera();
  // The header actions resolve the current selection through the same registry.
  await click('[aria-label="Folder actions"]');
  await command('Input.insertText', { text: 'rn' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate(valueOf('dialog input')),
    (value) => value === 'Models',
    'header menu uses selected folder',
  );
  await click('dialog [aria-label="Close"]');
  await paletteCommand('Reveal space');
  await settleCamera();
}

const planeBackface = () =>
  (window as unknown as SmokeWindow).__qaEngine.getSnapshot().configuration.elements.plane.backface;
const childFraming = () =>
  (window as unknown as SmokeWindow).__qaEngine.getSnapshot().configuration.space.navigation!
    .childFraming;
/** A point inside the button that hit-tests to it, or null. */
function exposedPoint(selector: string) {
  const button = document.querySelector(selector)!;
  const rect = button.getBoundingClientRect();
  for (let y = rect.top + 1; y < rect.bottom; y += 2)
    for (let x = rect.left + 1; x < rect.right; x += 2)
      if (button.contains(document.elementFromPoint(x, y))) return { x, y };
  return null;
}
/** The camera's angles plus the plane's own: zero when the camera faces it. */
function facingAngles(planeID: string) {
  const engine = (window as unknown as SmokeWindow).__qaEngine;
  const camera = engine.camera.get();
  const node = engine.inspect().planes.find((plane) => plane.planeID === planeID)!;
  return {
    yaw: camera.yaw + node.location.rotateY,
    pitch: camera.pitch + node.location.rotateX,
    roll: camera.roll,
  };
}
/** Where the sidebar's edge, and 64 plane pixels beyond it, fall on screen. */
function sidebarEdge(sidebarSelector: string, handle: string) {
  const sidebar = document.querySelector<HTMLElement>(sidebarSelector)!;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;pointer-events:none;width:0;height:0;top:50%';
  sidebar.append(probe);
  const position = (x: number) => {
    probe.style.left = x + 'px';
    const rect = probe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  };
  const start = position(sidebar.clientWidth);
  const end = position(sidebar.clientWidth + 64);
  probe.remove();
  return {
    start,
    end,
    hit: document.querySelector(handle)!.contains(document.elementFromPoint(start.x, start.y)),
  };
}
function narrowPlane(selector: string) {
  const plane = document.querySelector(selector)!;
  const list = plane.querySelector('.file-scroll')!;
  return {
    sidebar: plane.querySelector<HTMLElement>('.location-sidebar')!.offsetWidth,
    plane: plane.clientWidth,
    overflow: list.scrollWidth > list.clientWidth,
  };
}
async function verifyRootPlanes(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const untouched = await inventory();
  await until(
    () => evaluate(pageCall(indexStatus)),
    (status) => !status.running && status.count > 10,
    'packaged SQLite utility index',
  );
  assert.equal(await evaluate(pageCall(epubCount, fixture.files)), 1);
  const jobs = await evaluate(pageCall(viewerJobs));
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
  // the fixture's version 1 state, with no UI preferences, is saved at the current UI version,
  // past the plane-navigation step; its backup below keeps the original bytes
  assert.equal(original.ui?.version, uiPreferencesVersion);
  assert.equal(original.ui.sidebar.visible, false);
  assert.equal(original.workspaces[0].panes[0].type, 'folder');
  assert.equal(await evaluate(exists('.app-main > .location-sidebar')), false);
  assert.equal(await evaluate(exists('.folder-plane .location-sidebar')), true);
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
    pageCall(() =>
      (window as unknown as SmokeWindow).__qaEngine.pubsub.publish({
        topic: 'configuration',
        data: {
          elements: { plane: { backface: 'hidden' } },
          space: { navigation: { childFraming: 'pair' } },
        },
      }),
    ),
  );
  assert.equal(await evaluate(pageCall(planeBackface)), 'visible');
  assert.equal(await evaluate(pageCall(childFraming)), 'plane');

  const first = original.workspaces[0].roots[0];
  const firstEngineID = await enginePlaneIDs();
  await click('[aria-label="New folder plane (⇧⌘N)"]');
  let state = await roots(2);
  const second = state.workspaces[0].roots[1];
  assert.equal(state.workspaces[0].panes.find((pane) => pane.id === second)?.path, fixture.files);
  assert.ok(JSON.parse(await enginePlaneIDs()).includes(JSON.parse(firstEngineID)[0]));
  await click(`${controls(second)} [aria-label="Hide plane navigation"]`);
  assert.equal(await evaluate(exists(folder(second) + ' .location-sidebar')), false);
  await click(`${controls(second)} [aria-label="Show plane navigation"]`);
  await click(`${folder(second)} .sidebar-resizer`);
  await key('ArrowRight', 'ArrowRight');
  assert.equal(
    await evaluate(requiredAttribute(folder(second) + ' .sidebar-resizer', 'aria-valuenow')),
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
  await key('N', 'KeyN', 12);
  await roots(4);
  await paletteCommand('New folder plane');
  state = await roots(5);
  await click(`${controls(state.workspaces[0].roots[4])} [aria-label="Folder actions"]`);
  await command('Input.insertText', { text: 'New folder plane' });
  await key('Enter', 'Enter');
  await roots(6);
  // Two additions in one React batch must retain both roots and all earlier engine IDs.
  await evaluate(
    pageCall(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[aria-label="New folder plane (⇧⌘N)"]',
      )!;
      button.click();
      button.click();
    }),
  );
  state = await roots(8);
  assert.equal(new Set(state.workspaces[0].roots).size, 8);
  assert.equal(
    await evaluate(
      pageCall(() =>
        (window as unknown as SmokeWindow).__qaEngine.tree
          .get()
          .every((plane) => !plane.parentPlaneID),
      ),
    ),
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
    const collapsed = await evaluate(
      pageCall(() => {
        const map = document.querySelector('[data-plurid-overlay="minimap"]');
        return !!map && map.hasAttribute('popover') && !map.matches(':popover-open');
      }),
    );
    if (collapsed) {
      await paletteCommand('Overview');
      await until(
        () =>
          evaluate(
            pageCall(
              () =>
                document
                  .querySelector('[data-plurid-overlay=minimap]')
                  ?.matches(':popover-open') === true,
            ),
          ),
        Boolean,
        'crowded workspace overview opens through its command',
      );
    }
    const engineID = await evaluate(
      pageCall(
        (id: string) =>
          (window as unknown as SmokeWindow).__qaEngine
            .inspect()
            .planes.find((plane) => plane.route.endsWith('/' + id))!.planeID,
        hostID,
      ),
    );
    const minimap = `[data-plurid-minimap-plane=${JSON.stringify(engineID)}]`;
    if (keyboard) {
      await evaluate(focus(minimap));
      await key('Enter', 'Enter');
    } else {
      // Dense maps have overlapping generous hit boxes. Find an exposed point
      // belonging to this real native button, rather than clicking another plane.
      const point = await evaluate(pageCall(exposedPoint, minimap));
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
    const facing = await evaluate(pageCall(facingAngles, engineID));
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
  assert.equal(await evaluate(pageCall(childFraming)), 'plane');
  await snapshot('desktop-native-root-navigation.png');

  // The browser's projected positions are independent evidence of pointer movement
  // in local plane units, including a tilted and zoomed camera.
  await evaluate(
    pageCall(() =>
      (window as unknown as SmokeWindow).__qaEngine.camera.moveBy(
        { absolute: { yaw: 12, pitch: 6, roll: 8, scale: 0.65 } },
        { animate: false },
      ),
    ),
  );
  await settleCamera();
  const camera = await evaluate(pageCall(cameraJSON));
  const handle = folder(previewOwner) + ' .sidebar-resizer';
  const points = await evaluate(
    pageCall(sidebarEdge, folder(previewOwner) + ' .location-sidebar', handle),
  );
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
    Math.abs(Number(await evaluate(requiredAttribute(handle, 'aria-valuenow'))) - 274) <= 2,
  );
  assert.equal(
    await evaluate(pageCall(cameraJSON)),
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
  assert.equal(await evaluate(exists(folder(previewOwner) + ' .location-sidebar')), true);
  const narrow = await evaluate(pageCall(narrowPlane, folder(previewOwner)));
  assert.ok(narrow.sidebar <= narrow.plane / 2 + 1);
  assert.equal(narrow.overflow, false);
  await click(`${controls(previewOwner)} [aria-label="Hide plane navigation"]`);
  await click(`${controls(previewOwner)} [aria-label="Show plane navigation"]`);
  await snapshot('desktop-native-navigation-narrow-docked.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await paletteCommand('Reveal space');
  await settleCamera();
  assert.equal(await enginePlaneIDs(), topology);
  assert.deepEqual(await evaluate(pageCall(viewerJobs)), jobs);
  assert.deepEqual(
    await inventory(),
    untouched,
    'Roots, navigation and minimap never change files',
  );
  await delay(800);
  await evaluate(pageCall(saveState, original));
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  console.log(
    'Root planes: +, Cmd+Shift+N, Commands, plane actions, shortcut roots, independent history, rapid additions, reload, minimap facing, projected resizing and narrow docked navigation.',
  );
}
async function job(request: RendererOperationRequest): Promise<OperationJob> {
  const id = await evaluate(
    pageCall((request: RendererOperationRequest) => window.viewer.operate(request), request),
  );
  return until(
    () => evaluate(pageCall(viewerJobs)),
    (jobs) =>
      jobs.some(
        (job) => job.id === id && ['completed', 'failed', 'cancelled'].includes(job.status),
      ),
    'file operation',
  ).then((jobs) => jobs.find((job) => job.id === id)!);
}
const settingsSnapshot = () => window.viewer.settingsGet();
/** Whether a command result is labelled `label`; with `press`, clicks it and throws when missing. */
function resultButton(label: string, press: boolean) {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.command-result')).find(
    (row) => row.querySelector('.command-result-text > span')?.textContent === label,
  );
  if (press) row!.click();
  return !!row;
}
function paletteBounds() {
  const dialog = document.querySelector('.command-palette')!;
  const rect = dialog.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
    inputTop: dialog.querySelector('input')!.getBoundingClientRect().top,
    viewport: innerHeight,
  };
}
function pathControlGeometry(scope: string) {
  return [...document.querySelectorAll<HTMLElement>(scope + ' .path-field')].map((field) => {
    const rect = field.getBoundingClientRect();
    const button = field.querySelector('.copy-button')!.getBoundingClientRect();
    return {
      path: field.querySelector('.path-text')!.textContent,
      copyVisible:
        button.width > 0 &&
        button.left >= rect.left &&
        button.right <= rect.right + 1 &&
        button.top >= 0 &&
        button.bottom <= innerHeight,
      overflow: field.scrollWidth - field.clientWidth,
    };
  });
}
async function verifyEntryAndPalette(): Promise<void> {
  await delay(800);
  const original = JSON.parse(await readFile(stateFile, 'utf8')) as SavedState;
  const settings = await evaluate(pageCall(settingsSnapshot));
  await evaluate(pageCall(openSettings));
  await openSettingsProbe();
  await until(
    () => settingsEvaluate(pageCall(categoryButton, 'Browsing', false)),
    Boolean,
    'Settings categories ready',
  );
  await settingsEvaluate(pageCall(categoryButton, 'Browsing', true));
  await until(
    () => settingsEvaluate(exists('[aria-label="New folder planes start in"]')),
    Boolean,
    'new-plane folder preference',
  );
  // a choice is a searchable menu: open it, then choose the row
  await settingsEvaluate(clickElement('[aria-label="New folder planes start in"]'));
  await until(
    () => settingsEvaluate(pageCall(resultButton, 'Downloads', false)),
    Boolean,
    'new-plane folder choices',
  );
  await settingsEvaluate(pageCall(resultButton, 'Downloads', true));
  await until(
    () => evaluate(pageCall(settingsSnapshot)),
    (snapshot) => snapshot.settings.browsing.newPlaneLocation === 'downloads',
    'folder preference propagated from Settings',
  );
  await evaluate(
    patchSettings(
      { path: 'settings.browsing.newPlaneLocation', value: 'custom' },
      { path: 'settings.browsing.newPlanePath', value: fixture.files },
      { path: 'settings.browsing.emptyWorkspaceLocation', value: 'custom' },
      { path: 'settings.browsing.emptyWorkspacePath', value: path.join(fixture.files, 'Data') },
    ),
  );
  await until(
    () => settingsEvaluate(pageCall(bodyText)),
    (body) => body.includes(fixture.files) && body.includes('Change folder…'),
    'custom starting folder in Settings',
  );
  await snapshot('desktop-native-new-plane-settings.png');
  const folderPaths = await settingsEvaluate(
    pageCall(pathControlGeometry, '.settings-folder-choice'),
  );
  assert.deepEqual(
    folderPaths.map((entry) => entry.path),
    [fixture.files, path.join(fixture.files, 'Data')],
  );
  assert.ok(folderPaths.every((entry) => entry.copyVisible && entry.overflow <= 1));
  await click('dialog [aria-label="Close"]');
  const empty = structuredClone(original);
  empty.workspaces[0].panes = [];
  empty.workspaces[0].roots = [];
  empty.workspaces[0].activePane = undefined;
  empty.workspaces[0].arrangement = {};
  await evaluate(pageCall(saveState, empty));
  await command('Page.reload');
  await until(
    () =>
      evaluate(
        pageCall(
          () =>
            document.readyState === 'complete' &&
            !!document.querySelector('.empty-actions .primary:not(:disabled)'),
        ),
      ),
    Boolean,
    'empty workspace can create a root directly',
  );
  await snapshot('desktop-native-empty-workspace.png');
  assert.equal(
    await evaluate(exists('[aria-label="New folder planes start in"]')),
    false,
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
  await click('[aria-label="New folder plane (⇧⌘N)"]');
  await restoredEngine(2);
  await key('N', 'KeyN', 12);
  await restoredEngine(3);
  await until(
    async () => JSON.parse(await readFile(stateFile, 'utf8')) as SavedState,
    (value) =>
      value.workspaces[0].panes.length === 3 &&
      value.workspaces[0].panes[0].path === path.join(fixture.files, 'Data') &&
      value.workspaces[0].panes.slice(1).every((pane) => pane.path === fixture.files),
    'plus and Command-N use the populated-workspace preference',
  );
  await evaluate(
    patchSettings(
      {
        path: 'settings.browsing.newPlaneLocation',
        value: settings.settings.browsing.newPlaneLocation,
      },
      { path: 'settings.browsing.newPlanePath', value: settings.settings.browsing.newPlanePath },
      {
        path: 'settings.browsing.emptyWorkspaceLocation',
        value: settings.settings.browsing.emptyWorkspaceLocation,
      },
      {
        path: 'settings.browsing.emptyWorkspacePath',
        value: settings.settings.browsing.emptyWorkspacePath,
      },
    ),
  );
  await delay(800);
  await evaluate(pageCall(saveState, original));
  await reloadPage();
  await restoredEngine(1);
  await settleCamera();
  await key('k', 'KeyK', 4);
  await until(
    () => evaluate(exists('.command-palette[open]')),
    Boolean,
    'anchored command palette',
  );
  const bounds = () => evaluate(pageCall(paletteBounds));
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
  const commandPaths = await evaluate(pageCall(pathControlGeometry, '.palette-context'));
  assert.deepEqual(commandPaths, [{ path: fixture.files, copyVisible: true, overflow: 0 }]);
  await key('Escape', 'Escape');
  await key('f', 'KeyF', 4);
  await until(
    () => evaluate(countOf('.command-palette[open] .command-result')),
    (count) => count === 11,
    'file palette has enough results to scroll',
  );
  const finder = await bounds();
  assert.equal(finder.top, narrow.top);
  assert.ok(finder.bottom <= finder.viewport - 19, JSON.stringify(finder));
  assert.ok(
    await evaluate(
      pageCall(() => {
        const list = document.querySelector('.command-palette .command-results')!;
        return list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto';
      }),
    ),
  );
  await snapshot('desktop-native-palette-small-window.png');
  const filePaths = await evaluate(pageCall(pathControlGeometry, '.palette-context'));
  assert.deepEqual(filePaths, [{ path: fixture.files, copyVisible: true, overflow: 0 }]);
  await command('Emulation.clearDeviceMetricsOverride');
  await key('Escape', 'Escape');
  console.log(
    'Workspace entry: direct root creation, starting-folder Settings, and palettes with a fixed search position and bounded scrolling.',
  );
}
async function verifyShutdown(): Promise<void> {
  // Stall only this isolated QA instance's read-only worker. A slow filesystem
  // or extraction must not leave an interactive window without its IPC bridge.
  await evaluate(pageCall(openSettings));
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
    const reply = await evaluate(
      pageCall(() =>
        window.viewer.jobs().then(
          () => 'available',
          (error: Error) => error.message,
        ),
      ),
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
const performanceHarness = {
  evaluate,
  command,
  until,
  key,
  contextMenu,
  paletteCommand,
  settleCamera,
};
const performanceContext = {
  foreground,
  binary,
  files: fixture.files,
  evidenceDirectory: captureRoot,
};

const operate = (request: RendererOperationRequest) => window.viewer.operate(request);
const treeJSON = () => JSON.stringify((window as unknown as SmokeWindow).__qaEngine.tree.get());
const surfaceWidth = () => document.querySelector('.workspace-surface')!.clientWidth;
/** Drags the Favorites section title onto the Locations section. */
function dragFavoritesSection() {
  const transfer = new DataTransfer();
  const titles = Array.from(document.querySelectorAll('.sidebar-section-title'));
  const source = titles.find((button) => button.textContent.includes('Favorites'))!;
  const target = titles.find((button) => button.textContent.includes('Locations'))!;
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
  target
    .closest('section')!
    .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
}
/** Plays the open preview's media muted, kept as `window.__qaMedia` to check after closing. */
function playPreviewMedia() {
  const media = document.querySelector<HTMLMediaElement>('dialog audio, dialog video');
  (window as unknown as SmokeWindow).__qaMedia = media;
  media!.muted = true;
  return media!.play();
}
const collisionAction = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.collision-actions button'))
    .find((button) => button.textContent === label)!
    .click();
/** The model canvas's bounds, clipped to the viewport. */
function visibleModelCanvas() {
  const rect = document.querySelector('.model-stage canvas')!.getBoundingClientRect();
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.min(rect.width, innerWidth - Math.max(0, rect.x)),
    height: Math.min(rect.height, innerHeight - Math.max(0, rect.y)),
    scale: 1,
  };
}
/** The workspace surface's edges and each plane's and plane header's. */
function framedBounds() {
  const bounds = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return [rect.left, rect.top, rect.right, rect.bottom];
  };
  return {
    view: bounds(document.querySelector('.workspace-surface')!),
    planes: Array.from(document.querySelectorAll('[data-plurid-plane], .plane-controls'), bounds),
  };
}
/** What the page shows when a run fails: visibility, focus, motion, canvases and text layers. */
function failureDiagnostics() {
  return {
    visibility: document.visibilityState,
    focus: document.hasFocus(),
    motion: document.querySelector('[data-plurid-motion]')?.getAttribute('data-plurid-motion'),
    canvas: Array.from(document.querySelectorAll('canvas'), (canvas) => ({
      width: canvas.width,
      height: canvas.height,
    })),
    textLayers: Array.from(document.querySelectorAll('.textLayer'), (layer) =>
      layer.innerHTML.slice(0, 200),
    ),
  };
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
      evaluate(
        pageCall(
          () => document.readyState === 'complete' && !!document.querySelector('.folder-explorer'),
        ),
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
      () => evaluate(pageCall(() => document.visibilityState)),
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
  if (scenario === 'performance') {
    await captureEngine();
    await profileNativeInteractions(performanceHarness, performanceContext);
    assert.deepEqual(exceptions, []);
    console.log('Packaged foreground performance workloads recorded.');
    return;
  }
  assert.equal(await evaluate(pageCall(() => location.protocol)), 'viewer-app:');
  assert.deepEqual(
    await evaluate(
      pageCall(() => ({
        require: typeof (window as unknown as { require?: unknown }).require,
        process: typeof (window as unknown as { process?: unknown }).process,
        bridge: typeof window.viewer,
      })),
    ),
    { require: 'undefined', process: 'undefined', bridge: 'object' },
  );
  await snapshot('desktop-native-initial.png');
  const untouched = await inventory();
  await until(
    () => evaluate(pageCall(indexStatus)),
    (status) => !status.running && status.count > 10,
    'packaged SQLite utility index',
  );
  assert.equal(await evaluate(pageCall(epubCount, fixture.files)), 1);
  await captureEngine();
  if (process.env.VIEWER_TEST_SCENARIO === 'root-planes') {
    await verifyRootPlanes();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'context-menu') {
    await paletteCommand('Frame plane');
    await settleCamera();
    await verifyCapturedMenus();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    console.log('Packaged contextual command capture verified.');
    return;
  }
  if (scenario === 'resources') {
    await verifyResourceBoundaries(path.join(fixture.files, 'README.md'));
    assert.deepEqual(exceptions, []);
    console.log('Packaged resource ranges and confinement verified.');
    return;
  }
  if (scenario === 'appearance') {
    await appearance('light');
    await appearance('dark');
    assert.deepEqual(exceptions, []);
    console.log('Packaged appearance choice applies through Settings.');
    return;
  }
  if (scenario === 'milestones') {
    await verifyMilestones(
      {
        evaluate,
        until,
        click,
        command,
        settleCamera,
        snapshot,
        paletteCommand,
        reloadPage,
        captureEngine,
      },
      {
        files: fixture.files,
        profile,
        stateFile,
        binary,
        debuggerOrigin: launched.debuggerOrigin,
        initialRootID: fixture.state.workspaces[0]!.panes[0]!.id,
      },
    );
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'services') {
    await verifyServiceWorkflows();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'daily-file-work') {
    await verifyDailyFileWork();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'model-lighting') {
    await verifyModelLighting();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'refinements') {
    await verifyRefinements();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'drawings-workspaces') {
    await verifyDrawingsAndWorkspaces();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'menus-models') {
    await verifyGroupedMenuAndModels();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'foundations') {
    await verifyFoundations();
    return;
  }
  if (scenario === 'store-file-services') {
    await verifyStoreFileServices();
    return;
  }
  if (scenario === 'file-workflows') {
    await verifyColumnWorkflows();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'chrome') {
    await verifyConfiguredChrome();
    await verifyListAlignment();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'shutdown') {
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    await verifyShutdown();
    return;
  }
  if (scenario === 'alignment') {
    await verifyListAlignment();
    await verifyPreviewFooter();
    await verifySettingsScroll();
    await verifyBackgroundApp();
    return;
  }
  if (scenario === 'size') {
    await verifyIndependentSizeCalculation();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    return;
  }
  if (scenario === 'entry') {
    await verifyEntryAndPalette();
    await verifyAnchoredPreviews();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'published-plane-input') {
    await verifyPublishedPlaneInput();
    await verifyBackgroundApp();
    assert.deepEqual(await inventory(), untouched);
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'files') {
    await verifyFileQueries();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'line') {
    await verifyCommandLine();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'look') {
    await verifyLook();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'space') {
    await verifySpace();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'keys') {
    await verifyKeys();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'text-editing') {
    await verifyTextEditing();
    await verifyBackgroundApp();
    assert.deepEqual(exceptions, []);
    return;
  }
  if (scenario === 'spatial') {
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
  if (foreground) await profileNativeInteractions(performanceHarness, performanceContext);
  await verifyAnchoredPreviews();
  await verifyServiceWorkflows();
  await verifyPreviewOwnership();
  await verifyRestoredPreviews();
  await verifyRootPlanes();
  await click('[aria-label="Show window navigation"]');
  await paletteCommand('Frame plane');
  await settleCamera();
  const aids = () =>
    evaluate(
      pageCall(() => ({
        toolbar: !!document.querySelector('[data-plurid-entity="PluridToolbar"]'),
        minimap: !!document.querySelector('[data-plurid-minimap]'),
        viewcube: !!document.querySelector('[data-plurid-overlay="viewcube"]'),
      })),
    );
  // a first run is quiet: no space toolbar or viewcube; its minimap comes with the third plane
  assert.deepEqual(
    { ...(await aids()), minimap: undefined },
    { toolbar: false, minimap: undefined, viewcube: false },
  );
  await paletteCommand('Show space toolbar');
  await paletteCommand('Show viewcube');
  await until(aids, (now) => now.toolbar && now.viewcube, 'the space toolbar and viewcube shown');

  // The first press on the title selects the engine plane before its gesture listener.
  const firstLocation = await evaluate(pageCall(firstLocationJSON));
  const firstCamera = await evaluate(pageCall(cameraJSON));
  await drag('.plane-heading');
  assert.notEqual(await evaluate(pageCall(firstLocationJSON)), firstLocation);
  assert.equal(await evaluate(pageCall(cameraJSON)), firstCamera);
  assert.equal(
    await evaluate(
      pageCall(() => (window as unknown as SmokeWindow).__qaEngine.selection.get().length),
    ),
    1,
  );
  assert.equal(await evaluate(exists('[aria-label^="resize plane"]')), true);
  await paletteCommand('Frame plane');
  await settleCamera();
  await verifySpatialTools();

  await click('.plane-controls [aria-label="Search this folder"]');
  assert.equal(await evaluate(pageCall(activeLabel)), 'Find files');
  assert.equal(await evaluate(pageCall(focusOutline)), 'none');
  await command('Input.insertText', { text: 'README' });
  await click('.plane-controls [aria-label="Close search"]');
  assert.equal(await evaluate(exists('.search-row')), false);
  assert.equal(
    await evaluate(pageCall(() => document.activeElement!.classList.contains('folder-explorer'))),
    true,
  );
  await click('.plane-controls [aria-label="Search this folder"]');
  assert.equal(await evaluate(requiredValue('.search-row input')), '');
  await click('.plane-controls [aria-label="Close search"]');

  assert.equal(
    await evaluate(
      pageCall(
        () => getComputedStyle(document.querySelector('[data-plurid-plane]')!).backfaceVisibility,
      ),
    ),
    'visible',
  );
  assert.equal(
    await evaluate(
      exists(
        '.wordmark, .workspace-tabs, .workspace-footer, .folder-toolbar, .search-row, .breadcrumb-row, .operations-panel, .operations-button',
      ),
    ),
    false,
    'Initial shell has no branding, redundant toolbars, permanent operations or search rows',
  );
  await key('k', 'KeyK', 4);
  await until(
    () => evaluate(pageCall(searchingCommands)),
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
    dimensions.push(await settingsEvaluate(pageCall(() => [innerWidth, innerHeight])));
  }
  assert.deepEqual(dimensions, [dimensions[0], dimensions[0], dimensions[0]]);
  assert.ok((dimensions[0] as number[])[0] >= 760);
  await snapshot('settings-native.png');
  for (const [label, selector] of [
    ['Show space toolbar', '[data-plurid-entity="PluridToolbar"]'],
    ['Show minimap', '[data-plurid-minimap]'],
    ['Show viewcube', '[data-plurid-overlay="viewcube"]'],
  ]) {
    await setting(label);
    await until(
      () => evaluate(exists(selector)),
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
      state.ui?.version === uiPreferencesVersion &&
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
      exists(
        '[data-plurid-minimap], [data-plurid-overlay=viewcube], [data-plurid-entity=PluridToolbar]',
      ),
    ),
    false,
  );
  await paletteCommand('Settings');
  await tab('Space');
  for (const label of ['Show space toolbar', 'Show minimap', 'Show viewcube']) await setting(label);
  await setting('Show resize handles');
  assert.equal(await evaluate(exists('[aria-label^="resize plane"]')), false);
  await setting('Show resize handles');
  await setting('Drag planes by their title', false);
  await click('dialog [aria-label="Close"]');
  const stationary = await evaluate(pageCall(firstLocationJSON));
  await drag('.plane-heading');
  assert.equal(await evaluate(pageCall(firstLocationJSON)), stationary);
  await paletteCommand('Settings');
  await tab('Space');
  await setting('Drag planes by their title');
  await setting('Show plane headers');
  assert.equal(await evaluate(exists('.plane-controls')), false);
  await setting('Show plane headers');
  assert.equal((await text()).includes('Show plane backs'), false);
  assert.equal(await evaluate(pageCall(planeBackface)), 'visible');
  await click('dialog [aria-label="Close"]');
  await click('.plane-controls [aria-label="Hide plane navigation"]');
  await paletteCommand('Show plane navigation');
  await until(
    () => evaluate(exists('.folder-plane .location-sidebar')),
    (value) => value,
    'in-plane navigation',
  );
  assert.equal(
    await evaluate(requiredAttribute('.folder-plane .sidebar-resizer', 'aria-valuenow')),
    '210',
  );
  await click('.folder-plane .sidebar-resizer');
  await key('ArrowRight', 'ArrowRight');
  assert.equal(
    await evaluate(requiredAttribute('.folder-plane .sidebar-resizer', 'aria-valuenow')),
    '220',
  );
  assert.equal(
    await evaluate(
      requiredAttribute('.app-main > .location-sidebar .sidebar-resizer', 'aria-valuenow'),
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

  await verifyCapturedMenus();

  const sidebarJobs = await evaluate(pageCall(viewerJobs));
  const favorites = '.app-main > .location-sidebar .sidebar-group[aria-label="Favorites"]';
  await click(`${favorites} .sidebar-section-title`);
  assert.equal(await evaluate(exists(favorites + ' .location')), false);
  // Find the now-collapsed section by its title rather than its hidden contents.
  await evaluate(
    pageCall(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.sidebar-section-title'))
        .find((button) => button.textContent.includes('Favorites'))!
        .click(),
    ),
  );
  await evaluate(pageCall(dragFavoritesSection));
  assert.deepEqual(
    await evaluate(
      pageCall(() =>
        Array.from(document.querySelectorAll('.sidebar-section-title'), (button) =>
          button.textContent.trim(),
        ),
      ),
    ),
    ['Favorites', 'Locations', 'Recent'],
  );
  await evaluate(
    pageCall(
      (source: string, target: string) => {
        const transfer = new DataTransfer();
        const from = document.querySelector(source)!,
          to = document.querySelector(target)!;
        from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      },
      `.location[title=${JSON.stringify(path.join(fixture.files, 'Documents'))}]`,
      `.location[title=${JSON.stringify(path.join(fixture.files, 'Models'))}]`,
    ),
  );
  assert.deepEqual(
    await evaluate(
      pageCall(
        (selector: string) =>
          Array.from(document.querySelectorAll(selector), (button) => button.textContent.trim()),
        favorites + ' .location',
      ),
    ),
    ['Documents', 'Models'],
  );
  // A folder row offers a separate shortcut payload, so Favorites never moves a file.
  await evaluate(
    pageCall(
      (source: string, target: string) => {
        const transfer = new DataTransfer();
        document
          .querySelector(source)!
          .dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        document
          .querySelector(target)!
          .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      },
      fileSelector(path.join(fixture.files, 'Images')),
      favorites,
    ),
  );
  await until(
    () =>
      evaluate(exists(`.location[title=${JSON.stringify(path.join(fixture.files, 'Images'))}]`)),
    (value) => value,
    'folder shortcut drop',
  );
  await contextMenu(
    '.location[title=' + JSON.stringify(path.join(fixture.files, 'Documents')) + ']',
  );
  await command('Input.insertText', { text: 'Rename shortcut' });
  await key('Enter', 'Enter');
  await until(
    () => evaluate(valueOf('dialog input')),
    (value) => value === 'Documents',
    'shortcut alias dialog',
  );
  await command('Input.insertText', { text: 'Project documents' });
  await click('dialog .primary');
  await until(text, (value) => value.includes('Project documents'), 'shortcut alias');
  assert.deepEqual(
    await evaluate(pageCall(viewerJobs)),
    sidebarJobs,
    'Sidebar changes must not start filesystem operations',
  );
  await click('[aria-label="Sidebar width"]');
  await key('ArrowRight', 'ArrowRight');
  assert.equal(await evaluate(requiredAttribute('.sidebar-resizer', 'aria-valuenow')), '220');
  await click('[aria-label="Hide window navigation"]');
  await until(
    () => evaluate(exists('.location-sidebar')),
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
      evaluate(
        pageCall(() => document.activeElement?.getAttribute('aria-label') === 'Find file by name'),
      ),
    (value) => value,
    'contextual file finder',
  );
  await command('Input.insertText', { text: 'Project brief.pdf' });
  await choose('Search scope', 'subfolders');
  await until(
    () => evaluate(textOf('.command-result[aria-selected=true]')),
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
  assert.equal(
    await evaluate(pageCall(() => document.querySelector('.symlink-mark')?.tagName)),
    'svg',
  );
  await snapshot('selected-alias-dark.png');
  for (const extension of ['glb', 'gltf', 'obj', 'stl', 'fbx']) {
    await preview(
      path.join(fixture.files, 'Models', `Triangle.${extension}`),
      '1 mesh · 1 triangle · 3 vertices',
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
  assert.equal(
    await evaluate(pageCall(() => (window as unknown as SmokeWindow).__epubUnsafe === undefined)),
    true,
  );
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
  assert.ok(
    await evaluate(exists('[aria-label="Collapse materials"]')),
    'Data tree expansion is retained when Quick Preview reopens.',
  );
  await until(text, (value) => value.includes('Brushed aluminum'), 'light JSON tree');
  await snapshot('json-light.png');
  await closePreview();
  await paletteCommand('Parent folder');
  await until(
    () => evaluate(exists(fileSelector(path.join(fixture.files, 'Source')))),
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
    () => evaluate(exists(fileSelector(path.join(fixture.files, 'Data')))),
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
      () =>
        evaluate(
          pageCall(
            () =>
              document.querySelector<HTMLMediaElement>('dialog audio, dialog video')?.duration || 0,
          ),
        ),
      (value) => value >= 1,
      `decoded ${file}`,
    );
    await evaluate(pageCall(playPreviewMedia));
    await closePreview();
    assert.equal(
      await evaluate(
        pageCall(() => {
          const media = (window as unknown as SmokeWindow).__qaMedia!;
          return media.paused && !media.hasAttribute('src');
        }),
      ),
      true,
    );
    await evaluate(
      pageCall(() => {
        (window as unknown as SmokeWindow).__qaMedia = null;
      }),
    );
  }
  await preview(
    path.join(fixture.files, 'Media', 'Malformed.mkv'),
    'Compatibility preview unavailable',
  );
  assert.equal(await evaluate(exists('.quick-preview .native-open-actions')), true);
  await snapshot('desktop-native-media-error.png');
  await evaluate(
    pageCall(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-preview button'))
        .find((button) => button.textContent.trim() === 'Retry conversion')!
        .click(),
    ),
  );
  await until(
    text,
    (value) => value.includes('Compatibility preview unavailable'),
    'media retry recovery',
  );
  await closePreview();
  await paletteCommand('Parent folder');
  await until(text, (value) => value.includes('Reference files.zip'), 'return after media');

  const source = path.join(fixture.files, 'README.md'),
    destination = path.join(fixture.files, 'Transfers');
  assert.equal((await job({ kind: 'copy', sources: [source], destination })).status, 'completed');
  const workspaceWidth = await evaluate(pageCall(surfaceWidth));
  const collisionID = await evaluate(
    pageCall(operate, { kind: 'copy', sources: [source], destination }),
  );
  await until(
    () => evaluate(pageCall(viewerJobs)),
    (jobs) => jobs.some((job) => job.id === collisionID && job.status === 'collision'),
    'pending collision',
  );
  await until(
    () => evaluate(exists('.operations-button')),
    (value) => value,
    'conditional operations control',
  );
  await until(
    () => evaluate(exists('.operations-panel .collision')),
    Boolean,
    'collision automatically opens File operations',
  );
  await click('.operations-button');
  await until(
    () => evaluate(exists('.operations-panel')),
    (open) => !open,
    'operations control closes the automatic popover',
  );
  await click('.operations-button');
  await until(text, (value) => value.includes('already exists.'), 'collision popover');
  assert.equal(
    await evaluate(pageCall(surfaceWidth)),
    workspaceWidth,
    'Operations must not reduce workspace width',
  );
  await snapshot('operations-native.png');
  await evaluate(pageCall(collisionAction, 'Replace'));
  await until(text, (value) => value.includes('Replace existing item?'), 'protected replacement');
  await click('dialog [aria-label="Close"]');
  await evaluate(pageCall(collisionAction, 'Skip'));
  await until(
    () => evaluate(exists('.operations-button, .operations-panel')),
    (value) => !value,
    'operations control removed after completion',
  );
  await paletteCommand('File operations');
  await until(text, (value) => value.includes('completed'), 'explicit operation history');
  await click('[aria-label="Close operations"]');
  const renamed = await job({
    kind: 'rename',
    sources: [path.join(destination, 'README.md')],
    name: 'Copied notes.md',
  });
  assert.equal(renamed.undoable, true);
  await evaluate(pageCall((id: string) => window.viewer.undo(id), renamed.id));
  assert.equal(
    await readFile(path.join(destination, 'README.md'), 'utf8'),
    '# Studio\n\nSynthetic files for local Viewer verification.\n',
  );
  await verifyResourceBoundaries(source);

  await paletteCommand('Grid view');
  assert.equal(
    await evaluate(pageCall(() => document.querySelectorAll('.file-tile').length > 0)),
    true,
  );
  await paletteCommand('Columns view');
  await click(fileSelector(path.join(fixture.files, 'Documents')));
  await until(text, (value) => value.includes('Project brief.pdf'), 'column child folder');
  await preview(path.join(fixture.files, 'Documents', 'Project notes.md'), 'A wider view');
  await closePreview();
  await paletteCommand('Gallery view');
  await until(
    () => evaluate(exists(fileSelector(path.join(fixture.files, 'Documents', 'Project notes.md')))),
    Boolean,
    'view switch retains the browsed column folder',
  );
  await paletteCommand('Parent folder');
  await until(
    () => evaluate(exists(fileSelector(source))),
    Boolean,
    'parent folder returns to Studio before gallery inspection',
  );
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
    '1 mesh · 1 triangle · 3 vertices',
  );
  await evaluate(
    pageCall(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button'))
        .find((button) => button.textContent === 'Open linked plane')!
        .click(),
    ),
  );
  await until(
    () => evaluate(countOf('[data-plurid-plane]')),
    (count) => count === 2,
    'linked spatial preview',
  );
  await settleCamera();
  const facing = await evaluate(
    pageCall(() => {
      const engine = (window as unknown as SmokeWindow).__qaEngine;
      return {
        yaw: engine.camera.get().yaw,
        rotateY: engine.tree.get()[0].children![0].location.rotateY,
      };
    }),
  );
  assert.ok(
    Math.abs(((facing.yaw + facing.rotateY + 540) % 360) - 180) < 0.1,
    `New plane must face the camera: ${JSON.stringify(facing)}`,
  );
  await paletteCommand('Models');
  await settleCamera();
  const modelFile = path.join(fixture.files, 'Models', 'Triangle.glb');
  // Repeated activation reuses the original linked node, including a rapid repeated event.
  const branch = await evaluate(pageCall(treeJSON));
  await evaluate(pageCall(activateThrice, fileSelector(modelFile)));
  await settleCamera();
  assert.equal(await evaluate(countOf('[data-viewer-plane]')), 2);
  assert.equal(await evaluate(pageCall(treeJSON)), branch);
  await paletteCommand('Models');
  await settleCamera();
  await click(fileSelector(modelFile));
  await paletteCommand('Open in another plane');
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 3,
    'intentional second view',
  );
  await settleCamera();
  await paletteCommand('Close plane');
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 2,
    'closed second view',
  );
  await paletteCommand('Triangle.glb');
  await settleCamera();
  assert.equal(
    await evaluate(pageCall(() => document.querySelector('.model-stage canvas') !== null)),
    true,
  );
  assert.equal(
    await evaluate(exists('.plane-module-controls .preview-toolbar')),
    true,
    'Preview controls belong in the plane header',
  );
  await paletteCommand('Show wireframe');
  await paletteCommand('Hide wireframe');
  const transforms = () =>
    evaluate(
      pageCall(() =>
        JSON.stringify(
          Array.from(
            document.querySelectorAll('.workspace-surface [style*=transform]'),
            (element) => getComputedStyle(element).transform,
          ),
        ),
      ),
    );
  const beforeTransform = await transforms();
  const bounds = await evaluate(pageCall(visibleModelCanvas));
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
  const framed = await evaluate(pageCall(framedBounds));
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
  // docked beside the sidebar, the plane keeps its width: the model's tools give way into "…"
  // rather than widening it past the window
  assert.equal(await frameModel(), 'menu', 'Frame model gives way in a narrow docked header');
  await delay(200);
  assert.equal(
    await evaluate(
      pageCall(() => {
        const button = document.querySelector('.preview-info button')!;
        const rect = button.getBoundingClientRect();
        return (
          button.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          ) &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight
        );
      }),
    ),
    true,
    'Dock navigation must leave the external-app action visible and reachable',
  );
  await snapshot('compact-native-docked.png');
  await command('Emulation.clearDeviceMetricsOverride');
  await appearance('light');
  await until(text, (value) => value.includes('1 mesh · '), 'model after look change');
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
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 0,
    'closed linked branch',
  );
  await paletteCommand('Undo arrangement');
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 2,
    'undo closed branch',
  );
  await paletteCommand('Redo arrangement');
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 0,
    'redo closed branch',
  );
  await paletteCommand('Undo arrangement');
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 2,
    'restore closed branch again',
  );
  // Verify real workspace switching without sharing an engine adapter.
  await paletteCommand('New workspace');
  await command('Input.insertText', { text: 'Second workspace' });
  await click('dialog .primary');
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
    (count) => count === 1,
    'new workspace',
  );
  const filesBeforeDelete = await inventory();
  const jobsBeforeDelete = await evaluate(pageCall(viewerJobs));
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
    () => evaluate(textOf('.workspace-switcher')),
    (value) => value.trim() === fixture.state.workspaces[0].name,
    'layout-only deletion switches workspace',
  );
  assert.deepEqual(
    await inventory(),
    filesBeforeDelete,
    'Workspace deletion must preserve every fixture file, folder and symlink',
  );
  assert.deepEqual(
    await evaluate(pageCall(viewerJobs)),
    jobsBeforeDelete,
    'Workspace deletion must preserve file jobs',
  );
  await paletteCommand('Undo workspace deletion');
  await until(
    () => evaluate(textOf('.workspace-switcher')),
    (value) => value.trim() === 'Second workspace',
    'workspace recovery',
  );
  assert.deepEqual(await inventory(), filesBeforeDelete, 'Recovery must preserve fixture contents');
  await paletteCommand(fixture.state.workspaces[0].name);
  await until(
    () => evaluate(countOf('[data-viewer-plane]')),
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
    () => evaluate(countOf('[data-plurid-plane]')),
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
  assert.equal(await evaluate(pageCall(pageLook)), 'light');
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
  console.error(launched.output().slice(-3500));
  if (socket?.readyState === WebSocket.OPEN) {
    console.error(await evaluate(pageCall(failureDiagnostics)).catch(() => 'No diagnostic DOM'));
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
  await launched.stop();
  console.log('Native fixtures preserved:', fixture.root);
  console.log('Native evidence preserved:', owned.evidenceDirectory);
}
