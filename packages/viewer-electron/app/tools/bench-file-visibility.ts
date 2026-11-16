/** Interleaved controls use the same listing and retained files; only the native flag read differs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import type { FileVisibility } from '../src/desktop/files/visibility';
import { entryForScan as entry, entryWithVisibility, list } from '../src/desktop/files/filesystem';
import { temporaryRoot } from './temporary';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const helper = process.argv[2];
assert.ok(
  helper && path.isAbsolute(helper),
  'Pass the absolute path of a separately compiled helper.',
);
const native = createRequire(import.meta.url)(helper) as FileVisibility;
const previous: FileVisibility = { hiddenEntries: async () => [], fileHidden: async () => false };
const root = await temporaryRoot('viewer-visibility-benchmark-');
const folder = path.join(root, 'Listing');
await mkdir(folder);
const count = 20000;
for (let start = 0; start < count; start += 64)
  await Promise.all(
    Array.from({ length: Math.min(64, count - start) }, (_, offset) =>
      writeFile(path.join(folder, `File ${start + offset}.txt`), 'x', { flag: 'wx' }),
    ),
  );
const median = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
const before: number[] = [];
const after: number[] = [];
async function measure(visibility: FileVisibility, samples: number[]) {
  const started = performance.now();
  const result = await list(folder, visibility);
  samples.push(performance.now() - started);
  assert.equal(result.entries.length, count);
}
await measure(previous, []);
await measure(native, []);
for (let pass = 0; pass < 9; pass++) {
  if (pass % 2) {
    await measure(native, after);
    await measure(previous, before);
  } else {
    await measure(previous, before);
    await measure(native, after);
  }
}
const entryBefore: number[] = [];
const entryAfter: number[] = [];
const files = Array.from({ length: count }, (_, index) => path.join(folder, `File ${index}.txt`));
async function measureEntries(read: typeof entry, samples: number[]) {
  const started = performance.now();
  for (const file of files) await read(file);
  samples.push(performance.now() - started);
}
for (let pass = 0; pass < 3; pass++) {
  if (pass % 2) {
    await measureEntries(entry, entryAfter);
    await measureEntries((file) => entryWithVisibility(file, native), entryBefore);
  } else {
    await measureEntries((file) => entryWithVisibility(file, native), entryBefore);
    await measureEntries(entry, entryAfter);
  }
}
const result = {
  count,
  beforeMilliseconds: median(before),
  afterMilliseconds: median(after),
  entryBeforeMilliseconds: median(entryBefore),
  entryAfterMilliseconds: median(entryAfter),
  entrySamples: { before: entryBefore, after: entryAfter },
  samples: { before, after },
  method:
    'Warm 20,000-file filesystem.list, nine interleaved controls, empty flag reader versus native bulk attributes. Three interleaved entry() passes over the same 20,000 distinct files compare native per-item flags with metadata only.',
};
await writeFile(path.join(root, 'performance.json'), JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify({ root, ...result }, null, 2));
