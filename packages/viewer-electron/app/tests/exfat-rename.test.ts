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
import type { FileAccessIntent } from '../src/desktop/native/macos-files';
import type { FileAccess } from '../src/desktop/files/file-access';
import { publish } from '../src/desktop/operations/file-transfer';
import { renameExclusive } from '../src/desktop/operations/rename-exclusive';
import { Operations } from '../src/desktop/operations/operations';
import { Trash } from '../src/desktop/operations/trash';
import { privateStage } from '../src/desktop/operations/staging';
import * as removal from '../src/desktop/operations/removal';
import { temporaryRoot } from '../tools/temporary';

const native = vi.hoisted(() => ({
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
const operations: Operations[] = [];
const execute = promisify(execFile);
type ItemKind = 'file' | 'folder';
type Caller = 'publish' | 'undo-trash' | 'restore-replaced' | 'stage-cleanup' | 'trash-restore';
type Collision = 'file' | 'folder' | 'link' | 'dangling-link' | 'outside-link';
type Scenario =
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
interface NativeResult {
  error: number;
  cleanupError: number;
  reservations: number;
  commits: number;
  discards: number;
  retained: string;
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
  beforeRetry = undefined;
  destination = '';
  results = [];
  nativeRuns = 0;
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
    if (result.error)
      throw Object.assign(
        new Error(result.cleanupError ? 'Reservation cleanup failed' : 'Rename refused'),
        {
          code: getSystemErrorName(-result.error),
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
      if (!(await restore.call(service, task, target))) throw new Error('Restoration refused');
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

describe.skipIf(process.platform !== 'darwin')('publication without exclusive rename', () => {
  const callers: Caller[] = [
    'publish',
    'undo-trash',
    'restore-replaced',
    'stage-cleanup',
    'trash-restore',
  ];
  const kinds: ItemKind[] = ['file', 'folder'];

  describe.each(callers)('%s', (caller) => {
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
        discards: 1,
        cleanupError: 0,
      });
      const discarded = path.join(results[0]!.retained, 'Discarded reservation');
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
        else expect(await readFile(destination, 'utf8')).toBe('other');
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
      await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(results[0]).toMatchObject({ commits: 0, discards: 1, cleanupError: 0 });
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
