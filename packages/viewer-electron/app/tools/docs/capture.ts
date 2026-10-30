/** Public documentation captures own their app/profile and preserve every input. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  open as openFile,
  readdir,
  readFile,
  realpath,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { documentSamples } from '../playground/samples/documents';
import { nestingSamples } from '../playground/samples/nesting';
import { ownedApp, until } from '../../tests/owned-app';
import { click, countOf, exists, focus, textOf } from '../../tests/native/runtime/page';
import { pageCall } from '../../tests/native/runtime/page-function';
import { record, screenshot, type Connection } from './record';
import { temporaryRoot } from '../temporary';
import { fieldNotesPDF } from './sample';
import { demoModel } from './model';
import { modelEndpoint } from '../../src/domain/models/permissions';
import type { ModelProvider } from '../../src/domain/services';
import { strToU8, zipSync } from 'fflate';

assert.equal(
  process.platform,
  'darwin',
  'Documentation capture currently uses the qualified macOS app.',
);
process.env.VIEWER_TEST_PRESERVE = '1';
process.env.VIEWER_TEST_NO_REMOVAL = '1';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(appRoot, '../../..');
const arguments_ = process.argv.slice(2);
const option = (name: string) => {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
};
const binary = path.resolve(
  option('--binary') ||
    process.env.VIEWER_TEST_BINARY ||
    path.join(appRoot, `out/Viewer-darwin-${process.arch}/Viewer.app/Contents/MacOS/Viewer`),
);
assert.ok((await lstat(binary)).isFile());
const resources = path.resolve(binary, '../../Resources');
const ffmpeg = path.join(resources, `viewer-processors-darwin-${process.arch}`, 'ffmpeg');
const execute = promisify(execFile);
const root = await realpath(await temporaryRoot('viewer-docs-demo-', '/tmp'));
const output = path.join(root, 'Captures');
await mkdir(output);
const publicImage = path.join(repositoryRoot, 'docs/media/source.jpg');
const image = path.join(root, 'Source.jpg');
const movie = option('--movie');
if (movie) {
  const expected = '738e2f999860553d056dd79c952f58f63cbb73892a57c72342ce9e5330d9d2d7';
  assert.equal(
    createHash('sha256')
      .update(await readFile(movie))
      .digest('hex'),
    expected,
    'Pinned Blender source movie',
  );
  await execute(ffmpeg, [
    '-n',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '150',
    '-i',
    movie,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    image,
  ]);
} else await copyFile(publicImage, image);
const samples = documentSamples(await readFile(image));
const examples = path.join(root, 'Field notes'),
  photos = path.join(root, 'Photos'),
  site = path.join(root, 'Website');
for (const directory of [examples, photos, site]) await mkdir(directory);
for (const sample of samples.filter((sample) =>
  /Field notes\.epub$|Materials\.(docx|xlsx)$/.test(sample.path),
))
  await writeFile(path.join(examples, path.basename(sample.path)), sample.bytes, { flag: 'wx' });
await writeFile(path.join(examples, 'Field notes.pdf'), fieldNotesPDF(await readFile(image)), {
  flag: 'wx',
});
await copyFile(image, path.join(examples, 'Forest.jpg'));
await execute(ffmpeg, [
  '-n',
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  image,
  path.join(photos, 'Forest.png'),
]);
const sourceImage = path.join(photos, 'Forest.png');
const sourceHash = createHash('sha256')
  .update(await readFile(sourceImage))
  .digest('hex');
await writeFile(
  path.join(site, 'README.md'),
  '# A small website\n\nA local project for a new homepage.\n',
  { flag: 'wx' },
);
await writeFile(
  path.join(site, 'index.html'),
  '<!doctype html><title>Field notes</title><h1>A small project, a wider view.</h1>\n',
  { flag: 'wx' },
);
const git = async (...args: string[]) =>
  (
    await execute(
      '/usr/bin/git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgSign=false',
        '-C',
        site,
        ...args,
      ],
      {
        env: {
          PATH: '/usr/bin:/bin',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_AUTHOR_NAME: 'Viewer Demo',
          GIT_AUTHOR_EMAIL: 'demo@example.invalid',
          GIT_COMMITTER_NAME: 'Viewer Demo',
          GIT_COMMITTER_EMAIL: 'demo@example.invalid',
        },
      },
    )
  ).stdout;
const templates = path.join(root, 'Templates');
await mkdir(templates);
await git('init', '--initial-branch=main', '--template=' + templates);
await git('add', '--', 'README.md', 'index.html');
await git('commit', '--no-verify', '--no-gpg-sign', '-m', 'Start a small website');

async function profile(name: string, folder: string, mode?: 'columns', model?: ModelProvider) {
  const directory = path.join(root, name);
  await mkdir(directory);
  const ui = normalizePreferences(),
    settings = defaultSettings(root);
  settings.hotkey.enabled = false;
  settings.providers = model ? [model] : [];
  if (model) {
    settings.prompts.providerID = model.id;
    // the person's own approval, as Settings → Models → Data access records it
    await writeFile(
      path.join(directory, 'model-permissions-v1.json'),
      JSON.stringify({
        version: 1,
        permissions: [
          {
            providerID: model.id,
            kind: model.kind,
            endpoint: modelEndpoint(model),
            level: 'names',
          },
        ],
      }),
      { flag: 'wx' },
    );
  }
  // a folder's view is kept by its path
  if (mode) settings.folders = { [folder]: { mode } };
  settings.search.roots = [folder];
  settings.search.contentRoots = [];
  settings.git.enabled = name === 'Develop';
  ui.space.opening = 'dock';
  ui.sidebar.inNewPlanes = false;
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    ui,
    favorites: [],
    recents: [],
    activeWorkspace: 'demo',
    workspaces: [
      {
        id: 'demo',
        name: 'Field notes',
        roots: ['folder'],
        activePane: 'folder',
        arrangement: {},
        panes: [
          {
            id: 'folder',
            type: 'folder',
            path: folder,
            mode: name === 'Develop' ? 'list' : 'grid',
            sort: 'name',
            descending: false,
            showHidden: false,
            history: [folder],
            historyIndex: 0,
          },
        ],
        layout: {
          active: 'folder',
          docked: 'folder',
          placements: [
            {
              id: 'folder',
              width: 1120,
              height: 720,
              show: true,
              location: { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0 },
            },
          ],
        },
      },
    ],
  };
  await writeFile(
    path.join(directory, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(directory, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  return directory;
}
function selectField(selector: string): void {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  input.focus();
  input.select();
}

/** The first button in `scope` whose text or accessible name is `label`: whether it is enabled,
 * pressing it when asked. */
