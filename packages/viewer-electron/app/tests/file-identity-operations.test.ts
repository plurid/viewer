import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FileSystemModule from 'node:fs/promises';
import type * as MacFilesModule from '../src/desktop/native/macos-files';
import type { NativeFileBindings } from '../src/desktop/native/macos-files';
import type { FileAccess } from '../src/desktop/files/file-access';
import type { BigIntStats, PathLike, Stats } from 'node:fs';
import type { OperationReceipt } from '../src/desktop/operations/operation-journal';
import { Operations } from '../src/desktop/operations/operations';
import {
  OperationLog,
  operationJournal,
  outputProof,
  outputEvidence,
  undoStepSchema,
} from '../src/desktop/operations/operation-journal';
import { Resources } from '../src/desktop/previews/resources';
import { Trash } from '../src/desktop/operations/trash';
import { adaptMacFiles } from '../src/desktop/native/macos-files';
import { inspectReviewedFile } from '../src/desktop/native/reviewed-file';
import { readText } from '../src/desktop/editing/text-files';
import * as removal from '../src/desktop/operations/removal';
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
const interleaving = vi.hoisted(() => ({
  afterRead: undefined as (() => Promise<void>) | undefined,
  afterPublish: undefined as (() => Promise<void>) | undefined,
  foreign: '',
  createdSynthetic: false,
  device: undefined as bigint | undefined,
  many: '',
}));
const native = vi.hoisted(() => ({
  coordinateStart: vi.fn(async (_id: string, intents: { path: string }[]) =>
    intents.map((item) => item.path),
  ),
  coordinateEnd: vi.fn(async () => {}),
  coordinateCancel: vi.fn(),
  coordinateSameItem: vi.fn(() => false),
  renameExclusive: vi.fn<(source: string, target: string) => Promise<void>>(),
  clone: vi.fn(async () => {
    throw Object.assign(new Error('No clone'), { code: 'ENOTSUP' });
  }),
  copyMetadata: vi.fn(async () => {
    await interleaving.afterRead?.();
  }),
  copyLinkMetadata: vi.fn(async () => {}),
  volumes: vi.fn(async () => []),
  datesAdded: vi.fn(
    async (_files: string[]) =>
      [] as { path: string; identity: string; size: number; modified: number; added: number }[],
  ),
  trashConfirmation: vi.fn(),
}));
vi.mock('../src/desktop/native/macos-files', async (original) => ({
  ...(await original<typeof MacFilesModule>()),
  macFiles: () => native,
}));
vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn(async () => {}) },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FileSystemModule>();
  const projected = (info: Stats | BigIntStats, file: PathLike) => {
    const inode = inodes.get(BigInt.asUintN(64, BigInt(info.ino)));
    if (inode !== undefined) {
      if (typeof info.ino === 'bigint') info.ino = inode;
      else info.ino = Number(BigInt.asUintN(64, inode));
    }
    if (interleaving.device !== undefined) {
      const device =
        interleaving.device -
        (interleaving.foreign && String(file).startsWith(interleaving.foreign) ? 1n : 0n);
      info.dev = typeof info.dev === 'bigint' ? device : Number(BigInt.asUintN(64, device));
    } else if (interleaving.foreign && String(file).startsWith(interleaving.foreign))
      info.dev = typeof info.dev === 'bigint' ? info.dev + 1n : info.dev + 1;
    return info;
  };
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) =>
      String(args[0]) === interleaving.many
        ? Array.from({ length: 10001 }, () => 'Child.txt')
        : actual.readdir(...args),
    lstat: async (file: PathLike, options?: { bigint?: boolean }) =>
      projected(
        options?.bigint ? await actual.lstat(file, { bigint: true }) : await actual.lstat(file),
        file,
      ),
    stat: async (file: PathLike, options?: { bigint?: boolean }) =>
      projected(
        options?.bigint ? await actual.stat(file, { bigint: true }) : await actual.stat(file),
        file,
      ),
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const stat = handle.stat.bind(handle);
      if (interleaving.createdSynthetic && typeof args[1] === 'string' && args[1].includes('w'))
        inodes.set(BigInt.asUintN(64, (await stat({ bigint: true })).ino), -1n);
      Object.defineProperty(handle, 'stat', {
        value: async (options?: { bigint?: boolean }) =>
          projected(options?.bigint ? await stat({ bigint: true }) : await stat(), args[0]),
      });
      return handle;
    },
  };
});

