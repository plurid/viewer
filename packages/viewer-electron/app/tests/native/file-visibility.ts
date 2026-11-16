import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileVisibility } from '../../src/desktop/files/visibility';
import { entryWithVisibility as entry, list } from '../../src/desktop/files/filesystem';
import { temporaryRoot } from '../../tools/temporary';
import { needsFolderAccess } from '../../src/domain/files/access';
import type { GuestACL } from '../../src/desktop/files/network-sharing';

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
const visibility = createRequire(import.meta.url)(helper) as FileVisibility & { guestACL(file: string): Promise<GuestACL> };
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
for (const system of ['/Library/Caches', '/private/var/db']) {
  try { await readdir(system); }
  catch { continue; }
  assert.ok((await list(system, visibility)).entries.length > 0);
}
const readable = path.join(root, 'Read only');
await mkdir(readable);
await writeFile(path.join(readable, 'File'), 'fixture');
await chmod(readable, 0o444);
assert.equal((await list(readable, visibility)).entries.length, 1);
await chmod(readable, 0o700);
const denied = path.join(root, 'Denied');
await mkdir(denied);
await chmod(denied, 0);
await assert.rejects(list(denied, visibility), (error: NodeJS.ErrnoException) => needsFolderAccess(error.code));
await assert.rejects(visibility.hiddenEntries(denied), (error: NodeJS.ErrnoException) => needsFolderAccess(error.code));
await chmod(denied, 0o700);
let protectedCode: string | undefined;
for (const protectedFolder of ['/private/var/db/dslocal/nodes/Default', '/Library/Application Support/com.apple.TCC']) {
  try { await readdir(protectedFolder); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (needsFolderAccess(code)) {
      await assert.rejects(list(protectedFolder, visibility), (cause: NodeJS.ErrnoException) => cause.code === code);
      protectedCode = code;
      break;
    }
  }
}
assert.ok(protectedCode, 'A protected macOS folder must preserve its native permission error.');
const aclFolder = path.join(root, 'ACL');
await mkdir(aclFolder, { mode: 0o755 });
assert.equal(await visibility.guestACL(aclFolder), 'none');
execFileSync('/bin/chmod', ['+a', 'everyone allow add_file,add_subdirectory,delete_child', aclFolder]);
assert.equal(await visibility.guestACL(aclFolder), 'write');
assert.equal(await visibility.guestACL(path.join(root, 'Missing ACL')), 'unknown');
console.log(
  JSON.stringify(
    {
      root,
      helper,
      checks: 'UF_HIDDEN, dot rule, literal Thumbs.db, flag removal, readable system folders, mode 444, mode 000, protected folder permission codes and ACL grants passed',
    },
    null,
    2,
  ),
);
