/**
 * A copy on one APFS volume is a clone of each file; where a volume cannot clone, its bytes are
 * streamed. Either way the identity checks hold: a source that changes while it is cloned is
 * refused as a streamed one is. A plain copy leaves its bytes to the system; a move across volumes
 * flushes each file before its sources go.
 */
import type * as MacFilesModule from '../src/desktop/native/macos-files';
import { execFile } from 'node:child_process';
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationJob } from '../src/domain/contracts';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

/** What the native clone does in each test: clone, refuse as a volume that cannot, or clone and
 * then change the source as a writer would. */
type CloneMode = 'native' | 'unsupported' | 'change-source' | 'staged-defer';
const native = vi.hoisted(() => ({
  mode: 'native' as CloneMode,
  clones: [] as string[],
  metadata: 0,
  changed: '',
}));
vi.mock('../src/desktop/native/macos-files', async (original) => {
  const actual = await original<typeof MacFilesModule>();
  return {
    ...actual,
    macFiles: () => {
      const files = actual.macFiles();
      return Object.defineProperties(Object.create(files), {
        cloneStageVersion: {
          get: () => (native.mode === 'staged-defer' ? 1 : files.cloneStageVersion),
        },
        clone: {
          value: async (sourceFD: number, target: string, deferRestrictions?: boolean) => {
            native.clones.push(target);
            if (native.mode === 'unsupported')
              throw Object.assign(new Error('Could not clone the file'), { code: 'ENOTSUP' });
            if (native.mode === 'staged-defer' && deferRestrictions) {
              await files.clone(sourceFD, target);
              const info = JSON.parse(await files.information(target)) as {
                revision: string;
                locked: boolean;
              };
              if (info.locked) {
                await files.updateInformation(
                  target,
                  info.revision,
                  JSON.stringify({ locked: false }),
                );
                return true;
              }
              return false;
            }
            const result =
              deferRestrictions !== undefined
                ? await files.clone(sourceFD, target, deferRestrictions)
                : await files.clone(sourceFD, target);
            if (native.mode === 'change-source') await appendFile(native.changed, ' and more');
            return result;
          },
        },
        copyMetadata: {
          value: async (sourceFD: number, targetFD: number) => {
            native.metadata++;
            return files.copyMetadata(sourceFD, targetFD);
          },
        },
      });
    },
  };
});
import { macFiles } from '../src/desktop/native/macos-files';
import { Operations } from '../src/desktop/operations/operations';
import { copyTree } from '../src/desktop/operations/file-transfer';

const run = promisify(execFile);
let root: string, destination: string, operations: Operations;
beforeEach(async () => {
  root = await temporaryRoot('viewer-copy-clones-');
  destination = path.join(root, 'destination');
  await mkdir(destination);
  const trash = path.join(root, 'trash');
  await mkdir(trash);
  native.mode = 'native';
  native.clones = [];
  native.metadata = 0;
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
  await trashTemporary(root);
});

async function copied(sources: string[]): Promise<OperationJob> {
  const id = operations.start({ kind: 'copy', sources, destination });
  await vi.waitFor(
    () => {
      const job = operations.all().find((item) => item.id === id)!;
      expect(['completed', 'failed', 'cancelled']).toContain(job.status);
    },
    { timeout: 10000, interval: 10 },
  );
  return operations.all().find((item) => item.id === id)!;
}

/** A file with a known date and an extended attribute, which a copy must carry. */
async function dated(file: string, text: string): Promise<void> {
  await writeFile(file, text, { flag: 'wx' });
  await run('/usr/bin/xattr', ['-w', 'com.example.viewer-test', 'kept', file]);
  const day = new Date('2024-02-03T04:05:06Z');
  await utimes(file, day, day);
}