function labelledButton(label: string, scope: string | null, press: boolean): boolean {
  const root = scope === null ? document : document.querySelector(scope);
  const button = [...(root?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent.trim() === label || button.getAttribute('aria-label') === label,
  );
  if (press) button!.click();
  return !!button && !button.disabled;
}

function selectRow(selector: string): void {
  const row = document.querySelector<HTMLElement>(selector)!;
  row.click();
  row.focus();
}

/** Adds the row to the selection, as ⌘-click does. */
function addRow(selector: string): void {
  document
    .querySelector(selector)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
}

function openContextMenu(selector: string): void {
  const row = document.querySelector<HTMLElement>(selector)!;
  row.click();
  const box = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 60,
      clientY: box.top + box.height / 2,
    }),
  );
}

/** Closes what `selector` names, when it is open. */
function dismiss(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

/** The index has read every root. */
const indexReady = () =>
  window.viewer
    .indexStatus()
    .then(
      (status) =>
        !status.running &&
        status.roots.length > 0 &&
        status.roots.every((root) => root.status === 'ready'),
    );

async function field(connection: Connection, label: string, text: string) {
  const selector = `[aria-label=${JSON.stringify(label)}]`;
  await until(() => connection.evaluate(exists(selector)), Boolean, label);
  await connection.evaluate(pageCall(selectField, selector));
  await connection.command('Input.insertText', { text });
}
/** `scope`: a selector for the part of the window that holds the button. */
async function button(connection: Connection, label: string, scope?: string) {
  await until(
    () => connection.evaluate(pageCall(labelledButton, label, scope ?? null, false)),
    Boolean,
    label,
  );
  await connection.evaluate(pageCall(labelledButton, label, scope ?? null, true));
}
async function palette(connection: Connection, label: string) {
  await connection.evaluate(click('[aria-label="Commands (⌘K)"]'));
  await field(connection, 'Search commands', label);
  await until(
    () => connection.evaluate(textOf('.command-result[aria-selected=true]')),
    (text) => text.toLowerCase().includes(label.toLowerCase()),
    label,
  );
  await delay(650);
  await connection.evaluate(click('.command-result[aria-selected=true]'));
}
async function open(
  name: string,
  folder: string,
  mode?: 'columns',
  model?: ModelProvider,
  home?: string,
) {
  const directory = await profile(name, folder, mode, model),
    app = await ownedApp(binary, directory, home ? { environment: { HOME: home } } : {});
  const connection = await app.connect();
  await connection.command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => connection.evaluate(countOf('[data-file-path]')),
    (count) => count > 0,
    'Demo folder',
  );
  await delay(1000);
  return { directory, app, connection };
}
const results: Record<string, unknown> = {};
let current = await open('Files', examples);
try {
  results.files = await record(current.connection, path.join(output, 'files'), ffmpeg, async () => {
    const { connection } = current;
    await delay(900);
    await connection.evaluate(click('[aria-label="Search this folder"]'));
    await field(connection, 'Find files', 'Field notes.pdf');
    await delay(1200);
    const selector =
      '[data-file-path=' + JSON.stringify(path.join(examples, 'Field notes.pdf')) + ']';
    await connection.evaluate(pageCall(selectRow, selector));
    await delay(650);
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
    await until(() => connection.evaluate(exists('.pdf-viewer canvas')), Boolean, 'PDF pixels');
    await delay(2000);
    await screenshot(connection, path.join(output, 'files.png'));
    await delay(1600);
  });
  await button(current.connection, 'Open linked plane');
  await delay(1500);
  await current.connection.evaluate(pageCall(dismiss, '[aria-label="Close search"]'));
  await palette(current.connection, 'Frame all');
  await delay(1800);
  await screenshot(current.connection, path.join(output, 'hero.png'));
} finally {
  await current.app.close(current.connection);
}

