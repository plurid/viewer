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
type CloneMode = 'native' | 'unsupported' | 'change-source';
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
        clone: {
          value: async (sourceFD: number, target: string) => {
            native.clones.push(target);
            if (native.mode === 'unsupported')
              throw Object.assign(new Error('Could not clone the file'), { code: 'ENOTSUP' });
            await files.clone(sourceFD, target);
            if (native.mode === 'change-source') await appendFile(native.changed, ' and more');
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
});
