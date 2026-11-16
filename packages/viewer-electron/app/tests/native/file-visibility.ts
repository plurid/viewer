import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileVisibility } from '../../src/desktop/files/visibility';
import { entryWithVisibility as entry, list } from '../../src/desktop/files/filesystem';
import { temporaryRoot } from '../../tools/temporary';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.platform, 'darwin');
const root = await temporaryRoot('viewer-native-visibility-');
const app = fileURLToPath(new URL('../..', import.meta.url));
const helper = path.join(root, 'viewer-macos-files.node');
const headers = path.resolve(path.dirname(process.execPath), '../include/node');
execFileSync('/usr/bin/xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-I',
  headers,
  '-framework',
  'Foundation',
  '-framework',
  'AppKit',
  '-framework',
  'Quartz',
  '-framework',
  'Security',
  path.join(app, 'tools/macos-files.mm'),
  '-o',
  helper,
]);
const visibility = createRequire(import.meta.url)(helper) as FileVisibility;
const folder = path.join(root, 'Files');
await mkdir(folder);
for (const name of ['hidden by flag.txt', '.dot-file', 'Thumbs.db', 'visible 日本.txt'])
  await writeFile(path.join(folder, name), 'fixture', { flag: 'wx' });
execFileSync('/usr/bin/chflags', ['hidden', path.join(folder, 'hidden by flag.txt')]);
assert.equal(await visibility.fileHidden(path.join(folder, 'hidden by flag.txt')), true);
assert.equal(await visibility.fileHidden(path.join(folder, 'Thumbs.db')), false);
assert.deepEqual(await visibility.hiddenEntries(folder), ['hidden by flag.txt']);
assert.equal((await entry(path.join(folder, 'hidden by flag.txt'), visibility)).hidden, true);
const listing = await list(folder, visibility);
assert.equal(listing.entries.find((item) => item.name === '.dot-file')?.hidden, true);
assert.equal(listing.entries.find((item) => item.name === 'Thumbs.db')?.hidden, false);
assert.deepEqual(
  listing.entries
    .filter((item) => !item.hidden)
    .map((item) => item.name)
    .sort(),
  ['Thumbs.db', 'visible 日本.txt'],
);
assert.equal(listing.entries.length, 4);
execFileSync('/usr/bin/chflags', ['nohidden', path.join(folder, 'hidden by flag.txt')]);
assert.equal((await entry(path.join(folder, 'hidden by flag.txt'), visibility)).hidden, false);
assert.deepEqual(await visibility.hiddenEntries(folder), []);
await assert.rejects(visibility.hiddenEntries(path.join(root, 'Missing')));
console.log(
  JSON.stringify(
    {
      root,
      helper,
      checks: 'UF_HIDDEN, dot rule, literal Thumbs.db, flag removal and missing folder passed',
    },
    null,
    2,
  ),
);
