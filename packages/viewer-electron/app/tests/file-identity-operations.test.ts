import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FileSystemModule from 'node:fs/promises';
import type { BigIntStats, PathLike, Stats } from 'node:fs';
import type { OperationReceipt } from '../src/desktop/operations/operation-journal';
import { Operations } from '../src/desktop/operations/operations';
import {
  OperationLog,
  operationJournal,
  outputProof,
} from '../src/desktop/operations/operation-journal';
import { disposeRenameRecovery } from '../src/desktop/operations/removal';
import { fileStats } from '../src/desktop/files/stats';
import { entry } from '../src/desktop/files/filesystem';
import {
  itemIdentity,
  nativeIdentityArgument,
  olderIdentityMessage,
} from '../src/domain/files/item-identity';
import { sameSourceVersion } from '../src/domain/files/inspection';
import { indexEntries, reconcileSelection } from '../src/domain/files/entries';
import { temporaryRoot } from '../tools/temporary';

const inodes = vi.hoisted(() => new Map<bigint, bigint>());
const native = vi.hoisted(() => ({
  coordinateStart: vi.fn(async (_id: string, intents: { path: string }[]) =>
    intents.map((item) => item.path),
  ),
  coordinateEnd: vi.fn(async () => {}),
  coordinateCancel: vi.fn(),
  coordinateSameItem: vi.fn(() => false),
  renameExclusive: vi.fn<(source: string, target: string) => Promise<void>>(),
}));
vi.mock('../src/desktop/native/macos-files', () => ({ macFiles: () => native }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FileSystemModule>();
  const projected = (info: Stats | BigIntStats) => {
    const inode = inodes.get(BigInt.asUintN(64, BigInt(info.ino)));
    if (inode !== undefined) {
      if (typeof info.ino === 'bigint') info.ino = inode;
      else info.ino = Number(BigInt.asUintN(64, inode));
    }
    return info;
  };
  return {
    ...actual,
    lstat: async (file: PathLike, options?: { bigint?: boolean }) =>
      projected(
        options?.bigint ? await actual.lstat(file, { bigint: true }) : await actual.lstat(file),
      ),
    stat: async (file: PathLike, options?: { bigint?: boolean }) =>
      projected(
        options?.bigint ? await actual.stat(file, { bigint: true }) : await actual.stat(file),
      ),
  };
});

let root: string;
const services: Operations[] = [];
beforeEach(async () => {
  root = await temporaryRoot('viewer-exact-identity-');
  inodes.clear();
  native.renameExclusive.mockImplementation(async (source, target) => {
    const existing = await lstat(target).catch(() => undefined);
    if (existing) throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
    await rename(source, target);
  });
});
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function highInode(file: string, inode: bigint): Promise<void> {
  const actual = await vi.importActual<typeof FileSystemModule>('node:fs/promises');
  inodes.set(BigInt.asUintN(64, (await actual.lstat(file, { bigint: true })).ino), inode);
}
function operations(data?: string): Operations {
  const result = new Operations(
    async (file) => {
      await rename(file, path.join(root, 'Retained ' + randomUUID()));
    },
    () => {},
    undefined,
    undefined,
    undefined,
    data,
  );
  services.push(result);
  return result;
}

