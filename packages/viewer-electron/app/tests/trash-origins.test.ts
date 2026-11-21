import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TrashOrigins,
  trashOriginFileName,
  trashOriginLimit,
} from '../src/desktop/operations/trash-origins';
import { temporaryRoot } from '../tools/temporary';

const stores: TrashOrigins[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe('Trash origins private store', () => {
  it('writes versioned mode-0600 records atomically and removes restored items', async () => {
    const directory = await temporaryRoot('viewer-trash-origins-');
    const store = new TrashOrigins(directory);
    stores.push(store);
    const file = path.join(directory, trashOriginFileName);
    await store.record([
      {
        file: '/Users/Fixture/.Trash/Report.pdf',
        originalPath: '/Users/Fixture/Documents/Report.pdf',
        identity: '1:100',
        modified: 1234,
        size: 42,
      },
    ]);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      origins: [
        {
          file: '/Users/Fixture/.Trash/Report.pdf',
          originalPath: '/Users/Fixture/Documents/Report.pdf',
          identity: '1:100',
          modified: 1234,
          size: 42,
        },
      ],
    });
    const cold = new TrashOrigins(directory);
    stores.push(cold);
    expect(await cold.list()).toHaveLength(1);
    await cold.remove(['/Users/Fixture/.Trash/Report.pdf']);
    expect(await cold.list()).toEqual([]);
    const reloaded = new TrashOrigins(directory);
    stores.push(reloaded);
    expect(await reloaded.list()).toEqual([]);
  });

  it('bounds retained origins to the limit, dropping the oldest first', async () => {
    const directory = await temporaryRoot('viewer-trash-origins-bound-');
    const store = new TrashOrigins(directory);
    stores.push(store);
    const entries = Array.from({ length: trashOriginLimit + 5 }, (_, index) => ({
      file: `/Users/Fixture/.Trash/item-${index}.txt`,
      originalPath: `/Users/Fixture/Work/item-${index}.txt`,
      identity: `1:${index + 1}`,
      modified: index,
      size: 10,
    }));
    await store.record(entries);
    const kept = await store.list();
    expect(kept).toHaveLength(trashOriginLimit);
    expect(kept[0]?.file).toBe('/Users/Fixture/.Trash/item-5.txt');
    expect(kept.at(-1)?.file).toBe(`/Users/Fixture/.Trash/item-${trashOriginLimit + 4}.txt`);
  });

  it('keeps an unreadable store file aside and preserves a newer version untouched', async () => {
    const brokenDir = await temporaryRoot('viewer-trash-origins-broken-');
    const brokenFile = path.join(brokenDir, trashOriginFileName);
    await writeFile(brokenFile, '{ corrupt');
    const notices: string[] = [];
    const broken = new TrashOrigins(brokenDir, (message) => notices.push(message));
    stores.push(broken);
    expect(await broken.list()).toEqual([]);
    expect(notices).toHaveLength(1);
    const aside = (await readdir(brokenDir)).filter((name) => name.includes('.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(brokenDir, aside[0]!), 'utf8')).toBe('{ corrupt');
    await broken.record([
      {
        file: '/Users/Fixture/.Trash/Fresh.txt',
        originalPath: '/Users/Fixture/Work/Fresh.txt',
        identity: '1:55',
      },
    ]);
    expect(JSON.parse(await readFile(brokenFile, 'utf8')).origins).toHaveLength(1);

    const newerDir = await temporaryRoot('viewer-trash-origins-newer-');
    const newerFile = path.join(newerDir, trashOriginFileName);
    const future = JSON.stringify({ version: 2, origins: [] });
    await writeFile(newerFile, future);
    const newerNotices: string[] = [];
    const newer = new TrashOrigins(newerDir, (message) => newerNotices.push(message));
    stores.push(newer);
    expect(await newer.list()).toEqual([]);
    expect(newerNotices[0]).toContain('newer Viewer');
    await newer.record([
      {
        file: '/Users/Fixture/.Trash/SessionOnly.txt',
        originalPath: '/Users/Fixture/Work/SessionOnly.txt',
        identity: '1:56',
      },
    ]);
    expect(await readFile(newerFile, 'utf8')).toBe(future);
    expect(await newer.list()).toHaveLength(1);
  });

  it('preserves state when a save fails', async () => {
    const directory = await temporaryRoot('viewer-trash-origins-fail-');
    const store = new TrashOrigins(directory);
    stores.push(store);
    const save = vi.spyOn(store.store!, 'save').mockRejectedValueOnce(new Error('disk full'));
    await expect(
      store.record([
        {
          file: '/Users/Fixture/.Trash/Fail.txt',
          originalPath: '/Users/Fixture/Work/Fail.txt',
          identity: '1:99',
        },
      ]),
    ).rejects.toThrow('disk full');
    expect(await store.list()).toEqual([]);
    save.mockRestore();
  });
});
