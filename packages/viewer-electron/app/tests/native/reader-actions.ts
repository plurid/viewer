/** Generated selections and public-book copies exercise the packaged readers without user files. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { CURRENT_STATE_VERSION } from '../../src/domain/contracts';
import type { SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { temporaryRoot } from '../../tools/temporary';
import { readerSamples } from '../../tools/playground/reader-samples';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';
import { officeFixture } from '../office-fixtures';
import { ownedApp, until } from '../owned-app';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-reader-actions-');
const files = path.join(root, 'Files'),
  profile = path.join(root, 'Profile');
const captures = path.resolve('../../../.impeccable/review/reader-actions-' + path.basename(root));
await Promise.all([files, profile, captures].map((file) => mkdir(file, { recursive: true })));
const reference = readerSamples.find((sample) => sample.path.endsWith('idpf-wasteland.epub'))!;
const source = path.join(
  process.env.VIEWER_TEST_READER_CORPUS ?? defaultPlaygroundDirectory,
  reference.path,
);
const sha = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
assert.equal(await sha(source), reference.sha256);
const book = path.join(files, 'Published book.epub'),
  workbook = path.join(files, 'Selection.xlsx');
await copyFile(source, book, 1);
const rows = Array.from({ length: 160 }, (_, index) => {
  const n = index + 1;
  return `<row r="${n}"><c r="A${n}" t="inlineStr"><is><t>Part ${n}</t></is></c><c r="B${n}"><v>${n}</v></c></row>`;
}).join('');
await writeFile(
  workbook,
  officeFixture('workbook', {
    'xl/worksheets/data.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  }),
  { flag: 'wx' },
);
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'readers',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'readers',
      name: 'Reader actions',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
          sidebar: { visible: false, width: 210 },
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), { flag: 'wx' });
type App = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<App['connect']>>;
function driver(connection: Connection) {
  const { evaluate, command } = connection;
  const key = async (key: string, code: string, virtual: number, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: virtual,
        modifiers,
      });
  };
  const button = (label: string) =>
    evaluate(
      `(() => { const button = Array.from(document.querySelectorAll('.quick-preview-dialog button')).find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button'); button.click(); })()`,
    );
  const fill = (label: string, value: string) =>
    evaluate(
      `(() => { const input = Array.from(document.querySelectorAll('.quick-preview input')).find(input => input.getAttribute('aria-label') === ${JSON.stringify(label)} || input.closest('label')?.textContent.trim() === ${JSON.stringify(label)}); if (!input) throw new Error('Missing input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  const open = async (name: string, selector: string) => {
    const file = path.join(files, name);
    await until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector(${JSON.stringify(`[data-file-path="${file}"]`)})`,
        ),
      Boolean,
      'File available',
    );
    await evaluate(
      `document.querySelector(${JSON.stringify(`[data-file-path="${file}"]`)}).click(); document.querySelector('.folder-explorer').focus()`,
    );
    await key(' ', 'Space', 32);
    await until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector(${JSON.stringify('.quick-preview ' + selector)}) && !document.querySelector('.quick-preview .loading')`,
        ),
      Boolean,
      'Reader ready',
      20000,
    );
  };
  const close = async () => {
    await button('Close');
    await until(
      () => evaluate<boolean>('!document.querySelector(".quick-preview")'),
      Boolean,
      'Preview closed',
    );
  };
  const capture = async (name: string, width: number) => {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(
      () => evaluate<boolean>('!document.querySelector("[data-plurid-motion]")'),
      Boolean,
      'Settled reader',
    );
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const shot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(captures, name + '.png'), Buffer.from(shot.data, 'base64'), {
      flag: 'wx',
    });
  };
  return { key, button, fill, open, close, capture };
}
let app: App | undefined,
  connection: Connection | undefined,
  passed = false;
const checks: string[] = [];
try {
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  let d = driver(connection);
  await d.open('Selection.xlsx', '[role="grid"]');
  // Capture the requested payload without replacing the person's operating-system clipboard.
  await connection.evaluate(
    `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__readerCopied = value; } } })`,
  );
  const rect = (row: number, column: number) =>
    connection!.evaluate<{ x: number; y: number }>(
      `(() => { const cell = document.querySelector('.quick-preview [id$="-${row}-${column}"]'); const rect = cell.getBoundingClientRect(); return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 }; })()`,
    );
  const a = await rect(1, 1),
    b = await rect(3, 2);
  await connection.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
  await connection.command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...a,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await connection.command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...b,
    button: 'left',
    buttons: 1,
  });
  await connection.command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...b,
    button: 'left',
    clickCount: 1,
  });
  await until(
    () =>
      connection!.evaluate<string>(
        `document.querySelector('[aria-label="Selected range"]').textContent`,
      ),
    (value) => value === 'A1:B3',
    'Pointer range',
  );
  await d.button('Copy');
  await until(
    () => connection!.evaluate<string>('window.__readerCopied'),
    (text) => text === 'Part 1\t1\nPart 2\t2\nPart 3\t3',
    'Pointer range payload',
  );
  await d.capture('spreadsheet-desktop-dark', 1280);
  await d.fill('Cell address', 'A99');
  await d.button('Go');
  await d.key('ArrowDown', 'ArrowDown', 40, 8);
  await d.key('ArrowDown', 'ArrowDown', 40, 8);
  await until(
    () => connection!.evaluate<boolean>(`!!document.querySelector('[id$="-101-1"]')`),
    Boolean,
    'Next worksheet page',
  );
  await d.key('ArrowRight', 'ArrowRight', 39, 8);
  await d.key('ArrowDown', 'ArrowDown', 40, 8);
  await d.button('Copy');
  const expected = [99, 100, 101, 102].map((n) => `Part ${n}\t${n}`).join('\n');
  await until(
    () => connection!.evaluate<string>('window.__readerCopied'),
    (text) => text === expected,
    'Range across visible page boundary',
  );
  await connection.evaluate(
    `window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([{ path: 'settings.appearance', value: 'light' }], snapshot.revision))`,
  );
  await until(
    () => connection!.evaluate<string>('document.documentElement.dataset.look'),
    (look) => look === 'light',
    'Light appearance',
  );
  await d.capture('spreadsheet-minimum-light', 760);
  checks.push('Mouse drag, Shift-arrow extension across worksheet pages and exact TSV payload');
  await d.close();
  await d.open('Published book.epub', '.epub-chapter');
  await connection.evaluate(`document.querySelector('.epub-chapter').scrollTop = 420`);
  await d.button('Bookmarks');
  await d.fill('Bookmark name', 'Return to the poem');
  await d.button('Add bookmark');
  await d.button('Next chapter');
  await d.button('Return to the poem');
  await until(
    () => connection!.evaluate<number>('document.querySelector(".epub-chapter").scrollTop'),
    (top) => top === 420,
    'Bookmark reading position',
  );
  await d.capture('bookmarks-minimum-light', 760);
  await connection.evaluate(
    `window.viewer.settingsGet().then(snapshot => window.viewer.settingsPatch([{ path: 'settings.appearance', value: 'dark' }], snapshot.revision))`,
  );
  await until(
    () => connection!.evaluate<string>('document.documentElement.dataset.look'),
    (look) => look === 'dark',
    'Dark appearance',
  );
  await d.capture('bookmarks-desktop-dark', 1280);
  await d.close();
  await app.close(connection);
  app = undefined;
  connection = undefined;
  // Repack only the generated copy to change its source version without changing its chapters.
  const original = await readFile(book);
  await writeFile(path.join(root, 'Before repack.epub'), original, { flag: 'wx' });
  await writeFile(book, zipSync(unzipSync(original)));
  app = await ownedApp(binary, profile);
  connection = await app.connect();
  d = driver(connection);
  await d.open('Published book.epub', '.epub-chapter');
  await d.button('Bookmarks');
  await d.button('Return to the poem');
  await until(
    () => connection!.evaluate<number>('document.querySelector(".epub-chapter").scrollTop'),
    (top) => top === 420,
    'Bookmark after restart and file revision',
  );
  checks.push(
    'Named EPUB bookmarks survive app restart and changed source bytes, and return to their recorded chapter and scroll',
  );
  await d.close();
  await d.open('Selection.xlsx', '[role="grid"]');
  await until(
    () =>
      connection!.evaluate<string>(
        `document.querySelector('[aria-label="Selected range"]').textContent`,
      ),
    (value) => value === 'A99:B102',
    'Restored worksheet range',
  );
  checks.push('Selected worksheet range survives app restart');
  passed = true;
} finally {
  if (app) await app.close(connection);
  assert.equal(await sha(source), reference.sha256);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ passed, checks, captures: path.relative(process.cwd(), captures) }, null, 2),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      passed,
      checks,
      evidence: path.basename(root) + '/result.json',
      captures: path.relative(process.cwd(), captures),
    }),
  );
}