describe('exact identity at operation boundaries', () => {
  it.each(['copy', 'move', 'rename'] as const)(
    'asks about a %s collision between distinct high inodes',
    async (kind) => {
      const incoming = path.join(root, 'Incoming');
      const destination = path.join(root, 'Destination');
      await mkdir(incoming);
      await mkdir(destination);
      const source = path.join(
        kind === 'rename' ? destination : incoming,
        kind === 'rename' ? 'Original.txt' : 'report.txt',
      );
      const target = path.join(destination, 'report.txt');
      await writeFile(source, 'incoming content', { flag: 'wx' });
      await writeFile(target, 'existing content', { flag: 'wx' });
      await highInode(source, -1n);
      await highInode(target, -2n);
      expect((await lstat(source)).ino).toBe((await lstat(target)).ino);
      const service = operations();
      const id = service.start(
        kind === 'rename'
          ? { kind, sources: [source], name: 'report.txt' }
          : { kind, sources: [source], destination },
      );
      await vi.waitFor(() =>
        expect(service.all().find((job) => job.id === id)?.status).toBe('collision'),
      );
      expect(service.all().find((job) => job.id === id)?.collision).toMatchObject({
        source,
        destination: target,
      });
      service.resolve(id, 'skip', false);
      await service.drained();
      expect(await readFile(source, 'utf8')).toBe('incoming content');
      expect(await readFile(target, 'utf8')).toBe('existing content');
    },
  );

  it('writes exact identities to the journal and safely undoes a high-inode move after restart', async () => {
    const destination = path.join(root, 'Destination');
    const data = path.join(root, 'Profile');
    await mkdir(destination);
    const source = path.join(root, 'report.txt');
    await writeFile(source, 'complete', { flag: 'wx' });
    await highInode(source, -1n);
    const service = operations(data);
    const id = service.start({ kind: 'move', sources: [source], destination });
    await service.drained();
    expect(service.all().find((job) => job.id === id)?.status).toBe('completed');
    await service.close();
    const receipt = (await new OperationLog(data).load()).receipts.find(
      (item) => item.job.id === id,
    )!;
    expect(receipt.undo[0]?.identity).toMatch(/:18446744073709551615:u64$/);
    const restored = operations(data);
    await restored.undo(id);
    expect(await readFile(source, 'utf8')).toBe('complete');
  });

  it.each([
    { rounded: false, log: false },
    { rounded: true, log: false },
    { rounded: false, log: true },
    { rounded: true, log: true },
  ])(
    'reads an older journal and refuses only its rounded identity ($rounded, append log: $log)',
    async ({ rounded, log }) => {
      const data = path.join(root, 'Profile');
      const current = path.join(root, 'Current.txt');
      const original = path.join(root, 'Original.txt');
      await writeFile(current, 'kept content', { flag: 'wx' });
      const info = await lstat(current);
      const identity = rounded
        ? `${info.dev}:${Number((1n << 64n) - 1n)}`
        : `${info.dev}:${info.ino}`;
      if (rounded) await highInode(current, -1n);
      const id = randomUUID();
      const receipt: OperationReceipt = {
        job: {
          id,
          revision: 1,
          kind: 'move',
          status: 'completed',
          sources: [original],
          bytesDone: 0,
          bytesTotal: 0,
          itemsDone: 1,
          itemsTotal: 1,
          completed: [{ source: original, destination: current }],
          errors: [],
          errorCount: 0,
          undoable: true,
        },
        request: { kind: 'move', sources: [original], destination: root },
        undo: [{ from: current, to: original, identity, modified: info.mtimeMs, size: info.size }],
      };
      if (log) await new OperationLog(data).record(receipt);
      else await operationJournal(data).save({ version: 1, records: [receipt] });
      const service = operations(data);
      if (rounded) {
        await expect(service.undo(id)).rejects.toThrow(olderIdentityMessage);
        expect(await readFile(current, 'utf8')).toBe('kept content');
        expect(native.renameExclusive).not.toHaveBeenCalled();
      } else {
        await service.undo(id);
        expect(await readFile(original, 'utf8')).toBe('kept content');
      }
    },
  );

  it.each([false, true])(
    'checks an old removal proof before Undo (rounded descendant: %s)',
    async (rounded) => {
      const data = path.join(root, 'Profile');
      const folder = path.join(root, 'Output');
      const child = path.join(folder, 'Child.txt');
      await mkdir(folder);
      await writeFile(child, 'kept content', { flag: 'wx' });
      if (rounded) await highInode(child, -2n);
      const hash = createHash('sha256');
      // Reproduce the old on-disk hash, including its rounded numbers, without using it as proof.
      for (const relative of ['', 'Child.txt']) {
        const info = await lstat(path.join(folder, relative));
        hash.update(
          JSON.stringify([
            relative,
            info.dev,
            info.ino,
            info.size,
            info.mtimeMs,
            info.ctimeMs,
            info.mode,
            '',
          ]),
        );
      }
      const info = await lstat(folder);
      const id = randomUUID();
      await new OperationLog(data).record({
        job: {
          id,
          revision: 1,
          kind: 'copy',
          status: 'completed',
          sources: [],
          bytesDone: 0,
          bytesTotal: 0,
          itemsDone: 1,
          itemsTotal: 1,
          completed: [{ source: '', destination: folder }],
          errors: [],
          errorCount: 0,
          undoable: true,
        },
        request: { kind: 'copy', sources: [], destination: root },
        undo: [
          {
            from: folder,
            to: '',
            remove: true,
            proof: hash.digest('hex'),
            identity: `${info.dev}:${info.ino}`,
            modified: info.mtimeMs,
            size: info.size,
          },
        ],
      });
      const service = operations(data);
      if (rounded) {
        await expect(service.undo(id)).rejects.toThrow(olderIdentityMessage);
        expect(await readFile(child, 'utf8')).toBe('kept content');
      } else {
        await service.undo(id);
        const target = (await readdir(root)).find((name) => name.startsWith('Retained '));
        expect(await readFile(path.join(root, target!, 'Child.txt'), 'utf8')).toBe('kept content');
      }
    },
  );

  it('reproduces safe old proof hashes and refuses a legacy proof with a high-inode descendant', async () => {
    const folder = path.join(root, 'Folder');
    await mkdir(folder);
    const file = path.join(folder, 'Child.txt');
    await writeFile(file, 'complete', { flag: 'wx' });
    expect(await outputProof(folder, 1)).toBeDefined();
    await highInode(file, -2n);
    expect(await outputProof(folder, 1)).toBeUndefined();
    expect(await outputProof(folder)).toBeDefined();
  });

  it.each([false, true])(
    'trashes only an unchanged own high-inode reservation (changed: %s)',
    async (changed) => {
      const container = path.join(root, '.viewer-rename-' + 'a'.repeat(32));
      await mkdir(container);
      const file = path.join(container, 'item');
      await writeFile(file, '', { flag: 'wx' });
      await highInode(file, -1n);
      const info = await lstat(file, { bigint: true });
      const exact = itemIdentity({ ...info, ino: -1n });
      if (changed) await highInode(file, -2n);
      const trash = vi.fn(async (file: string) => {
        const target = path.join(root, 'Trash adapter ' + randomUUID());
        await rename(file, target);
        return { path: target, directory: (await lstat(target)).isDirectory() };
      });
      // Only the retained adapter moves entries; no operating-system Trash or deletion runs.
      vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
      vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
      const notes = await disposeRenameRecovery(
        {
          entries: [
            {
              kind: 'reservation',
              path: file,
              identity: nativeIdentityArgument(exact),
              directory: false,
            },
          ],
          containers: [
            { path: container, identity: itemIdentity(await lstat(container, { bigint: true })) },
          ],
        },
        trash,
      );
      if (changed) {
        expect(trash).not.toHaveBeenCalled();
        expect(notes.join(' ')).toContain('The recovery item changed and was kept at ' + file);
        expect((await lstat(file)).size).toBe(0);
      } else {
        expect(trash).toHaveBeenCalledWith(file);
        expect(notes.join(' ')).toContain('moved to the Trash');
      }
    },
  );

  it('keeps exact identities as strings across IPC and selection refresh and refuses old rounded versions', async () => {
    const file = path.join(root, 'report.txt');
    await writeFile(file, 'complete', { flag: 'wx' });
    await highInode(file, -1n);
    const first = JSON.parse(JSON.stringify(await entry(file))) as Awaited<
      ReturnType<typeof entry>
    >;
    expect(first.identity).toMatch(/:18446744073709551615:u64$/);
    const cache = new Map([[file, first]]);
    await highInode(file, -2n);
    const second = await entry(file);
    expect(reconcileSelection([file], cache, root, indexEntries([second]))).toEqual([]);
    const old = { identity: '12:18446744073709552000', modified: 1, size: 0 };
    expect(sameSourceVersion(old, old)).toBe(false);
  });

  it('converts a BigInt stat without rounding identity or losing fractional metadata', async () => {
    const file = path.join(root, 'Metadata.txt');
    await writeFile(file, 'complete', { flag: 'wx' });
    const ordinary = await lstat(file);
    const big = await lstat(file, { bigint: true });
    const exact = fileStats({ ...big, ino: -1n });
    expect(itemIdentity(exact)).toMatch(/:18446744073709551615:u64$/);
    expect(exact.isFile()).toBe(true);
    expect(exact.size).toBe(ordinary.size);
    expect(exact.mtimeMs).toBe(ordinary.mtimeMs);
  });
});
