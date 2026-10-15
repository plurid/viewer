import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OperationJob } from '../src/domain/contracts';
import { Checkpoints } from '../src/desktop/checkpoints';
import { temporaryRoot, trashTemporary, trashFixtureEntry } from '../tools/temporary';
let root: string;
const access = vi.fn(async (_paths: readonly string[]) => {});
const coordination = { run: async <T>(_intents: unknown, work: () => Promise<T>) => work() };
beforeEach(async () => {
  root = await temporaryRoot('viewer-checkpoints-');
  access.mockClear();
});
afterEach(async () => {
  await trashTemporary(root);
});
describe('reviewed content checkpoints', () => {
  it('rejects a folder whose inventory changes while checkpoint files are being copied', async () => {
    const folder = path.join(root, 'Source');
    await mkdir(folder);
    await writeFile(path.join(folder, 'Original.txt'), 'original');
    let changed = false;
    const sourceCoordination = {
      run: async <T>(intents: { path: string; mode: string }[], work: () => Promise<T>) => {
        const result = await work();
        if (!changed && intents[0].mode === 'read') {
          changed = true;
          await writeFile(path.join(folder, 'Added.txt'), 'added during capture');
        }
        return result;
      },
    };
    const service = new Checkpoints(root + '/Private', access, () => 1024 ** 2, sourceCoordination);
    await expect(service.create('Changed folder', [folder])).rejects.toThrow('changed');
    expect((await service.list()).records).toEqual([]);
    expect(await readFile(path.join(folder, 'Added.txt'), 'utf8')).toBe('added during capture');
  });
  it('checks the full retained tree, including empty folders and unrecorded files, before restore', async () => {
    const folder = path.join(root, 'Source');
    await mkdir(path.join(folder, 'Empty'), { recursive: true });
    await writeFile(path.join(folder, 'Original.txt'), 'original');
    const service = new Checkpoints(root + '/Private', access, () => 1024 ** 2, coordination);
    const record = await service.create('Tree proof', [folder]);
    const snapshot = path.join(root, 'Private', record.id, '0', 'Source');
    await writeFile(path.join(snapshot, 'Unrecorded.txt'), 'must not be restored');
    const destination = root + '/Restore';
    await mkdir(destination);
    const start = vi.fn(() => 'job');
    await expect(service.restore(record.id, destination, { start })).rejects.toThrow('changed');
    expect(start).not.toHaveBeenCalled();
    await trashFixtureEntry(path.join(snapshot, 'Unrecorded.txt'));
    await trashFixtureEntry(path.join(snapshot, 'Empty'));
    await expect(service.restore(record.id, destination, { start })).rejects.toThrow('changed');
    expect(start).not.toHaveBeenCalled();
  });
  it('serializes restore admission with removal and retains storage while a restore job is pending', async () => {
    const file = root + '/Source.txt',
      destination = root + '/Restore';
    await writeFile(file, 'original');
    await mkdir(destination);
    let enter: () => void = () => {},
      release: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobs: OperationJob[] = [];
    const service = new Checkpoints(
      root + '/Private',
      async (paths) => {
        if (paths.includes(destination)) {
          enter();
          await blocked;
        }
      },
      () => 1024 ** 2,
      coordination,
      () => jobs,
    );
    const record = await service.create('Serialized restore', [file]);
    const restoration = service.restore(record.id, destination, {
      start: (request) => {
        jobs.push({
          id: 'job',
          revision: 0,
          kind: 'copy',
          status: 'queued',
          sources: request.sources,
          bytesDone: 0,
          bytesTotal: 0,
          itemsDone: 0,
          itemsTotal: 1,
          completed: [],
          errors: [],
          errorCount: 0,
          undoable: false,
        });
        return 'job';
      },
    });
    const settledRestore = restoration.then(
      (value) => value,
      (error) => error,
    );
    await entered;
    let removed = false;
    const removal = service.remove(record.id).then(
      () => {
        removed = true;
        return undefined;
      },
      (error: Error) => error,
    );
    try {
      for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
      expect(removed).toBe(false);
      release();
      expect(await settledRestore).toEqual({ jobs: ['job'] });
      expect(await removal).toMatchObject({
        message: expect.stringContaining('restore to finish'),
      });
      expect((await service.list()).records).toHaveLength(1);
      jobs[0].status = 'completed';
      await service.remove(record.id);
      expect((await service.list()).records).toEqual([]);
    } finally {
      release();
      await settledRestore;
      await removal;
      await service.close();
    }
  });
  it('captures nested contents and mode, persists cold, and restores through guarded operations', async () => {
    const folder = path.join(root, 'Source'),
      file = path.join(folder, 'Résumé.txt');
    await mkdir(folder);
    await writeFile(file, 'Original source.');
    await chmod(file, 0o640);
    const service = new Checkpoints(root + '/Private', access, () => 1024 ** 2, coordination);
    expect(await service.estimate([folder, file])).toMatchObject({
      entries: 2,
      supported: true,
    });
    const record = await service.create('Rename proposal', [folder, file]);
    expect(record.roots).toHaveLength(1);
    const copy = path.join(root, 'Private', record.id, '0', 'Source', 'Résumé.txt');
    expect(await readFile(copy, 'utf8')).toBe('Original source.');
    expect((await stat(copy)).mode & 0o777).toBe(0o640);
    await writeFile(file, 'Changed source.');
    const cold = new Checkpoints(root + '/Private', access, () => 1024 ** 2, coordination);
    expect((await cold.list()).usedBytes).toBe(record.bytes);
    const destination = root + '/Restored';
    await mkdir(destination);
    const start = vi.fn(() => 'job');
    expect(await cold.restore(record.id, destination, { start })).toEqual({ jobs: ['job'] });
    expect(start).toHaveBeenCalledWith({
      kind: 'copy',
      sources: [path.join(root, 'Private', record.id, '0', 'Source')],
      destination,
    });
    expect(await readFile(file, 'utf8')).toBe('Changed source.');
  });
  it('enforces the total retained budget before copying and frees it on removal', async () => {
    const file = root + '/Source.txt';
    await writeFile(file, '12345678');
    let budget = 1024 ** 2;
    const service = new Checkpoints(root + '/Private', access, () => budget, coordination);
    const record = await service.create('First', [file]);
    budget = record.bytes + 1;
    expect(await service.estimate([file])).toMatchObject({ supported: false, availableBytes: 1 });
    await expect(service.create('Second', [file])).rejects.toThrow('budget');
    expect((await service.list()).records).toHaveLength(1);
    await service.remove(record.id);
    expect(await service.estimate([file])).toMatchObject({
      supported: true,
      availableBytes: budget,
    });
  });
  it('keeps unsupported/symlink coverage explicit and cancellation leaves no ready record', async () => {
    const file = root + '/Source.txt';
    await writeFile(file, 'Original.');
    await symlink(file, root + '/Link');
    const service = new Checkpoints(root + '/Private', access, () => 1024 ** 2, coordination);
    expect(await service.estimate([root + '/Link'])).toMatchObject({
      supported: false,
      scope: 'contents-and-mode',
    });
    const abort = new AbortController();
    abort.abort();
    await expect(service.create('Cancelled', [file], abort.signal)).rejects.toThrow();
    expect((await service.list()).records).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('Original.');
    expect((await readdir(root + '/Private')).filter((name) => !name.endsWith('.json'))).toEqual(
      [],
    );
  });
  it('rechecks revocation and snapshot integrity before a restore can start', async () => {
    const file = root + '/Source.txt';
    await writeFile(file, 'Original.');
    const service = new Checkpoints(root + '/Private', access, () => 1024 ** 2, coordination);
    access.mockRejectedValueOnce(new Error('revoked'));
    await expect(service.create('Denied', [file])).rejects.toThrow('revoked');
    const record = await service.create('Capture', [file]);
    await writeFile(path.join(root, 'Private', record.id, '0', 'Source.txt'), 'Corrupt.');
    const destination = root + '/Restore';
    await mkdir(destination);
    const start = vi.fn(() => 'job');
    await expect(service.restore(record.id, destination, { start })).rejects.toThrow('changed');
    expect(start).not.toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('Original.');
  });
  it('restores older file-hash manifests while rejecting unrecorded files in their trees', async () => {
    const folder = root + '/Source';
    await mkdir(folder);
    await writeFile(folder + '/Original.txt', 'version 1 recovery contents');
    const directory = root + '/Private';
    const service = new Checkpoints(directory, access, () => 1024 ** 2, coordination);
    const record = await service.create('Version 1 contents', [folder]);
    const manifestPath = path.join(directory, record.id, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(
      manifestPath,
      JSON.stringify(manifest.entries.filter((proof: { hash?: string }) => proof.hash)),
    );
    const index = JSON.parse(await readFile(directory + '/checkpoints-v1.json', 'utf8'));
    delete index[0].manifestVersion;
    await writeFile(directory + '/checkpoints-v1.json', JSON.stringify(index));
    const cold = new Checkpoints(directory, access, () => 1024 ** 2, coordination);
    const destination = root + '/Restore';
    await mkdir(destination);
    const start = vi.fn(() => 'job');
    expect(await cold.restore(record.id, destination, { start })).toEqual({ jobs: ['job'] });
    start.mockClear();
    await writeFile(
      path.join(directory, record.id, '0', 'Source', 'Unexpected.txt'),
      'do not publish',
    );
    await expect(cold.restore(record.id, destination, { start })).rejects.toThrow('tree changed');
    expect(start).not.toHaveBeenCalled();
    await cold.close();
    await service.close();
  });
});
