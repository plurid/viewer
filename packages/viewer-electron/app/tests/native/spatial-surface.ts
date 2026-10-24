/** Owned clear-backdrop and HUD regression; only generated folders are inspected. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const binary = path.resolve(process.env.VIEWER_TEST_BINARY);
const root = await realpath(await temporaryRoot('viewer-native-spatial-surface-'));
const profile = path.join(root, 'Profile');
const folder = path.join(root, 'Generated empty folder');
await Promise.all([profile, folder].map((file) => mkdir(file, { mode: 0o700 })));
const settings = defaultSettings(folder);
settings.providers = [];
settings.hotkey.enabled = false;
settings.agents.enabled = false;
const ui = normalizePreferences();
ui.space.backdrop = 'clear';
ui.space.backdropOpacity = 60;
ui.space.grid = false;
ui.space.minimap = false;
ui.space.viewcube = true;
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
  mode: 0o600,
});
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'generated-space',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'generated-space',
      name: 'Generated clear backdrop',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: folder,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [folder],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
  flag: 'wx',
  mode: 0o600,
});
const sha = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
const result: Record<string, unknown> = {
  binary,
  executableSha256: await sha(binary),
  archiveSha256: await sha(path.resolve(binary, '../../Resources/app.asar')),
  root,
  profile,
  retained: true,
};
const mode = process.env.VIEWER_NATIVE_WINDOW_MODE ?? 'hidden';
assert.ok(mode === 'hidden' || mode === 'foreground');
const app = await ownedApp(binary, profile, { mode });
const main = await app.connect();
const nativeCapture = process.env.VIEWER_NATIVE_CAPTURE_WINDOW === '1';
const visibility = path.join(root, 'on-screen-windows');
if (nativeCapture) {
  assert.equal(mode, 'foreground');
  await promisify(execFile)('/usr/bin/xcrun', [
    'swiftc', 'tests/native/fixtures/on-screen-windows.swift', '-o', visibility,
  ]);
}
result.evidenceDirectory = app.evidenceDirectory;
const measurements: unknown[] = [];
result.measurements = measurements;
const save = () => writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));

async function measure(name: string) {
  let previous = '';
  let stable = 0;
  await until(
    () => main.evaluate<string>(`(() => {
      const view = document.querySelector('[data-plurid-entity="PluridView"]');
      const plane = document.querySelector('[data-plurid-plane]');
      const space = document.querySelector('[data-plurid-entity="PluridSpace"]');
      if (!view || !plane || !space || view.hasAttribute('data-plurid-motion') ||
          Number(getComputedStyle(space).opacity) < 1) return '';
      const rect = plane.getBoundingClientRect();
      return JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
    })()`),
    (current) => {
      stable = current && current === previous ? stable + 1 : 0;
      previous = current;
      return stable >= 3;
    },
    'settled spatial geometry',
  );
  const value = await main.evaluate<Record<string, unknown>>(`(() => {
    const root = document.querySelector('.workspace-surface');
    const cube = root.querySelector('[data-plurid-overlay="viewcube"]');
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom };
    };
    const layers = Array.from(root.querySelectorAll('*')).flatMap(element => {
      const style = getComputedStyle(element);
      if (style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none') return [];
      return [{ entity: element.getAttribute('data-plurid-entity'), className: element.className,
        bounds: box(element), background: style.backgroundColor, image: style.backgroundImage,
        transform: style.transform, opacity: style.opacity, shadow: style.boxShadow }];
    });
    return { viewport: box(root), cube: cube ? box(cube) : null, layers,
      plane: box(root.querySelector('[data-plurid-plane]')),
      backdrop: document.documentElement.dataset.backdrop };
  })()`);
  const { data } = await main.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const screenshot = path.join(app.evidenceDirectory, name + '.png');
  await writeFile(screenshot, Buffer.from(data, 'base64'), { flag: 'wx', mode: 0o600 });
  let windowScreenshot: string | undefined;
  if (nativeCapture) {
    const { stdout } = await promisify(execFile)(visibility, [String(app.child.pid)]);
    const identifiers: number[] = JSON.parse(stdout);
    assert.equal(identifiers.length, 1, 'Only the owned test window is captured');
    windowScreenshot = path.join(app.evidenceDirectory, name + '-window.png');
    await promisify(execFile)('/usr/sbin/screencapture', [
      '-x', '-o', '-l', String(identifiers[0]), windowScreenshot,
    ]);
  }
  measurements.push({ name, ...value, screenshot, windowScreenshot });
  await save();
  return value;
}

try {
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(".plane-heading")'),
    Boolean,
    'generated folder plane',
  );
  const { windowId } = await main.command<{ windowId: number }>('Browser.getWindowForTarget');
  await main.command('Browser.setWindowBounds', {
    windowId, bounds: { windowState: 'normal' },
  });
  await main.command('Browser.setWindowBounds', {
    windowId, bounds: { width: 1000, height: 700 },
  });
  await measure('before-drag');
  const point = await main.evaluate<{ x: number; y: number }>(`(() => {
    const rect = document.querySelector('.plane-heading').getBoundingClientRect();
    return {x: rect.x + Math.min(120, rect.width / 2), y: rect.y + rect.height / 2};
  })()`);
  await main.command('Input.dispatchMouseEvent', {
    type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point,
  });
  for (let step = 1; step <= 8; step++) {
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left', buttons: 1,
      x: point.x + step * 20, y: point.y - step * 12,
    });
    await delay(20);
  }
  await main.command('Input.dispatchMouseEvent', {
    type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1,
    x: point.x + 160, y: point.y - 96,
  });
  await measure('after-drag');
  await main.command('Browser.setWindowBounds', {
    windowId, bounds: { width: 1400, height: 1200 },
  });
  await measure('after-resize');
  result.completed = true;
  await save();
  console.log('Retained spatial surface diagnostics: ' + path.join(root, 'result.json'));
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  await save();
  throw error;
} finally {
  await app.close(main);
}
