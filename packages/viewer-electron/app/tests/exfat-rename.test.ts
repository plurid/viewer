import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { getSystemErrorName, promisify } from 'node:util';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FileAccessIntent,
  NativeRenameRecovery,
  TrashReceipt,
} from '../src/desktop/native/macos-files';
import type { FileAccess } from '../src/desktop/files/file-access';
import { publish } from '../src/desktop/operations/file-transfer';
import { renameExclusive } from '../src/desktop/operations/rename-exclusive';
import { Operations } from '../src/desktop/operations/operations';
import { Trash } from '../src/desktop/operations/trash';
import { privateStage } from '../src/desktop/operations/staging';
import * as removal from '../src/desktop/operations/removal';
import { temporaryRoot } from '../tools/temporary';

const native = vi.hoisted(() => ({
  renameRecoveryVersion: 1 as number | undefined,
  trash: vi.fn<(file: string, purpose?: string) => Promise<TrashReceipt>>(),
  renameExclusive:
    vi.fn<
      (
        source: string,
        target: string,
        purpose?: string,
        allowReservation?: boolean,
      ) => Promise<void>
    >(),
  coordinateStart: vi.fn(async (_id: string, intents: FileAccessIntent[]) =>
    intents.map((intent) => intent.path),
  ),
  coordinateEnd: vi.fn(async () => {}),
  coordinateCancel: vi.fn(),
  coordinateSameItem: vi.fn(() => true),
  clone: vi.fn(async () => {
    throw Object.assign(new Error('No clones'), { code: 'ENOTSUP' });
  }),
  copyMetadata: vi.fn(async () => {}),
  volumes: vi.fn(async () => []),
  datesAdded: vi.fn(async () => []),
}));

vi.mock('../src/desktop/native/macos-files', () => ({ macFiles: () => native }));
vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

let root: string;
let runner: string;
let scenario: Scenario;
let beforeRetry: ((source: string, target: string) => Promise<void>) | undefined;
let destination: string;
let results: NativeResult[];
let nativeRuns: number;
let afterNative: ((result: NativeResult) => Promise<void>) | undefined;
const operations: Operations[] = [];
const execute = promisify(execFile);
type ItemKind = 'file' | 'folder';
type Caller = 'publish' | 'undo-trash' | 'restore-replaced' | 'stage-cleanup' | 'trash-restore';
type Collision = 'file' | 'folder' | 'link' | 'dangling-link' | 'outside-link';
type CleanupKind = 'file' | 'empty' | 'link' | 'fill' | 'folder' | 'folder-fill';
type CleanupAvailability = '' | '-occupied' | '-restore-fail' | '-restore-late';
type CleanupScenario = `cleanup-${CleanupKind}${CleanupAvailability}`;
type Scenario =
  | 'commit-exdev'
  | CleanupScenario
  | 'opened-folder-swap'
  | 'native'
  | 'open-fail-4'
  | 'open-fail-5'
  | 'open-fail-6'
  | 'normal'
  | 'fail'
  | 'swap-file'
  | 'swap-folder'
  | 'swap-link'
  | 'swap-dangling'
  | 'fill'
  | 'pause'
  | 'exclusive-io'
  | 'cleanup-fail';
interface NativeResult extends NativeRenameRecovery {
  error: number;
  cleanupError: number;
  reservations: number;
  commits: number;
  discards: number;
  retained: string;
  unsafeDiscards: number;
  claims: number;
  restores: number;
  closeOnExec: boolean;
  directoryReads: number;
  otherIdentity: string;
}
interface Fixture {
  source: string;
  relative: string;
  run(): Promise<unknown>;
}

beforeAll(async () => {
  if (process.platform !== 'darwin') return;
  const build = await temporaryRoot('viewer-rename-runner-');
  runner = path.join(build, 'exclusive-rename-test');
  await execute('xcrun', [
    'clang++',
    '-std=c++17',
    '-Wall',
    '-Wextra',
    '-Werror',
    'tools/exclusive-rename-test.cc',
    '-o',
    runner,
  ]);
});

