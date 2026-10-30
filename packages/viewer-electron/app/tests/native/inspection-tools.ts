import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { columnName } from '../../src/domain/previews/documents/office';
import { officeFixture } from '../office-fixtures';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import {
  animationFrames,
  attributeOf,
  click,
  countOf,
  exists,
  focus,
  patchSettings,
  pressButton,
  textOf,
} from './runtime/page';
import { pageCall } from './runtime/page-function';
assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary);
const root = await temporaryRoot('viewer-native-inspection-'),
  files = path.join(root, 'Files'),
  collection = path.join(files, 'Collection'),
  notes = path.join(collection, 'Notes'),
  profile = path.join(root, 'Profile');
await mkdir(notes, { recursive: true });
await mkdir(profile);
const yaml = path.join(notes, 'Config.yaml'),
  css = path.join(notes, 'Theme.css'),
  book = path.join(notes, 'Wide.xlsx');
const hidden = path.join(notes, '.Hidden.css');
await writeFile(hidden, '.hidden { display: none; }\n', { flag: 'wx' });
await writeFile(
  yaml,
  'base: &base\n  color: red\ncopy: *base\nnested:\n  one: true\n  two: [1, 2, 3]\n',
  { flag: 'wx' },
);
await writeFile(
  css,
  '.widget { color: #52706f; padding: 12px; }\n.widget:hover { background: white; }\n',
  { flag: 'wx' },
);
const rows = [1, 2]
  .map(
    (row) =>
      `<row r="${row}">` +
      Array.from(
        { length: 256 },
        (_, index) =>
          `<c r="${columnName(index + 1)}${row}" t="inlineStr"><is><t>Stored ${index + 1}</t></is></c>`,
      ).join('') +
      '</row>',
  )
  .join('');
await writeFile(
  book,
  officeFixture('workbook', {
    'xl/worksheets/data.xml': '<worksheet><sheetData>' + rows + '</sheetData></worksheet>',
  }),
  { flag: 'wx' },
);
const settings = defaultSettings(files),
  ui = normalizePreferences();
settings.hotkey.enabled = false;
settings.providers = [];
settings.browsing.mode = 'columns';
ui.sidebar.inNewPlanes = false;
const state: SavedState = {
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace: 'inspection',
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'inspection',
      name: 'Inspection tools',
      roots: ['folder'],
      activePane: 'folder',
      arrangement: {},
      panes: [
        {
          id: 'folder',
          type: 'folder',
          path: files,
          mode: 'columns',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [files],
          historyIndex: 0,
        },
      ],
    },
  ],
};
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }));
await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state));

const searchFocused = () =>
  document.activeElement?.getAttribute('aria-label') === 'Search commands';

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** The file path of every matching row, in order. */
const filePaths = (selector: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector), (row) => row.dataset.filePath);

const textsOf = (selector: string) =>
  Array.from(document.querySelectorAll(selector), (element) => element.textContent);

/** The text of the first match; refuses a missing element. */
function requiredText(selector: string): string {
  const element = document.querySelector(selector);
  if (!element) throw new Error('Nothing matches: ' + selector);
  return element.textContent;
}

/** Which column is active, which rows lead to the selection, and what is selected. */
function columnScope() {
  return {
    active: Array.from(
      document.querySelectorAll<HTMLElement>('.file-column.is-active-column'),
      (column) => column.dataset.folderPath,
    ),
    ancestors: Array.from(
      document.querySelectorAll<HTMLElement>('.file-row.is-path-ancestor'),
      (row) => row.dataset.filePath,
    ),
    selected: Array.from(
      document.querySelectorAll<HTMLElement>('.file-row[aria-selected=true]'),
      (row) => row.dataset.filePath,
    ),
  };
}

function codeText() {
  const code = getComputedStyle(document.querySelector('.code-scroll')!);
  return {
    font: code.fontSize,
    line: code.lineHeight,
    property: getComputedStyle(document.querySelector('.code-scroll .token.property')!).color,
    plain: code.color,
  };
}

function scrollToLastColumn(): void {
  const scroller = document.querySelector('.data-scroll')!;
  scroller.scrollLeft = 100000;
  scroller.dispatchEvent(new Event('scroll'));
}

