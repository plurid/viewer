import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileAccess } from '../src/desktop/file-access';
import { Operations } from '../src/desktop/operations';
import { temporaryRoot, trashTemporary, trashFixtureEntry } from '../tools/temporary';

let root: string;
let data: string;
let folder: string;
let other: string;
let access: FileAccess;
let stops: ReturnType<typeof vi.fn<() => void>>[];
let start: ReturnType<typeof vi.fn<(bookmark: string) => () => void>>;
beforeEach(async () => {
  root = await temporaryRoot('viewer-file-access-');
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
  await trashTemporary(root);
});
describe('native folder access', () => {
  it('allows a large native selection without persisting each item and releases it at Quit', async () => {
    const files = await Promise.all(
      Array.from({ length: 256 }, async (_, index) => {
        const file = path.join(other, `Generated-${index}.txt`);
        await writeFile(file, 'native incoming fixture');
        return { path: file, directory: false, bookmark: 'native-' + index };
      }),
    );
    await access.receiveNative(files);
    await access.require(files.map((file) => file.path));
    expect(
      await stat(path.join(data, 'file-access-v1.json')).catch(() => undefined),
    ).toBeUndefined();
    expect((await access.list()).every((grant) => grant.session)).toBe(true);
    await access.close();
    expect(stops).toHaveLength(256);
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    access = new FileAccess(data, { start });
    await expect(access.require([files[0].path])).rejects.toMatchObject({
      code: 'FILE_ACCESS_REQUIRED',
    });
  });
  it('revokes native session selections under a root and denies overlapping late imports', async () => {
    const file = path.join(other, 'Generated.txt');
    await writeFile(file, 'fixture');
    await access.receiveNative([{ path: file, directory: false, bookmark: 'native' }]);
    await access.require([file]);
    let finish!: () => void;
    const revoking = access.revoke(
      other,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const late = expect(
      access.receiveNative([{ path: file, directory: false, bookmark: 'late' }]),
    ).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish();
    await revoking;
    await late;
    expect(stops[0]).toHaveBeenCalledExactlyOnceWith();
    expect(await access.list()).toEqual([]);
    await expect(access.require([file])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
  });
  it('shows a removed saved location as unavailable and releases its diagnostic scope', async () => {
    await access.remember(folder, true, 'folder');
    await trashFixtureEntry(folder);
    expect(await access.list()).toEqual([{ path: folder, directory: true, status: 'unavailable' }]);
    expect(stops[0]).toHaveBeenCalledExactlyOnceWith();
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
  });
  it('rejects a pending native import after revocation has already completed', async () => {
    await access.load();
    let release!: () => void;
    vi.spyOn(access, 'load').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = access.receiveNative([
      { path: other, directory: true, bookmark: 'old-selection' },
    ]);
    const denied = expect(pending).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await access.revoke(other, async () => {});
    release();
    await denied;
    await expect(access.require([other])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    expect(await access.list()).toEqual([]);
  });
  it('keeps a root blocked until the last overlapping revoke finishes', async () => {
    await access.remember(folder, true, 'folder');
    let finish!: () => void;
    const first = access.revoke(folder, async () => {});
    const second = access.revoke(
      folder,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await first;
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    const incoming = access.remember(folder, true, 'late-clipboard');
    finish();
    await second;
    await expect(incoming).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await access.remember(folder, true, 'new-picker');
    await expect(access.require([folder])).resolves.toBeUndefined();
  });
  it('does not save or retain a private Trash Undo lease as a general folder permission', async () => {
    await access.withReceipt(
      { path: other, directory: true, bookmark: 'private-receipt' },
      async () => {
        await access.require([other]);
        expect(await access.list()).toEqual([]);
      },
    );
    expect(stops[0]).toHaveBeenCalledExactlyOnceWith();
    await expect(access.require([other])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    expect(await access.list()).toEqual([]);
  });
  it('prevents clipboard or drop grants from resurrecting a permission while it is being revoked', async () => {
    await access.remember(folder, true, 'folder');
    let release!: () => void;
    const revoking = access.revoke(
      folder,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const incoming = access.remember(folder, true, 'clipboard');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await revoking;
    await expect(incoming).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    expect(await access.list()).toEqual([]);
    await access.remember(folder, true, 'explicit-picker');
    await expect(access.require([folder])).resolves.toBeUndefined();
  });
  it('blocks new reads immediately, drains dependent work, then releases the revoked scope', async () => {
    await access.remember(folder, true, 'folder');
    await access.require([folder]);
    let finish!: () => void;
    let quiescing = false;
    const revoke = access.revoke(folder, async () => {
      quiescing = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await vi.waitFor(() => expect(quiescing).toBe(true));
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    expect(stops[0]).not.toHaveBeenCalled();
    finish();
    await revoke;
    expect(stops[0]).toHaveBeenCalledExactlyOnceWith();
    expect(await access.list()).toEqual([]);
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
  });
  it('keeps authority blocked and the scope alive when dependent work cannot stop', async () => {
    await access.remember(folder, true, 'folder');
    await access.require([folder]);
    await expect(
      access.revoke(folder, async () => {
        throw new Error('still running');
      }),
    ).rejects.toThrow('still running');
    expect(stops[0]).not.toHaveBeenCalled();
    expect((await access.list())[0].status).toBe('revoking');
    await expect(access.require([folder])).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await access.revoke(folder, async () => {});
    expect(stops[0]).toHaveBeenCalledExactlyOnceWith();
  });
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