current = await open('Create', photos);
try {
  results.create = await record(
    current.connection,
    path.join(output, 'create'),
    ffmpeg,
    async () => {
      const { connection } = current;
      await delay(900);
      await connection.evaluate(click('[data-file-path]'));
      await palette(connection, 'Images for web');
      await until(
        () =>
          connection.evaluate(
            pageCall(
              () =>
                !!document.querySelector<HTMLCanvasElement>('.image-tools-canvas canvas')?.width,
            ),
          ),
        Boolean,
        'Source image',
      );
      await delay(1300);
      await screenshot(connection, path.join(output, 'create.png'));
      await button(connection, 'Export image', '.image-tools-dialog');
      await until(
        () => connection.evaluate(pageCall(() => window.viewer.jobs())),
        (jobs) => jobs.some((job) => job.status === 'completed'),
        'Converted file',
        30000,
      );
      await delay(1200);
      await button(connection, 'Open result', '.image-tools-dialog');
      await delay(2000);
    },
  );
  assert.equal(
    createHash('sha256')
      .update(await readFile(sourceImage))
      .digest('hex'),
    sourceHash,
  );
  const converted = await lstat(path.join(photos, 'Forest converted.webp'));
  assert.ok(
    converted.size > 0 && converted.size < (await lstat(sourceImage)).size,
    'Actual WebP output is smaller.',
  );
} finally {
  await current.app.close(current.connection);
}

current = await open('Develop', site);
try {
  results.develop = await record(
    current.connection,
    path.join(output, 'develop'),
    ffmpeg,
    async () => {
      const { connection } = current;
      await delay(900);
      await palette(connection, 'New task from branch');
      await field(connection, 'Branch task name', 'Homepage refresh');
      await field(connection, 'New branch name', 'feature/homepage');
      await field(connection, 'Worktree destination', path.join(root, 'Homepage'));
      await delay(1800);
      await button(connection, 'Create task', 'dialog');
      await until(
        async () =>
          JSON.parse(await readFile(path.join(current.directory, 'viewer-state-v1.json'), 'utf8'))
            .workspaces[0]?.taskAreas?.[0]?.members.length,
        (count) => count === 4,
        'Four task tools',
        30000,
      );
      await until(() => connection.evaluate(exists('.task-plane')), Boolean, 'Task overview');
      await field(connection, 'Note title', 'Homepage plan');
      await button(connection, 'Start writing');
      await until(
        () => connection.evaluate(exists('.note-plane .cm-content')),
        Boolean,
        'Note editor',
      );
      await connection.evaluate(focus('.note-plane .cm-content'));
      await connection.command('Input.insertText', {
        text: '## Homepage refresh\n\n- Keep a clear opening.\n- Add the new photographs.\n- Review the changes together.',
      });
      await delay(1000);
      await button(connection, 'Document');
      await delay(2000);
      await screenshot(connection, path.join(output, 'develop.png'));
      await delay(1400);
    },
  );
} finally {
  await current.app.close(current.connection);
}

