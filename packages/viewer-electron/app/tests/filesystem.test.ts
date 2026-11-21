import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { absolute, entry, list, validName } from '../src/desktop/files/filesystem';
import { selectedRange, sortEntries } from '../src/domain/files/entries';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-fs-');
});
afterEach(async () => {
  await chmod(root, 0o700);
  await trashTemporary(root);
});
describe('local files', () => {
  it('preserves Unicode names, hidden files, and stable file identities', async () => {
    await writeFile(path.join(root, 'résumé_日本.json'), '{}');
    await writeFile(path.join(root, '.hidden'), 'secret');
    const listing = await list(root);
    const file = listing.entries.find((item) => !item.hidden)!;
    expect(file.name).toBe('résumé_日本.json');
    expect(file.extension).toBe('json');
    expect(file.mime).toContain('json');
    expect(file.identity).toMatch(/\d+:\d+/);
    expect(listing.entries.find((item) => item.hidden)?.name).toBe('.hidden');
  });
  it('reports directory symlinks and broken links without recursing', async () => {
    await mkdir(path.join(root, 'folder'));
    await symlink('folder', path.join(root, 'alias'));
    await symlink('gone', path.join(root, 'broken'));
    expect(await entry(path.join(root, 'alias'))).toMatchObject({
      kind: 'symlink',
      directory: true,
      linkTarget: 'folder',
    });
    expect((await entry(path.join(root, 'broken'))).error).toBeTruthy();
    expect((await list(root)).entries).toHaveLength(3);
  });
  it('rejects invalid names and relative paths', () => {
    expect(() => absolute('../file')).toThrow();
    for (const name of ['', '.', '..', 'a/b', 'a\0b']) expect(() => validName(name)).toThrow();
  });
  it('keeps folders first and applies natural sorting and path-based ranges', async () => {
    await mkdir(path.join(root, 'z-folder'));
    for (const name of ['file10.txt', 'file2.txt', 'file1.txt'])
      await writeFile(path.join(root, name), name);
    const sorted = sortEntries((await list(root)).entries, 'name', false);
    expect(sorted.map((item) => item.name)).toEqual([
      'z-folder',
      'file1.txt',
      'file2.txt',
      'file10.txt',
    ]);
    expect(selectedRange(sorted, sorted[1].path, sorted[3].path)).toEqual(
      sorted.slice(1).map((item) => item.path),
    );
  });
  it('returns a useful failure for inaccessible folders', async () => {
    await chmod(root, 0);
    await expect(list(root)).rejects.toMatchObject({ code: 'EACCES' });
  });
  it('gives collation-equal names a deterministic order that reverses when descending', () => {
    const make = (name: string) => ({
      path: `/fixtures/${name}`,
      parent: '/fixtures',
      name,
      directory: false,
      kind: 'file' as const,
      extension: name.split('.').pop() ?? '',
      size: 10,
      created: 0,
      modified: 0,
      hidden: false,
      mime: 'application/octet-stream',
      identity: name,
    });
    for (const [first, second] of [
      ['1.png', '01.png'],
      ['a.txt', 'A.txt'],
      ['resume.pdf', 'résumé.pdf'],
    ]) {
      const a = make(first);
      const b = make(second);
      const ascFromAB = sortEntries([a, b], 'name', false).map((item) => item.name);
      const ascFromBA = sortEntries([b, a], 'name', false).map((item) => item.name);
      const descFromAB = sortEntries([a, b], 'name', true).map((item) => item.name);
      const descFromBA = sortEntries([b, a], 'name', true).map((item) => item.name);
      expect(ascFromAB).toEqual(ascFromBA);
      expect(descFromAB).toEqual(descFromBA);
      expect(descFromAB).toEqual([...ascFromAB].reverse());
    }
  });
});
