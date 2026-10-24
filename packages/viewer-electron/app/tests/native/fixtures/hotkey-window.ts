import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { app, BrowserWindow, screen } from 'electron';
import { HotkeyWindow, type WindowBounds } from '../../../src/desktop/windows/hotkey-window';
import { activateApplication } from '../../../src/desktop/windows/application-dispatch';
import type { FullscreenPhase } from '../../../src/desktop/windows/fullscreen-transition';

interface WindowEvidence {
  id: number;
  destroyed: boolean;
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  fullscreen: boolean;
  dropped: boolean;
  bounds?: WindowBounds;
  normalBounds?: WindowBounds;
}

interface NativeState {
  hidden: boolean;
  targetID?: number;
  onScreenWindowIDs?: number[];
  windows: WindowEvidence[];
}

interface NativeEvent extends NativeState {
  label: string;
  elapsed: number;
}

const stateTimeout = 4000;
const stableMilliseconds = 100;
const pollMilliseconds = 25;
const started = performance.now();
const evidenceRoot = process.env.VIEWER_HOTKEY_FIXTURE_ROOT;
assert.ok(
  evidenceRoot && path.isAbsolute(evidenceRoot),
  'Run this fixture through its native probe.',
);
assert.equal(realpathSync(evidenceRoot), path.resolve(__dirname, '../../..'));
const resultPath = path.join(evidenceRoot, 'result.json');
const profile = path.join(evidenceRoot, 'Profile');
mkdirSync(profile, { mode: 0o700 });
app.setName('Viewer hotkey regression');
app.setPath('userData', profile);
const nativeWindows = createRequire(path.join(evidenceRoot, 'native.cjs'))(
  path.join(evidenceRoot, 'window-fullscreen.node'),
) as { windowFullscreenPhase(handle: Buffer): FullscreenPhase };

const events: NativeEvent[] = [];
const windows: BrowserWindow[] = [];
let hotkey: HotkeyWindow | undefined;
let target: BrowserWindow | undefined;
let finished = false;
let activationQueue: Promise<void> = Promise.resolve();
let onScreenWindowIDs: number[] | undefined;

function state(): NativeState {
  return {
    hidden: app.isHidden(),
    targetID: target?.id,
    onScreenWindowIDs,
    windows: windows.map((window) => {
      const destroyed = window.isDestroyed();
      return {
        id: window.id,
        destroyed,
        visible: !destroyed && window.isVisible(),
        focused: !destroyed && window.isFocused(),
        minimized: !destroyed && window.isMinimized(),
        fullscreen: !destroyed && window.isFullScreen(),
        dropped: hotkey?.isDropped(window) ?? false,
        bounds: destroyed ? undefined : window.getBounds(),
        normalBounds: destroyed ? undefined : window.getNormalBounds(),
      };
    }),
  };
}

