/** Trusted Chromium drag events in a hidden owned app; not physical Finder drag acceptance. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { ownedApp, until } from './owned-app';
import type { SavedState } from '../src/domain/contracts';
import { attributeOf, countOf, exists, focus } from './native/runtime/page';
import type { PageExpression } from './native/runtime/page-function';
import { pageCall } from './native/runtime/page-function';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const binary =
  process.env.VIEWER_TEST_BINARY ||
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
const root = await temporaryRoot('viewer-native-drag-');
const profile = path.join(root, 'profile'),
  browse = path.join(root, 'Browse'),
  nested = path.join(browse, 'Nested'),
  child = path.join(nested, 'Child'),
  source = path.join(root, 'Source.txt');
await mkdir(profile);
await mkdir(child, { recursive: true });
await writeFile(source, 'Generated spring-loading fixture.');
await writeFile(path.join(child, 'Existing.txt'), 'Keep this generated file.');
await Promise.all(
  Array.from({ length: 130 }, (_, i) =>
    writeFile(path.join(browse, 'Item-' + String(i).padStart(3, '0') + '.txt'), String(i)),
  ),
);
const initial: SavedState = {
  version: 3,
  activeWorkspace: 'drag',
  favorites: [],
  recents: [],
  look: 'dark',
  workspaces: [
    {
      id: 'drag',
      name: 'Drag navigation',
      roots: ['drag-folder'],
      activePane: 'drag-folder',
      arrangement: {},
      panes: [
        {
          id: 'drag-folder',
          type: 'folder',
          path: browse,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [browse],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(initial));

/** The selector's middle, or null while nothing matches or something covers it. */
function visibleCenter(selector: string) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  return element.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
}

const longList = () => (document.querySelector('.file-scroll')?.scrollHeight ?? 0) > 1000;

/** Two pixels above the file list's bottom edge, centered. */
function bottomEdge() {
  const rect = document.querySelector('.file-scroll')!.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom - 2 };
}

const listScrollTop = () => document.querySelector('.file-scroll')!.scrollTop;

function scrollListToTop() {
  document.querySelector('.file-scroll')!.scrollTop = 0;
}

/** Whether the list fits the 760-pixel viewport while its columns scroll sideways. */
function narrowList() {
  const table = document.querySelector('.file-table');
  if (!table) return false;
  const bounds = table.getBoundingClientRect();
  return (
    innerWidth === 760 && bounds.right <= innerWidth + 1 && table.scrollWidth > table.clientWidth
  );
}

/** Two pixels inside the table's right edge, 100 pixels into the list. */
function rightEdge() {
  const table = document.querySelector('.file-table')!.getBoundingClientRect(),
    list = document.querySelector('.file-scroll')!.getBoundingClientRect();
  return { x: table.right - 2, y: list.top + 100 };
}

const viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
let pulse: ReturnType<typeof setInterval> | undefined;
let pumping: Promise<void> | undefined;
let dragPoint: { x: number; y: number } | undefined;
let pulseError: unknown;
try {
  connection = await viewer.connect();
  const evaluate = <R>(expression: PageExpression<R>) => connection!.evaluate(expression);
  const command = (method: string, params: Record<string, unknown> = {}) =>
    connection!.command(method, params);
  const data = {
    items: [{ mimeType: 'application/x-viewer-files', data: JSON.stringify([source]) }],
    dragOperationsMask: 17,
  };
  // Model continuing dragover delivery, which CDP's one-shot drag injection omits.
  pulse = setInterval(() => {
    if (!dragPoint || pumping) return;
    pumping = command('Input.dispatchDragEvent', { type: 'dragOver', ...dragPoint, data })
      .then(() => {})
      .catch((error) => {
        pulseError ??= error;
      })
      .finally(() => {
        pumping = undefined;
      });
  }, 150);
  const pause = async () => {
    const last = dragPoint;
    dragPoint = undefined;
    await pumping;
    if (last) {
      await command('Input.dispatchDragEvent', { type: 'dragOver', ...last, data });
      await command('Input.dispatchDragEvent', { type: 'dragOver', ...last, data });
    }
  };
  const row = (folder: string) => '[data-directory-path=' + JSON.stringify(folder) + ']';
  const column = (folder: string) =>
    '.file-column[data-folder-path=' + JSON.stringify(folder) + ']';
  const point = async (selector: string) => {
    let previous: { x: number; y: number } | undefined,
      stable = 0;
    const position = await until(
      () => evaluate(pageCall(visibleCenter, selector)),
      (value) => {
        if (!value) {
          stable = 0;
          return false;
        }
        stable =
          previous && Math.hypot(value.x - previous.x, value.y - previous.y) < 0.5 ? stable + 1 : 0;
        previous = value;
        return stable >= 4;
      },
      'Stable visible drag target: ' + selector,
    );
    assert.ok(position);
    return position;
  };
  const over = async (selector: string, enter = false) => {
    const position = await point(selector);
    if (enter) await command('Input.dispatchDragEvent', { type: 'dragEnter', ...position, data });
    await command('Input.dispatchDragEvent', { type: 'dragOver', ...position, data });
    dragPoint = position;
    // Chromium emits only dragenter when the previous virtual row was replaced.
    // Deliver the next dragover too, as a continuing physical drag would do.
    await command('Input.dispatchDragEvent', { type: 'dragOver', ...position, data });
    return position;
  };
  const inFolder = async (folder: string) =>
    (await evaluate(attributeOf('.folder-explorer', 'aria-label'))) === 'Folder ' + folder;
  const key = async (key: string, code: string, modifiers = 0) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  };
  const cancel = async () => {
    await pause();
    await key('Escape', 'Escape');
    // An injected external drag has no intercepted Chromium source session.
    // Move its target out of the file surface to deliver native dragleave;
    // dragCancel alone does not clear that externally supplied target data.
    await command('Input.dispatchDragEvent', { type: 'dragOver', x: 0, y: 0, data });
    await command('Input.dispatchDragEvent', { type: 'dragOver', x: 0, y: 0, data });
    await command('Input.dispatchDragEvent', { type: 'dragCancel', x: 0, y: 0, data });
  };
  const bootstrap = () => evaluate(pageCall(() => window.viewer.bootstrap()));
  await until(() => evaluate(exists('[aria-label="Dock plane"]')), Boolean, 'Generated drag plane');
  const dockPoint = await point('[aria-label="Dock plane"]');
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    ...dockPoint,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    ...dockPoint,
  });
  await until(
    () => evaluate(exists('[aria-label="Reveal space"]')),
    Boolean,
    'Generated plane docked',
  );
  await until(() => evaluate(exists(row(nested))), Boolean, 'Nested folder loaded');
  await over(row(nested), true);
  await until(() => inFolder(nested), Boolean, 'First spring-loaded folder');
  await until(() => evaluate(exists(row(child))), Boolean, 'Child folder loaded');
  await over(row(child));
  await until(() => inFolder(child), Boolean, 'Second spring-loaded folder');
  await until(
    bootstrap,
    (state) => state.state?.workspaces[0].panes[0].path === child,
    'Spring-loaded state passes persistence validation',
  );
  assert.equal(await evaluate(countOf('.notice[role=alert]')), 0);
  assert.equal(await evaluate(exists('[aria-label="Reveal space"]')), true);
  await cancel();
  await until(() => inFolder(browse), Boolean, 'Cancelled drag restores original folder');
  assert.equal(
    await evaluate(exists('[aria-label="Reveal space"]')),
    true,
    'Escape cancels the drag without revealing space',
  );
  const restored = await until(
    bootstrap,
    (state) => state.state?.workspaces[0].panes[0].path === browse,
    'Cancelled drag persistence',
  );
  const restoredPane = restored.state!.workspaces[0].panes[0];
  assert.equal(restoredPane.type, 'folder');
  assert.ok(restoredPane.type === 'folder');
  assert.deepEqual(restoredPane.history, [browse]);
  assert.deepEqual(restored.state!.recents, []);
  assert.equal(await readFile(source, 'utf8'), 'Generated spring-loading fixture.');

  await until(() => evaluate(pageCall(longList)), Boolean, 'Long virtual file list');
  const edge = await evaluate(pageCall(bottomEdge));
  await command('Input.dispatchDragEvent', { type: 'dragEnter', ...edge, data });
  await command('Input.dispatchDragEvent', { type: 'dragOver', ...edge, data });
  dragPoint = edge;
  await command('Input.dispatchDragEvent', { type: 'dragOver', ...edge, data });
  await until(
    () => evaluate(pageCall(listScrollTop)),
    (value) => value > 100,
    'Drag scrolls virtual rows at the bottom edge',
  );
  await cancel();
  assert.equal(await evaluate(countOf('.notice[role=alert]')), 0);
  let previousScroll = -1,
    stableScroll = 0;
  await until(
    () => evaluate(pageCall(listScrollTop)),
    (value) => {
      stableScroll = value === previousScroll ? stableScroll + 1 : 0;
      previousScroll = value;
      return stableScroll >= 3;
    },
    'Cancellation or expired external drag activity stops scrolling',
    2500,
  );
  const stopped = await evaluate(pageCall(listScrollTop));
  await delay(150);
  assert.equal(await evaluate(pageCall(listScrollTop)), stopped);
  await evaluate(pageCall(scrollListToTop));
  await evaluate(focus('.folder-explorer'));
  await key('3', 'Digit3', 4);
  await until(() => evaluate(exists(column(browse))), Boolean, 'Columns view selected');
  await over(row(nested), true);
  await until(() => evaluate(exists(column(nested))), Boolean, 'Spring loading appends a column');
  assert.equal(await inFolder(browse), true);
  await cancel();
  await until(
    () => evaluate(countOf('.file-column')),
    (value) => value === 1,
    'Cancelled columns drag restores the trail',
  );
  await over(row(nested), true);
  await until(() => evaluate(exists(row(child))), Boolean, 'Nested column loaded again');
  await over(row(child));
  await until(() => evaluate(exists(column(child))), Boolean, 'Second spring-loaded column');
  const destination = await over(column(child) + ' .file-scroll');
  await pause();
  await command('Input.dispatchDragEvent', { type: 'drop', ...destination, data });
  const jobs = await until(
    () => evaluate(pageCall(() => window.viewer.jobs())),
    (jobs) =>
      jobs.some(
        (job) => job.sources.includes(source) && ['completed', 'failed'].includes(job.status),
      ),
    'Spring-loaded folder drop operation',
  );
  const job = jobs.find((job) => job.sources.includes(source))!;
  assert.equal(job.status, 'completed', JSON.stringify(job.errors));
  assert.equal(
    await readFile(path.join(child, 'Source.txt'), 'utf8'),
    'Generated spring-loading fixture.',
  );
  await assert.rejects(readFile(source), { code: 'ENOENT' });
  assert.equal(await inFolder(browse), true);
  assert.equal(await evaluate(exists('[aria-label="Reveal space"]')), true);
  await evaluate(pageCall((id: string) => window.viewer.undo(id), job.id));
  assert.equal(await readFile(source, 'utf8'), 'Generated spring-loading fixture.');
  assert.equal(
    await readFile(path.join(child, 'Existing.txt'), 'utf8'),
    'Keep this generated file.',
  );

  await evaluate(focus('.folder-explorer'));
  await key('1', 'Digit1', 4);
  await command('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 640,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(() => evaluate(pageCall(narrowList)), Boolean, 'Narrow list viewport');
  const side = await evaluate(pageCall(rightEdge));
  await command('Input.dispatchDragEvent', { type: 'dragEnter', ...side, data });
  await command('Input.dispatchDragEvent', { type: 'dragOver', ...side, data });
  dragPoint = side;
  await command('Input.dispatchDragEvent', { type: 'dragOver', ...side, data });
  await until(
    () => evaluate(pageCall(() => document.querySelector('.file-table')!.scrollLeft)),
    (value) => value > 20,
    'Drag scrolls metadata columns horizontally',
  );
  await cancel();
  assert.ifError(pulseError);
  console.log(
    'PASS packaged spring-loaded list/columns navigation, cancellation/history, retained docking, nested drop/Undo and vertical/horizontal edge scrolling. Physical Finder drag and signed Store acceptance remain separate.',
  );
} finally {
  dragPoint = undefined;
  clearInterval(pulse);
  await pumping?.catch(() => {});
  try {
    await viewer.close(connection);
  } finally {
    await trashTemporary(root);
  }
}
