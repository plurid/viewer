/** Compiles native guards against a no-op unlinkat. No files are erased. */
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
const run = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('This native guard check requires macOS.');
const created = await mkdtemp(path.join(os.tmpdir(), 'viewer-trash-guard-'));
const root = await realpath(created),
  trash = path.join(root, '.Trash');
await mkdir(trash, { mode: 0o700 });
await mkdir(path.join(trash, 'Nested'), { mode: 0o700 });
await writeFile(path.join(trash, 'Nested', 'Unicode-ș.txt'), 'Generated nested content');
await writeFile(path.join(trash, 'Notes.txt'), 'Generated note');
await mkdir(path.join(root, 'Documents'), { mode: 0o700 });
const outside = path.join(root, 'Documents', 'Precious.txt');
await writeFile(outside, 'Generated external sentinel — must remain unchanged');
await symlink(path.join(root, 'Documents'), path.join(trash, 'Documents link'));
const before = await readFile(outside);
const binary = path.join(root, 'guard-test');
await run(
  'xcrun',
  [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-O1',
    '-I',
    path.join(os.homedir(), '.electron-gyp', '44.7.0', 'include/node'),
    '-framework',
    'Foundation',
    '-framework',
    'AppKit',
    'tools/trash-guard-test.mm',
    '-o',
    binary,
  ],
  { maxBuffer: 1024 * 1024 },
);
const result = await run(binary, [root]);
assert.match(result.stdout, /PASS 13 native guard checks/);
assert.deepEqual(await readFile(outside), before);
assert.equal(await readFile(path.join(trash, 'Notes.txt'), 'utf8'), 'Generated note');
assert.equal(
  await readFile(path.join(root, 'MovedOutsideTrash', 'Unicode-ș.txt'), 'utf8'),
  'Generated nested content',
);
console.log(result.stdout.trim());
console.log('Generated fixtures and test binary preserved:', root);