let root: string;
const services: Operations[] = [];
beforeEach(async () => {
  root = await temporaryRoot('viewer-exact-identity-');
  inodes.clear();
  interleaving.afterRead = undefined;
  interleaving.afterPublish = undefined;
  interleaving.foreign = '';
  interleaving.createdSynthetic = false;
  interleaving.device = undefined;
  interleaving.many = '';
  native.copyMetadata.mockClear();
  native.renameExclusive.mockImplementation(async (source, target) => {
    const existing = await lstat(target).catch(() => undefined);
    if (existing) throw Object.assign(new Error('File exists'), { code: 'EEXIST' });
    await rename(source, target);
    await interleaving.afterPublish?.();
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
      const directory = (await lstat(file)).isDirectory();
      const target = path.join(root, 'Retained ' + randomUUID());
      await rename(file, target);
      return { path: target, directory };
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
  it('writes safe copy and Trash proofs in the exact layout accepted by the earlier reader', async () => {
    const file = path.join(root, 'Source.txt');
    const destination = path.join(root, 'Destination');
    const data = path.join(root, 'Profile');
    await mkdir(destination);
    await writeFile(file, 'stable bytes', { flag: 'wx' });
    const service = operations(data);
    const id = service.start({ kind: 'copy', sources: [file], destination });
    await service.drained();
    const trashSource = path.join(root, 'Trashed.txt');
    await writeFile(trashSource, 'retained Trash bytes', { flag: 'wx' });
    const trashID = service.start({ kind: 'trash', sources: [trashSource] });
    await service.drained();
    await service.close();
    const receipt = (await new OperationLog(data).load()).receipts.find(
      (item) => item.job.id === id,
    )!;
    const trashReceipt = (await new OperationLog(data).load()).receipts.find(
      (item) => item.job.id === trashID,
    )!;
    expect(trashReceipt.undo[0]?.trash).toBe(true);
    const oldReader = undoStepSchema.omit({ proofVersion: true, proofSynthetic: true });
    for (const step of [...receipt.undo, ...trashReceipt.undo]) {
      expect(step.proofVersion).toBeUndefined();
      expect(step.proofSynthetic).toBeUndefined();
      expect(JSON.stringify(oldReader.parse(step))).toBe(JSON.stringify(step));
      expect(step.proof).toBe(await outputProof(step.from, 1));
      const output = await outputEvidence(step.from);
      expect(Object.hasOwn(output, 'proofVersion')).toBe(false);
    }
  });

  it('reports contents changed when an older proof exceeds the item limit', async () => {
    const folder = path.join(root, 'Output');
    const data = path.join(root, 'Profile');
    await mkdir(folder);
    await writeFile(path.join(folder, 'Child.txt'), 'retained', { flag: 'wx' });
    const proof = (await outputProof(folder, 1))!;
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
        completed: [],
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
          proof,
          identity: `${info.dev}:${info.ino}`,
          modified: info.mtimeMs,
          size: info.size,
        },
      ],
    });
    interleaving.many = folder;
    await expect(operations(data).undo(id)).rejects.toThrow('contents changed');
  });

  it('keeps unreadable entries selected at the same path', async () => {
    const file = path.join(root, 'Unreadable.txt');
    await writeFile(file, 'retained', { flag: 'wx' });
    const unreadable = { ...(await entry(file)), identity: '', error: 'Unreadable fixture' };
    expect(
      reconcileSelection([file], new Map([[file, unreadable]]), root, indexEntries([unreadable])),
    ).toEqual([file]);
  });

  it('uses exact devices to choose copy for a drop between rounded-looking different volumes', async () => {
    const source = path.join(root, 'Drop.txt');
    const destination = path.join(root, 'Destination');
    await mkdir(destination);
    await writeFile(source, 'drop bytes', { flag: 'wx' });
    interleaving.device = -1n;
    interleaving.foreign = destination;
    expect((await lstat(source)).dev).toBe((await lstat(destination)).dev);
    const service = operations();
    const id = service.start({ kind: 'transfer', sources: [source], destination });
    await service.drained();
    const job = service.all().find((job) => job.id === id)!;
    expect(job.status, JSON.stringify(job.errors)).toBe('completed');
    expect(native.copyMetadata).toHaveBeenCalled();
    expect(await readFile(source, 'utf8')).toBe('drop bytes');
    expect(await readFile(path.join(destination, 'Drop.txt'), 'utf8')).toBe('drop bytes');
  });

  it('verifies a high-inode preview grant against its open descriptor', async () => {
    const file = path.join(root, 'Preview.txt');
    await writeFile(file, 'preview bytes', { flag: 'wx' });
    await highInode(file, -1n);
    const resources = new Resources();
    try {
      const grant = await resources.grant(file);
      const response = await resources.response(new Request(grant.url!));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('preview bytes');
    } finally {
      await resources.close();
    }
  });

  it('normalizes native Trash metadata while retaining temporal item verification', async () => {
    const home = path.join(root, 'Home');
    const folder = path.join(home, '.Trash');
    await mkdir(home);
    await mkdir(folder, { mode: 0o700 });
    const file = path.join(folder, 'Retained.txt');
    await writeFile(file, 'trash bytes', { flag: 'wx' });
    await highInode(file, -1n);
    native.datesAdded.mockImplementation(async (files) =>
      Promise.all(
        files.map(async (file) => {
          const info = fileStats(await lstat(file, { bigint: true }));
          return {
            path: file,
            identity: nativeIdentityArgument(itemIdentity(info)),
            size: info.size,
            modified: info.mtimeMs,
            added: 1700000000000,
          };
        }),
      ),
    );
    const trash = new Trash(home, { require: async () => {} } as unknown as FileAccess);
    try {
      const snapshot = await trash.list();
      const item = snapshot.items.find((item) => item.name === 'Retained.txt')!;
      expect(item.addedToTrash).toBe(new Date(1700000000000).toISOString());
      await highInode(file, 42n);
      await trash.copyPaths([item.id]);
    } finally {
      trash.close();
    }
  });

  it('hands a fresh exact native identity to the Trash adapter after a temporal review', async () => {
    const file = path.join(root, 'Reviewed.txt');
    await writeFile(file, 'reviewed bytes', { flag: 'wx' });
    await highInode(file, -1n);
    const reviewed = (await inspectReviewedFile(file, 32768)).reviewed;
    const recorded = vi.fn(async (file: string) => ({ path: file, directory: false }));
    const adapter = adaptMacFiles({ trash: recorded } as unknown as NativeFileBindings);
    await adapter.trash(file, 'purpose', reviewed);
    const raw = nativeIdentityArgument(itemIdentity(await lstat(file, { bigint: true })));
    expect(recorded).toHaveBeenLastCalledWith(
      file,
      'purpose',
      expect.objectContaining({ version: expect.objectContaining({ identity: raw }) }),
    );
    expect(raw).toMatch(/:18446744073709551615$/);
    await highInode(file, 42n);
    await adapter.trash(file, 'purpose', reviewed);
    expect(recorded).toHaveBeenLastCalledWith(
      file,
      'purpose',
      expect.objectContaining({
        version: expect.objectContaining({ identity: raw.slice(0, raw.indexOf(':')) + ':42' }),
      }),
    );
  });

  it('hashes a versioned proof from exact device and temporal file evidence', async () => {
    const file = path.join(root, 'Proof.txt');
    await writeFile(file, 'proof bytes', { flag: 'wx' });
    await highInode(file, -1n);
    interleaving.device = -1n;
    const info = fileStats(await lstat(file, { bigint: true }));
    const expected = createHash('sha256')
      .update(
        JSON.stringify([
          '',
          '18446744073709551615:synthetic:file',
          info.size,
          info.mtimeMs,
          info.ctimeMs,
          info.mode,
          '',
        ]),
      )
      .digest('hex');
    const evidence = await outputEvidence(file);
    expect(evidence.proof).toBe(expected);
    expect(evidence.proofVersion).toBe(2);
    expect(evidence.proofSynthetic).toEqual(['']);
  });

  it('saves text read from an empty file after its synthetic inode changes', async () => {
    const file = path.join(root, 'Empty.txt');
    await writeFile(file, '', { flag: 'wx' });
    await highInode(file, -1n);
    const read = await readText(file);
    await highInode(file, -2n);
    const { sha256, ...version } = read.version;
    const job = await operations().writeText(file, 'saved content', { version, sha256 });
    expect(job.status, JSON.stringify(job.errors)).toBe('completed');
    expect(await readFile(file, 'utf8')).toBe('saved content');
  });

  it('undoes a new empty file after its synthetic inode changes', async () => {
    interleaving.createdSynthetic = true;
    const file = path.join(root, 'Empty.txt');
    const service = operations();
    const job = await service.writeText(file, '');
    expect(job.status).toBe('completed');
    await highInode(file, 42n);
    await service.undo(job.id);
    await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    const retained = (await readdir(root)).find((name) => name.startsWith('Retained '));
    expect((await lstat(path.join(root, retained!))).size).toBe(0);
  });

  it('undoes a folder copy whose empty descendant gets another synthetic inode', async () => {
    const source = path.join(root, 'Folder');
    const destination = path.join(root, 'Destination');
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(source, 'Empty.txt'), '', { flag: 'wx' });
    await highInode(path.join(source, 'Empty.txt'), -1n);
    interleaving.createdSynthetic = true;
    const service = operations();
    const id = service.start({ kind: 'copy', sources: [source], destination });
    await service.drained();
    expect(service.all().find((job) => job.id === id)?.status).toBe('completed');
    await highInode(path.join(destination, 'Folder/Empty.txt'), 42n);
    await service.undo(id);
    const retained = (await readdir(root)).find((name) => name.startsWith('Retained '));
    expect((await lstat(path.join(root, retained!, 'Empty.txt'))).size).toBe(0);
  });

  it('honors Replace when only the empty destination synthetic inode changed during the prompt', async () => {
    const source = path.join(root, 'report.txt');
    const destination = path.join(root, 'Destination');
    await mkdir(destination);
    const target = path.join(destination, 'report.txt');
    await writeFile(source, 'complete', { flag: 'wx' });
    await writeFile(target, '', { flag: 'wx' });
    await highInode(source, -1n);
    await highInode(target, -2n);
    const service = operations();
    const id = service.start({ kind: 'copy', sources: [source], destination });
    await vi.waitFor(() =>
      expect(service.all().find((job) => job.id === id)?.status).toBe('collision'),
    );
    await highInode(target, -30n);
    service.resolve(id, 'replace', false);
    await service.drained();
    expect(service.all().find((job) => job.id === id)?.status).toBe('completed');
    expect(await readFile(target, 'utf8')).toBe('complete');
  });

  it('verifies a cross-volume move after an empty source descendant changes synthetic inode', async () => {
    const source = path.join(root, 'Folder');
    const destination = path.join(root, 'Destination');
    await mkdir(source);
    await mkdir(destination);
    const child = path.join(source, 'Empty.txt');
    await writeFile(child, '', { flag: 'wx' });
    await highInode(child, -1n);
    interleaving.foreign = destination;
    interleaving.afterPublish = async () => {
      await highInode(child, -2n);
    };
    vi.spyOn(removal, 'unlinkVerified').mockImplementation(async (file) => {
      await rename(file, path.join(root, 'Preserved source ' + randomUUID()));
    });
    vi.spyOn(removal, 'removeEmptyDirectory').mockImplementation(async (file) => {
      expect(await readdir(file)).toEqual([]);
      await rename(file, path.join(root, 'Preserved folder ' + randomUUID()));
    });
    const service = operations();
    const id = service.start({ kind: 'move', sources: [source], destination });
    await service.drained();
    const job = service.all().find((job) => job.id === id)!;
    expect(job.status, JSON.stringify(job.errors)).toBe('completed');
    expect((await lstat(path.join(destination, 'Folder/Empty.txt'))).size).toBe(0);
    const retained = (await readdir(root)).find((name) => name.startsWith('Preserved source '));
    expect((await lstat(path.join(root, retained!))).size).toBe(0);
  });

  it('copies actual high-inode content through the path and descriptor checks', async () => {
    const source = path.join(root, 'report.txt');
    const destination = path.join(root, 'Destination');
    await mkdir(destination);
    await writeFile(source, 'complete high-inode bytes', { flag: 'wx' });
    await highInode(source, -1n);
    interleaving.afterRead = async () => {
      await highInode(source, -2n);
    };
    const service = operations();
    const id = service.start({ kind: 'copy', sources: [source], destination });
    await service.drained();
    const job = service.all().find((job) => job.id === id)!;
    expect(job.status, JSON.stringify(job.errors)).toBe('completed');
    expect(await readFile(path.join(destination, 'report.txt'), 'utf8')).toBe(
      'complete high-inode bytes',
    );
  });

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
    expect(receipt.undo[0]?.identity).toMatch(/:synthetic:file$/);
    await highInode(path.join(destination, 'report.txt'), 42n);
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
    await highInode(file, 42n);
    const second = await entry(file);
    expect(reconcileSelection([file], cache, root, indexEntries([second]))).toEqual([file]);
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