// Stills for the guides: Columns with a preview, the palette for a photograph, Optimize results,
// and a file menu's suggestions for an archive, which only this session's folder holds.
await writeFile(
  path.join(examples, 'Field trip.zip'),
  zipSync({ 'Field trip/notes.txt': strToU8('A short walk, a few photographs.\n') }),
  { flag: 'wx' },
);
current = await open('Stills', examples, 'columns');
try {
  const { connection } = current;
  const row = (name: string) =>
    '[data-file-path=' + JSON.stringify(path.join(examples, name)) + ']';
  await connection.evaluate(click(row('Field notes.pdf')));
  await until(
    () => connection.evaluate(exists('.column-preview canvas, .column-preview img')),
    Boolean,
    'Column preview',
  );
  await delay(2000);
  await screenshot(connection, path.join(output, 'columns.png'));

  await connection.evaluate(click(row('Forest.jpg')));
  await delay(600);
  await connection.evaluate(click('[aria-label="Commands (⌘K)"]'));
  await field(connection, 'Search commands', 'convert');
  await until(
    () => connection.evaluate(countOf('.command-result')),
    (count) => count > 1,
    'Image commands',
  );
  await delay(900);
  await screenshot(connection, path.join(output, 'palette.png'));
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
  });
  await connection.command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
  });
  await delay(600);

  // the PDF and the photograph together
  await connection.evaluate(click(row('Field notes.pdf')));
  await connection.evaluate(pageCall(addRow, row('Forest.jpg')));
  await delay(600);
  await palette(connection, 'Optimize');
  await until(() => connection.evaluate(exists('.optimize-dialog')), Boolean, 'Optimize dialog');
  await button(connection, 'Prepare candidates', '.optimize-dialog');
  await until(
    () =>
      connection.evaluate(countOf('.optimize-results .optimize-savings, .optimize-results .error')),
    (count) => count >= 2,
    'Optimize results',
    60000,
  );
  await delay(1200);
  await screenshot(connection, path.join(output, 'optimize.png'));
  await connection.evaluate(pageCall(dismiss, '.optimize-dialog [aria-label="Close"]'));
  await delay(600);

  await connection.evaluate(pageCall(openContextMenu, row('Field trip.zip')));
  await until(
    () => connection.evaluate(textOf('.context-menu')),
    (text) => text.includes('Suggested'),
    'Suggested actions',
  );
  await delay(700);
  await screenshot(connection, path.join(output, 'suggested.png'));
} finally {
  await current.app.close(current.connection);
}

// Exploring a folder: its insight cards, then a model's look around it. A local stand-in answers
// as a model would, with a fixed and truthful account of this folder.
const inbox = path.join(root, 'Inbox');
await mkdir(path.join(inbox, 'Field trip'), { recursive: true });
await writeFile(
  path.join(inbox, 'Field trip.zip'),
  zipSync({ 'Field trip/notes.txt': strToU8('A short walk, a few photographs.\n') }),
  { flag: 'wx' },
);
await writeFile(path.join(inbox, 'Field trip', 'notes.txt'), 'A short walk, a few photographs.\n', {
  flag: 'wx',
});
const screenshots = [12, 14, 15, 21, 26].map((minute) =>
  path.join(inbox, `Screenshot 2026-10-21 at 10.${minute}.08.png`),
);
for (const file of screenshots) await copyFile(sourceImage, file);
await copyFile(path.join(examples, 'Field notes.pdf'), path.join(inbox, 'Field notes.pdf'));
const step = {
  kind: 'reply',
  text: '',
  path: null,
  query: null,
  commandID: null,
  patches: [],
  renames: [],
  files: [] as string[],
};
const model = await demoModel((instructions, input) => {
  if (instructions.includes('Suggest file actions')) return { kinds: [] };
  const { messages } = input as { messages: { role: string }[] };
  if (!messages.some((message) => message.role === 'tool'))
    return { ...step, kind: 'list', path: inbox };
  return {
    ...step,
    text:
      'This folder holds a field trip: Field trip.zip and the Field trip folder it was ' +
      'extracted to, five screenshots taken within a quarter of an hour, and the field notes ' +
      'as a PDF.\n\nThe archive is already extracted, so once the folder looks complete it can go ' +
      'to the Trash. The screenshots belong together and could share a folder.',
    files: [
      path.join(inbox, 'Field trip.zip'),
      path.join(inbox, 'Field trip'),
      screenshots[0]!,
      path.join(inbox, 'Field notes.pdf'),
    ],
  };
});
current = await open('Explore', inbox, undefined, {
  id: 'demo',
  name: 'Local model',
  kind: 'local',
  endpoint: model.endpoint,
  model: 'demo',
  allowContent: false,
});
try {
  const { connection } = current;
  await until(
    () => connection.evaluate(countOf('.folder-insight')),
    (count) => count >= 2,
    'Folder insights',
  );
  await delay(900);
  await screenshot(connection, path.join(output, 'insights.png'));
  await palette(connection, 'Explore this folder');
  await until(
    () => connection.evaluate(countOf('.chat-files button')),
    (count) => count >= 3,
    'Explore answer',
    60000,
  );
  await delay(1200);
  await screenshot(connection, path.join(output, 'explore.png'));
} finally {
  await current.app.close(current.connection);
  await model.close();
}

