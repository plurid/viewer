/** Retained fixtures and reproducible identity costs; no cleanup or operating-system Trash. */
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileStats } from '../src/desktop/files/stats';
import type { FileStats } from '../src/desktop/files/stats';
import { entry, list } from '../src/desktop/files/filesystem';
import { indexEntries, reconcileSelection } from '../src/domain/files/entries';
import { temporaryRoot, adoptRetainedNativeFixture } from './temporary';
import type * as StatsModule from '../src/desktop/files/stats';
import type * as FileSystemModule from '../src/desktop/files/filesystem';
import type * as EntriesModule from '../src/domain/files/entries';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const collect = (globalThis as { gc?: () => void }).gc;
assert.ok(collect, 'Run this benchmark with node --expose-gc.');
const reuse = process.argv[2];
const root = reuse ? await realpath(reuse) : await temporaryRoot('viewer-identity-benchmark-');
if (reuse) adoptRetainedNativeFixture(root);
const folder = path.join(root, 'Listing');
if (!reuse) await mkdir(folder);
const count = 20000;
for (let start = 0; !reuse && start < count; start += 64)
  await Promise.all(
    Array.from({ length: Math.min(64, count - start) }, (_, offset) =>
      writeFile(path.join(folder, `File ${start + offset}.txt`), 'x', { flag: 'wx' }),
    ),
  );

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const numeric = await lstat(path.join(folder, 'File 0.txt'));
const source = await lstat(path.join(folder, 'File 0.txt'), { bigint: true });
const app = fileURLToPath(new URL('..', import.meta.url));
const baseline = process.env.VIEWER_BENCH_BASE ?? 'HEAD';
const committed = (file: string) =>
  execFileSync('git', ['show', baseline + ':packages/viewer-electron/app/' + file], {
    cwd: app,
    encoding: 'utf8',
  });
function moduleFrom<T>(
  file: string,
  source: string,
  substitutions = new Map<string, unknown>(),
): T {
  const require = createRequire(path.join(app, file));
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  // Both controls run the same listing implementation; only the stat converter changes.
  new Function('module', 'exports', 'require', code)(
    module,
    module.exports,
    (name: string) => substitutions.get(name) ?? require(name),
  );
  return module.exports as T;
}
const previousStats = moduleFrom<typeof StatsModule>(
  'src/desktop/files/stats.ts',
  committed('src/desktop/files/stats.ts'),
);
const filesystemText = await readFile(path.join(app, 'src/desktop/files/filesystem.ts'), 'utf8');
const previousFilesystem = moduleFrom<typeof FileSystemModule>(
  'src/desktop/files/filesystem.ts',
  filesystemText,
  new Map([['./stats', previousStats]]),
);
const previousEntries = moduleFrom<typeof EntriesModule>(
  'src/domain/files/entries.ts',
  committed('src/domain/files/entries.ts'),
);
const samples = Array.from({ length: 1024 }, (_, index) => ({ ...source, ino: BigInt(index + 1) }));
let snapshot: FileStats | undefined;
const costs: number[] = [];
for (let pass = 0; pass < 6; pass++) {
  const started = performance.now();
  for (let index = 0; index < 200000; index++)
    snapshot = fileStats(samples[index % samples.length]!);
  if (pass) costs.push(((performance.now() - started) * 1000) / 200000);
}
assert.ok(snapshot?.isFile());

await list(folder);
const listings: number[] = [];
const previousListings: number[] = [];
for (let pass = 0; pass < 5; pass++) {
  collect();
  const started = performance.now();
  const listing = await list(folder);
  listings.push(performance.now() - started);
  assert.equal(listing.entries.length, count);
  collect();
  const previousStart = performance.now();
  assert.equal((await previousFilesystem.list(folder)).entries.length, count);
  previousListings.push(performance.now() - previousStart);
}

const retainedCount = 100000;
collect();
const before = process.memoryUsage().heapUsed;
const retained = Array.from({ length: retainedCount }, (_, index) =>
  fileStats({ ...source, ino: BigInt(index + 1) }),
);
collect();
const retainedStatsBytes = (process.memoryUsage().heapUsed - before) / retainedCount;
assert.equal(retained.at(-1)?.size, numeric.size);

const base = await entry(path.join(folder, 'File 0.txt'));
const entries = Array.from({ length: 100000 }, (_, index) => ({
  ...base,
  path: path.join(folder, `Indexed ${index}.txt`),
  identity: `1:${index + 1}`,
}));
for (let warm = 0; warm < 3; warm++) indexEntries(entries);
const indexes: number[] = [];
const previousIndexes: number[] = [];
for (let pass = 0; pass < 7; pass++) {
  collect();
  const started = performance.now();
  const indexed = indexEntries(entries);
  indexes.push(performance.now() - started);
  assert.equal(indexed.paths.size, entries.length);
  collect();
  const previousStart = performance.now();
  assert.equal(previousEntries.indexEntries(entries).paths.size, entries.length);
  previousIndexes.push(performance.now() - previousStart);
}
const selected = entries.slice(0, 20000);
const selectedPaths = selected.map((item) => item.path);
const refreshed = indexEntries(selected.map((item) => ({ ...item })));
const refreshes: number[] = [];
const previousRefreshes: number[] = [];
for (let pass = 0; pass < 12; pass++) {
  const cache = new Map(selected.map((item) => [item.path, item]));
  const previousCache = new Map(cache);
  const started = performance.now();
  assert.equal(reconcileSelection(selectedPaths, cache, folder, refreshed).length, selected.length);
  const elapsed = performance.now() - started;
  const previousStart = performance.now();
  assert.equal(
    previousEntries.reconcileSelection(selectedPaths, previousCache, folder, refreshed).length,
    selected.length,
  );
  if (pass >= 3) {
    refreshes.push(elapsed);
    previousRefreshes.push(performance.now() - previousStart);
  }
}
const result = {
  baseline,
  conversionMicroseconds: median(costs),
  listing20000Milliseconds: median(listings),
  retainedStatsBytes,
  index100000Milliseconds: median(indexes),
  selectAllRefresh20000Milliseconds: median(refreshes),
  controls: {
    previousListingMilliseconds: median(previousListings),
    previousIndexMilliseconds: median(previousIndexes),
    previousRefresh20000Milliseconds: median(previousRefreshes),
  },
  samples: {
    costs,
    listings,
    indexes,
    previousListings,
    previousIndexes,
    refreshes,
    previousRefreshes,
  },
  method:
    'Warm filesystem.list over 20,000 real files; retained snapshots include array storage and unique inode BigInts; indexEntries over 100,000 distinct rows.',
};
await writeFile(
  path.join(root, `performance-${randomUUID()}.json`),
  JSON.stringify(result, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ root, ...result }, null, 2));
