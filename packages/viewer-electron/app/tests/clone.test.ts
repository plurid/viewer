/**
 * Release and acceptance tools keep copies of the app. A clone shares the original's disk blocks,
 * so a kept copy costs megabytes, not 900 MB; it must still be the same tree a copy would be.
 */
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assertOutsideSeed, cloneTree, cloneWithSpeechRuntime } from '../tools/clone';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-clone-');
});
afterEach(async () => {
  await trashTemporary(root);
});

async function sample(): Promise<string> {
  const source = path.join(root, 'Viewer.app');
  await mkdir(path.join(source, 'Contents/Resources'), { recursive: true });
  await writeFile(path.join(source, 'Contents/Info.plist'), '<plist/>');
  await writeFile(path.join(source, 'Contents/Resources/engine.wasm'), Buffer.alloc(64 * 1024, 7));
  await symlink('Resources/engine.wasm', path.join(source, 'Contents/engine'));
  return source;
}

it('builds with the prepared speech runtime while preserving the entire seed', async () => {
  const seed = await sample();
  const current = path.join(root, 'assets', 'viewer-speech-v1-darwin-arm64');
  const retained = path.join(seed, 'Contents/Resources', path.basename(current));
  await mkdir(current, { recursive: true });
  await mkdir(retained);
  await writeFile(path.join(retained, 'manifest.json'), '{"version":1}');
  await writeFile(path.join(retained, 'old-only'), 'seed');
  await writeFile(path.join(current, 'manifest.json'), '{"helperHash":"new"}');
  const output = path.join(root, 'new.app');
  await cloneWithSpeechRuntime(seed, output, current);
  const runtime = path.join(output, 'Contents/Resources', path.basename(current));
  expect(await readFile(path.join(runtime, 'manifest.json'), 'utf8')).toBe('{"helperHash":"new"}');
  await expect(lstat(path.join(runtime, 'old-only'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(retained, 'manifest.json'), 'utf8')).toBe('{"version":1}');
  expect(await readFile(path.join(retained, 'old-only'), 'utf8')).toBe('seed');
  expect(await readlink(path.join(output, 'Contents/engine'))).toBe('Resources/engine.wasm');
});

it('refuses a new output inside the seed through a parent alias', async () => {
  const seed = await sample();
  const alias = path.join(root, 'alias');
  await symlink(seed, alias);
  await expect(assertOutsideSeed(seed, path.join(alias, 'new', 'Viewer.app'))).rejects.toThrow(
    'outside',
  );
  await expect(lstat(path.join(seed, 'new'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('makes the same tree, with links kept as links', async () => {
  const source = await sample();
  const target = path.join(root, 'Copy.app');
  await cloneTree(source, target);
  expect(await readFile(path.join(target, 'Contents/Info.plist'), 'utf8')).toBe('<plist/>');
  expect(await readFile(path.join(target, 'Contents/Resources/engine.wasm'))).toEqual(
    Buffer.alloc(64 * 1024, 7),
  );
  expect((await lstat(path.join(target, 'Contents/engine'))).isSymbolicLink()).toBe(true);
  expect(await readlink(path.join(target, 'Contents/engine'))).toBe('Resources/engine.wasm');
  // a change to the clone leaves the original as it was
  await writeFile(path.join(target, 'Contents/Info.plist'), '<plist>signed</plist>');
  expect(await readFile(path.join(source, 'Contents/Info.plist'), 'utf8')).toBe('<plist/>');
});

it('makes the target’s missing parent folders', async () => {
  const source = await sample();
  const target = path.join(root, 'build', 'node_modules', 'Viewer.app');
  await cloneTree(source, target);
  expect(await readFile(path.join(target, 'Contents/Info.plist'), 'utf8')).toBe('<plist/>');
});

it('never writes into an existing target', async () => {
  const source = await sample();
  const target = path.join(root, 'Existing.app');
  await mkdir(target);
  await expect(cloneTree(source, target)).rejects.toMatchObject({ code: 'EEXIST' });
  await expect(lstat(path.join(target, 'Viewer.app'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.runIf(process.platform === 'darwin')(
  'leaves out extended attributes, which code signing refuses on bundle files',
  async () => {
    const source = await sample();
    const file = path.join(source, 'Contents/Info.plist');
    execFileSync('/usr/bin/xattr', ['-w', 'com.example.note', 'detritus', file]);
    const target = path.join(root, 'Signed.app');
    await cloneTree(source, target);
    const names = execFileSync('/usr/bin/xattr', [path.join(target, 'Contents/Info.plist')], {
      encoding: 'utf8',
    });
    expect(names).not.toContain('com.example.note');
  },
);
