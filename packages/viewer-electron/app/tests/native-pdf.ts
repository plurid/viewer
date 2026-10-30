/** PDF viewport regressions in an owned direct package, using generated documents only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { SavedState } from '../src/domain/contracts';
import { ownedApp, until } from './owned-app';
import { click, exists, patchSettings, textOf } from './native/runtime/page';
import { pageCall } from './native/runtime/page-function';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const root = await temporaryRoot('viewer-native-pdf-');
const profile = path.join(root, 'Profile'),
  output = path.resolve('out/pdf-acceptance');
await Promise.all([profile, output].map((file) => mkdir(file, { recursive: true })));
const file = path.join(root, 'Panel drawings.pdf');
const pages = [
  [595, 842, 0],
  [842, 595, 0],
  [595, 842, 90],
  [2384, 3370, 0],
];
const bodies = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
for (const [i, [width, height, rotation]] of pages.entries()) {
  const stream = `0.15 0.18 0.2 RG 1 w 36 36 ${width - 72} ${height - 72} re S
    BT /F1 20 Tf 60 ${height - 72} Td (Panel assembly - Page ${i + 1}) Tj ET
    2 w ${width * 0.3} ${height * 0.3} ${width * 0.4} ${height * 0.4} re S
    ${width * 0.34} ${height * 0.46} ${width * 0.32} ${height * 0.2} re S
    ${width * 0.4} ${height * 0.3} ${width * 0.2} ${height * 0.08} re S
    BT /F1 12 Tf 60 60 Td (Whole-page preview: lower edge visible) Tj ET`;
  bodies.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Rotate ${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  );
}
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (const [i, body] of bodies.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await writeFile(file, pdf);
const state: SavedState = {
  version: 4,
  look: 'dark',
  activeWorkspace: 'pdf',
  favorites: [],
  recents: [],
  workspaces: [
    {
      id: 'pdf',
      name: 'PDF checks',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      layout: {
        placements: [
          {
            id: 'folder',
            location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
            width: 1100,
            height: 760,
            show: true,
          },
        ],
        active: 'folder',
        docked: 'folder',
      },
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: root,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [root],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));
await writeFile(path.join(output, 'result.json'), JSON.stringify({ completed: false }));
const binary =
  process.env.VIEWER_TEST_BINARY ??
  path.resolve('out/Viewer-darwin-arm64/Viewer.app/Contents/MacOS/Viewer');
let viewer = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof viewer.connect>> | undefined;
const checks: string[] = [];
/** The page canvas's size, the stage's room inside its padding, and the stage's scroll extent. */
function pdfGeometry() {
  const stage = document.querySelector('.pdf-scroll')!,
    canvas = stage.querySelector('canvas')!,
    style = getComputedStyle(stage);
  return {
    width: parseFloat(canvas.style.width),
    height: parseFloat(canvas.style.height),
    availableWidth:
      stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    availableHeight:
      stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    scrollWidth: stage.scrollWidth,
    scrollHeight: stage.scrollHeight,
    clientWidth: stage.clientWidth,
    clientHeight: stage.clientHeight,
  };
}
/** The PDF viewer's, or else the context menu's, opacity and transforms through its ancestors,
 * with the page canvas's inline style. */
