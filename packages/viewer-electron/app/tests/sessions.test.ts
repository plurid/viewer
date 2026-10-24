import { it, expect, beforeEach } from 'vitest';
import { pathMapper } from '../src/domain/files/changes';
import {
  browseSession,
  clearSessions,
  remapSessions,
  selectedFiles,
  rootOwners,
} from '../src/renderer/workspace/sessions';
import type { FileEntry } from '../src/domain/contracts';
beforeEach(clearSessions);
it('remaps a simultaneous batch by the longest owning path and preserves boundaries', () => {
  const map = pathMapper([
    { source: '/Books', destination: '/Library' },
    { source: '/Books/A.epub', destination: '/Books/B.epub' },
    { source: '/Books/B.epub', destination: '/Books/A.epub' },
  ]);
  expect(map('/Books/A.epub')).toBe('/Books/B.epub');
  expect(map('/Books/B.epub')).toBe('/Books/A.epub');
  expect(map('/Books/Sub/A.epub')).toBe('/Library/Sub/A.epub');
  expect(map('/Bookshelf/A.epub')).toBe('/Bookshelf/A.epub');
});
it('keeps independent selections and filters across detachment and an owned directory rename', () => {
  const one = browseSession('one', '/Books'),
    two = browseSession('two', '/Books');
  const file = { path: '/Books/A.epub', parent: '/Books', name: 'A.epub' } as FileEntry;
  one.selection = [file.path];
  one.cache.set(file.path, file);
  one.query = 'Fire';
  one.scroll = { list: 170 };
  one.columnScroll.set('/Books/Chapter', 50);
  one.columnTrail = ['/Books/Chapter'];
  one.columnScope = '/Books/Chapter';
  one.columnDirectory = '/Books/Chapter';
  expect(browseSession('one', '/Books')).toBe(one);
  expect(two.selection).toEqual([]);
  expect(two.columnScope).toBe('/Books');
  remapSessions([{ source: '/Books', destination: '/Library' }]);
  expect(browseSession('one', '/Library')).toBe(one);
  expect(one.query).toBe('Fire');
  expect(one.scroll).toEqual({ list: 170 });
  expect(one.columnScroll.get('/Library/Chapter')).toBe(50);
  expect(one.columnTrail).toEqual(['/Library/Chapter']);
  expect(one.columnScope).toBe('/Library/Chapter');
  expect(one.columnDirectory).toBe('/Library/Chapter');
  expect(selectedFiles('one')[0]).toMatchObject({ path: '/Library/A.epub', parent: '/Library' });
  expect(browseSession('one', '/Another').selection).toEqual([]);
});
it('uses live root ownership and retains only pending ownership outside the live tree', () => {
  const tree = [
    { id: 'one', children: [{ id: 'image-a' }] },
    { id: 'two', children: [{ id: 'image-b' }] },
  ];
  type Node = { id: string; children?: Node[] };
  const owners = rootOwners<Node>(
    tree,
    (node) => node.id,
    ['one', 'two'],
    new Map([
      ['image-b', 'one'],
      ['pending', 'two'],
    ]),
  );
  expect(owners.get('image-a')).toBe('one');
  expect(owners.get('image-b')).toBe('two');
  expect(owners.get('pending')).toBe('two');
});
it('retains the cache used by mounted column selection handlers after a file change', () => {
  const session = browseSession('folder', '/Studio');
  const selectionCache = session.cache;
  remapSessions([{ source: '/Studio/README.md', destination: '/Studio/Notes.md' }]);
  const child = {
    path: '/Studio/Documents/Project notes.md',
    parent: '/Studio/Documents',
    name: 'Project notes.md',
  } as FileEntry;
  // A memoized column click handler writes through the cache it captured.
  selectionCache.set(child.path, child);
  session.selection = [child.path];
  expect(selectedFiles('folder')).toEqual([child]);
  remapSessions([{ source: '/Studio/Documents', destination: '/Studio/Projects' }]);
  expect(session.cache).toBe(selectionCache);
  expect(selectionCache.has(child.path)).toBe(false);
  expect(selectedFiles('folder')[0].path).toBe('/Studio/Projects/Project notes.md');
});