function pressCell(reference: string): void {
  [...document.querySelectorAll<HTMLElement>('.workbook-cell')]
    .find((cell) => cell.getAttribute('aria-label')!.startsWith(reference + ':'))!
    .click();
}

const noFolderOverride = (folder: string) =>
  window.viewer.settingsGet().then((snapshot) => !snapshot.settings.folders[folder]);

const app = await ownedApp(binary, profile);
let connection: Awaited<ReturnType<typeof app.connect>> | undefined;
const observations: unknown[] = [];
try {
  connection = await app.connect();
  const { command, evaluate } = connection;
  const clickFile = async (file: string) => {
    const selector = `[data-file-path=${JSON.stringify(file)}]`;
    await until(() => evaluate(exists(selector)), Boolean, 'file row ' + path.basename(file));
    await evaluate(click(selector));
  };
  const capture = async (name: string) => {
    await evaluate(pageCall(pause, 300));
    await evaluate(animationFrames(2));
    const value = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name + '.png'), Buffer.from(value.data, 'base64'), {
      flag: 'wx',
    });
  };
  const runCommand = async (label: string) => {
    await evaluate(click('[aria-label="Commands (⌘K)"]'));
    await until(() => evaluate(pageCall(searchFocused)), Boolean, 'command input');
    await command('Input.insertText', { text: label });
    await until(
      () => evaluate(textOf('.command-result[aria-selected="true"]')),
      (value) => value.includes(label),
      label,
    );
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
    await until(
      () =>
        evaluate(pageCall(() => document.querySelector('[aria-label="Search commands"]') === null)),
      Boolean,
      'command closed',
    );
    await evaluate(animationFrames(2));
  };
  await clickFile(collection);
  await clickFile(notes);
  await clickFile(yaml);
  await until(() => evaluate(exists('.structured-viewer')), Boolean, 'YAML inspector');
  const scope = await evaluate(pageCall(columnScope));
  assert.deepEqual(scope.active, [notes]);
  assert.deepEqual(scope.selected, [yaml]);
  assert.ok(scope.ancestors.includes(collection) && scope.ancestors.includes(notes));
  await evaluate(click('[aria-label="Commands (⌘K)"]'));
  await until(() => evaluate(pageCall(searchFocused)), Boolean, 'grouping command input');
  await command('Input.insertText', { text: 'Group by kind' });
  await until(
    () => evaluate(textOf('.command-result[aria-selected="true"]')),
    (value) => value.includes('Group by kind'),
    'grouping command',
  );
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  const headings = await until(
    () =>
      evaluate(
        pageCall(
          textsOf,
          '[data-folder-path=' + JSON.stringify(notes) + '] .file-group-label .section-label',
        ),
      ),
    (value) => ['CSS files', 'XLSX files', 'YAML files'].every((label) => value.includes(label)),
    'kind sections inside browsed child column',
  );
  observations.push({ groupedColumn: notes, headings });
  assert.deepEqual(
    await evaluate(pageCall(filePaths, '.file-row[aria-selected=true]')),
    [yaml],
    'Grouping keeps the selected source.',
  );
  await evaluate(focus('.folder-explorer'));
  for (const [key, expected] of [
    ['ArrowUp', book],
    ['ArrowDown', yaml],
  ] as const) {
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: key === 'ArrowUp' ? 38 : 40,
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: key === 'ArrowUp' ? 38 : 40,
    });
    await until(
      () => evaluate(pageCall(filePaths, '.file-row[aria-selected=true]')),
      (value) => value.length === 1 && value[0] === expected,
      'selection skips group headers',
    );
  }
  await until(
    () => evaluate(exists('.structured-viewer')),
    Boolean,
    'YAML inspector after grouped keyboard navigation',
  );
  const treeButton = (text: string) => evaluate(pressButton(text, '.structured-viewer'));
  await treeButton('Expand all');
  await until(
    () => evaluate(textOf('.structured-viewer')),
    (text) => text.includes('one') && text.includes('↪'),
    'expanded YAML aliases',
  );
  await capture('columns-data-dark');
  await treeButton('Collapse all');
  assert.equal(await evaluate(countOf('.structured-row')), 1);
  await treeButton('Expand all');
  await clickFile(css);
  await until(() => evaluate(exists('.code-scroll .token.property')), Boolean, 'CSS highlighting');
  const text = await evaluate(pageCall(codeText));
  assert.equal(text.font, '16px');
  assert.equal(text.line, '20px');
  assert.notEqual(text.property, text.plain);
  await capture('columns-code-dark');
  await clickFile(book);
  await until(() => evaluate(exists('.workbook-cell')), Boolean, 'wide worksheet');
  const count = await evaluate(countOf('.data-header [role=columnheader]'));
  assert.ok(count > 1 && count < 20, 'Wide worksheets render only the visible columns.');
  await evaluate(pageCall(scrollToLastColumn));
  await until(
    () => evaluate(textOf('.data-header')),
    (text) => text.includes('IV'),
    'last original column',
  );
  await evaluate(pageCall(pressCell, 'IV2'));
  assert.ok((await evaluate(pageCall(requiredText, '.workbook-cell-detail'))).includes('IV2'));
  await capture('wide-sheet-dark');
  await evaluate(patchSettings({ path: 'settings.appearance', value: 'light' }));
  await until(
    () => evaluate(pageCall(() => document.documentElement.dataset.look)),
    (value) => value === 'light',
    'light theme',
  );
  await clickFile(yaml);
  await until(() => evaluate(exists('.structured-viewer')), Boolean, 'restored YAML');
  await capture('columns-data-light');
  const displayed = () =>
    evaluate(pageCall(filePaths, '[data-folder-path=' + JSON.stringify(notes) + '] .file-row'));
  await runCommand('Ungroup files');
  await runCommand('Sort by name');
  await until(
    displayed,
    (value) => value.join('|') === [book, css, yaml].join('|'),
    'child descending name order',
  );
  await runCommand('Sort by name');
  await until(
    displayed,
    (value) => value.join('|') === [yaml, css, book].join('|'),
    'child ascending name order',
  );
  await runCommand('Show hidden files');
  await until(displayed, (value) => value.includes(hidden), 'child hidden files shown');
  await capture('columns-hidden-light');
  await runCommand('Hide hidden files');
  await until(displayed, (value) => !value.includes(hidden), 'child hidden files hidden');
  await runCommand('Reset this folder’s view');
  await until(() => evaluate(pageCall(noFolderOverride, notes)), Boolean, 'child overrides reset');
  assert.equal(
    await evaluate(pageCall(noFolderOverride, files)),
    true,
    'Ancestor preferences stayed intact.',
  );
  await runCommand('Sort by size');
  await runCommand('Use as default folder view');
  await until(
    () =>
      evaluate(
        pageCall(() =>
          window.viewer
            .settingsGet()
            .then(
              ({ settings: { browsing } }) =>
                browsing.mode === 'columns' && browsing.sort === 'size' && browsing.descending,
            ),
        ),
      ),
    Boolean,
    'current column exported as defaults',
  );
  await runCommand('Grid view');
  await until(
    () => evaluate(attributeOf('.folder-explorer', 'aria-label')),
    (value) => value === 'Folder ' + notes,
    'view change enters browsed child',
  );
  await until(() => evaluate(exists('.grid-scroll')), Boolean, 'child grid view');
  await runCommand('Columns view');
  await runCommand('Parent folder');
  await until(
    () => evaluate(attributeOf('.folder-explorer', 'aria-label')),
    (value) => value === 'Folder ' + collection,
    'parent of browsed folder',
  );
  await clickFile(notes);
  await runCommand('Search this folder…');
  await until(
    () => evaluate(attributeOf('.folder-explorer', 'aria-label')),
    (value) => value === 'Folder ' + notes,
    'search enters browsed child',
  );
  await until(
    () =>
      evaluate(pageCall(() => document.activeElement?.getAttribute('aria-label') === 'Find files')),
    Boolean,
    'child search is focused',
  );
  observations.push({ columnCommands: 'sort/hidden/reset/defaults/view/parent/search verified' });
  observations.push({
    scope,
    text,
    visibleHeaders: count,
    wideSheet: 'IV2 selected without rendering all columns',
  });
} catch (error) {
  if (connection)
    console.log(
      'Inspection surface:',
      await connection.evaluate(pageCall(() => document.body.innerText.slice(-5000))),
    );
  throw error;
} finally {
  await app.close(connection);
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ root, observations }, null, 2));
  console.log('Retained inspection evidence:', root);
}
