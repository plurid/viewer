/** Folder activation must preserve the camera even when navigation replaces the clicked row. */
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedState } from '../../src/domain/contracts';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { defaultSettings } from '../../src/domain/services';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { NativeInteractions } from './runtime/interactions';
import { countOf, exists } from './runtime/page';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.ok(process.env.VIEWER_TEST_BINARY);
const root = await realpath(await temporaryRoot('viewer-folder-double-click-'));
const profile = path.join(root, 'Profile');
const folder = path.join(root, 'Files');
const child = path.join(folder, 'Child');
const other = path.join(root, 'Other');
await Promise.all([profile, child, other].map((file) => mkdir(file, { recursive: true })));
await writeFile(path.join(child, 'Inside.txt'), 'The folder opened.\n', { flag: 'wx' });
const settings = defaultSettings(folder);
settings.providers = [];
settings.hotkey.enabled = false;
settings.agents.enabled = false;
const ui = normalizePreferences();
ui.sidebar.visible = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  activeWorkspace: 'folders',
  look: 'dark',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'folders',
      name: 'Folder double-click',
      roots: ['folder', 'other'],
      activePane: 'folder',
      arrangement: {},
      panes: [folder, other].map((file, index) => ({
        id: index ? 'other' : 'folder',
        type: 'folder',
        path: file,
        mode: 'list',
        sort: 'name',
        descending: false,
        showHidden: false,
        history: [file],
        historyIndex: 0,
      })),
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
const app = await ownedApp(process.env.VIEWER_TEST_BINARY, profile);
const main = await app.connect();
const result: Record<string, unknown> = { root, binary: process.env.VIEWER_TEST_BINARY };
const checks: unknown[] = [];
result.checks = checks;
const actions = new NativeInteractions({ ...main, until });
const header = '[data-viewer-plane="folder"]';
const folderView = (file: string) =>
  '.folder-explorer[aria-label=' + JSON.stringify('Folder ' + file) + ']';
function geometry() {
  const plane = document
    .querySelector('[data-viewer-plane="folder"]')
    ?.closest('[data-plurid-plane]');
  if (!plane || document.querySelector('[data-plurid-motion]')) return null;
  const rect = plane.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
function rowPoint(file: string) {
  const row = [...document.querySelectorAll<HTMLElement>('[data-file-path]')].find(
    (row) => row.dataset.filePath === file,
  );
  if (!row) throw new Error('Folder row unavailable');
  row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  const label = row.querySelector('.filename') ?? row;
  const rect = label.getBoundingClientRect();
  const point = { x: rect.x + Math.min(20, rect.width / 2), y: rect.y + rect.height / 2 };
  const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-file-path]');
  if (hit?.dataset.filePath !== file) throw new Error('Folder row is obscured');
  return point;
}
async function doubleClick(point: { x: number; y: number }, modifiers = 0) {
  for (const clickCount of [1, 2]) {
    await main.command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      buttons: 1,
      clickCount,
      modifiers,
      ...point,
    });
    await main.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      clickCount,
      modifiers,
      ...point,
    });
  }
}
function backdropPoint() {
  for (const x of [12, innerWidth - 12]) {
    for (const y of [120, innerHeight - 40]) {
      const target = document.elementFromPoint(x, y);
      if (
        target?.closest('[data-plurid-entity="PluridView"]') &&
        !target.closest('[data-plurid-plane], [data-plurid-overlay], button')
      )
        return { x, y };
    }
  }
  throw new Error('No unobstructed backdrop');
}
try {
  await main.command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(() => main.evaluate(exists('[data-viewer-plane="folder"]')), Boolean, 'Folder plane');
  await actions.click(header + ' [aria-label="Frame plane"]');
  const settle = () => {
    let last = '';
    let stable = 0;
    return until(
      () => main.evaluate(pageCall(geometry)),
      (value) => {
        const current = JSON.stringify(value);
        stable = value && current === last ? stable + 1 : 0;
        last = current;
        return stable >= 3;
      },
      'Camera settled',
    );
  };
  const back = async () => {
    await actions.click(header + ' [aria-label="Back"]');
    await until(() => main.evaluate(exists(folderView(folder))), Boolean, 'Original folder');
    const column = '[data-folder-path=' + JSON.stringify(folder) + '] .column-title';
    // View commands use the active column, which Back may restore as a child.
    if (await main.evaluate(exists(column))) await actions.click(column);
  };
  for (const mode of ['List', 'Grid', 'Columns', 'Gallery', 'Map']) {
    if (mode !== 'List') await back();
    await actions.palette(mode + ' view');
    await until(
      () =>
        main.evaluate(
          exists(header + ' [title=' + JSON.stringify('View as ' + mode.toLowerCase()) + ']'),
        ),
      Boolean,
      mode + ' view',
    );
    if (mode === 'Columns') {
      // Reveal the child column before double-clicking so its automatic scroll cannot
      // place a different row under the pointer between the two native clicks.
      await actions.click('[data-file-path=' + JSON.stringify(child) + ']');
      await until(
        () => main.evaluate(exists('[data-folder-path=' + JSON.stringify(child) + ']')),
        Boolean,
        'Child column revealed',
      );
    }
    const before = await settle();
    assert.equal(await main.evaluate(countOf('[data-plurid-plane]')), 2);
    await doubleClick(await main.evaluate(pageCall(rowPoint, child)));
    await until(() => main.evaluate(exists(folderView(child))), Boolean, 'Entered child folder');
    await until(
      () =>
        main.evaluate(
          exists('[data-file-path=' + JSON.stringify(path.join(child, 'Inside.txt')) + ']'),
        ),
      Boolean,
      'Child contents',
    );
    const after = await settle();
    checks.push({ mode, before, after });
    assert.deepEqual(after, before, mode + ': entering a folder must not reframe the workspace');
    assert.equal(await main.evaluate(countOf('[data-plurid-plane]')), 2);
    await actions.capture(path.join(root, mode.toLowerCase() + '.png'));
  }
  await back();
  await actions.palette('List view');
  await settle();
  await doubleClick(await main.evaluate(pageCall(rowPoint, child)), 1);
  await until(
    () => main.evaluate(countOf('[data-plurid-plane]')),
    (count) => count === 3,
    'Option-double-click opens a linked folder',
  );
  assert.ok(
    await main.evaluate(exists(folderView(folder))),
    'Linked opening keeps the source folder',
  );
  checks.push({ mode: 'Option-double-click', planes: 3 });
  await actions.click(header + ' [aria-label="Frame plane"]');
  const framed = await settle();
  assert.ok(framed);
  await doubleClick(await main.evaluate(pageCall(backdropPoint)));
  const overview = await settle();
  assert.ok(
    overview && overview.width < framed.width * 0.8,
    'Backdrop double-click still frames all planes',
  );
  checks.push({ mode: 'Backdrop double-click', framed, overview });
  await actions.capture(path.join(root, 'overview.png'));
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  const picture = await main.command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'failure.png'), Buffer.from(picture.data, 'base64'), {
    flag: 'wx',
  });
  throw error;
} finally {
  await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(root);
  await app.close(main);
}
