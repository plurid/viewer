/**
 * Recursive watches off macOS and Windows go through chokidar: Linux's path, which the shipped app
 * never takes and which a mocked fs cannot reach. A real folder, watched as Linux would watch it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { watchDirectory, type DirectoryWatch } from '../src/desktop/files/directory-watch';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
let watch: DirectoryWatch | undefined;
beforeEach(async () => {
  root = await temporaryRoot('viewer-recursive-watch-');
});
afterEach(async () => {
  await watch?.close();
  watch = undefined;
  await trashTemporary(root);
});

/** Watching has begun once a change made now is reported. A write settles for 250 ms before it
 * is reported, so each attempt writes once and waits. */
async function ready(changed: ReturnType<typeof vi.fn>) {
  const probe = path.join(root, 'probe.txt');
  for (let attempt = 0; attempt < 8; attempt++) {
    await writeFile(probe, String(attempt));
    try {
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(probe), { timeout: 1000 });
      return;
    } catch {
      // not watching yet
    }
  }
  expect(changed).toHaveBeenCalledWith(probe);
}

it('reports nested changes, keeps ignored paths silent and closes once', async () => {
  const changed = vi.fn();
  const failed = vi.fn();
  watch = watchDirectory(root, {
    recursive: true,
    platform: 'linux',
    ignored: (file) => path.basename(file) === 'ignored.txt',
    changed,
    failed,
  });
  await ready(changed);
  await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true });
  const nested = path.join(root, 'nested', 'deeper', 'notes.txt');
  await writeFile(nested, 'A short walk.');
  await writeFile(path.join(root, 'nested', 'ignored.txt'), 'Not reported.');
  await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(nested), { timeout: 5000 });
  expect(changed.mock.calls.some(([file]) => String(file).endsWith('ignored.txt'))).toBe(false);
  expect(failed).not.toHaveBeenCalled();
  // a second close is the same close; nothing arrives after it
  const closing = [watch.close(), watch.close()];
  await Promise.all(closing);
  const calls = changed.mock.calls.length;
  await writeFile(nested, 'Changed after close.');
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(changed).toHaveBeenCalledTimes(calls);
});