function writeEvidence(error?: unknown, passed = false): void {
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        version: 1,
        pid: process.pid,
        profile,
        scenario: process.env.VIEWER_HOTKEY_FIXTURE_SCENARIO ?? 'normal',
        passed,
        events,
        error:
          error instanceof Error ? error.stack : error === undefined ? undefined : String(error),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

function snapshot(label: string): void {
  events.push({ label, elapsed: Math.round(performance.now() - started), ...state() });
  writeEvidence();
}

/** Poll native state through its asynchronous transition, then require a stable observation. */
async function until(label: string, predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + stateTimeout;
  let stableSince: number | undefined;
  let previous = '';
  while (performance.now() < deadline) {
    if (finished) throw new Error('The native fixture stopped before ' + label + '.');
    await activationQueue;
    const now = performance.now();
    const current = JSON.stringify(state());
    if (current !== previous) {
      previous = current;
      snapshot(label + ': observed');
    }
    if (await predicate()) {
      stableSince ??= now;
      if (now - stableSince >= stableMilliseconds) {
        snapshot(label + ': settled');
        return;
      }
    } else stableSince = undefined;
    await new Promise<void>((resolve) => setTimeout(resolve, pollMilliseconds));
  }
  snapshot(label + ': timed out');
  assert.fail('Native state did not settle: ' + label + '. See result.json for every transition.');
}

function visibleAndFocused(window: BrowserWindow): boolean {
  return !app.isHidden() && window.isVisible() && window.isFocused() && !window.isMinimized();
}

function droppedAndFocused(window: BrowserWindow): boolean {
  return (
    visibleAndFocused(window) &&
    !!hotkey?.isDropped(window) &&
    window.getBounds().y === screen.getPrimaryDisplay().workArea.y
  );
}

async function onScreen(window: BrowserWindow): Promise<boolean> {
  const { stdout } = await promisify(execFile)(
    path.join(evidenceRoot!, 'on-screen-windows'),
    [String(process.pid)],
    { timeout: 2000, maxBuffer: 65536 },
  );
  onScreenWindowIDs = JSON.parse(stdout) as number[];
  const identifier = /^window:(\d+):/.exec(window.getMediaSourceId());
  assert.ok(identifier, 'The native window has a CoreGraphics source identifier.');
  return onScreenWindowIDs.includes(Number(identifier[1]));
}

async function focusOtherWindow(original: BrowserWindow): Promise<void> {
  const other = windows.find((window) => window !== original && window.isVisible());
  assert.ok(other, 'Another owned workspace is available for native focus transfer.');
  other.focus();
  await until(
    'native focus moved to another workspace',
    () => other.isFocused() && target === other,
  );
  assert.notEqual(target, original, 'The focus listener must actually select another workspace.');
}

async function run(): Promise<void> {
  assert.equal(realpathSync(app.getPath('userData')), realpathSync(profile));
  const scenario = process.env.VIEWER_HOTKEY_FIXTURE_SCENARIO;
  const fullscreenScenario = scenario === 'fullscreen' || scenario === 'fullscreen-entering';
  for (let index = 0; index < 3; index += 1) {
    const window = new BrowserWindow({
      title: 'Viewer hotkey regression ' + (index + 1),
      width: 800,
      height: 600,
      minWidth: 780,
      minHeight: 560,
      titleBarStyle: 'hiddenInset',
      show: false,
    });
    window.on('focus', () => {
      if (finished) return;
      target = window;
      snapshot('native workspace focus');
    });
    window.on('hide', () => {
      if (!finished) snapshot('native workspace hide');
    });
    window.on('minimize', () => {
      if (!finished) snapshot('native workspace minimize');
    });
    window.on('restore', () => {
      if (!finished) snapshot('native workspace restore');
    });
    window.on('enter-full-screen', () => {
      if (!finished) snapshot('native workspace entered fullscreen');
    });
    window.on('leave-full-screen', () => {
      if (!finished) snapshot('native workspace left fullscreen');
    });
    windows.push(window);
    await window.loadURL('data:text/html,<title>Native hotkey regression</title>');
    window.show();
    await until('workspace ' + (index + 1) + ' shown', () => visibleAndFocused(window));
  }
  const original = windows.at(-1)!;
  original.focus();
  await until('original workspace focused', () => original.isFocused() && target === original);
  const originalBounds = original.getBounds();
  hotkey = new HotkeyWindow(
    { register: () => true, unregister: () => {} },
    async () => target,
    () => screen.getPrimaryDisplay().workArea,
    () => true,
    () => {},
    true,
    (window) => nativeWindows.windowFullscreenPhase(window.getNativeWindowHandle()),
  );
  hotkey.configure(true, 'Alt+Space');
  const activate = () =>
    activateApplication({
      available: () => !finished,
      present: true,
      restoreHotkey: () => hotkey?.restore() ?? false,
      currentWindow: () => target,
      createWindow: async () => undefined,
    });
  // This is the same listener path as the application. No activate event or global key is emitted.
  app.on('activate', () => {
    if (finished) return;
    snapshot('native application activate');
    activationQueue = activationQueue.then(activate).catch(finish);
  });

  if (fullscreenScenario) {
    if (scenario === 'fullscreen') {
      await new Promise<void>((resolve) => {
        original.once('enter-full-screen', () => resolve());
        hotkey!.setFullScreen(original, true);
      });
      await until('original workspace in fullscreen', () => visibleAndFocused(original));
      assert.ok(original.isFullScreen());
    } else {
      hotkey.setFullScreen(original, true);
    }
    snapshot('before fullscreen toggle');
    await hotkey.toggle();
    await until(
      'fullscreen workspace becomes visible drop-down',
      async () =>
        droppedAndFocused(original) &&
        !original.isFullScreen() &&
        original.getBounds().height < screen.getPrimaryDisplay().workArea.height &&
        (await onScreen(original)),
    );
    await hotkey.toggle();
    await until(
      'fullscreen drop-down hidden',
      async () => !original.isVisible() && !(await onScreen(original)),
    );
    await hotkey.toggle();
    await until(
      'fullscreen drop-down shown again',
      async () => droppedAndFocused(original) && (await onScreen(original)),
    );
    await activate();
    await until(
      'original fullscreen restored',
      async () =>
        visibleAndFocused(original) &&
        original.isFullScreen() &&
        !hotkey!.isDropped(original) &&
        (await onScreen(original)),
    );
    return;
  }

  snapshot('before first toggle');
  await hotkey.toggle();
  await until('first drop-down shown', () => droppedAndFocused(original));
  await hotkey.toggle();
  await until('drop-down hidden', () => !original.isVisible() && hotkey!.isDropped(original));
  assert.equal(original.isVisible(), false, 'The second toggle must actually hide its window.');
  await focusOtherWindow(original);
  await hotkey.toggle();
  await until('same drop-down shown again', () => droppedAndFocused(original));
  assert.equal(windows.length, 3, 'Repeated toggles keep the same native windows.');

  original.minimize();
  await until('drop-down minimized', () => original.isMinimized() && !original.isFocused());
  assert.ok(original.isMinimized(), 'Recovery starts from an actually minimized native window.');
  await hotkey.toggle();
  await until('minimized drop-down recovered', () => droppedAndFocused(original));
  assert.equal(original.isMinimized(), false);

  app.hide();
  await until(
    'application hidden',
    () => app.isHidden() && windows.every((window) => !window.isFocused()),
  );
  assert.ok(app.isHidden(), 'Recovery starts from an actually hidden native application.');
  await hotkey.toggle();
  await until('hidden application recovered', () => droppedAndFocused(original));
  assert.equal(app.isHidden(), false);
  assert.ok(hotkey.isDropped(original), 'Application recovery preserves drop-down placement.');

  await hotkey.toggle();
  await until(
    'hotkey target hidden before Dock helper',
    () => !original.isVisible() && hotkey!.isDropped(original),
  );
  assert.equal(original.isVisible(), false, 'Dock recovery starts from a hidden hotkey target.');
  await focusOtherWindow(original);
  await activate();
  await until(
    'Dock helper recovered original placement',
    () =>
      visibleAndFocused(original) &&
      !hotkey!.isDropped(original) &&
      JSON.stringify(original.getBounds()) === JSON.stringify(originalBounds),
  );
  assert.deepEqual(original.getBounds(), originalBounds);
  assert.equal(BrowserWindow.getAllWindows().length, 3);
}

function finish(error?: unknown): void {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  hotkey?.close();
  snapshot(error === undefined ? 'passed' : 'failed');
  writeEvidence(error, error === undefined);
  if (error !== undefined) console.error(error instanceof Error ? error.stack : error);
  app.exit(error === undefined ? 0 : 1);
}

const watchdog = setTimeout(
  () => finish(new Error('The native hotkey fixture exceeded 30 seconds.')),
  30_000,
);
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
app
  .whenReady()
  .then(run)
  .then(() => finish(), finish);
