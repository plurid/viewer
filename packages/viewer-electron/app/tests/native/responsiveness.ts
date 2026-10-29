/**
 * How fast Viewer responds, measured on a packaged build in a hidden window: cold start, plane
 * clicks, keyboard selection, palette typing, a 10,000-item folder, grid thumbnails, a copy job
 * and camera motion. Each workload records React commits, main-process IPC (VIEWER_PERF=1),
 * frames and long tasks. Renderer timings are scheduling observations, not display FPS.
 *
 *   VIEWER_TEST_PRESERVE=1 VIEWER_TEST_NO_REMOVAL=1 VIEWER_TEST_BINARY=<Viewer executable> \
 *   node --import tsx tests/native/responsiveness.ts
 *
 * Results go to out/perf/<time>/responsiveness.json. Fixtures and evidence are kept.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import zlib from 'node:zlib';
import {
  CURRENT_STATE_VERSION,
  type FolderPane,
  type SavedState,
} from '../../src/domain/contracts';
import { defaultSettings } from '../../src/domain/services';
import { normalizePreferences } from '../../src/domain/preferences/ui';
import {
  performanceReportPrefix,
  type PerformanceReport,
  type TrafficCounter,
} from '../../src/desktop/diagnostics/performance';
import { temporaryRoot } from '../../tools/temporary';
import { ownedApp, until } from '../owned-app';
import { reactCommitProbe } from '../react-commits';
import { pageCall } from './runtime/page-function';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const binary = process.env.VIEWER_TEST_BINARY;
assert.ok(binary, 'Set VIEWER_TEST_BINARY to a packaged Viewer executable.');

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const coldStarts = 3;

// ---------------------------------------------------------------------------------------------
// Fixture

/** A solid-colour RGB PNG; every thumbnail is a distinct file with distinct bytes. */
function png(width: number, height: number, colour: readonly [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(colour, 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function writeAll(files: { file: string; bytes: string | Buffer }[]): Promise<void> {
  for (let start = 0; start < files.length; start += 200)
    await Promise.all(
      files
        .slice(start, start + 200)
        .map(({ file, bytes }) => writeFile(file, bytes, { flag: 'wx' })),
    );
}

const root = await temporaryRoot('viewer-native-responsiveness-');
const files = path.join(root, 'Files');
const profile = path.join(root, 'Profile');
const folders = {
  documents: path.join(files, 'Documents'),
  large: path.join(files, 'Large folder'),
  gallery: path.join(files, 'Gallery'),
  pictures: path.join(files, 'Gallery', 'Pictures'),
  copies: path.join(files, 'Copies'),
};
await mkdir(files);
await mkdir(profile);
for (const folder of Object.values(folders)) await mkdir(folder);
const documents = Array.from({ length: 2000 }, (_, index) =>
  path.join(folders.documents, `Note ${String(index).padStart(4, '0')}.txt`),
);
await writeAll(documents.map((file, index) => ({ file, bytes: `Note ${index}\n` })));
await writeAll(
  Array.from({ length: 10_000 }, (_, index) => ({
    file: path.join(folders.large, `Item ${String(index).padStart(5, '0')}.dat`),
    bytes: '',
  })),
);
await writeAll(
  Array.from({ length: 300 }, (_, index) => ({
    file: path.join(folders.pictures, `Picture ${String(index).padStart(3, '0')}.png`),
    bytes: png(96, 96, [index % 256, (index * 7) % 256, (index * 13) % 256]),
  })),
);

const folderPane = (id: string, folder: string, mode: FolderPane['mode']): FolderPane => ({
  id,
  type: 'folder',
  path: folder,
  mode,
  sort: 'name',
  descending: false,
  showHidden: false,
  history: [folder],
  historyIndex: 0,
});
const settings = defaultSettings(files);
settings.hotkey.enabled = false;
settings.providers = [];
// a folder's view mode is shared by path (domain/preferences/folder-presentation.ts)
settings.folders = {
  [folders.gallery]: { mode: 'grid' },
  [folders.pictures]: { mode: 'grid' },
};
const ui = normalizePreferences();
ui.sidebar.inNewPlanes = false;
const state = (activeWorkspace: 'start' | 'planes'): SavedState => ({
  version: CURRENT_STATE_VERSION,
  look: 'dark',
  activeWorkspace,
  favorites: [],
  recents: [],
  ui,
  workspaces: [
    {
      id: 'start',
      name: 'Start',
      roots: ['start'],
      activePane: 'start',
      arrangement: {},
      panes: [folderPane('start', files, 'list')],
    },
    {
      id: 'planes',
      name: 'Planes',
      roots: ['docs', 'files', 'grid'],
      activePane: 'docs',
      arrangement: {},
      panes: [
        folderPane('docs', folders.documents, 'list'),
        folderPane('files', files, 'list'),
        folderPane('grid', folders.gallery, 'grid'),
      ],
    },
  ],
});
const stateFile = path.join(profile, 'viewer-state-v1.json');
await writeFile(path.join(profile, 'config.jsonc'), JSON.stringify({ version: 1, settings, ui }), {
  flag: 'wx',
});
await writeFile(stateFile, JSON.stringify(state('start')), { flag: 'wx' });

// ---------------------------------------------------------------------------------------------
// Observation

type Launched = Awaited<ReturnType<typeof ownedApp>>;
type Connection = Awaited<ReturnType<Launched['connect']>>;

interface ProbeWindow {
  __qaCommits?: number;
  __responsiveness?: {
    frames: number[];
    tasks: number[];
    commits: number;
    started: number;
    stopped: boolean;
    raf: number;
    observer: PerformanceObserver;
  };
  __watch?: { inputs: number[]; changes: number[]; stop(): void };
}

function reportsIn(output: string): PerformanceReport[] {
  const reports: PerformanceReport[] = [];
  for (const line of output.split('\n')) {
    const at = line.indexOf(performanceReportPrefix);
    if (at < 0) continue;
    try {
      reports.push(
        JSON.parse(line.slice(at + performanceReportPrefix.length)) as PerformanceReport,
      );
    } catch {
      // the last line can still be arriving
    }
  }
  return reports;
}

/** Waits for a main-process report written after `epoch`. */
async function reportAfter(launched: Launched, epoch: number): Promise<PerformanceReport> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const latest = reportsIn(launched.output()).at(-1);
    if (latest && latest.time > epoch) return latest;
    assert.ok(Date.now() < deadline, 'Viewer wrote no VIEWER_PERF report.');
    await delay(50);
  }
}

function trafficBetween(
  before: Record<string, TrafficCounter>,
  after: Record<string, TrafficCounter>,
) {
  const rows = Object.entries(after)
    .map(([name, counter]) => ({
      name,
      calls: counter.calls - (before[name]?.calls ?? 0),
      bytes: counter.bytes - (before[name]?.bytes ?? 0),
    }))
    .filter((row) => row.calls > 0)
    .sort((left, right) => right.bytes - left.bytes);
  return {
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    top: rows.slice(0, 6),
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round((sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0) * 10) / 10;
}

function beginProbe() {
  const page = window as unknown as ProbeWindow;
  const probe = {
    frames: [] as number[],
    tasks: [] as number[],
    commits: page.__qaCommits ?? 0,
    started: performance.now(),
    stopped: false,
    raf: 0,
    observer: new PerformanceObserver((list) => {
      probe.tasks.push(...list.getEntries().map((entry) => entry.duration));
    }),
  };
  let last = performance.now();
  const frame = (time: number) => {
    if (probe.stopped) return;
    probe.frames.push(time - last);
    last = time;
    probe.raf = requestAnimationFrame(frame);
  };
  probe.raf = requestAnimationFrame(frame);
  probe.observer.observe({ entryTypes: ['longtask'] });
  page.__responsiveness = probe;
}

function finishProbe() {
  const page = window as unknown as ProbeWindow;
  const probe = page.__responsiveness!;
  probe.stopped = true;
  cancelAnimationFrame(probe.raf);
  probe.tasks.push(...probe.observer.takeRecords().map((entry) => entry.duration));
  probe.observer.disconnect();
  delete page.__responsiveness;
  return {
    milliseconds: performance.now() - probe.started,
    commits: (page.__qaCommits ?? 0) - probe.commits,
    // the first interval need not start at a paint
    frames: probe.frames.slice(1),
    tasks: probe.tasks,
  };
}

interface Observation {
  workload: string;
  milliseconds: number;
  commits: number;
  frames: { count: number; p95: number; worst: number };
  longTasks: { count: number; longest: number };
  requests: ReturnType<typeof trafficBetween>;
  events: ReturnType<typeof trafficBetween>;
  mainDelayMax: number;
  [detail: string]: unknown;
}

/** Runs one workload between probes, then waits for its saves and echoes to settle. */
async function observe(
  launched: Launched,
  connection: Connection,
  workload: string,
  run: () => Promise<Record<string, unknown> | void>,
  settle = 900,
): Promise<Observation> {
  const before = await reportAfter(launched, Date.now());
  await connection.evaluate(pageCall(beginProbe));
  const detail = (await run()) ?? {};
  await delay(settle);
  const probe = await connection.evaluate<ReturnType<typeof finishProbe>>(pageCall(finishProbe));
  const after = await reportAfter(launched, Date.now());
  const during = reportsIn(launched.output()).filter(
    (report) => report.time > before.time && report.time <= after.time,
  );
  const observation: Observation = {
    workload,
    milliseconds: Math.round(probe.milliseconds),
    commits: probe.commits,
    frames: {
      count: probe.frames.length,
      p95: percentile(probe.frames, 0.95),
      worst: percentile(probe.frames, 1),
    },
    longTasks: {
      count: probe.tasks.length,
      longest: Math.round(Math.max(0, ...probe.tasks)),
    },
    requests: trafficBetween(before.requests, after.requests),
    events: trafficBetween(before.events, after.events),
    mainDelayMax: Math.max(0, ...during.map((report) => report.delay.max)),
    ...detail,
  };
  console.log(JSON.stringify(observation));
  return observation;
}

// ---------------------------------------------------------------------------------------------
// Page helpers

/** A point in the plane's header that belongs to the header itself, not one of its buttons. */
function headerPoint(pane: string) {
  const header = document.querySelector(`.plane-controls[data-viewer-plane="${pane}"]`);
  if (!header) return null;
  const bounds = header.getBoundingClientRect();
  const y = bounds.top + bounds.height / 2;
  for (let x = bounds.right - 4; x > bounds.left + 4; x -= 4)
    if (document.elementFromPoint(x, y) === header) return { x, y };
  return null;
}

/** The centre of the element matching `selector`, when it is on screen. */
function centre(selector: string) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const bounds = element.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  return x > 0 && y > 0 && x < innerWidth && y < innerHeight ? { x, y } : null;
}

/** Records when each key or input arrives, and when the watched state next changes. */
function watchChanges(kind: 'selection' | 'results') {
  const page = window as unknown as ProbeWindow;
  const read =
    kind === 'selection'
      ? () =>
          document
            .querySelector('[aria-selected="true"][data-file-path]')
            ?.getAttribute('data-file-path') ?? ''
      : () => document.querySelector('.command-results')?.textContent ?? '';
  const watch = { inputs: [] as number[], changes: [] as number[], stop: () => {} };
  let last = read();
  const input = () => watch.inputs.push(performance.now());
  const type = kind === 'selection' ? 'keydown' : 'input';
  document.addEventListener(type, input, { capture: true });
  const observer = new MutationObserver(() => {
    const now = read();
    if (now === last) return;
    last = now;
    watch.changes.push(performance.now());
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  watch.stop = () => {
    observer.disconnect();
    document.removeEventListener(type, input, { capture: true });
  };
  page.__watch = watch;
}

/** For each input, the time until the first change after it. */
function changeLatencies() {
  const page = window as unknown as ProbeWindow;
  const watch = page.__watch!;
  watch.stop();
  delete page.__watch;
  return watch.inputs.map((input) => {
    const change = watch.changes.find((time) => time >= input);
    return change === undefined ? -1 : change - input;
  });
}

/** Times a navigation by double-click: until the folder's first rows, and its thumbnails. */
function watchFolder(folder: string, thumbnails: boolean) {
  const started = performance.now();
  const prefix = folder + '/';
  return new Promise<Record<string, number>>((resolve) => {
    const result: Record<string, number> = {};
    let stable = 0;
    let lastLoaded = -1;
    const tick = () => {
      const now = performance.now() - started;
      const rows = [...document.querySelectorAll('[data-file-path]')].filter((row) =>
        row.getAttribute('data-file-path')!.startsWith(prefix),
      );
      if (rows.length && result.firstRows === undefined) {
        result.firstRows = now;
        result.rows = rows.length;
      }
      if (thumbnails && rows.length) {
        const loaded = rows.filter((row) => {
          const image = row.querySelector('img');
          return !!image && image.complete && image.naturalWidth > 0;
        }).length;
        if (loaded && result.firstThumbnail === undefined) result.firstThumbnail = now;
        stable = loaded === lastLoaded ? stable + 1 : 0;
        lastLoaded = loaded;
        result.thumbnails = loaded;
        result.tiles = rows.length;
        if (loaded === rows.length || (loaded && stable > 90)) {
          result.allThumbnails = now;
          return resolve(result);
        }
      } else if (!thumbnails && rows.length) return resolve(result);
      if (now > 20_000) return resolve({ ...result, timedOut: now });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---------------------------------------------------------------------------------------------
// Workloads

const environment = { VIEWER_PERF: '1' };

async function coldStart(index: number) {
  const spawned = Date.now();
  const launched = await ownedApp(binary!, profile, { environment });
  const connection = await launched.connect();
  try {
    const marks = await until(
      () =>
        connection.evaluate<Record<string, number>>(
          pageCall(() =>
            Object.fromEntries(
              performance
                .getEntriesByType('mark')
                .map((mark) => [mark.name, performance.timeOrigin + mark.startTime]),
            ),
          ),
        ),
      (marks) => 'viewer:first-rows' in marks,
      'first folder rows after a cold start',
      30_000,
    );
    const main = (await reportAfter(launched, Date.now())).marks;
    const since = (epoch: number | undefined) =>
      epoch === undefined ? undefined : Math.round(epoch - spawned);
    const observation = {
      workload: `cold-start-${index}`,
      main: Object.fromEntries(Object.entries(main).map(([name, time]) => [name, since(time)])),
      renderer: Object.fromEntries(
        Object.entries(marks).map(([name, time]) => [name, since(time)]),
      ),
    };
    console.log(JSON.stringify(observation));
    return observation;
  } finally {
    await launched.close(connection);
  }
}

async function mouse(connection: Connection, point: { x: number; y: number }, clickCount = 1) {
  for (let click = 1; click <= clickCount; click++)
    for (const type of ['mousePressed', 'mouseReleased'])
      await connection.command('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        clickCount: click,
      });
}

async function key(connection: Connection, key: string, code: string, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp'])
    await connection.command('Input.dispatchKeyEvent', { type, key, code, modifiers });
}

async function frames(connection: Connection, count = 2) {
  for (let frame = 0; frame < count; frame++)
    await connection.evaluate('new Promise((resolve) => requestAnimationFrame(resolve))');
}

async function interactive(): Promise<Observation[]> {
  await writeFile(stateFile, JSON.stringify(state('planes')));
  const launched = await ownedApp(binary!, profile, { environment });
  const connection = await launched.connect();
  const observations: Observation[] = [];
  const run = async (
    workload: string,
    work: () => Promise<Record<string, unknown> | void>,
    settle?: number,
  ) => {
    observations.push(await observe(launched, connection, workload, work, settle));
  };
  try {
    // count production React commits; the probe must load before React
    await connection.command('Runtime.enable');
    await connection.command('Page.enable');
    await connection.command('Page.addScriptToEvaluateOnNewDocument', { source: reactCommitProbe });
    await connection.command('Page.reload');
    await until(
      () => connection.evaluate<number>('document.querySelectorAll(".plane-controls").length'),
      (count) => count === 3,
      'three planes after the probe reload',
      30_000,
    );
    await until(
      () => connection.evaluate<{ running: boolean }>('window.viewer.indexStatus()'),
      (status) => !status.running,
      'an idle index before measuring',
      120_000,
    );
    await delay(1500);

    for (const [index, pane] of ['files', 'grid', 'docs', 'files', 'grid', 'docs'].entries())
      await run(`plane-click-${index + 1}`, async () => {
        const point = await connection.evaluate<{ x: number; y: number } | null>(
          pageCall(headerPoint, pane),
        );
        assert.ok(point, `A free spot in the ${pane} plane header`);
        await mouse(connection, point);
      });

    const firstRow = `[data-file-path=${JSON.stringify(documents[0])}]`;
    const row = await connection.evaluate<{ x: number; y: number } | null>(
      pageCall(centre, firstRow),
    );
    assert.ok(row, 'The first document row on screen');
    await mouse(connection, row);
    await frames(connection);
    await run('selection-50-arrows', async () => {
      await connection.evaluate(pageCall(watchChanges, 'selection'));
      for (let step = 0; step < 50; step++) {
        await key(connection, 'ArrowDown', 'ArrowDown');
        await frames(connection, 1);
      }
      await delay(100);
      const latencies = await connection.evaluate<number[]>(pageCall(changeLatencies));
      return {
        latency: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
        missed: latencies.filter((latency) => latency < 0).length,
      };
    });

    await run('palette-typing', async () => {
      await key(connection, 'k', 'KeyK', 4);
      await until(
        () =>
          connection.evaluate<boolean>(
            'document.activeElement?.getAttribute("aria-label") === "Search commands"',
          ),
        Boolean,
        'the command palette',
      );
      await connection.evaluate(pageCall(watchChanges, 'results'));
      for (const character of 'frame all') {
        await connection.command('Input.insertText', { text: character });
        await frames(connection, 1);
      }
      await delay(300);
      const latencies = await connection.evaluate<number[]>(pageCall(changeLatencies));
      await key(connection, 'Escape', 'Escape');
      return {
        latency: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
      };
    });

    const picturesTile = `.file-tile[data-file-path=${JSON.stringify(folders.pictures)}]`;
    await run(
      'open-300-thumbnails',
      async () => {
        const point = await connection.evaluate<{ x: number; y: number } | null>(
          pageCall(centre, picturesTile),
        );
        if (!point)
          throw new Error(
            'The Pictures tile is not on screen: ' +
              JSON.stringify(
                await connection.evaluate(
                  pageCall(() => ({
                    viewport: [innerWidth, innerHeight],
                    tiles: [...document.querySelectorAll('.file-tile')].map((tile) => {
                      const bounds = tile.getBoundingClientRect();
                      return [
                        tile.getAttribute('data-file-path'),
                        Math.round(bounds.x),
                        Math.round(bounds.y),
                      ];
                    }),
                    planes: [...document.querySelectorAll('.plane-controls')].map((header) => {
                      const bounds = header.getBoundingClientRect();
                      return [
                        header.getAttribute('data-viewer-plane'),
                        Math.round(bounds.x),
                        Math.round(bounds.y),
                        Math.round(bounds.width),
                      ];
                    }),
                  })),
                ),
              ),
          );
        const timing = connection.evaluate<Record<string, number>>(
          pageCall(watchFolder, folders.pictures, true),
        );
        await mouse(connection, point, 2);
        return { timing: await timing };
      },
      1500,
    );

    const largeRow = `[data-file-path=${JSON.stringify(folders.large)}]`;
    await run('open-10k-folder', async () => {
      const point = await connection.evaluate<{ x: number; y: number } | null>(
        pageCall(centre, largeRow),
      );
      assert.ok(point, 'The Large folder row on screen');
      const timing = connection.evaluate<Record<string, number>>(
        pageCall(watchFolder, folders.large, false),
      );
      await mouse(connection, point, 2);
      return { timing: await timing };
    });

    await run('scroll-10k-folder', async () => {
      const point = await connection.evaluate<{ x: number; y: number } | null>(
        pageCall(centre, `[data-file-path^=${JSON.stringify(folders.large + '/')}]`),
      );
      assert.ok(point, 'A Large folder row on screen');
      for (let step = 0; step < 24; step++) {
        await connection.command('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          ...point,
          deltaX: 0,
          deltaY: 600,
        });
        await frames(connection, 1);
      }
    });

    await run(
      'copy-2000-files',
      async () => {
        const started = Date.now();
        await connection.evaluate(
          pageCall(
            (sources: string[], destination: string) =>
              window.viewer.operate({ kind: 'copy', sources, destination }),
            documents,
            folders.copies,
          ),
        );
        // Watch the destination on disk: polling the job list over IPC would itself load
        // the main process, since each reply carries every source path.
        await until(
          // no-removal mode keeps each emptied `.viewer-transfer-*` staging folder
          async () =>
            (await readdir(folders.copies)).filter((name) => !name.startsWith('.')).length,
          (copied) => copied === documents.length,
          'the copy job to finish',
          120_000,
        );
        return { jobMilliseconds: Date.now() - started };
      },
      1500,
    );

    await until(
      () => connection.evaluate<{ running: boolean }>('window.viewer.indexStatus()'),
      (status) => !status.running,
      'an idle index after the copy',
      120_000,
    );
    await delay(1500);
    await run('camera-wheel', async () => {
      for (let step = 0; step < 24; step++) {
        await connection.command('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 4,
          y: 450,
          deltaX: step % 2 ? 70 : -70,
          deltaY: step % 2 ? 40 : -40,
        });
        await frames(connection, 1);
      }
    });
    return observations;
  } finally {
    await launched.close(connection);
  }
}

async function bundles() {
  const renderer = path.join(app, '.vite/renderer/main_window');
  const html = await readFile(path.join(renderer, 'index.html'), 'utf8');
  const eager = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1]!,
  );
  const sizes = await Promise.all(
    eager.map(async (file) => (await stat(path.join(renderer, file))).size),
  );
  const main = await stat(path.join(app, '.vite/build/main.cjs'));
  return {
    rendererEager: Object.fromEntries(eager.map((file, index) => [file, sizes[index]])),
    rendererEagerBytes: sizes.reduce((sum, size) => sum + size, 0),
    mainBytes: main.size,
  };
}

// ---------------------------------------------------------------------------------------------

const started = new Date();
const starts = [];
for (let index = 1; index <= coldStarts; index++) starts.push(await coldStart(index));
const observations = await interactive();
const result = {
  version: 1,
  started: started.toISOString(),
  binary: path.resolve(binary),
  fixture: root,
  bundles: await bundles(),
  coldStarts: starts,
  observations,
};
const output = path.join(app, 'out/perf', started.toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'responsiveness.json'), JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
});
console.log('Responsiveness results:', path.join(output, 'responsiveness.json'));
