import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { OperationJob, OperationProgress, OperationRequest } from '../src/domain/contracts';
const exdev = vi.hoisted(() => ({ source: '', race: '', noLinks: false }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (source: string, destination: string) => {
      if (source === exdev.source) {
        exdev.source = '';
        throw Object.assign(new Error('Cross-device link'), { code: 'EXDEV' });
      }
      return actual.rename(source, destination);
    },
    link: async (source: string, destination: string) => {
      if (source === exdev.source) {
        exdev.source = '';
        throw Object.assign(new Error('Cross-device link'), { code: 'EXDEV' });
      }
      if (destination === exdev.race) {
        exdev.race = '';
        await actual.writeFile(destination, 'concurrent writer', { flag: 'wx' });
      }
      if (exdev.noLinks)
        throw Object.assign(new Error('Hard links are unsupported'), { code: 'EOPNOTSUPP' });
      return actual.link(source, destination);
    },
  };
});
import { Operations } from '../src/desktop/operations';
let root: string, destination: string, trash: string, operations: Operations;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-ops-'));
  destination = path.join(root, 'destination');
  trash = path.join(root, 'trash');
  await mkdir(destination);
  await mkdir(trash);
  operations = new Operations(
    async (file) => {
      await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
    },
    () => undefined,
  );
});
afterEach(async () => {
  await operations.close();
  vi.restoreAllMocks();
  exdev.source = '';
  exdev.race = '';
  exdev.noLinks = false;
  await rm(root, { recursive: true, force: true });
});
async function waitFor(
  id: string,
  condition: (job: OperationJob) => boolean = (job) =>
    ['completed', 'cancelled', 'failed'].includes(job.status),
): Promise<OperationJob> {
  await vi.waitFor(
    () => {
      const job = operations.all().find((item) => item.id === id)!;
      expect(condition(job)).toBe(true);
    },
    { timeout: 10000, interval: 10 },
  );
  return operations.all().find((item) => item.id === id)!;
}
async function run(request: OperationRequest) {
  return waitFor(operations.start(request));
}
describe('file operation queue', () => {
  it('streams exclusive copies and safe moves on volumes without hard-link support', async () => {
    exdev.noLinks = true;
    const source = path.join(root, 'external.txt');
    await writeFile(source, 'external disk');
    const copied = await run({ kind: 'copy', sources: [source], destination });
    expect(copied.status).toBe('completed');
    expect(await readFile(path.join(destination, 'external.txt'), 'utf8')).toBe('external disk');
    const renamed = await run({ kind: 'rename', sources: [source], name: 'renamed.txt' });
    expect(renamed.undoable).toBe(true);
    await operations.undo(renamed.id);
    expect(await readFile(source, 'utf8')).toBe('external disk');
  });
  it('copies every selected file and preserves symlinks', async () => {
    const sources = [path.join(root, 'one.txt'), path.join(root, 'two.txt')];
    await Promise.all(sources.map((file) => writeFile(file, path.basename(file))));
    await symlink('one.txt', path.join(root, 'alias'));
    sources.push(path.join(root, 'alias'));
    const job = await run({ kind: 'copy', sources, destination });
    expect(job.completed).toHaveLength(3);
    expect(job.errors).toEqual([]);
    expect(await readFile(path.join(destination, 'two.txt'), 'utf8')).toBe('two.txt');
    expect((await lstat(path.join(destination, 'alias'))).isSymbolicLink()).toBe(true);
  });
  it('waits for collision decisions and keeps both without losing either file', async () => {
    const source = path.join(root, 'one.txt');
    await writeFile(source, 'new');
    await writeFile(path.join(destination, 'one.txt'), 'old');
    const id = operations.start({ kind: 'copy', sources: [source], destination });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'keep-both', false);
    await waitFor(id);
    expect(await readFile(path.join(destination, 'one.txt'), 'utf8')).toBe('old');
    expect(await readFile(path.join(destination, 'one copy.txt'), 'utf8')).toBe('new');
  });
  it('replaces through Trash and applies a decision to remaining conflicts', async () => {
    const sources = [path.join(root, 'one.txt'), path.join(root, 'two.txt')];
    for (const source of sources) {
      await writeFile(source, 'new');
      await writeFile(path.join(destination, path.basename(source)), 'old');
    }
    const id = operations.start({ kind: 'copy', sources, destination });
    await waitFor(id, (job) => job.status === 'collision');
    operations.resolve(id, 'replace', true);
    const job = await waitFor(id);
    expect(job.completed).toHaveLength(2);
    expect(await readdir(trash)).toHaveLength(2);
    expect(await readFile(path.join(destination, 'two.txt'), 'utf8')).toBe('new');
  });
  it('renames Unicode and case-only names and safely undoes a move', async () => {
    const source = path.join(root, 'Résumé.txt');
    await writeFile(source, 'contents');
    const renamed = await run({ kind: 'rename', sources: [source], name: 'résumé.txt' });
    expect(renamed.status).toBe('completed');
    await operations.undo(renamed.id);
    expect(await readFile(source, 'utf8')).toBe('contents');
    await run({ kind: 'rename', sources: [source], name: 'résumé.txt' });
    const file = path.join(root, 'résumé.txt');
    const moved = await run({ kind: 'move', sources: [file], destination });
    expect(moved.undoable).toBe(true);
    await operations.undo(moved.id);
    expect(await readFile(file, 'utf8')).toBe('contents');
  });
  it('refuses undo when the destination contents changed', async () => {
    const source = path.join(root, 'file');
    await writeFile(source, 'old');
    const job = await run({ kind: 'move', sources: [source], destination });
    await writeFile(path.join(destination, 'file'), 'changed');
    await expect(operations.undo(job.id)).rejects.toThrow('changed');
  });
  it('stages cross-volume moves and removes the source only after a full copy', async () => {
    const source = path.join(root, 'file');
    await writeFile(source, 'cross volume');
    exdev.source = source;
    const job = await run({ kind: 'move', sources: [source], destination });
    expect(job.status).toBe('completed');
    expect(job.undoable).toBe(false);
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(destination, 'file'), 'utf8')).toBe('cross volume');
  });
  it.skipIf(process.platform !== 'darwin')(
    'keeps cross-volume originals with unsupported macOS metadata',
    async () => {
      const source = path.join(root, 'tagged.txt');
      await writeFile(source, 'important');
      await promisify(execFile)('/usr/bin/xattr', [
        '-w',
        'com.plurid.viewer.fixture',
        'synthetic',
        source,
      ]);
      exdev.source = source;
      const job = await run({ kind: 'move', sources: [source], destination });
      expect(job.status).toBe('failed');
      expect(job.errors[0].message).toContain('metadata');
      expect(await readFile(source, 'utf8')).toBe('important');
      await expect(lstat(path.join(destination, 'tagged.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
  it('keeps a concurrently created destination and leaves the source intact', async () => {
    const source = path.join(root, 'racing.txt');
    await writeFile(source, 'original');
    exdev.race = path.join(destination, 'racing.txt');
    const job = await run({ kind: 'move', sources: [source], destination });
    expect(job.status).toBe('failed');
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(await readFile(path.join(destination, 'racing.txt'), 'utf8')).toBe('concurrent writer');
  });
  it('moves whole directories and rejects undo into an occupied folder', async () => {
    const source = path.join(root, 'folder');
    await mkdir(source);
    await writeFile(path.join(source, 'child.txt'), 'child');
    const job = await run({ kind: 'move', sources: [source], destination });
    expect(job.undoable).toBe(true);
    await mkdir(source);
    await expect(operations.undo(job.id)).rejects.toThrow('already exists');
    await rm(source, { recursive: true });
    await operations.undo(job.id);
    expect(await readFile(path.join(source, 'child.txt'), 'utf8')).toBe('child');
  });
  it('cancels an active copy and cleans only its staging files', async () => {
    const source = path.join(root, 'large.bin');
    await writeFile(source, Buffer.alloc(16 * 1024 * 1024, 7));
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 100));
    operations = new Operations(
      async () => undefined,
      () => undefined,
      (job) => {
        if (job.bytesDone > 0) operations.cancel(job.id);
      },
    );
    const job = await run({ kind: 'copy', sources: [source], destination });
    expect(job.status).toBe('cancelled');
    expect(await readdir(destination)).toEqual([]);
    expect((await lstat(source)).size).toBe(16 * 1024 * 1024);
  });
  it('throttles small-file progress across the whole job and sends authoritative lifecycle snapshots', async () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 20));
    const snapshots: OperationJob[] = [];
    const updates: { progress: OperationProgress; time: number }[] = [];
    const revisions: number[] = [];
    operations = new Operations(
      async () => undefined,
      (job) => {
        snapshots.push(job);
        revisions.push(job.revision);
      },
      (progress) => {
        updates.push({ progress, time });
        revisions.push(progress.revision);
      },
    );
    const sources = Array.from({ length: 12 }, (_, index) => path.join(root, `small-${index}.txt`));
    await Promise.all(sources.map((source) => writeFile(source, 'synthetic')));
    const job = await run({ kind: 'copy', sources, destination });
    expect(snapshots.map((job) => job.status)).toEqual(['queued', 'running', 'completed']);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThan(sources.length);
    for (let i = 1; i < updates.length; i++)
      expect(updates[i].time - updates[i - 1].time).toBeGreaterThanOrEqual(80);
    expect(revisions).toEqual(Array.from({ length: revisions.length }, (_, index) => index + 1));
    expect(updates[0].progress).not.toHaveProperty('completed');
    expect(updates[0].progress).not.toHaveProperty('sources');
    expect(job.completed).toHaveLength(12);
    expect(job).toMatchObject({ bytesDone: 108, itemsDone: 12, errorCount: 0 });
    expect(snapshots.at(-1)).toEqual(job);
    expect(await readFile(sources[0], 'utf8')).toBe('synthetic');
  });
  it('rejects copying a folder inside itself through a symlink', async () => {
    const folder = path.join(root, 'folder');
    await mkdir(folder);
    const alias = path.join(root, 'alias');
    await symlink(folder, alias);
    const job = await run({ kind: 'copy', sources: [folder], destination: alias });
    expect(job.status).toBe('failed');
    expect(job.errors[0].message).toContain('inside itself');
  });
  it('reports partial failures and processes every Trash selection', async () => {
    const first = path.join(root, 'first'),
      second = path.join(root, 'second');
    await writeFile(first, 'a');
    await writeFile(second, 'b');
    const job = await run({ kind: 'trash', sources: [first, path.join(root, 'missing'), second] });
    expect(job.completed).toHaveLength(2);
    expect(job.errors).toHaveLength(1);
    expect(await readdir(trash)).toHaveLength(2);
  });
});