beforeEach(async () => {
  root = await realpath(await temporaryRoot('viewer-exfat-rename-'));
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  scenario = 'normal';
  native.renameRecoveryVersion = 1;
  beforeRetry = undefined;
  afterNative = undefined;
  destination = '';
  results = [];
  nativeRuns = 0;
  native.trash.mockRejectedValue(Object.assign(new Error('No test Trash'), { code: 'ENOTSUP' }));
  native.renameExclusive.mockImplementation(async (source, target, _purpose, allowReservation) => {
    destination = target;
    if (!allowReservation) {
      await beforeRetry?.(source, target);
      throw Object.assign(new Error('Unsupported exclusive rename'), { code: 'ENOTSUP' });
    }
    const retained = path.join(root, 'Reservation evidence ' + ++nativeRuns);
    await mkdir(retained);
    await writeFile(path.join(retained, 'Sentinel.txt'), 'sentinel', { flag: 'wx' });
    const { stdout } = await execute(runner, [source, target, retained, scenario, 'reserve']);
    const result = { ...JSON.parse(stdout), retained } as NativeResult;
    results.push(result);
    await afterNative?.(result);
    if (result.error)
      throw Object.assign(
        new Error(result.cleanupError ? 'Reservation cleanup failed' : 'Rename refused'),
        {
          code: getSystemErrorName(-result.error),
          renameMessage: 'Rename refused',
          renameRecovery:
            result.entries.length || result.containers.length
              ? { entries: result.entries, containers: result.containers }
              : undefined,
        },
      );
  });
});

