import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FileVisibility } from '../src/desktop/files/visibility';
import { fileVisibility } from '../src/desktop/files/visibility';
import { HiddenPaths } from '../src/desktop/files/hidden-paths';
import { FileIndex } from '../src/desktop/search/index-core';
import { defaultSettings } from '../src/domain/services';
import { temporaryRoot } from './temporary';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
const [helper, label = 'sample'] = process.argv.slice(2);
assert.ok(helper && path.isAbsolute(helper));
const native = createRequire(import.meta.url)(helper) as FileVisibility;
let reads = 0;
fileVisibility.hiddenEntries = async (folder) => {
  reads++;
  return native.hiddenEntries(folder);
};
const root = await temporaryRoot('viewer-index-visibility-benchmark-');
const folder = path.join(root, 'Files');
await mkdir(folder);
const count = 20000;
for (let start = 0; start < count; start += 64)
  await Promise.all(
    Array.from({ length: Math.min(64, count - start) }, (_, offset) =>
      writeFile(path.join(folder, `File ${start + offset}.txt`), 'fixture', { flag: 'wx' }),
    ),
  );
const index = new FileIndex(':memory:');
const update = index.update.bind(index) as (
  file: string,
  removed?: boolean,
  visibility?: HiddenPaths,
) => Promise<void>;
try {
  index.configure(defaultSettings(folder).search);
  await index.settled();
  const single: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const start = performance.now();
    await update(path.join(folder, 'File 0.txt'));
    single.push(performance.now() - start);
  }
  const visibility = new HiddenPaths();
  reads = 0;
  const start = performance.now();
  for (let offset = 0; offset < 511; offset++)
    await update(path.join(folder, `File ${offset}.txt`), false, visibility);
  const batchMilliseconds = performance.now() - start;
  const result = {
    label,
    count,
    singleMilliseconds: single.toSorted((a, b) => a - b)[1],
    singleSamples: single,
    batchSize: 511,
    batchMilliseconds,
    millisecondsPerEvent: batchMilliseconds / 511,
    folderFlagReads: reads,
  };
  await writeFile(path.join(root, 'performance.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify({ root, ...result }, null, 2));
} finally {
  await index.close();
}
