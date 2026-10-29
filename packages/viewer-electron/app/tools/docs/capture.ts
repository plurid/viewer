/** Public documentation captures own their app/profile and preserve every input. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { documentSamples } from '../playground/samples/documents';
import { ownedApp, until } from '../../tests/owned-app';
import { record, screenshot, type Connection } from './record';
import { temporaryRoot } from '../temporary';
import { fieldNotesPDF } from './sample';

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

async function profile(name: string, folder: string, mode?: 'columns') {
  const directory = path.join(root, name);
  await mkdir(directory);
  const ui = normalizePreferences(),
    settings = defaultSettings(root);
  settings.hotkey.enabled = false;
  settings.providers = [];
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
async function field(connection: Connection, label: string, text: string) {
  const selector = `[aria-label=${JSON.stringify(label)}]`;
  await until(
    () => connection.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
    Boolean,
    label,
  );
  await connection.evaluate(
    `(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); })()`,
  );
  await connection.command('Input.insertText', { text });
}
async function button(connection: Connection, label: string, scope = 'document') {
  const expression = `Array.from(${scope}.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)})`;
  await until(
    () => connection.evaluate<boolean>(`!!(${expression}) && !(${expression}).disabled`),
    Boolean,
    label,
  );
  await connection.evaluate(`(${expression}).click()`);
}
async function palette(connection: Connection, label: string) {
  await connection.evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
  await field(connection, 'Search commands', label);
  await until(
    () =>
      connection.evaluate<string>(
        'document.querySelector(".command-result[aria-selected=true]")?.textContent || ""',
      ),
    (text) => text.toLowerCase().includes(label.toLowerCase()),
    label,
  );
  await delay(650);
  await connection.evaluate(
    'document.querySelector(".command-result[aria-selected=true]").click()',
  );
}
async function open(name: string, folder: string, mode?: 'columns') {
  const directory = await profile(name, folder, mode),
    app = await ownedApp(binary, directory);
  const connection = await app.connect();
  await connection.command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(
    () => connection.evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
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
    await connection.evaluate(
      `document.querySelector('[aria-label="Search this folder"]').click()`,
    );
    await field(connection, 'Find files', 'Field notes.pdf');
    await delay(1200);
    const selector =
      '[data-file-path=' + JSON.stringify(path.join(examples, 'Field notes.pdf')) + ']';
    await connection.evaluate(
      `(() => { const row = document.querySelector(${JSON.stringify(selector)}); row.click(); row.focus(); })()`,
    );
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
    await until(
      () => connection.evaluate<boolean>('!!document.querySelector(".pdf-viewer canvas")'),
      Boolean,
      'PDF pixels',
    );
    await delay(2000);
    await screenshot(connection, path.join(output, 'files.png'));
    await delay(1600);
  });
  await button(current.connection, 'Open linked plane');
  await delay(1500);
  await current.connection.evaluate(
    `document.querySelector('[aria-label="Close search"]')?.click()`,
  );
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
      await connection.evaluate('document.querySelector("[data-file-path]").click()');
      await palette(connection, 'Images for web');
      await until(
        () =>
          connection.evaluate<boolean>(
            '!!document.querySelector(".image-tools-canvas canvas")?.width',
          ),
        Boolean,
        'Source image',
      );
      await delay(1300);
      await screenshot(connection, path.join(output, 'create.png'));
      await button(connection, 'Export image', 'document.querySelector(".image-tools-dialog")');
      await until(
        () => connection.evaluate<{ status: string }[]>('window.viewer.jobs()'),
        (jobs) => jobs.some((job) => job.status === 'completed'),
        'Converted file',
        30000,
      );
      await delay(1200);
      await button(connection, 'Open result', 'document.querySelector(".image-tools-dialog")');
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
      await button(connection, 'Create task', 'document.querySelector("dialog")');
      await until(
        async () =>
          JSON.parse(await readFile(path.join(current.directory, 'viewer-state-v1.json'), 'utf8'))
            .workspaces[0]?.taskAreas?.[0]?.members.length,
        (count) => count === 4,
        'Four task tools',
        30000,
      );
      await until(
        () => connection.evaluate<boolean>('!!document.querySelector(".task-plane")'),
        Boolean,
        'Task overview',
      );
      await field(connection, 'Note title', 'Homepage plan');
      await button(connection, 'Start writing');
      await until(
        () => connection.evaluate<boolean>('!!document.querySelector(".note-plane .cm-content")'),
        Boolean,
        'Note editor',
      );
      await connection.evaluate('document.querySelector(".note-plane .cm-content").focus()');
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

// Stills for the guides: Columns with a preview, the palette for a photograph, Optimize results.
current = await open('Stills', examples, 'columns');
try {
  const { connection } = current;
  const row = (name: string) =>
    '[data-file-path=' + JSON.stringify(path.join(examples, name)) + ']';
  await connection.evaluate(
    `document.querySelector(${JSON.stringify(row('Field notes.pdf'))}).click()`,
  );
  await until(
    () =>
      connection.evaluate<boolean>(
        '!!document.querySelector(".column-preview canvas, .column-preview img")',
      ),
    Boolean,
    'Column preview',
  );
  await delay(2000);
  await screenshot(connection, path.join(output, 'columns.png'));

  await connection.evaluate(`document.querySelector(${JSON.stringify(row('Forest.jpg'))}).click()`);
  await delay(600);
  await connection.evaluate(`document.querySelector('[aria-label="Commands (⌘K)"]').click()`);
  await field(connection, 'Search commands', 'convert');
  await until(
    () => connection.evaluate<number>('document.querySelectorAll(".command-result").length'),
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
  await connection.evaluate(
    `document.querySelector(${JSON.stringify(row('Field notes.pdf'))}).click()`,
  );
  await connection.evaluate(
    `document.querySelector(${JSON.stringify(row('Forest.jpg'))}).dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))`,
  );
  await delay(600);
  await palette(connection, 'Optimize');
  await until(
    () => connection.evaluate<boolean>('!!document.querySelector(".optimize-dialog")'),
    Boolean,
    'Optimize dialog',
  );
  await button(connection, 'Prepare candidates', 'document.querySelector(".optimize-dialog")');
  await until(
    () =>
      connection.evaluate<number>(
        'document.querySelectorAll(".optimize-results .optimize-savings, .optimize-results .error").length',
      ),
    (count) => count >= 2,
    'Optimize results',
    60000,
  );
  await delay(1200);
  await screenshot(connection, path.join(output, 'optimize.png'));
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
