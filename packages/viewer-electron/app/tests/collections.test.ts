import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { FileIndex } from '../src/desktop/index-core';
import type { FileEntry } from '../src/domain/contracts';
import { entry } from '../src/desktop/filesystem';
import { collectionSchema, basketItemSchema } from '../src/domain/collections';
import { sourceVersion } from '../src/domain/inspection';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
describe('cross-page collection snapshots', () => {
  it('captures every indexed match beyond the visible page and rejects oversized snapshots without returning a partial selection', async () => {
    const root = await temporaryRoot('viewer-query-snapshot-');
    const index = new FileIndex(':memory:');
    try {
      index.configure({ roots: [root], contentRoots: [], exclusions: [], paused: false });
      await index.settled();
      const base = await entry(root);
      const items = Array.from({ length: 1200 }, (_, number): FileEntry => ({
        ...base,
        path: path.join(root, 'Match ' + number + '.txt'),
        name: 'Match ' + number + '.txt',
        parent: root,
        kind: 'file',
        directory: false,
        extension: 'txt',
      }));
      index.ingest(items, root);
      expect(index.query({ root, query: 'Match' }).entries).toHaveLength(150);
      const snapshot = index.snapshot({ root, query: 'Match', offset: 150, limit: 150 });
      expect(snapshot.entries).toHaveLength(1200);
      expect(new Set(snapshot.entries.map((item) => item.path)).size).toBe(1200);
      expect(snapshot.coverage).toBe('indexed-matches');
      index.ingest(
        Array.from({ length: 10001 }, (_, number): FileEntry => ({
          ...base,
          path: path.join(root, 'Huge ' + number),
          name: 'Huge ' + number,
          kind: 'file',
          directory: false,
        })),
        root,
      );
      expect(() => index.snapshot({ root, query: 'Huge' })).toThrow('more than 10,000');
    } finally {
      await index.close();
      await trashTemporary(root);
    }
  });
  it('stores explicit references and source versions without changing their original files', async () => {
    const root = await temporaryRoot('viewer-collections-');
    try {
      const a = path.join(root, 'A'),
        b = path.join(root, 'B');
      await Promise.all([mkdir(a), mkdir(b)]);
      const first = path.join(a, 'File.txt'),
        second = path.join(b, 'File.txt');
      await Promise.all([writeFile(first, 'first'), writeFile(second, 'second')]);
      const basket = [
        basketItemSchema.parse({ path: first, version: sourceVersion(await entry(first)) }),
        basketItemSchema.parse({ path: second, version: sourceVersion(await entry(second)) }),
      ];
      const collection = collectionSchema.parse({
        id: crypto.randomUUID(),
        name: 'Cross-folder files',
        kind: 'explicit',
        sources: basket.map((item) => item.path),
      });
      expect(collection.sources).toEqual([first, second]);
      expect(collectionSchema.safeParse({ ...collection, kind: 'query' }).success).toBe(false);
      expect(basket.every((item) => !!item.version.identity)).toBe(true);
    } finally {
      await trashTemporary(root);
    }
  });
});
