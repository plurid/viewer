/** Compiles native guards against a no-op unlinkat. No files are erased. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { temporaryRoot } from '../tools/temporary';
import { ensureElectronHeaders } from '../tools/native-build/headers';
const run = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('This native guard check requires macOS.');
const created = await temporaryRoot('viewer-trash-guard-');
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
const headers = await ensureElectronHeaders({
  appRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  electronVersion: createRequire(import.meta.url)('electron/package.json').version,
  arch: process.arch,
});
await run(
  'xcrun',
  [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-O1',
    '-I',
    headers,
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