// Overview: a sample Home, indexed, with what its cards look for. Large files are sparse, so a
// 2.4 GB video takes no space on the disk.
const home = path.join(root, 'Home');
const place = (...parts: string[]) => path.join(home, ...parts);
for (const folder of ['Downloads', 'Desktop', 'Documents', 'Pictures'])
  await mkdir(place(folder), { recursive: true });
const day = 24 * 60 * 60 * 1000;
async function sized(file: string, bytes: number, daysOld = 1) {
  const handle = await openFile(file, 'wx');
  await handle.truncate(Math.round(bytes));
  await handle.close();
  const at = new Date(Date.now() - daysOld * day);
  await utimes(file, at, at);
}
await sized(place('Downloads', 'Viewer 0.9.dmg'), 182 * 1000 ** 2, 21);
await sized(place('Downloads', 'Fonts installer.pkg'), 14 * 1000 ** 2, 12);
await sized(place('Downloads', 'Old invoice.pdf'), 220 * 1000, 140);
// an archive Extract here already unpacked beside itself
await copyFile(path.join(examples, 'Field trip.zip'), place('Downloads', 'Field trip.zip'));
await mkdir(place('Downloads', 'Field trip'));
await writeFile(
  place('Downloads', 'Field trip', 'notes.txt'),
  'A short walk, a few photographs.\n',
);
await sized(place('Documents', 'Field trip film.mov'), 2.4 * 1000 ** 3, 9);
await sized(place('Documents', 'Survey scans.pdf'), 18 * 1000 ** 2, 9);
await copyFile(path.join(examples, 'Materials.xlsx'), place('Documents', 'Materials copy.xlsx'));
await copyFile(path.join(examples, 'Field notes.pdf'), place('Documents', 'Field notes (1).pdf'));
for (const name of ['IMG_2041.HEIC', 'IMG_2042.HEIC', 'IMG_2043.HEIC'])
  await copyFile(path.join(appRoot, 'tools/playground/assets/study.heic'), place('Pictures', name));
for (const minute of [12, 14, 15, 21, 26, 31])
  await copyFile(sourceImage, place('Desktop', `Screenshot 2026-10-21 at 10.${minute}.08.png`));
// the sample Home dates from the screenshots' day, over a week ago: Changed this week stays empty
// and every card fits the capture
for (const folder of ['Downloads', 'Desktop', 'Documents', 'Pictures'])
  for (const name of await readdir(place(folder))) {
    const file = place(folder, name);
    if ((await stat(file)).mtimeMs > Date.now() - 8 * day)
      await utimes(file, new Date(Date.now() - 8 * day), new Date(Date.now() - 8 * day));
  }
current = await open('Overview', home, undefined, undefined, home);
try {
  const { connection } = current;
  // the index has read the sample Home
  await until(
    () => connection.evaluate(pageCall(indexReady)),
    Boolean,
    'Indexed sample Home',
    60000,
  );
  await palette(connection, 'File overview');
  await until(
    () => connection.evaluate(countOf('.overview-card:not([aria-busy=true]) .overview-files li')),
    (count) => count >= 8,
    'Overview cards',
    30000,
  );
  await delay(1200);
  await screenshot(connection, path.join(output, 'overview.png'));
} finally {
  await current.app.close(current.connection);
}

// The Layout plane: three photographs, each a part of the same frame, laid out together; then the
// playground's sample parts nested for cutting, with six brackets.
const trip = path.join(root, 'Trip photos'),
  parts = path.join(root, 'Workshop parts');