describe.runIf(process.platform === 'darwin')('copying files', () => {
  it('clones a file on the same volume, with its date and attributes', async () => {
    const source = path.join(root, 'Report.txt');
    await dated(source, 'cloned contents');
    const job = await copied([source]);
    expect(job.status).toBe('completed');
    const target = path.join(destination, 'Report.txt');
    expect(await readFile(target, 'utf8')).toBe('cloned contents');
    expect(native.clones).toHaveLength(1);
    expect(native.metadata).toBe(0);
    expect((await lstat(target)).mtimeMs).toBe((await lstat(source)).mtimeMs);
    const { stdout } = await run('/usr/bin/xattr', ['-p', 'com.example.viewer-test', target]);
    expect(stdout.trim()).toBe('kept');
    expect(job.bytesDone).toBe('cloned contents'.length);
  });

  it('clones a folder file by file', async () => {
    const folder = path.join(root, 'Project');
    await mkdir(path.join(folder, 'notes'), { recursive: true });
    for (const name of ['a.txt', 'b.txt', 'notes/c.txt'])
      await writeFile(path.join(folder, name), name, { flag: 'wx' });
    expect((await copied([folder])).status).toBe('completed');
    expect(native.clones).toHaveLength(3);
    expect(await readFile(path.join(destination, 'Project/notes/c.txt'), 'utf8')).toBe(
      'notes/c.txt',
    );
  });

  it('streams the bytes where the volume cannot clone, with the same metadata', async () => {
    native.mode = 'unsupported';
    const source = path.join(root, 'Report.txt');
    await dated(source, 'streamed contents');
    expect((await copied([source])).status).toBe('completed');
    const target = path.join(destination, 'Report.txt');
    expect(await readFile(target, 'utf8')).toBe('streamed contents');
    expect(native.metadata).toBe(1);
    expect((await lstat(target)).mtimeMs).toBe((await lstat(source)).mtimeMs);
    const { stdout } = await run('/usr/bin/xattr', ['-p', 'com.example.viewer-test', target]);
    expect(stdout.trim()).toBe('kept');
  });

  it('refuses a clone of a file that changed while it was cloned, and publishes nothing', async () => {
    native.mode = 'change-source';
    const source = path.join(root, 'Busy.txt');
    native.changed = source;
    await writeFile(source, 'first draft', { flag: 'wx' });
    const job = await copied([source]);
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toMatch(/Source changed while copying/);
    await expect(lstat(path.join(destination, 'Busy.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(source, 'utf8')).toBe('first draft and more');
  });

  it('flushes each file only for a copy whose sources a move removes next', async () => {
    const folder = path.join(root, 'Batch');
    await mkdir(folder);
    for (const name of ['one.txt', 'two.txt'])
      await writeFile(path.join(folder, name), name, { flag: 'wx' });
    const probe = await open(path.join(root, 'probe'), 'wx');
    const sync = vi.spyOn(Object.getPrototypeOf(probe) as { sync(): Promise<void> }, 'sync');
    await probe.close();
    const job = { check() {}, signal: new AbortController().signal, started() {}, copied() {} };
    const access = async () => {};
    await copyTree(job, folder, path.join(root, 'Written'), [], access, 'written');
    expect(sync).not.toHaveBeenCalled();
    await copyTree(job, folder, path.join(root, 'Flushed'), [], access, 'flushed');
    expect(sync).toHaveBeenCalledTimes(2);
    sync.mockClear();
    native.mode = 'unsupported';
    await copyTree(job, folder, path.join(root, 'Streamed'), [], access, 'written');
    expect(sync).not.toHaveBeenCalled();
  });

  async function setLocked(file: string, locked: boolean): Promise<void> {
    const info = JSON.parse(await macFiles().information(file)) as { revision: string };
    await macFiles().updateInformation(file, info.revision, JSON.stringify({ locked }));
  }

  async function isLocked(file: string): Promise<boolean> {
    return (JSON.parse(await macFiles().information(file)) as { locked: boolean }).locked;
  }

  it.each(['native', 'unsupported'] as const)(
    'copies and duplicates a read-only 0555 folder with its mode and Undo proof (%s)',
    async (mode) => {
      native.mode = mode;
      const folder = path.join(root, 'ReadOnly');
      await mkdir(folder);
      await writeFile(path.join(folder, 'note.txt'), 'kept', { flag: 'wx' });
      await chmod(folder, 0o555);
      const copiedTarget = path.join(destination, 'ReadOnly');
      const duplicateTarget = path.join(root, 'ReadOnly copy');
      try {
        const job = await copied([folder]);
        expect(job.status, JSON.stringify(job.errors)).toBe('completed');
        expect((await lstat(copiedTarget)).mode & 0o777).toBe(0o555);
        expect(await readFile(path.join(copiedTarget, 'note.txt'), 'utf8')).toBe('kept');
        const dupID = operations.start({ kind: 'duplicate', sources: [folder] });
        await operations.drained();
        const dup = operations.all().find((item) => item.id === dupID)!;
        expect(dup.status, JSON.stringify(dup.errors)).toBe('completed');
        expect((await lstat(duplicateTarget)).mode & 0o777).toBe(0o555);
        // Undo hashes mode and ctime, so deferred metadata must finish before recordUndo.
        expect(await operations.matchesOutput(job.id, copiedTarget)).toBe(true);
      } finally {
        await chmod(folder, 0o755).catch(() => {});
        await chmod(copiedTarget, 0o755).catch(() => {});
        await chmod(duplicateTarget, 0o755).catch(() => {});
      }
    },
  );

  it.each(['native', 'unsupported'] as const)(
    'copies a folder with a deny-delete ACL like Home folders and preserves it (%s)',
    async (mode) => {
      native.mode = mode;
      const folder = path.join(root, 'DocumentsFixture');
      await mkdir(folder);
      await writeFile(path.join(folder, 'doc.txt'), 'private', { flag: 'wx' });
      await run('/bin/chmod', ['+a', 'everyone deny delete', folder]);
      const target = path.join(destination, 'DocumentsFixture');
      try {
        const job = await copied([folder]);
        expect(job.status, JSON.stringify(job.errors)).toBe('completed');
        expect(await readFile(path.join(target, 'doc.txt'), 'utf8')).toBe('private');
        const { stdout } = await run('/bin/ls', ['-lde', target]);
        expect(stdout).toContain('deny delete');
      } finally {
        await run('/bin/chmod', ['-N', folder]).catch(() => {});
        await run('/bin/chmod', ['-N', target]).catch(() => {});
      }
    },
  );

  it('copies and duplicates a locked file on the streamed path and preserves its lock', async () => {
    native.mode = 'unsupported';
    const source = path.join(root, 'Locked.txt');
    await writeFile(source, 'sealed', { flag: 'wx' });
    await setLocked(source, true);
    const target = path.join(destination, 'Locked.txt');
    const duplicate = path.join(root, 'Locked copy.txt');
    try {
      const job = await copied([source]);
      expect(job.status, JSON.stringify(job.errors)).toBe('completed');
      expect(await readFile(target, 'utf8')).toBe('sealed');
      expect(await isLocked(target)).toBe(true);
      const dupID = operations.start({ kind: 'duplicate', sources: [source] });
      await operations.drained();
      const dup = operations.all().find((item) => item.id === dupID)!;
      expect(dup.status, JSON.stringify(dup.errors)).toBe('completed');
      expect(await isLocked(duplicate)).toBe(true);
    } finally {
      await setLocked(source, false).catch(() => {});
      await setLocked(target, false).catch(() => {});
      await setLocked(duplicate, false).catch(() => {});
    }
  });

  it('copies a locked file on the clone path when staged cloning defers restrictions', async () => {
    native.mode = 'staged-defer';
    const source = path.join(root, 'LockedClone.txt');
    await writeFile(source, 'cloned secret', { flag: 'wx' });
    await setLocked(source, true);
    const target = path.join(destination, 'LockedClone.txt');
    try {
      const job = await copied([source]);
      expect(job.status, JSON.stringify(job.errors)).toBe('completed');
      expect(await readFile(target, 'utf8')).toBe('cloned secret');
      expect(await isLocked(target)).toBe(true);
      expect(native.clones).toHaveLength(1);
      expect(native.metadata).toBe(1);
    } finally {
      await setLocked(source, false).catch(() => {});
      await setLocked(target, false).catch(() => {});
    }
  });
});
