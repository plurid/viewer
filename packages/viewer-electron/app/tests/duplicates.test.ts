import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { link, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Duplicates } from '../src/desktop/duplicates';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, actual: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-duplicates-');
  actual = await realpath(root);
});
afterEach(async () => {
  await trashTemporary(root);
});
// Results use canonical paths (/private/var rather than /var).
const names = (paths: readonly string[]) => paths.map((file) => path.relative(actual, file)).sort();

describe('duplicate finder', () => {
  it('groups identical files only, counting hard links once and ignoring links and empty files', async () => {
    await mkdir(path.join(root, 'a'));
    await mkdir(path.join(root, 'b'));
    const big = Buffer.alloc(200 * 1024, 7);
    await writeFile(path.join(root, 'a', 'photo.jpg'), big);
    await writeFile(path.join(root, 'b', 'photo copy.jpg'), big);
    await link(path.join(root, 'a', 'photo.jpg'), path.join(root, 'b', 'hard link.jpg'));
    // Same size and same first 64 KB, different ending.
    const nearly = Buffer.from(big);
    nearly[nearly.length - 1] = 8;
    await writeFile(path.join(root, 'b', 'edited.jpg'), nearly);
    await writeFile(path.join(root, 'a', 'note.txt'), 'same text');
    await writeFile(path.join(root, 'b', 'note.txt'), 'same text');
    await writeFile(path.join(root, 'a', 'empty'), '');
    await writeFile(path.join(root, 'b', 'empty'), '');
    await symlink(path.join(root, 'a', 'note.txt'), path.join(root, 'b', 'link.txt'));
    const duplicates = new Duplicates(async () => {});
    const result = await duplicates.run(crypto.randomUUID(), [root, path.join(root, 'a')]);
    expect(result.coverage).toBe('complete');
    expect(result.groups).toHaveLength(2);
    const [photos, notes] = result.groups;
    expect(photos.size).toBe(big.length);
    // The hard link is the same file as one of the photos, so it adds no group member.
    expect(photos.files).toHaveLength(2);
    expect(
      names(photos.files.map((file) => file.path)).some((name) => name.includes('edited')),
    ).toBe(false);
    expect(names(notes.files.map((file) => file.path))).toEqual(['a/note.txt', 'b/note.txt']);
    // Searching never changes anything.
    expect(await readFile(path.join(root, 'b', 'photo copy.jpg'))).toEqual(big);
  });
  it('can be cancelled', async () => {
    for (let index = 0; index < 50; index++)
      await writeFile(path.join(root, `copy-${index}.bin`), Buffer.alloc(64 * 1024, 1));
    const duplicates = new Duplicates(async () => {});
    const id = crypto.randomUUID();
    const running = duplicates.run(id, [root]);
    duplicates.cancel(id);
    await expect(running).rejects.toThrow();
  });
});
