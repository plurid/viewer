import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { FileVisibility } from '../../src/desktop/files/visibility';
import { entryWithVisibility as entry, list } from '../../src/desktop/files/filesystem';
import { temporaryRoot } from '../../tools/temporary';
import { needsFolderAccess } from '../../src/domain/files/access';
import type { GuestACL } from '../../src/desktop/files/network-sharing';
import type { NativeSharingMount } from '../../src/desktop/native/macos-files';
import { NetworkSharing, sharingFolder } from '../../src/desktop/files/network-sharing';
import { fileVisibility } from '../../src/desktop/files/visibility';
import { entry as singleEntry, entryForScan } from '../../src/desktop/files/filesystem';

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
const visibility = createRequire(import.meta.url)(helper) as FileVisibility & {
  guestACL(file: string): Promise<GuestACL>;
  sharingMounts(): NativeSharingMount[];
};
assert.ok(visibility.sharingMounts().some((mount) => mount.path === '/' && mount.local));
const folder = path.join(root, 'Files');
await mkdir(folder);
for (const name of ['hidden by flag.txt', '.dot-file', 'Thumbs.db', 'visible 日本.txt'])
  await writeFile(path.join(folder, name), 'fixture', { flag: 'wx' });
execFileSync('/usr/bin/chflags', ['hidden', path.join(folder, 'hidden by flag.txt')]);
assert.equal(await visibility.fileHidden(path.join(folder, 'hidden by flag.txt')), true);
fileVisibility.fileHidden = (file) => visibility.fileHidden(file);
assert.equal((await singleEntry(path.join(folder, 'hidden by flag.txt'))).hidden, true);
assert.equal((await entryForScan(path.join(folder, 'hidden by flag.txt'))).hidden, false);
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
  try {
    await readdir(system);
  } catch {
    continue;
  }
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
await assert.rejects(list(denied, visibility), (error: NodeJS.ErrnoException) =>
  needsFolderAccess(error.code),
);
await assert.rejects(visibility.hiddenEntries(denied), (error: NodeJS.ErrnoException) =>
  needsFolderAccess(error.code),
);
await chmod(denied, 0o700);
let protectedCode: string | undefined;
for (const protectedFolder of [
  '/private/var/db/dslocal/nodes/Default',
  '/Library/Application Support/com.apple.TCC',
]) {
  try {
    await readdir(protectedFolder);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (needsFolderAccess(code)) {
      await assert.rejects(
        list(protectedFolder, visibility),
        (cause: NodeJS.ErrnoException) => cause.code === code,
      );
      protectedCode = code;
      break;
    }
  }
}
assert.ok(protectedCode, 'A protected macOS folder must preserve its native permission error.');
const aclFolder = path.join(root, 'ACL');
await mkdir(aclFolder, { mode: 0o755 });
let sharePath = aclFolder;
const sharing = new NetworkSharing({
  available: true,
  folder: sharingFolder,
  addresses: () => [],
  acl: (file) => visibility.guestACL(file),
  run: async (read) => ({
    ok: true,
    stderr: '',
    stdout:
      read === 'shares'
        ? JSON.stringify({
            Fixture: {
              path: sharePath,
              smb_name: 'Fixture',
              smb_shared: 1,
              smb_guest_access: 1,
              smb_read_only: 0,
            },
          })
        : '',
  }),
});
assert.equal(await visibility.guestACL(aclFolder), 'none');
assert.equal((await sharing.refresh(true)).shares[0]?.guestWritable, false);
await chmod(aclFolder, 0o777);
assert.equal((await sharing.refresh(true)).shares[0]?.guestWritable, true);
await chmod(aclFolder, 0o755);
execFileSync('/bin/chmod', [
  '+a',
  'everyone allow add_file,add_subdirectory,delete_child',
  aclFolder,
]);
assert.equal(await visibility.guestACL(aclFolder), 'write');
assert.equal((await sharing.refresh(true)).shares[0]?.guestWritable, true);
assert.equal(await visibility.guestACL(path.join(root, 'Missing ACL')), 'unreadable');
sharePath = path.join(root, 'Unreadable ACL');
await mkdir(sharePath, { mode: 0o755 });
execFileSync('/bin/chmod', ['+a', 'everyone deny readsecurity', sharePath]);
assert.equal(await visibility.guestACL(sharePath), 'unreadable');
// A blocked share does not obscure other folders, but this folder must remain unknown.
assert.equal((await sharing.inspect([sharePath], true)).folders?.[0]?.status, 'unknown');
for (const right of [
  'add_file',
  'add_subdirectory',
  'delete_child',
  'delete',
  'writeattr',
  'writeextattr',
  'writesecurity',
  'chown',
]) {
  const target = path.join(root, 'Everyone ' + right);
  await mkdir(target, { mode: 0o755 });
  execFileSync('/bin/chmod', ['+a', 'everyone allow ' + right, target]);
  assert.equal(await visibility.guestACL(target), 'write', right);
}
for (const [label, principal] of [
  ['staff', 'group:staff'],
  ['specific-user', 'user:' + userInfo().username],
  ['guest', 'user:nobody'],
  ['guest-group', 'group:nobody'],
  ['guest-account-group', 'group:_guest'],
]) {
  const target = path.join(root, 'Principal ' + label);
  await mkdir(target, { mode: 0o755 });
  execFileSync('/bin/chmod', ['+a', principal + ' allow add_file', target]);
  const access = await visibility.guestACL(target);
  if (label === 'staff') {
    // Directory services can leave the absent Guest account's nested membership unresolved.
    assert.ok(access === 'none' || access === 'unknown', label);
  } else assert.equal(access, label.startsWith('guest') ? 'write' : 'none', label);
}
const permissionsSource = path.join(root, 'guest-permissions.mm');
const permissionsExecutable = path.join(root, 'guest-permissions');
await writeFile(
  permissionsSource,
  String.raw`
#include "guest-access.h"
#include <cerrno>
static int nested(uid_t, gid_t, int *member) { *member = 1; return 0; }
static int unrelated(uid_t, gid_t, int *member) { *member = 0; return 0; }
static int unavailable(uid_t, gid_t, int *) { return ENOENT; }
int main(int count, char **args) {
  @autoreleasepool {
    if (count != 2) return 1;
    NSString *file = [NSString stringWithUTF8String:args[1]];
    struct stat info{};
    if (stat(args[1], &info)) return 2;
    info.st_mode = S_IFDIR | 0555;
    uid_t owner = info.st_uid;
    info.st_uid = (uid_t)-2;
    if (![guestACLState(file, &info, unrelated) isEqualToString:@"write"]) return 3;
    info.st_uid = 201;
    if (![guestACLState(file, &info, unrelated) isEqualToString:@"write"]) return 4;
    info.st_uid = owner;
    if (![guestACLState(file, &info, nested) isEqualToString:@"write"]) return 5;
    if (![guestACLState(file, &info, unrelated) isEqualToString:@"none"]) return 6;
    if (![guestACLState(file, &info, unavailable) isEqualToString:@"unknown"]) return 7;
    return 0;
  }
}
`,
  { flag: 'wx' },
);
execFileSync('/usr/bin/xcrun', [
  'clang++',
  '-std=c++17',
  '-fobjc-arc',
  '-framework',
  'Foundation',
  '-I',
  path.join(app, 'tools'),
  permissionsSource,
  '-o',
  permissionsExecutable,
]);
execFileSync(permissionsExecutable, [path.join(root, 'Principal staff')]);
// chmod requires a live account name, so create the reserved Guest ACL with the native API.
const guestFixtureSource = path.join(root, 'guest-acl-fixture.cc');
const guestFixture = path.join(root, 'guest-acl-fixture');
await writeFile(
  guestFixtureSource,
  String.raw`
#include <sys/acl.h>
#include <uuid/uuid.h>
#include <membership.h>
int main(int count, char **args) {
  if (count != 2) return 1;
  uuid_t user;
  if (mbr_uid_to_uuid(201, user) != 0 && uuid_parse("FFFFEEEE-DDDD-CCCC-BBBB-AAAA000000C9", user) != 0) return 2;
  acl_t acl = acl_init(1);
  acl_entry_t entry;
  acl_permset_t permissions;
  if (acl_create_entry(&acl, &entry) || acl_set_tag_type(entry, ACL_EXTENDED_ALLOW) ||
      acl_set_qualifier(entry, user) || acl_get_permset(entry, &permissions) ||
      acl_add_perm(permissions, ACL_ADD_FILE) || acl_set_permset(entry, permissions)) return 3;
  int result = acl_set_file(args[1], ACL_TYPE_EXTENDED, acl);
  acl_free(acl);
  return result ? 4 : 0;
}
`,
  { flag: 'wx' },
);
execFileSync('/usr/bin/xcrun', ['clang++', guestFixtureSource, '-o', guestFixture]);
const accountFolder = path.join(root, 'Guest account');
await mkdir(accountFolder, { mode: 0o755 });
execFileSync(guestFixture, [accountFolder]);
assert.equal(await visibility.guestACL(accountFolder), 'write');
const groupFolder = path.join(root, 'Guest group');
await mkdir(groupFolder, { mode: 0o775 });
execFileSync('/usr/bin/chgrp', ['everyone', groupFolder]);
await chmod(groupFolder, 0o775);
assert.equal(await visibility.guestACL(groupFolder), 'write');
for (const [name, entries, expected] of [
  ['Deny before allow', ['everyone deny add_file', 'everyone allow add_file'], 'none'],
  ['Allow before deny', ['everyone allow add_file', 'everyone deny add_file'], 'write'],
  ['Inherit only', ['everyone allow add_file,file_inherit,directory_inherit,only_inherit'], 'none'],
  ['Different right', ['everyone deny add_file', 'everyone allow writeattr'], 'write'],
] as const) {
  const target = path.join(root, name);
  await mkdir(target, { mode: 0o755 });
  entries.forEach((entry, index) =>
    execFileSync('/bin/chmod', ['+a#', String(index), entry, target]),
  );
  assert.equal(await visibility.guestACL(target), expected, name);
}
sharePath = path.join(root, 'Mode denied by ACL');
await mkdir(sharePath, { mode: 0o777 });
await chmod(sharePath, 0o777);
execFileSync('/bin/chmod', [
  '+a',
  'everyone deny add_file,add_subdirectory,delete_child,delete,writeattr,writeextattr,writesecurity,chown',
  sharePath,
]);
assert.equal(await visibility.guestACL(sharePath), 'none');
assert.equal((await sharing.refresh(true)).shares[0]?.guestWritable, false);
console.log(
  JSON.stringify(
    {
      root,
      helper,
      checks:
        'Hidden flags, permission codes, kernel mount snapshot, nobody and Guest ownership without write bits, nested and unresolved group membership, guest ACL grants, ordered ACLs and inherit-only checks passed',
    },
    null,
    2,
  ),
);