function pdfSurface() {
  let node = document.querySelector('.pdf-viewer') || document.querySelector('.context-menu'),
    opacity = 1;
  const chain: string[] = [];
  while (node) {
    const style = getComputedStyle(node);
    opacity *= Number(style.opacity);
    chain.push(style.transform);
    node = node.parentElement;
  }
  return {
    opacity,
    chain,
    canvas: document.querySelector('.pdf-sheet canvas')?.getAttribute('style') || '',
  };
}
/** The icon path of the Workspace and Project context menu items, by label. */
function menuIcons() {
  return Object.fromEntries(
    [...document.querySelectorAll('.context-menu [role="menuitem"]')]
      .filter((item) => ['Workspace', 'Project'].includes(item.textContent.trim()))
      .map((item) => [item.textContent.trim(), item.querySelector('svg path')?.getAttribute('d')]),
  );
}
const zoomLabel = () => document.querySelector('button[aria-label="PDF zoom"]')!.textContent;
async function metrics(width: number, height: number) {
  await connection!.command('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
async function rendered(page: number) {
  await until(
    () => connection!.evaluate(textOf('.pdf-viewer .textLayer')),
    (text) => text.includes('Page ' + page),
    'PDF text layer on page ' + page,
  );
}
async function geometry() {
  return connection!.evaluate(pageCall(pdfGeometry));
}
async function fitted() {
  const size = await until(
    geometry,
    (s) =>
      s.width > 0 &&
      s.height > 0 &&
      s.width <= s.availableWidth + 1 &&
      s.height <= s.availableHeight + 1,
    'Entire PDF page fits both dimensions',
  );
  assert.ok(
    size.scrollHeight <= size.clientHeight + 1 && size.scrollWidth <= size.clientWidth + 1,
    'Fit page needs no scrolling: ' + JSON.stringify(size),
  );
  assert.ok(
    Math.max(size.width / size.availableWidth, size.height / size.availableHeight) > 0.98,
    'Fit page uses available space',
  );
  return size;
}
/** Chooses a zoom in its choice menu (ui/ChoiceMenu.tsx): the button, then the value's row. */
async function selectZoom(value: string) {
  const row = `.choice-menu [data-menu-id=${JSON.stringify('choice:' + value)}]`;
  await connection!.evaluate(click('button[aria-label="PDF zoom"]'));
  await until(() => connection!.evaluate(exists(row)), Boolean, 'PDF zoom menu');
  await connection!.evaluate(click(row));
}
async function capture(name: string) {
  let previous = '',
    stable = 0;
  await until(
    async () => {
      await delay(120);
      const value = await connection!.evaluate(pageCall(pdfSurface));
      const serialized = JSON.stringify(value);
      stable = previous === serialized ? stable + 1 : 0;
      previous = serialized;
      return value;
    },
    (s) => s.opacity > 0.999 && stable >= 2,
    'PDF opacity, transform and canvas settled',
  );
  const screenshot = await connection!.command<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
}
try {
  connection = await viewer.connect();
  await metrics(2560, 1440);
  const selector = `[data-file-path=${JSON.stringify(file)}]`;
  await until(() => connection!.evaluate(exists(selector)), Boolean, 'Generated PDF listing');
  await connection.evaluate(
    pageCall(
      (selector: string) =>
        document
          .querySelector(selector)!
          .dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 180 }),
          ),
      selector,
    ),
  );
  await until(
    () => connection!.evaluate(exists('.context-menu [role="menuitem"]')),
    Boolean,
    'Context menu',
  );
  const icons = await connection.evaluate(pageCall(menuIcons));
  assert.ok(
    icons.Workspace && icons.Project && icons.Workspace !== icons.Project,
    'Workspace and Project have different icons',
  );
  await connection.evaluate(
    pageCall(() =>
      [...document.querySelectorAll('.context-menu [role="menuitem"]')]
        .find((item) => item.textContent.trim() === 'Project')!
        .scrollIntoView({ block: 'nearest' }),
    ),
  );
  await capture('context-project-icon-dark');
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  checks.push('The actual context menu uses distinct Workspace and Project icons.');
  await connection.evaluate(click(selector));
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
  });
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
  });
  await rendered(1);
  await fitted();
  assert.equal(await connection.evaluate(pageCall(zoomLabel)), 'Fit page');
  await capture('pdf-portrait-wide-dark');
  await metrics(900, 640);
  await fitted();
  await capture('pdf-portrait-compact-dark');
  await connection.evaluate(click('[aria-label="Search PDF"]'));
  const searchSize = await fitted();
  assert.ok(searchSize.availableHeight < 500, 'Search row reserves its own height');
  await capture('pdf-search-compact-dark');
  await connection.evaluate(click('[aria-label="Close PDF search"]'));
  checks.push(
    'Quick Preview opens in Fit page; whole portrait page remains visible on large and compact windows and when search opens.',
  );
  for (let page = 2; page <= pages.length; page++) {
    await connection.evaluate(click('[aria-label="Next page"]'));
    await rendered(page);
    const size = await fitted();
    assert.equal(size.width > size.height, page === 2 || page === 3);
    if (page === 3) await capture('pdf-rotated-compact-dark');
  }
  checks.push(
    'Landscape, rotated and large-format pages recalculate their fit when changing page.',
  );
  // Return to portrait before testing intentional width fitting and actual-size zoom.
  for (let page = pages.length - 1; page >= 1; page--) {
    await connection.evaluate(click('[aria-label="Previous page"]'));
    await rendered(page);
  }
  await selectZoom('width');
  await until(
    geometry,
    (s) => Math.abs(s.width - s.availableWidth) < 1 && s.height > s.availableHeight,
    'Explicit Fit width',
  );
  await selectZoom('1');
  const actual = await until(
    geometry,
    (s) => Math.abs(s.width - (595 * 4) / 3) < 1,
    '100% uses PDF to CSS units',
  );
  await metrics(1440, 940);
  await until(
    geometry,
    (s) => Math.abs(s.width - actual.width) < 1 && s.availableWidth > 1000,
    'Manual zoom stays fixed on resize',
  );
  checks.push(
    'Fit width remains an explicit option; 100% uses CSS document scale and stays fixed across window resize.',
  );
  await selectZoom('page');
  await connection.evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => connection!.evaluate(pageCall(() => document.documentElement.dataset.look)),
    (s) => s === 'light',
    'PDF light theme',
  );
  await fitted();
  await capture('pdf-portrait-desktop-light');
  await metrics(900, 640);
  await fitted();
  await capture('pdf-portrait-compact-light');
  await connection.evaluate(click('.quick-preview-actions .primary'));
  await until(
    () =>
      connection!.evaluate(
        pageCall(
          () =>
            !document.querySelector('.quick-preview-dialog[open]') &&
            !!document.querySelector('.pdf-viewer'),
        ),
      ),
    Boolean,
    'Linked PDF plane',
  );
  await rendered(1);
  await fitted();
  await selectZoom('1.5');
  await until(geometry, (s) => Math.abs(s.width - 595 * 2) < 1, '150% linked plane');
  await viewer.close(connection);
  connection = undefined;
  viewer = await ownedApp(binary, profile);
  connection = await viewer.connect();
  await rendered(1);
  assert.equal(await connection.evaluate(pageCall(zoomLabel)), '150%');
  await until(
    geometry,
    (s) => Math.abs(s.width - 595 * 2) < 1,
    'Saved manual percentage after reopen',
  );
  checks.push(
    'Linked PDF planes also fit by default and retain an explicitly selected percentage after a clean quit and cold reopen.',
  );
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        completed: true,
        checks,
        scope:
          'Generated documents in an owned direct package. This does not qualify native permissions, assistive technologies or the Mac App Store.',
      },
      null,
      2,
    ),
  );
  for (const check of checks) console.log('PASS', check);
} finally {
  await viewer.close(connection);
  await trashTemporary(root);
}
