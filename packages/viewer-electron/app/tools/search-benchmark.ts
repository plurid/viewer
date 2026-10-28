/** Real generated directory trees; source files and all measurements are retained. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { SearchBatch } from '../src/domain/contracts';
import { commonSearchExclusions } from '../src/domain/search/exclusions';
import { defaultSettings } from '../src/domain/services';
import { Search } from '../src/desktop/search/search';
import { FileIndex } from '../src/desktop/search/index-core';
import { temporaryRoot } from './temporary';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1', 'Keep generated benchmark files.');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1', 'Disable benchmark file removal.');
const perSink = Number(process.argv[2] ?? 2000);
assert.ok(
  Number.isInteger(perSink) && perSink >= 100 && perSink <= 10000,
  'Choose 100–10,000 files per dependency/cache folder.',
);

const root = await temporaryRoot('viewer-search-benchmark-');
const files = path.join(root, 'Files');
const sinks = ['node_modules', '.venv', '__pycache__', '.git', '.next', 'target'];
const source = path.join(files, 'source');
await mkdir(source, { recursive: true });
const expected: string[] = [];
for (let index = 0; index < 64; index++) {
  const file = path.join(source, `needle-${index}.txt`);
  await writeFile(file, `Working document ${index}: needle-content-token.\n`, { flag: 'wx' });
  expected.push(file);
}
for (const sink of sinks) {
  for (let base = 0; base < perSink; base += 100) {
    const folder = path.join(files, sink, `package-${base / 100}`, 'nested');
    await mkdir(folder, { recursive: true });
    await Promise.all(
      Array.from({ length: Math.min(100, perSink - base) }, (_, offset) =>
        writeFile(
          path.join(folder, `entry-${base + offset}.txt`),
          `Generated dependency/cache entry ${base + offset}.\n`,
          { flag: 'wx' },
        ),
      ),
    );
  }
}
expected.sort();
const insideSink = (file: string) => sinks.includes(path.relative(files, file).split(path.sep)[0]!);
const observations: object[] = [];

async function measured<T>(work: () => Promise<T>) {
  globalThis.gc?.();
  const before = process.memoryUsage();
  let peakHeap = before.heapUsed,
    peakRSS = before.rss;
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const sample = setInterval(() => {
    const memory = process.memoryUsage();
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    peakRSS = Math.max(peakRSS, memory.rss);
  }, 10);
  const start = performance.now();
  try {
    const result = await work();
    const after = process.memoryUsage();
    return {
      ...result,
      elapsedMS: performance.now() - start,
      peakHeapBytes: Math.max(peakHeap, after.heapUsed),
      peakRSSBytes: Math.max(peakRSS, after.rss),
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      eventLoopP95MS: delay.count ? delay.percentile(95) / 1e6 : null,
    };
  } finally {
    clearInterval(sample);
    delay.disable();
  }
}

async function crawl(excluded: boolean, cancel = false) {
  let complete!: (batch: SearchBatch) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const completion = new Promise<SearchBatch>((resolve, reject) => {
    complete = resolve;
    timer = setTimeout(
      () => reject(new Error('Search did not settle within 120 seconds.')),
      120000,
    );
  });
  const matches: string[] = [];
  let authorized = 0,
    sinkAuthorizations = 0,
    cancellationAt: number | undefined;
  const search = new Search(
    (batch) => {
      matches.push(...batch.entries.map((entry) => entry.path));
      if (cancel && !batch.done && cancellationAt === undefined) {
        cancellationAt = performance.now();
        search.cancel('benchmark');
      }
      if (batch.done) complete(batch);
    },
    null,
    undefined,
    async (file) => {
      authorized++;
      if (insideSink(file)) sinkAuthorizations++;
    },
    () => (excluded ? commonSearchExclusions : []),
  );
  try {
    search.start({ id: 'benchmark', root: files, query: 'needle size>0', showHidden: true });
    const batch = await completion;
    const cancellationMS = cancellationAt === undefined ? null : performance.now() - cancellationAt;
    await search.quiesce();
    assert.equal(batch.errors, 0);
    assert.equal(batch.truncated, false);
    if (excluded)
      assert.equal(sinkAuthorizations, 0, 'Never enter excluded dependency/cache trees.');
    if (cancel) assert.ok(cancellationMS !== null, 'Cancel while the traversal is still active.');
    else
      assert.deepEqual(matches.sort(), expected, 'Exclusions preserve the useful source matches.');
    return {
      phase: cancel ? 'cancellation' : 'metadata-crawl',
      excluded,
      visited: batch.visited,
      authorized,
      sinkAuthorizations,
      matches: matches.length,
      cancellationMS,
    };
  } finally {
    clearTimeout(timer);
    await search.close();
  }
}

async function content(excluded: boolean) {
  let extracted = 0,
    sinkExtractions = 0,
    bytesRead = 0;
  const index = new FileIndex(':memory:', undefined, async (file) => {
    const bytes = await readFile(file);
    extracted++;
    bytesRead += bytes.length;
    if (insideSink(file)) sinkExtractions++;
    return bytes.toString('utf8');
  });
  const settings = defaultSettings(root).search;
  settings.roots = [files];
  settings.contentRoots = [files];
  settings.exclusions = excluded ? [...commonSearchExclusions] : [];
  try {
    index.configure(settings);
    await index.settled();
    const result = index.query({
      root: files,
      query: 'needle-content-token',
      content: true,
      showHidden: true,
    });
    assert.deepEqual(result.entries.map((entry) => entry.path).sort(), expected);
    if (excluded) assert.equal(sinkExtractions, 0, 'Never extract excluded documents.');
    else
      assert.equal(
        sinkExtractions,
        sinks.length * perSink,
        'The baseline reads every generated sink file.',
      );
    return {
      phase: 'content-index',
      excluded,
      extracted,
      sinkExtractions,
      bytesRead,
      indexed: index.status().count,
      matches: result.entries.length,
    };
  } finally {
    await index.close();
  }
}

const record = async <T extends object>(work: () => Promise<T>, extra: object = {}) => {
  const observation = { ...(await measured(work)), ...extra };
  observations.push(observation);
  console.log(JSON.stringify(observation));
};
let passed = false;
try {
  // Alternate order so cache warming cannot always favor the excluded configuration.
  for (let trial = 0; trial < 3; trial++)
    for (const excluded of trial % 2 ? [true, false] : [false, true])
      await record(() => crawl(excluded), { trial });
  for (const excluded of [false, true]) await record(() => content(excluded));
  for (const excluded of [false, true]) await record(() => crawl(excluded, true));
  passed = true;
} finally {
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        passed,
        perSink,
        sinkFiles: perSink * sinks.length,
        sourceFiles: expected.length,
        observations,
        node: process.versions.node,
        forcedGC: typeof globalThis.gc === 'function',
        limits:
          'Generated local files; Spotlight disabled. Content indexing uses real reads and in-memory SQLite. RSS is this Node process, not the Viewer app or unique physical memory.',
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ passed, fixture: path.basename(root) }));
}
