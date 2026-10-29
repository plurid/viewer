/**
 * How long a small file takes to show its content in Quick Preview, the first time and again, with
 * the search index idle and while it crawls a large tree; and whether moving through Columns ever
 * leaves the preview empty. Hidden window: renderer timing, not compositor frames.
 *
 *   VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 VIEWER_TEST_BINARY=<Viewer executable> \
 *   node --import tsx tests/native/preview-latency.ts
 *
 * Results go to out/perf/<time>/preview-latency.json. Fixtures and evidence are kept.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CURRENT_STATE_VERSION, type SavedState } from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import { documentSamples } from '../../tools/playground/samples/documents';
import { fieldNotesPDF } from '../../tools/docs/sample';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary, 'Set VIEWER_TEST_BINARY to a packaged Viewer executable.');
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const started = new Date();
const root = await temporaryRoot('viewer-native-preview-latency-');
const files = path.join(root, 'Files');
const crawl = path.join(root, 'Crawl');
await Promise.all([mkdir(files), mkdir(crawl)]);

// ---------------------------------------------------------------------------------------------
// Fixtures: one small file per format, and a tree large enough to keep the index crawling

const jpeg = await readFile(path.join(app, '../../../docs/media/source.jpg'));
const wanted = ['.epub', '.docx', '.xlsx'];
const fixtures: { name: string; bytes: Uint8Array | string }[] = [
  ...documentSamples(jpeg)
    .filter((sample) => wanted.includes(path.extname(sample.path)))
    .map((sample) => ({ name: path.basename(sample.path), bytes: sample.bytes })),
  { name: 'Field notes.pdf', bytes: fieldNotesPDF(jpeg) },
  { name: 'Forest.jpg', bytes: jpeg },
  { name: 'Notes.md', bytes: '# Field notes\n\nA short walk, a few photographs.\n' },
];
// another document, opened after the others: its engine should already have started
const docx = fixtures.find((fixture) => fixture.name.endsWith('.docx'))!;
const nextDocument = { name: 'Report.docx', bytes: docx.bytes };
for (const fixture of [...fixtures, nextDocument])
  await writeFile(path.join(files, fixture.name), fixture.bytes, { flag: 'wx' });
assert.equal(fixtures.length, 6, 'Every format has a fixture.');
for (let folder = 0; folder < 300; folder++) {
  const directory = path.join(crawl, `Folder ${folder}`);
  await mkdir(directory);
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      writeFile(path.join(directory, `Item ${index}.txt`), `generated ${folder}.${index}\n`, {
        flag: 'wx',
      }),
    ),
  );
}

async function profileFor(name: string, crawling: boolean, mode: 'list' | 'columns') {
  const profile = path.join(root, name);
  await mkdir(profile);
  const settings = defaultSettings(files);
  settings.hotkey.enabled = false;
  settings.providers = [];
  settings.search.roots = crawling ? [crawl, files] : [files];
  // a folder's view is kept by its path
  settings.folders = { [files]: { mode } };
  const ui = normalizePreferences();
  ui.sidebar.inNewPlanes = false;
  const state: SavedState = {
    version: CURRENT_STATE_VERSION,
    look: 'dark',
    activeWorkspace: 'latency',
    favorites: [],
    recents: [],
    ui,
    workspaces: [
      {
        id: 'latency',
        name: 'Preview latency',
        roots: ['folder'],
        activePane: 'folder',
        arrangement: {},
        panes: [
          {
            id: 'folder',
            type: 'folder',
            path: files,
            mode,
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
  await writeFile(
    path.join(profile, 'config.jsonc'),
    JSON.stringify({ version: 1, settings, ui }),
    { flag: 'wx' },
  );
  await writeFile(path.join(profile, 'viewer-state-v1.json'), JSON.stringify(state), {
    flag: 'wx',
  });
  return profile;
}

// ---------------------------------------------------------------------------------------------
// Page probes

/**
 * Times a preview from the key that opens it to the first frame that shows something real: no
 * spinner, and a picture, canvas or text. The harness polls too slowly to time it from outside.
 */
function armPreviewTiming(scope: string): void {
  const timing: { start?: number; shown?: number } = {};
  (window as unknown as { __preview: typeof timing }).__preview = timing;
  const shows = () => {
    const host = document.querySelector(`${scope} .preview-host`);
    if (!host || host.querySelector('.loading')) return false;
    if ([...host.querySelectorAll('canvas')].some((canvas) => canvas.width > 0)) return true;
    if ([...host.querySelectorAll('img')].some((image) => image.complete && image.naturalWidth > 0))
      return true;
    return (host.textContent ?? '').trim().length > 20;
  };
  const tick = () => {
    if (shows()) timing.shown = performance.now();
    else requestAnimationFrame(tick);
  };
  addEventListener(
    'keydown',
    () => {
      timing.start = performance.now();
      requestAnimationFrame(tick);
    },
    { once: true, capture: true },
  );
}

