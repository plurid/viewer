/** Owned clear-backdrop and HUD regression; only generated folders are inspected. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
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
const sha = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
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
result.evidenceDirectory = app.evidenceDirectory;
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}
interface SurfaceSnapshot {
  viewport: Bounds;
  plane: Bounds;
  cube: Bounds;
  cubeStyle: { left: string; top: string; right: string; bottom: string; visibility: string };
  backdrop: string;
  floorColor: string;
  exclusions: Bounds[];
}
interface PixelCheck {
  sampled: number;
  failed: number;
  expected: number[];
  mismatches: { x: number; y: number; rgba: number[] }[];
}
const measurements: (SurfaceSnapshot & { name: string; screenshot: string; pixels: PixelCheck })[] =
  [];
result.measurements = measurements;
const save = () => writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));

async function measure(name: string) {
  let previous = '';
  let stable = 0;
  await until(
    () =>
      main.evaluate<string>(`(() => {
      const view = document.querySelector('[data-plurid-entity="PluridView"]');
      const plane = document.querySelector('[data-plurid-plane]');
      const space = document.querySelector('[data-plurid-entity="PluridSpace"]');
      if (!view || !plane || !space || view.hasAttribute('data-plurid-motion') ||
          Number(getComputedStyle(space).opacity) < 1) return '';
      const rect = plane.getBoundingClientRect();
      const cube = document.querySelector('[data-plurid-overlay="viewcube"]').getBoundingClientRect();
      return JSON.stringify([rect.x, rect.y, rect.width, rect.height, cube.x, cube.y]);
    })()`),
    (current) => {
      stable = current && current === previous ? stable + 1 : 0;
      previous = current;
      return stable >= 3;
    },
    'settled spatial geometry',
  );
  const value = await main.evaluate<SurfaceSnapshot>(`(() => {
    const root = document.querySelector('.workspace-surface');
    const cube = root.querySelector('[data-plurid-overlay="viewcube"]');
    const space = root.querySelector('[data-plurid-entity="PluridSpace"]');
    const style = getComputedStyle(cube);
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom };
    };
    const exclusions = Array.from(root.querySelectorAll(
      '[data-plurid-plane], [data-plurid-overlay], [data-plurid-entity="PluridToolbar"]'
    )).filter(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).map(box);
    return { viewport: box(root), cube: box(cube), exclusions,
      cubeStyle: {left: cube.style.left, top: cube.style.top,
        right: style.right, bottom: style.bottom, visibility: style.visibility},
      plane: box(root.querySelector('[data-plurid-plane]')),
      floorColor: getComputedStyle(space).backgroundColor,
      backdrop: document.documentElement.dataset.backdrop };
  })()`);
  const { data } = await main.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  const screenshot = path.join(app.evidenceDirectory, name + '.png');
  await writeFile(screenshot, Buffer.from(data, 'base64'), { flag: 'wx', mode: 0o600 });
  // The PNG's alpha must remain uniform in the vacated floor, including after a real resize.
  // A repeated tint or stale rectangle changes these pixels even when its DOM geometry looks right.
  const pixels = await main.evaluate<PixelCheck>(`(async () => {
    const snapshot = ${JSON.stringify(value)};
    const image = new Image();
    image.src = 'data:image/png;base64,' + ${JSON.stringify(data)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.fillStyle = snapshot.floorColor;
    context.fillRect(0, 0, 1, 1);
    const expected = Array.from(context.getImageData(0, 0, 1, 1).data);
    context.clearRect(0, 0, 1, 1);
    context.drawImage(image, 0, 0);
    const sx = canvas.width / innerWidth, sy = canvas.height / innerHeight;
    const check = {sampled: 0, failed: 0, expected, mismatches: []};
    const view = snapshot.viewport;
    for (let y = view.y + 16; y < view.bottom - 16; y += 24) {
      for (let x = view.x + 16; x < view.right - 16; x += 24) {
        if (snapshot.exclusions.some(rect =>
          x >= rect.x - 16 && x <= rect.right + 16 &&
          y >= rect.y - 16 && y <= rect.bottom + 16)) continue;
        const rgba = Array.from(context.getImageData(Math.floor(x * sx), Math.floor(y * sy), 1, 1).data);
        check.sampled++;
        if (rgba.some((channel, index) => Math.abs(channel - expected[index]) > 2)) {
          check.failed++;
          if (check.mismatches.length < 8) check.mismatches.push({x, y, rgba});
        }
      }
    }
    return check;
  })()`);
  measurements.push({ name, ...value, screenshot, pixels });
  await save();
  return value;
}

try {
  await until(
    () => main.evaluate<boolean>('!!document.querySelector(".plane-heading")'),
    Boolean,
    'generated folder plane',
  );
  await main.evaluate('window.resizeTo(1000, 700)');
  const before = await measure('before-drag');
  const point = await main.evaluate<{ x: number; y: number }>(`(() => {
    const rect = document.querySelector('.plane-heading').getBoundingClientRect();
    return {x: rect.x + Math.min(120, rect.width / 2), y: rect.y + rect.height / 2};
  })()`);
  await main.command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...point,
  });
  for (let step = 1; step <= 8; step++) {
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: point.x + step * 20,
      y: point.y - step * 12,
    });
    await delay(20);
  }
  await main.command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    x: point.x + 160,
    y: point.y - 96,
  });
  const moved = await measure('after-drag');
  await main.evaluate('window.resizeTo(1400, 1200)');
  const resized = await measure('after-resize');
  assert.ok(resized.viewport.width > before.viewport.width, 'The native window really resized');
  assert.ok(
    Math.abs(moved.plane.x - before.plane.x) > 16,
    'The real plane drag vacated floor pixels',
  );

  // Find the existing public engine ref through React's test-only fiber, as the native smoke does.
  assert.equal(
    await main.evaluate(`(() => {
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
  await main.evaluate(`window.__qaEngine.pubsub.publish({
    topic: ${JSON.stringify(PLURID_PUBSUB_TOPIC.CONFIGURATION)},
    data: {elements: {viewcube: {conceal: true}}}
  })`);
  await main.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 70 });
  const tucked = await measure('engine-conceal');
  await main.command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: tucked.viewport.right - 20,
    // Stay inside both the tucked and expanded boxes throughout the engine's transition.
    y: tucked.viewport.bottom - 60,
  });
  const expanded = await measure('engine-hover');
  assert.equal(expanded.cubeStyle.right, '0px', 'Hover expands the native cube');
  assert.ok(expanded.cube.bottom <= expanded.viewport.bottom, 'The expanded cube fits its corner');
  await main.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 70 });
  await main.evaluate('window.resizeTo(780, 560)');
  await measure('compact-conceal');
  for (const snapshot of measurements) {
    assert.equal(snapshot.backdrop, 'clear');
    assert.equal(
      snapshot.cubeStyle.visibility,
      'visible',
      'The empty toolbar band does not hide the cube',
    );
    assert.ok(snapshot.pixels.sampled >= 20, 'Enough exposed floor pixels are sampled');
    assert.equal(
      snapshot.pixels.failed,
      0,
      'The captured floor has no differently tinted rectangle',
    );
    assert.equal(
      snapshot.cubeStyle.left,
      '',
      'Viewer does not override the native horizontal anchor',
    );
    assert.equal(snapshot.cubeStyle.top, '', 'Viewer does not override the native vertical anchor');
  }
  assert.ok(
    tucked.cube.right > tucked.viewport.right,
    'The engine can tuck the cube outside its corner',
  );
  assert.ok(tucked.cube.bottom > tucked.viewport.bottom, 'The engine conceal offset is preserved');
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