afterEach(async () => {
  for (const service of operations.splice(0)) await service.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function makeItem(file: string, kind: ItemKind): Promise<string> {
  if (kind === 'folder') await mkdir(file, { mode: 0o700 });
  const relative = kind === 'folder' ? 'Contents.txt' : '';
  await writeFile(path.join(file, relative), 'complete', { flag: 'wx' });
  return relative;
}

async function fixture(caller: Caller, kind: ItemKind): Promise<Fixture> {
  const folder = path.join(root, 'Destination');
  await mkdir(folder);
  destination = path.join(folder, 'Original');
  if (caller === 'stage-cleanup') {
    const stage = await privateStage(folder, '.viewer-transfer-');
    const relative = await makeItem(stage.file, kind);
    // Exercise production cleanup while every filesystem removal adapter retains its fixtures.
    vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
    vi.spyOn(removal, 'removeEmptyDirectory').mockRejectedValue(
      Object.assign(new Error('Stage holds content'), { code: 'ENOTEMPTY' }),
    );
    return {
      source: path.dirname(stage.file),
      relative: path.join('item', relative),
      run: () => stage.dispose(),
    };
  }
  if (caller === 'publish') {
    const source = path.join(root, 'Source');
    const relative = await makeItem(source, kind);
    const target = destination;
    return { source, relative, run: () => publish(source, target, async () => {}) };
  }
  const bin = path.join(root, '.Trash');
  await mkdir(bin, { mode: 0o700 });
  const source = path.join(bin, 'Original');
  if (caller === 'trash-restore') {
    const relative = await makeItem(source, kind);
    const access = { require: async () => {}, scoped: false } as unknown as FileAccess;
    const trash = new Trash(root, access);
    const snapshot = await trash.list();
    return {
      source,
      relative,
      run: () =>
        trash
          .restore({ isDestroyed: () => false } as BrowserWindow, [snapshot.items[0]!.id], {
            folder,
          })
          .finally(() => trash.close()),
    };
  }
  const target = destination;
  const relative = await makeItem(target, kind);
  const service = new Operations(
    async (file) => {
      await rename(file, source);
      return { path: source, directory: kind === 'folder' };
    },
    () => {},
  );
  operations.push(service);
  const id = service.start({ kind: 'trash', sources: [target] });
  await service.drained();
  expect(service.all().find((job) => job.id === id)).toMatchObject({
    status: 'completed',
    undoable: true,
  });
  if (caller === 'undo-trash') return { source, relative, run: () => service.undo(id) };
  const task = (Reflect.get(service, 'tasks') as Map<string, unknown>).get(id);
  const restore = Reflect.get(service, 'restoreReplaced') as (
    task: unknown,
    destination: string,
  ) => Promise<boolean>;
  return {
    source,
    relative,
    run: async () => {
      if (!(await restore.call(service, task, target)))
        throw new Error(
          'Restoration refused. ' +
            service
              .all()
              .find((job) => job.id === id)!
              .errors.map((error) => error.message)
              .join(' '),
        );
    },
  };
}

async function collision(target: string, kind: Collision): Promise<void> {
  if (kind === 'folder') return mkdir(target).then(() => {});
  if (kind === 'file') return writeFile(target, 'other', { flag: 'wx' });
  const sentinel =
    kind === 'outside-link'
      ? path.join(root, 'Outside.txt')
      : path.join(path.dirname(target), 'Sentinel.txt');
  if (kind !== 'dangling-link') await writeFile(sentinel, 'sentinel', { flag: 'wx' });
  await symlink(kind === 'dangling-link' ? path.join(root, 'Missing') : sentinel, target);
}

async function expectOtherItem(file: string, kind: CleanupKind, directory: boolean): Promise<void> {
  const info = await lstat(file);
  if (kind === 'link') {
    expect(info.isSymbolicLink()).toBe(true);
    expect(await readFile(await readlink(file), 'utf8')).toBe('sentinel');
  } else if (kind === 'folder') {
    expect(info.isDirectory()).toBe(true);
    expect(await readdir(file)).toEqual([]);
  } else if (kind === 'folder-fill' || (kind === 'fill' && directory)) {
    expect(await readFile(path.join(file, 'Other.txt'), 'utf8')).toBe('other');
  } else {
    expect(info.isFile()).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(
      kind === 'empty' ? '' : kind === 'fill' ? 'other' : 'other process content',
    );
  }
}

describe.skipIf(process.platform !== 'darwin')('publication without exclusive rename', () => {
  const cleanupKinds: CleanupKind[] = ['file', 'empty', 'link', 'fill', 'folder', 'folder-fill'];
  const recoveryCases = (['file', 'folder'] as const).flatMap((kind) =>
    cleanupKinds.flatMap((interleaving) =>
      ([false, true] as const).map((occupied) => ({
        kind,
        interleaving,
        occupied,
      })),
    ),
  );
  it.each(recoveryCases)(
    'preserves and reports cleanup $interleaving for a $kind with occupied destination: $occupied',
    async ({ kind, interleaving, occupied }) => {
      const source = path.join(root, 'Source.txt');
      const target = path.join(root, 'Published.txt');
      const evidence = path.join(root, 'Evidence');
      const relative = await makeItem(source, kind);
      await mkdir(evidence);
      await writeFile(path.join(evidence, 'Sentinel.txt'), 'sentinel', { flag: 'wx' });
      const testCase = `cleanup-${interleaving}${occupied ? '-occupied' : ''}`;
      const { stdout } = await execute(runner, [source, target, evidence, testCase, 'reserve']);
      const result = JSON.parse(stdout) as NativeResult;
      expect(result.unsafeDiscards).toBe(0);
      expect(result.error).not.toBe(0);
      const entry = result.entries.find(
        (entry) => entry.kind === (occupied ? 'kept' : 'restored'),
      )!;
      expect(entry).toBeDefined();
      expect(entry.path).toBe(occupied ? path.join(result.containers[0]!.path, 'item') : target);
      expect(`${(await lstat(entry.path)).dev}:${(await lstat(entry.path)).ino}`).toBe(
        result.otherIdentity,
      );
      expect(
        result.entries.some(
          (candidate) => candidate.kind === 'reservation' && candidate.path === entry.path,
        ),
      ).toBe(false);
      await expectOtherItem(entry.path, interleaving, kind === 'folder');
      if (occupied) expect(await readFile(target, 'utf8')).toBe('new occupant');
      expect(await readFile(path.join(source, relative), 'utf8')).toBe('complete');
    },
  );

  it('keeps native recovery free of permanent-removal calls', async () => {
    const header = await readFile('tools/exclusive-rename.h', 'utf8');
    expect(header).not.toMatch(/\b(?:unlink|unlinkat|rmdir|remove)\b/);
  });

  it('binds folder identity to the descriptor before a path replacement', async () => {
    const item = await fixture('publish', 'folder');
    scenario = 'opened-folder-swap';
    await expect(item.run()).rejects.toThrow(destination);
    const result = results[0]!;
    expect(result).toMatchObject({ commits: 0, restores: 1, discards: 0 });
    expect(`${(await lstat(destination)).dev}:${(await lstat(destination)).ino}`).toBe(
      result.otherIdentity,
    );
    expect(await readdir(destination)).toEqual([]);
    expect(result.entries).toEqual([
      expect.objectContaining({ kind: 'restored', path: destination }),
    ]);
    expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
  });

  it('keeps directory-reader descriptors closed on exec', async () => {
    const item = await fixture('publish', 'folder');
    await item.run();
    expect(results[0]!.directoryReads).toBeGreaterThan(0);
    expect(results[0]!.closeOnExec).toBe(true);
  });

  it.each(['file', 'folder'] as const)(
    'retains every item when restoring a captured %s fails',
    async (kind) => {
      const item = await fixture('publish', kind);
      scenario = `cleanup-${kind}-restore-fail`;
      let failure: unknown;
      try {
        await item.run();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      const recovery = results[0]!;
      const foreign = recovery.entries.find((entry) => entry.kind === 'kept')!;
      const empty = recovery.entries.find((entry) => entry.kind === 'reservation')!;
      expect(String(failure)).toContain(foreign.path);
      expect(String(failure)).toContain(empty.path);
      await expectOtherItem(foreign.path, kind, kind === 'folder');
      await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
      expect(native.trash).not.toHaveBeenCalled();
    },
  );

  it('keeps both foreign items when a second writer wins during restoration', async () => {
    const item = await fixture('publish', 'file');
    scenario = 'cleanup-file-restore-late';
    let failure: unknown;
    try {
      await item.run();
    } catch (error) {
      failure = error;
    }
    const kept = results[0]!.entries.filter((entry) => entry.kind === 'kept');
    expect(kept).toHaveLength(2);
    for (const entry of kept) {
      expect(String(failure)).toContain(entry.path);
      expect(await readFile(entry.path, 'utf8')).toBe('other process content');
    }
    expect(native.trash).not.toHaveBeenCalled();
    expect(await readFile(item.source, 'utf8')).toBe('complete');
  });

  it('trashes only the empty restoration slot while keeping a foreign sibling', async () => {
    const item = await fixture('publish', 'file');
    scenario = 'cleanup-file-restore-fail';
    vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
    const bin = path.join(root, 'Retained empty slot');
    native.trash.mockImplementation(async (file) => {
      const empty = results[0]!.entries.find((entry) => entry.kind === 'reservation')!;
      expect(file).toBe(empty.path);
      expect((await lstat(file)).size).toBe(0);
      await rename(file, bin);
      return { path: bin, directory: false };
    });
    let failure: unknown;
    try {
      await item.run();
    } catch (error) {
      failure = error;
    }
    const kept = results[0]!.entries.find((entry) => entry.kind === 'kept')!;
    expect(await readFile(kept.path, 'utf8')).toBe('other process content');
    expect(String(failure)).toContain(kept.path);
    expect(native.trash).toHaveBeenCalledTimes(1);
    expect((await lstat(bin)).size).toBe(0);
    expect((await lstat(results[0]!.containers[0]!.path)).isDirectory()).toBe(true);
  });

  it('keeps a substituted private holding folder out of the Trash', async () => {
    const item = await fixture('publish', 'file');
    scenario = 'fail';
    vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
    let folder = '';
    afterNative = async (result) => {
      folder = result.containers[0]!.path;
      await rename(folder, folder + '-original');
      await mkdir(folder);
      await writeFile(path.join(folder, 'Other.txt'), 'other process content', { flag: 'wx' });
    };
    await expect(item.run()).rejects.toThrow('recovery folder changed');
    expect(await readFile(path.join(folder, 'Other.txt'), 'utf8')).toBe('other process content');
    expect(native.trash).not.toHaveBeenCalled();
  });

  it('reports a protected path when the stage move back also fails', async () => {
    const item = await fixture('stage-cleanup', 'file');
    let changed = false;
    afterNative = async (result) => {
      if (changed || result.error) return;
      changed = true;
      const published = destination;
      await rename(published, published + '-original');
      await mkdir(published);
      await writeFile(path.join(published, 'Other.txt'), 'stage replacement', { flag: 'wx' });
      scenario = 'cleanup-file-occupied';
    };
    let failure: unknown;
    try {
      await item.run();
    } catch (error) {
      failure = error;
    }
    const kept = results[1]!.entries.find((entry) => entry.kind === 'kept')!;
    expect(String(failure)).toContain(kept.path);
    expect(await readFile(kept.path, 'utf8')).toBe('other process content');
  });

  it('reports a private recovery path even when the job was cancelled during the native reply', async () => {
    const source = path.join(root, 'Copy.txt');
    const folder = path.join(root, 'Destination');
    await writeFile(source, 'complete', { flag: 'wx' });
    await mkdir(folder);
    const service = new Operations(
      async () => {
        throw new Error('No test removal');
      },
      () => {},
    );
    operations.push(service);
    scenario = 'cleanup-file-occupied';
    afterNative = async () => service.cancel(id);
    const id = service.start({ kind: 'copy', sources: [source], destination: folder });
    await service.drained();
    const job = service.all().find((job) => job.id === id)!;
    const held = results[0]!.entries.find((entry) => entry.kind === 'kept')!;
    expect(job.status).toBe('cancelled');
    expect(
      job.errors.some((error) => error.path === held.path && error.message.includes(held.path)),
    ).toBe(true);
    expect(await readFile(held.path, 'utf8')).toBe('other process content');
    expect(await readFile(source, 'utf8')).toBe('complete');
  });

  it('keeps case-rename rollback recovery in the original error', async () => {
    const source = path.join(root, 'Case.txt');
    const target = path.join(root, 'CASE.txt');
    await writeFile(source, 'complete', { flag: 'wx' });
    const service = new Operations(
      async () => {
        throw new Error('No test removal');
      },
      () => {},
    );
    operations.push(service);
    beforeRetry = async (_source, destination) => {
      if (destination !== target) return;
      beforeRetry = async () => {
        beforeRetry = undefined;
        scenario = 'cleanup-file-occupied';
      };
      throw Object.assign(new Error('Case rename failed'), { code: 'EIO' });
    };
    const changeCase = Reflect.get(service, 'changeCase') as (
      source: string,
      target: string,
    ) => Promise<void>;
    let failure: unknown;
    try {
      await changeCase.call(service, source, target);
    } catch (error) {
      failure = error;
    }
    const held = results[1]!.entries.find((entry) => entry.kind === 'kept')!;
    expect(String(failure)).toContain('Case rename failed');
    expect(String(failure)).toContain(held.path);
    expect(await readFile(held.path, 'utf8')).toBe('other process content');
  });

  it('reports kept reservations when EXDEV starts a streamed move', async () => {
    const source = path.join(root, 'Move.txt');
    const folder = path.join(root, 'Destination');
    await writeFile(source, 'complete', { flag: 'wx' });
    await mkdir(folder);
    const service = new Operations(
      async () => {
        throw new Error('No test removal');
      },
      () => {},
    );
    operations.push(service);
    scenario = 'commit-exdev';
    afterNative = async () => {
      scenario = 'normal';
    };
    const id = service.start({ kind: 'move', sources: [source], destination: folder });
    await service.drained();
    const kept = results[0]!.entries.find((entry) => entry.kind === 'reservation')!;
    const job = service.all().find((job) => job.id === id)!;
    expect(job.errors.some((error) => error.message.includes(kept.path))).toBe(true);
    expect(await readFile(source, 'utf8')).toBe('complete');
    expect(await readFile(path.join(folder, 'Move.txt'), 'utf8')).toBe('complete');
  });

  it('reports final and private paths when claiming a failed reservation is refused', async () => {
    const item = await fixture('publish', 'file');
    scenario = 'cleanup-fail';
    let failure: unknown;
    try {
      await item.run();
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain(destination);
    expect(String(failure)).toContain(results[0]!.containers[0]!.path);
    expect((await lstat(destination)).size).toBe(0);
    expect(await readFile(item.source, 'utf8')).toBe('complete');
  });

  const disposals = (['file', 'folder'] as const).flatMap((kind) =>
    (['trash', 'no-trash', 'preserved'] as const).map((policy) => ({ kind, policy })),
  );
  it.each(disposals)(
    'handles an owned empty $kind through the removal module: $policy',
    async ({ kind, policy }) => {
      const item = await fixture('publish', kind);
      scenario = 'fail';
      const bin = path.join(root, 'Retained Trash adapter');
      await mkdir(bin);
      let trashed = 0;
      if (policy !== 'preserved') {
        vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
        vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
      }
      if (policy === 'trash')
        native.trash.mockImplementation(async (file) => {
          const info = await lstat(file);
          if (info.isDirectory()) expect(await readdir(file)).toEqual([]);
          else expect(info.size).toBe(0);
          const target = path.join(bin, String(++trashed));
          await rename(file, target);
          return { path: target, directory: info.isDirectory() };
        });
      let failure: unknown;
      try {
        await item.run();
      } catch (error) {
        failure = error;
      }
      const recovery = results[0]!;
      const reservation = recovery.entries.find((entry) => entry.kind === 'reservation')!;
      await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
      if (policy === 'trash') {
        expect(trashed).toBe(2);
        expect(String(failure)).toContain('moved to the Trash');
        await expect(lstat(reservation.path)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(recovery.containers[0]!.path)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readdir(bin)).toHaveLength(2);
      } else {
        expect(String(failure)).toContain(reservation.path);
        expect((await lstat(reservation.path)).isDirectory()).toBe(kind === 'folder');
        if (policy === 'preserved') expect(native.trash).not.toHaveBeenCalled();
        else expect(native.trash).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(['file', 'empty', 'link', 'fill', 'folder-fill'] as const)(
    'never trashes a %s substituted at a private recovery path',
    async (kind) => {
      const item = await fixture('publish', kind === 'folder-fill' ? 'folder' : 'file');
      scenario = 'fail';
      vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
      vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
      let changed = '';
      afterNative = async (result) => {
        const entry = result.entries.find((entry) => entry.kind === 'reservation')!;
        changed = entry.path;
        if (kind !== 'fill' && kind !== 'folder-fill') await rename(changed, changed + '-original');
        if (kind === 'link') {
          const sentinel = path.join(root, 'Private sentinel');
          await writeFile(sentinel, 'sentinel', { flag: 'wx' });
          await symlink(sentinel, changed);
        } else if (kind === 'folder-fill') {
          await writeFile(path.join(changed, 'Other.txt'), 'other', { flag: 'wx' });
        } else {
          await writeFile(
            changed,
            kind === 'empty' ? '' : kind === 'fill' ? 'other' : 'other process content',
            { flag: kind === 'fill' ? 'w' : 'wx' },
          );
        }
      };
      await expect(item.run()).rejects.toThrow('kept at');
      await expectOtherItem(changed, kind, kind === 'folder-fill');
      expect(native.trash).not.toHaveBeenCalled();
    },
  );
  const callers: Caller[] = [
    'publish',
    'undo-trash',
    'restore-replaced',
    'stage-cleanup',
    'trash-restore',
  ];
  const kinds: ItemKind[] = ['file', 'folder'];

  describe.each(callers)('%s', (caller) => {
    it.each(cleanupKinds)('reports a protected %s held aside during cleanup', async (kind) => {
      const item = await fixture(caller, 'file');
      scenario = `cleanup-${kind}-occupied`;
      let failure: unknown;
      try {
        await item.run();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      const held = results[0]!.entries.find((entry) => entry.kind === 'kept')!;
      expect(held).toBeDefined();
      expect(String(failure)).toContain(held.path);
      await expectOtherItem(held.path, kind, caller === 'stage-cleanup');
      expect(await readFile(destination, 'utf8')).toBe('new occupant');
      expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
      expect(native.trash).not.toHaveBeenCalled();
    });
    it.each(kinds)('publishes a complete %s', async (kind) => {
      const item = await fixture(caller, kind);
      await item.run();
      expect(await readFile(path.join(destination, item.relative), 'utf8')).toBe('complete');
      await expect(lstat(item.source)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(results).toEqual([
        expect.objectContaining({ error: 0, reservations: 1, commits: 1, discards: 0 }),
      ]);
    });

    it.each(['file', 'folder', 'link', 'dangling-link', 'outside-link'] as const)(
      'preserves a colliding %s, including one arriving after native preflight',
      async (kind) => {
        const item = await fixture(caller, 'file');
        let identity: string;
        beforeRetry = async (_source, target) => {
          await collision(target, kind);
          const info = await lstat(target);
          identity = `${info.dev}:${info.ino}`;
        };
        await expect(item.run()).rejects.toThrow();
        expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
        const info = await lstat(destination);
        expect(`${info.dev}:${info.ino}`).toBe(identity!);
        expect(results[0]).toMatchObject({ reservations: 0, commits: 0, discards: 0 });
        if (kind === 'file') expect(await readFile(destination, 'utf8')).toBe('other');
        if (kind === 'folder') expect(await readdir(destination)).toEqual([]);
        if (kind === 'link' || kind === 'outside-link')
          expect(await readFile(await readlink(destination), 'utf8')).toBe('sentinel');
        if (kind === 'dangling-link')
          expect(await readlink(destination)).toBe(path.join(root, 'Missing'));
      },
    );

    it.each(kinds)('clears only its empty reservation after a failing %s rename', async (kind) => {
      const item = await fixture(caller, kind);
      scenario = 'fail';
      await expect(item.run()).rejects.toThrow();
      await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
      expect(results[0]).toMatchObject({
        reservations: 1,
        commits: 1,
        claims: 1,
        discards: 0,
        cleanupError: 0,
      });
      const discarded = results[0]!.entries.find((entry) => entry.kind === 'reservation')!.path;
      if ((await lstat(discarded)).isDirectory()) expect(await readdir(discarded)).toEqual([]);
      else expect((await lstat(discarded)).size).toBe(0);
    });

    it('keeps a competing publisher’s completed item at the reserved name', async () => {
      const item = await fixture(caller, 'file');
      const rival = path.join(root, 'Rival.txt');
      await writeFile(rival, 'rival', { flag: 'wx' });
      scenario = 'pause';
      let competing: Promise<void> | undefined;
      beforeRetry = async (_source, target) => {
        beforeRetry = undefined;
        competing = renameExclusive(rival, target);
        await vi.waitFor(async () => expect(await lstat(target)).toBeDefined(), { interval: 5 });
      };
      await expect(item.run()).rejects.toThrow();
      await competing;
      expect(await readFile(destination, 'utf8')).toBe('rival');
      expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
      expect(results.reduce((sum, result) => sum + result.reservations, 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + result.discards, 0)).toBe(0);
    });

    it.each(['swap-file', 'swap-folder', 'swap-link', 'swap-dangling', 'fill'] as const)(
      'leaves another process’s item untouched on %s',
      async (interleaving) => {
        const item = await fixture(caller, 'file');
        scenario = interleaving;
        await expect(item.run()).rejects.toThrow();
        expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
        expect(results[0]).toMatchObject({ reservations: 1, commits: 0, discards: 0 });
        const info = await lstat(destination);
        if (interleaving === 'swap-folder') expect(await readdir(destination)).toEqual([]);
        else if (interleaving === 'swap-link' || interleaving === 'swap-dangling') {
          expect(info.isSymbolicLink()).toBe(true);
          expect(await readFile(path.join(results[0]!.retained, 'Sentinel.txt'), 'utf8')).toBe(
            'sentinel',
          );
        } else if (info.isDirectory())
          expect(await readFile(path.join(destination, 'Other.txt'), 'utf8')).toBe('other');
        else
          expect(await readFile(destination, 'utf8')).toBe(
            interleaving === 'fill' ? 'other' : 'other process content',
          );
      },
    );
  });

  it.each(['EEXIST', 'EXDEV', 'EACCES', 'EPERM', 'EIO', 'EINVAL', 'ENOSYS', undefined])(
    'does not retry %s or infer unsupported from English text',
    async (code) => {
      const failure = Object.assign(new Error('Operation not supported'), { code });
      native.renameExclusive.mockRejectedValue(failure);
      await expect(renameExclusive('/generated/source', '/generated/target')).rejects.toBe(failure);
      expect(native.renameExclusive).toHaveBeenCalledTimes(1);
      expect(results).toEqual([]);
    },
  );

  it.each([undefined, 0])('fails safely with an older helper capability %s', async (version) => {
    const item = await fixture('publish', 'file');
    native.renameRecoveryVersion = version;
    await expect(item.run()).rejects.toMatchObject({ code: 'ENOTSUP' });
    expect(native.renameExclusive).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]);
    expect(await readFile(item.source, 'utf8')).toBe('complete');
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves a supported native exclusive rename unchanged', async () => {
    native.renameExclusive.mockImplementation(async (source, target) => {
      const retained = path.join(root, 'Unused reservation evidence');
      await mkdir(retained);
      const { stdout } = await execute(runner, [source, target, retained, 'native', 'reserve']);
      expect(JSON.parse(stdout)).toMatchObject({
        error: 0,
        reservations: 0,
        commits: 0,
        discards: 0,
      });
      expect(await readdir(retained)).toEqual([]);
    });
    const item = await fixture('publish', 'file');
    await item.run();
    expect(native.renameExclusive).toHaveBeenCalledTimes(1);
    expect(native.renameExclusive.mock.calls[0]).toHaveLength(3);
    expect(results).toEqual([]);
  });

  it.each(['open-fail-4', 'open-fail-5', 'open-fail-6'] as const)(
    'clears only its empty directory reservation under descriptor exhaustion: %s',
    async (limit) => {
      const item = await fixture('publish', 'folder');
      scenario = limit;
      await expect(item.run()).rejects.toMatchObject({ code: 'EMFILE' });
      expect(results[0]).toMatchObject({ commits: 0, discards: 0 });
      if (results[0]!.containers.length)
        await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect((await lstat(destination)).isDirectory()).toBe(true);
      expect(results[0]!.entries.length).toBeGreaterThan(0);
      expect(await readFile(path.join(item.source, item.relative), 'utf8')).toBe('complete');
    },
  );

  it('requires the native retry itself to report unsupported before reserving', async () => {
    const item = await fixture('publish', 'file');
    scenario = 'exclusive-io';
    await expect(item.run()).rejects.toMatchObject({ code: 'EIO' });
    expect(results[0]).toMatchObject({ reservations: 0, commits: 0, discards: 0 });
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses names that were already occupied before publication without following links', async () => {
    const source = path.join(root, 'Source.txt');
    await writeFile(source, 'complete', { flag: 'wx' });
    for (const kind of ['file', 'folder', 'link', 'dangling-link', 'outside-link'] as const) {
      const folder = path.join(root, kind);
      await mkdir(folder);
      const target = path.join(folder, 'Occupied');
      await collision(target, kind);
      const before = await lstat(target);
      await expect(publish(source, target, async () => {})).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect((await lstat(target)).ino).toBe(before.ino);
    }
    expect(await readFile(source, 'utf8')).toBe('complete');
  });

  it('renames a source link without opening its target', async () => {
    const source = path.join(root, 'Link');
    const target = path.join(root, 'Published link');
    await symlink(path.join(root, 'Absent.txt'), source);
    await renameExclusive(source, target);
    expect((await lstat(target)).isSymbolicLink()).toBe(true);
    expect(await readlink(target)).toBe(path.join(root, 'Absent.txt'));
  });

  it.each(['ENOTSUP', 'EOPNOTSUPP'])(
    'retries only structured %s with the original purpose',
    async (code) => {
      const item = await fixture('publish', 'file');
      const implementation = native.renameExclusive.getMockImplementation()!;
      native.renameExclusive.mockImplementation(async (source, target, purpose, allowed) => {
        if (!allowed) throw Object.assign(new Error('Localized failure'), { code });
        return implementation(source, target, purpose, allowed);
      });
      await item.run();
      const calls = native.renameExclusive.mock.calls;
      expect(calls[1]).toEqual([...calls[0]!, true]);
    },
  );

  it('checks cancellation after unsupported rename and creates no reservation', async () => {
    const abort = new AbortController();
    beforeRetry = async () => abort.abort();
    const item = await fixture('publish', 'file');
    await expect(
      publish(item.source, destination, async () => {}, undefined, undefined, abort.signal),
    ).rejects.toThrow();
    expect(results).toEqual([]);
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(item.source, 'utf8')).toBe('complete');
  });

  it('cancels an operation waiting to retry publication without publishing or removing its stage', async () => {
    const source = path.join(root, 'Copy.txt');
    const target = path.join(root, 'Destination');
    await writeFile(source, 'complete', { flag: 'wx' });
    await mkdir(target);
    const service = new Operations(
      async () => {
        throw new Error('No removal');
      },
      () => {},
    );
    operations.push(service);
    beforeRetry = async () => service.cancel(id);
    const id = service.start({ kind: 'copy', sources: [source], destination: target });
    await service.drained();
    expect(service.all().find((job) => job.id === id)).toMatchObject({
      status: 'cancelled',
      completed: [],
    });
    expect(results).toEqual([]);
    await expect(lstat(path.join(target, 'Copy.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    const stages = (await readdir(target)).filter((name) => name.startsWith('.viewer-transfer-'));
    expect(stages).toHaveLength(1);
    expect(await readFile(path.join(target, stages[0]!, 'item'), 'utf8')).toBe('complete');
  });

  it('keeps an agent’s replacement Trash-only on an unsupported-rename volume', async () => {
    const source = path.join(root, 'Agent.txt');
    const target = path.join(root, 'Destination');
    await writeFile(source, 'complete', { flag: 'wx' });
    await mkdir(target);
    await writeFile(path.join(target, 'Agent.txt'), 'other', { flag: 'wx' });
    const service = new Operations(
      async () => {
        throw Object.assign(new Error('No Trash'), { code: 'ENOTSUP' });
      },
      () => {},
    );
    operations.push(service);
    const id = service.start({ kind: 'copy', sources: [source], destination: target }, 'agent');
    await vi.waitFor(() =>
      expect(service.all().find((job) => job.id === id)?.status).toBe('collision'),
    );
    service.resolve(id, 'replace', false);
    await service.drained();
    const job = service.all().find((job) => job.id === id)!;
    expect(job.status).toBe('failed');
    expect(job.errors[0]?.message).toContain(
      'agents replace items only by moving them to the Trash',
    );
    expect(await readFile(path.join(target, 'Agent.txt'), 'utf8')).toBe('other');
    expect(await readFile(source, 'utf8')).toBe('complete');
    expect(native.renameExclusive).not.toHaveBeenCalled();
  });

  it.each(kinds)(
    'lets only one of two simultaneous %s publishers reserve the name',
    async (kind) => {
      const first = path.join(root, 'First');
      const second = path.join(root, 'Second');
      const target = path.join(root, 'Published');
      const relative = await makeItem(first, kind);
      await makeItem(second, kind);
      scenario = 'pause';
      const outcomes = await Promise.allSettled([
        renameExclusive(first, target),
        renameExclusive(second, target),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await readFile(path.join(target, relative), 'utf8')).toBe('complete');
      expect(results.reduce((sum, result) => sum + result.reservations, 0)).toBe(1);
      expect(
        (
          await Promise.all([first, second].map((file) => lstat(file).catch(() => undefined)))
        ).filter(Boolean),
      ).toHaveLength(1);
    },
  );

  it('does not bypass the native coordinator for the Store edition', async () => {
    const previous = Object.getOwnPropertyDescriptor(process, 'mas');
    Object.defineProperty(process, 'mas', { configurable: true, value: true });
    try {
      const item = await fixture('publish', 'file');
      await item.run();
      expect(native.renameExclusive.mock.calls[1]?.[3]).toBe(true);
      expect(native.coordinateStart).toHaveBeenCalled();
    } finally {
      if (previous) Object.defineProperty(process, 'mas', previous);
      else Reflect.deleteProperty(process, 'mas');
    }
  });
});