/** Counts the frames in which the Columns preview has no content, while the test moves through. */
function watchColumns(): void {
  const probe = { frames: 0, empty: 0, running: true };
  (window as unknown as { __columns: typeof probe }).__columns = probe;
  const shows = () => {
    const host = document.querySelector('.column-preview .preview-host');
    if (!host || host.querySelector('.loading')) return false;
    if ([...host.querySelectorAll('canvas')].some((canvas) => canvas.width > 0)) return true;
    if ([...host.querySelectorAll('img')].some((image) => image.complete && image.naturalWidth > 0))
      return true;
    return (host.textContent ?? '').trim().length > 20;
  };
  const tick = () => {
    if (!probe.running) return;
    probe.frames++;
    if (!shows()) probe.empty++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopColumns(): { frames: number; empty: number } {
  const probe = (
    window as unknown as { __columns: { frames: number; empty: number; running: boolean } }
  ).__columns;
  probe.running = false;
  return { frames: probe.frames, empty: probe.empty };
}

type Connection = Awaited<ReturnType<Awaited<ReturnType<typeof ownedApp>>['connect']>>;

async function key(connection: Connection, name: string, code: string, keyCode: number) {
  for (const type of ['keyDown', 'keyUp'])
    await connection.command('Input.dispatchKeyEvent', {
      type,
      key: name,
      code,
      windowsVirtualKeyCode: keyCode,
    });
}

async function select(connection: Connection, name: string) {
  const selector = `[data-file-path=${JSON.stringify(path.join(files, name))}]`;
  await connection.evaluate(
    `(() => { const row = document.querySelector(${JSON.stringify(selector)}); row.click(); row.focus(); })()`,
  );
}

// ---------------------------------------------------------------------------------------------
// Workloads

interface Observation {
  run: string;
  file: string;
  trial: number;
  crawling: boolean;
  milliseconds: number;
}

/** `pause`: the time a person takes between selecting a file and pressing Space. */
async function quickPreviews(
  run: string,
  crawling: boolean,
  pause: number,
): Promise<Observation[]> {
  const launched = await ownedApp(binary!, await profileFor(run, crawling, 'list'));
  const connection = await launched.connect();
  const observations: Observation[] = [];
  try {
    await until(
      () => connection.evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
      (count) => count === fixtures.length + 1,
      'latency fixtures',
      30_000,
    );
    const opens = [
      ...fixtures.flatMap((fixture) => [0, 1, 2].map((trial) => ({ fixture, trial }))),
      { fixture: nextDocument, trial: 0 },
    ];
    for (const { fixture, trial } of opens) {
      await select(connection, fixture.name);
      await delay(pause);
      await connection.evaluate(pageCall(armPreviewTiming, '.quick-preview'));
      const crawling = (
        await connection.evaluate<{ running: boolean }>('window.viewer.indexStatus()')
      ).running;
      await key(connection, ' ', 'Space', 32);
      const timing = await until(
        () => connection.evaluate<{ start?: number; shown?: number }>('({ ...window.__preview })'),
        (value) => value.shown !== undefined,
        fixture.name + ' shows its content',
        30_000,
      );
      const observation = {
        run,
        file: fixture.name,
        trial,
        crawling,
        milliseconds: Math.round(timing.shown! - timing.start!),
      };
      observations.push(observation);
      console.log(JSON.stringify(observation));
      await key(connection, 'Escape', 'Escape', 27);
      await until(
        () => connection.evaluate<boolean>('!document.querySelector(".quick-preview-dialog")'),
        Boolean,
        'preview closes',
      );
    }
  } finally {
    await launched.close(connection);
  }
  return observations;
}

async function columns(): Promise<{ frames: number; empty: number; steps: number }> {
  const launched = await ownedApp(binary!, await profileFor('Columns', false, 'columns'));
  const connection = await launched.connect();
  try {
    await until(
      () => connection.evaluate<number>('document.querySelectorAll("[data-file-path]").length'),
      (count) => count === fixtures.length + 1,
      'column fixtures',
      30_000,
    );
    const names = [...fixtures, nextDocument]
      .map((fixture) => fixture.name)
      .sort((a, b) => a.localeCompare(b));
    // a first pass loads each module once, as a person would before moving quickly
    for (const name of names) {
      await select(connection, name);
      await until(
        () =>
          connection.evaluate<boolean>(
            `(() => { const host = document.querySelector('.column-preview .preview-host'); return !!host && !host.querySelector('.loading'); })()`,
          ),
        Boolean,
        name + ' in Columns',
        30_000,
      );
    }
    await select(connection, names[0]!);
    await delay(800);
    await connection.evaluate(pageCall(watchColumns));
    for (let step = 1; step < names.length; step++) {
      await key(connection, 'ArrowDown', 'ArrowDown', 40);
      await delay(500);
    }
    const probe = await connection.evaluate<{ frames: number; empty: number }>(
      pageCall(stopColumns),
    );
    return { ...probe, steps: names.length - 1 };
  } finally {
    await launched.close(connection);
  }
}

const idle = await quickPreviews('Idle', false, 0);
const crawlingRun = await quickPreviews('Crawling', true, 1500);
const columnRun = await columns();
console.log(JSON.stringify({ columns: columnRun }));

const summary = (observations: Observation[]) =>
  Object.fromEntries(
    [...fixtures, nextDocument].map((fixture) => {
      const times = observations
        .filter((item) => item.file === fixture.name)
        .map((item) => item.milliseconds);
      return [fixture.name, { first: times[0], warm: Math.min(...times.slice(1)) }];
    }),
  );
const result = {
  version: 1,
  started: started.toISOString(),
  binary,
  fixture: root,
  idle: summary(idle),
  crawling: summary(crawlingRun),
  columns: columnRun,
  observations: [...idle, ...crawlingRun],
};
const output = path.join(app, 'out/perf', started.toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'preview-latency.json'), JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
});
console.log('Preview latency results:', path.join(output, 'preview-latency.json'));