for (const directory of [trip, parts]) await mkdir(directory);
for (const [name, crop] of [
  ['Meadow.jpg', 'crop=300:225:0:40'],
  ['Trail.jpg', 'crop=300:225:170:70'],
  ['Clearing.jpg', 'crop=300:225:340:100'],
])
  await execute(ffmpeg, [
    '-n',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    image,
    '-vf',
    crop!,
    '-q:v',
    '2',
    path.join(trip, name!),
  ]);
for (const sample of nestingSamples())
  await writeFile(path.join(parts, path.basename(sample.path)), sample.bytes, { flag: 'wx' });
current = await open('Layout', trip);
try {
  const { connection } = current;
  const row = (name: string) => '[data-file-path=' + JSON.stringify(path.join(trip, name)) + ']';
  await connection.evaluate(pageCall(selectRow, row('Meadow.jpg')));
  for (const name of ['Trail.jpg', 'Clearing.jpg'])
    await connection.evaluate(pageCall(addRow, row(name)));
  await delay(600);
  await palette(connection, 'Lay out');
  await until(
    () => connection.evaluate(countOf('.layout-sheet image')),
    (count) => count >= 3,
    'Layout preview',
    30000,
  );
  await delay(1500);
  await screenshot(connection, path.join(output, 'layout.png'));
} finally {
  await current.app.close(current.connection);
}
current = await open('Nesting', parts);
try {
  const { connection } = current;
  // a little taller than the other stills, so the estimates and the used part of the sheet show
  await connection.command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(1000);
  const row = (name: string) => '[data-file-path=' + JSON.stringify(path.join(parts, name)) + ']';
  const names = (await readdir(parts)).sort();
  await connection.evaluate(pageCall(selectRow, row(names[0]!)));
  for (const name of names.slice(1)) await connection.evaluate(pageCall(addRow, row(name)));
  await delay(600);
  await palette(connection, 'Nest for cutting');
  await field(connection, 'Quantity of Bracket with holes', '6');
  await until(
    () => connection.evaluate(textOf('.nesting-panel')),
    (text) => text.includes('Checked:') && text.includes('of 9 parts'),
    'Nested parts',
    60000,
  );
  await delay(1500);
  await screenshot(connection, path.join(output, 'nesting.png'));
} finally {
  await current.app.close(current.connection);
}

const assets = [
  'hero.png',
  'files.png',
  'create.png',
  'develop.png',
  'columns.png',
  'palette.png',
  'optimize.png',
  'suggested.png',
  'insights.png',
  'explore.png',
  'overview.png',
  'layout.png',
  'nesting.png',
];
const publicFiles: Record<string, string> = Object.fromEntries(
  assets.map((name) => [name, path.join(output, name)]),
);
publicFiles['source.jpg'] = image;
for (const name of ['files', 'create', 'develop']) {
  publicFiles[name + '.mp4'] = path.join(output, name, 'demo.mp4');
  publicFiles[name + '.gif'] = path.join(output, name, 'demo.gif');
}
const manifest = {
  platform: process.platform,
  architecture: process.arch,
  source: 'Big Buck Bunny © 2008 Blender Foundation · CC BY 3.0',
  captures: results,
  assets: {} as Record<string, { bytes: number; sha256: string }>,
};
for (const [name, file] of Object.entries(publicFiles)) {
  const data = await readFile(file);
  manifest.assets[name] = {
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
assert.ok(
  Object.values(manifest.assets).reduce((total, asset) => total + asset.bytes, 0) <= 20 * 1048576,
  'Public media budget',
);
await writeFile(path.join(output, 'result.json'), JSON.stringify(manifest, null, 2), {
  flag: 'wx',
});
if (arguments_.includes('--publish')) {
  const media = path.join(repositoryRoot, 'docs/media');
  await mkdir(media, { recursive: true });
  for (const [name, file] of Object.entries(publicFiles))
    await copyFile(file, path.join(media, name));
  const publicManifest = {
    ...manifest,
    captures: Object.fromEntries(
      Object.entries(results).map(([name, value]) => {
        const result = value as { frames: number; seconds: number };
        return [name, { frames: result.frames, seconds: result.seconds }];
      }),
    ),
  };
  await writeFile(
    path.join(media, 'manifest.json'),
    JSON.stringify(publicManifest, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    passed: true,
    fixture: path.basename(root),
    published: arguments_.includes('--publish'),
    assets: Object.keys(publicFiles),
  }),
);
