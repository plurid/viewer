import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileAccess } from '../src/desktop/file-access';
import { Operations } from '../src/desktop/operations';

let root: string;
let data: string;
let folder: string;
let other: string;
let access: FileAccess;
let stops: ReturnType<typeof vi.fn<() => void>>[];
let start: ReturnType<typeof vi.fn<(bookmark: string) => () => void>>;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-file-access-'));
  [data, folder, other] = ['private', 'chosen', 'other'].map((name) => path.join(root, name));
  await Promise.all([data, folder, other].map((file) => mkdir(file)));
  stops = [];
  start = vi.fn(() => {
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
  access = new FileAccess(data, { start });
});
afterEach(async () => {
  await access.close();
  await rm(root, { recursive: true, force: true });
});
describe('native folder access', () => {
  it('prevents an ungranted transfer from writing and rechecks both roots during Undo', async () => {
    const source = path.join(folder, 'note.txt'),
      destination = path.join(other, 'note.txt');
    await writeFile(source, 'keep this document');
    await access.remember(folder, true, 'source');
    const operations = new Operations(
      async () => {},
      () => {},
      () => {},
      () => {},
      (files) => access.require(files),
    );
    try {
      const denied = operations.start({ kind: 'move', sources: [source], destination: other });
      await expect
        .poll(() => operations.all().find((job) => job.id === denied)?.status)
        .toBe('failed');
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(source, 'utf8')).toBe('keep this document');
      await access.remember(other, true, 'destination');
      const allowed = operations.start({ kind: 'move', sources: [source], destination: other });
      await expect
        .poll(() => operations.all().find((job) => job.id === allowed)?.status)
        .toBe('completed');
      expect(await readFile(destination, 'utf8')).toBe('keep this document');
      await access.close();
      await writeFile(
        path.join(data, 'file-access-v1.json'),
        JSON.stringify({
          version: 1,
          grants: [{ path: other, directory: true, bookmark: 'only-destination' }],
        }),
      );
      access = new FileAccess(data, { start });
      await expect(operations.undo(allowed)).rejects.toMatchObject({
        code: 'FILE_ACCESS_REQUIRED',
      });
      expect(await readFile(destination, 'utf8')).toBe('keep this document');
      await access.remember(folder, true, 'source-restored');
      await operations.undo(allowed);
      expect(await readFile(source, 'utf8')).toBe('keep this document');
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await operations.close();
    }
  });
  it('restores private picker grants across launches, acquires once and pairs every release', async () => {
    await writeFile(path.join(folder, 'document.txt'), 'document');
    await access.remember(folder, true, 'native-bookmark');
    const saved = path.join(data, 'file-access-v1.json');
    expect((await stat(saved)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(saved, 'utf8')).grants).toHaveLength(1);
    await access.close();
    access = new FileAccess(data, { start });
    await Promise.all([
      access.require([folder]),
      access.require([path.join(folder, 'document.txt')]),
    ]);
    await access.require([path.join(folder, 'new-directory', 'new-file.txt')]);
    expect(start).toHaveBeenCalledExactlyOnceWith('native-bookmark');
    await access.close();
    await access.close();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    await expect(access.require([folder])).rejects.toThrow('closed');
  });
  it('requires independent source and destination grants and rejects siblings and escaping symlinks', async () => {
    await access.remember(folder, true, 'source');
    await expect(access.require([folder, other])).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
    await expect(access.require([folder + '-sibling'])).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
    await symlink(other, path.join(folder, 'escape'));
    await expect(access.require([path.join(folder, 'escape', 'new.txt')])).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
    await access.remember(other, true, 'destination');
    await access.require([folder, path.join(other, 'new.txt')]);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('does not turn a chosen file into permission for its parent or sibling', async () => {
    const file = path.join(folder, 'config.jsonc');
    await writeFile(file, '{}');
    await access.remember(file, false, 'one-file');
    await access.require([file]);
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await expect(access.require([path.join(folder, 'sibling.txt')])).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
  });
  it('recovers from invalid bookmarks and corrupt metadata using a fresh picker grant', async () => {
    await writeFile(path.join(data, 'file-access-v1.json'), '{ broken');
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await expect(access.remember(folder, true, undefined)).rejects.toThrow();
    start.mockImplementationOnce(() => {
      throw new Error('native permission revoked');
    });
    await access.remember(folder, true, 'stale');
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await access.remember(folder, true, 'reselected');
    await access.require([folder]);
    expect(start).toHaveBeenLastCalledWith('reselected');
  });
  it('serializes simultaneous picks, keeps bookmarks separate from configuration, and contains private symlinks', async () => {
    await Promise.all([access.remember(folder, true, 'a'), access.remember(other, true, 'b')]);
    const saved = JSON.parse(await readFile(path.join(data, 'file-access-v1.json'), 'utf8'));
    expect(saved.grants.map((value: { path: string }) => value.path).sort()).toEqual(
      [folder, other].sort(),
    );
    await access.require([path.join(data, 'new-metadata')]);
    await symlink(other, path.join(data, 'escape'));
    await expect(access.require([path.join(data, 'escape', 'new.txt')])).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
    expect(start).not.toHaveBeenCalled();
  });
  it('leaves the direct-download filesystem behavior unrestricted with no bookmark I/O', async () => {
    await access.close();
    access = new FileAccess(data);
    await access.remember(folder, true, undefined);
    await access.require([other, '/a-path-not-existing']);
    await expect(stat(path.join(data, 'file-access-v1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(start).not.toHaveBeenCalled();
  });
});
