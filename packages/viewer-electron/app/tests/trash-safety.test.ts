/** Pure and mocked safety regressions. No filesystem removals or real native menus. */
import { beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { Trash } from '../src/desktop/operations/trash';
import {
  applicationsPath,
  linuxMounts,
  trashRoots,
} from '../src/desktop/operations/trash-locations';
import { trashName, forbiddenTrashCommands } from '../src/domain/files/trash';
import { agentCommandID } from '../src/domain/agents/safety';
import type { FileAccess } from '../src/desktop/files/file-access';
import type { BrowserWindow } from 'electron';

const mock = vi.hoisted(() => ({
  files: new Map<
    string,
    {
      directory: boolean;
      link?: boolean;
      uid: number;
      ino: number;
      mode: number;
      size: number;
      modified: number;
      canonical?: string;
    }
  >(),
  native: vi.fn(),
  move: vi.fn(),
  dates: vi.fn(),
  clipboard: vi.fn(),
  open: vi.fn(),
  confirm: vi.fn(),
  menu: vi.fn(),
  execute: vi.fn(),
  read: vi.fn(),
  settings: vi.fn(async () => {}),
}));
vi.mock('../src/desktop/native/macos-files', () => ({
  macFiles: () => ({
    volumes: async () => [
      { path: '/', name: 'Local' },
      { path: '/Volumes/External', name: 'External' },
    ],
    trashConfirmation: mock.native,
    renameExclusive: mock.move,
    datesAdded: mock.dates,
  }),
}));
vi.mock('electron', () => ({
  clipboard: { writeText: mock.clipboard },
  dialog: { showOpenDialog: mock.open, showMessageBox: mock.confirm },
  shell: { openExternal: mock.settings },
}));
vi.mock('node:child_process', () => ({ execFile: mock.execute }));
vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(async (file: string) => {
    const value = mock.files.get(file);
    if (!value) throw Object.assign(new Error('Missing fixture'), { code: 'ENOENT' });
    return {
      dev: 1,
      ino: value.ino,
      uid: value.uid,
      mode: value.mode,
      size: value.size,
      mtimeMs: value.modified,
      isDirectory: () => value.directory,
      isSymbolicLink: () => !!value.link,
      isFile: () => !value.directory && !value.link,
    };
  }),
  readdir: vi.fn(async (folder: string) =>
    [...mock.files.keys()]
      .filter((file) => file !== folder && path.dirname(file) === folder)
      .map((file) => path.basename(file)),
  ),
  realpath: vi.fn(async (file: string) => mock.files.get(file)?.canonical ?? file),
  readFile: mock.read,
}));
const home = '/Users/Fixture';
const root = home + '/.Trash';
const window = { isDestroyed: () => false } as BrowserWindow;
let access: { require: ReturnType<typeof vi.fn>; remember: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  mock.files.clear();
  mock.open.mockReset();
  mock.move.mockReset();
  mock.dates.mockReset().mockResolvedValue([]);
  mock.move.mockImplementation(async (source: string, target: string) => {
    if (mock.files.has(target)) throw new Error('Destination already exists.');
    for (const [file, value] of [...mock.files]) {
      if (file === source || file.startsWith(source + path.sep)) {
        mock.files.set(target + file.slice(source.length), value);
        mock.files.delete(file);
      }
    }
  });
  const uid = process.getuid!();
  mock.files.set(root, { directory: true, uid, ino: 1, mode: 0o40700, size: 64, modified: 1000 });
  mock.files.set(root + '/Notes.txt', {
    directory: false,
    uid,
    ino: 2,
    mode: 0o100600,
    size: 13,
    modified: 1000,
  });
  access = { require: vi.fn(async () => {}), remember: vi.fn(async () => {}) };
});
const service = () => new Trash(home, access as unknown as FileAccess);

it('names system locations and uses the platform’s actual Applications path', () => {
  expect(trashName('win32')).toBe('Recycle Bin');
  expect(trashName('linux')).toBe('Trash');
  expect(applicationsPath('darwin', home)).toBe('/Applications');
  expect(applicationsPath('win32', 'D:\\Users\\Fixture', 'E:\\Programs')).toBe('E:\\Programs');
  expect(applicationsPath('linux', '/home/fixture')).toBe('/usr/share/applications');
  expect(
    trashRoots('darwin', home, 501, [
      { path: '/', name: 'Local' },
      { path: '/Volumes/Disk', name: 'Disk' },
    ]),
  ).toEqual([
    { path: root, name: 'Home' },
    { path: '/Volumes/Disk/.Trashes/501', name: 'Disk', shared: '/Volumes/Disk/.Trashes' },
  ]);
  const linux = trashRoots(
    'linux',
    '/home/f',
    1000,
    [{ path: '/media/Disk', name: 'Disk' }],
    '/home/f/.data',
  );
  expect(linux.map((root) => root.path)).toEqual([
    '/home/f/.data/Trash/files',
    '/media/Disk/.Trash/1000/files',
    '/media/Disk/.Trash-1000/files',
  ]);
});
it('decodes mountinfo escaping and skips pseudo filesystems', () => {
  expect(
    linuxMounts(
      '1 0 8:1 / /media/Some\\040Disk rw - ext4 /dev/sda rw\n2 0 0:1 / /proc rw - proc proc rw',
    ),
  ).toEqual([{ path: '/media/Some Disk', name: 'Some Disk' }]);
});
it('lists Trash without launching a confirmation or removal process', async () => {
  const value = await service().list();
  expect(value.items).toMatchObject([
    { name: 'Notes.txt', directory: false, size: 13, location: 'Home' },
  ]);
  expect(value.canEmpty).toBe(true);
  expect(mock.native).not.toHaveBeenCalled();
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.confirm).not.toHaveBeenCalled();
});
it('uses verified macOS date-added metadata without calling it a deletion date', async () => {
  mock.dates.mockResolvedValue([
    {
      path: root + '/Notes.txt',
      identity: '1:2',
      size: 13,
      modified: 1000,
      added: Date.parse('2026-10-14T12:34:00Z'),
    },
  ]);
  const trash = service();
  const value = await trash.list();
  expect(value.items[0].addedToTrash).toBe('2026-10-14T12:34:00.000Z');
  expect(value.items[0].deleted).toBeUndefined();
  await trash.list();
  expect(mock.dates).toHaveBeenCalledOnce();
  expect(mock.native).not.toHaveBeenCalled();
});
it('rejects dates from a replaced file or changed version and tolerates unsupported metadata', async () => {
  for (const mismatch of [
    { identity: '1:99' },
    { size: 999 },
    { modified: 2000 },
    { added: Infinity },
  ]) {
    mock.dates.mockResolvedValue([
      {
        path: root + '/Notes.txt',
        identity: '1:2',
        size: 13,
        modified: 1000,
        added: Date.now(),
        ...mismatch,
      },
    ]);
    expect((await service().list()).items[0].addedToTrash).toBeUndefined();
  }
  mock.dates.mockRejectedValue(new Error('Metadata unavailable'));
  const value = await service().list();
  expect(value.items).toHaveLength(1);
  expect(value.items[0].addedToTrash).toBeUndefined();
  expect(value.canEmpty).toBe(true);
});
it('can close while an optional native metadata read is pending', async () => {
  let finish!: (dates: []) => void;
  mock.dates.mockImplementation(
    () =>
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
  );
  const trash = service();
  const reading = trash.list();
  await vi.waitFor(() => expect(mock.dates).toHaveBeenCalledOnce());
  trash.close();
  finish([]);
  await expect(reading).resolves.toHaveProperty('items');
  await expect(trash.list()).rejects.toThrow('Trash has closed');
});
it('opens native UI with the sealed inventory and exposes no emptying method', async () => {
  const trash = service();
  const value = await trash.list();
  await trash.confirmation(window, value.revision);
  expect(mock.native).toHaveBeenCalledOnce();
  const review = JSON.parse(mock.native.mock.calls[0][0]);
  expect(review).toMatchObject({
    count: 1,
    roots: [
      { path: root, identity: '1:1', items: [{ name: 'Notes.txt', identity: '1:2', size: 13 }] },
    ],
  });
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(trash))).toEqual([
    'constructor',
    'list',
    'close',
    'preview',
    'copyPaths',
    'chooseRestoreFolder',
    'restore',
    'requestAccess',
    'confirmation',
  ]);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.confirm).not.toHaveBeenCalled();
});
it('rejects arbitrary, stale and changed inventories before displaying native UI', async () => {
  const trash = service(),
    value = await trash.list();
  await expect(trash.confirmation(window, 'forged')).rejects.toThrow('Refresh');
  mock.files.get(root + '/Notes.txt')!.modified++;
  await expect(trash.confirmation(window, value.revision)).rejects.toThrow('changed');
  expect(mock.native).not.toHaveBeenCalled();
});
it.each(['link', 'owner', 'permissions', 'canonical'] as const)(
  'rejects an unsafe Trash root: %s',
  async (kind) => {
    const value = mock.files.get(root)!;
    if (kind === 'link') value.link = true;
    if (kind === 'owner') value.uid++;
    if (kind === 'permissions') value.mode = 0o40777;
    if (kind === 'canonical') value.canonical = '/Users/Fixture/Documents';
    const result = await service().list();
    expect(result.items).toHaveLength(0);
    expect(result.canEmpty).toBe(false);
    expect(result.locations[0].state).toBe('unavailable');
  },
);
it('keeps a symlink as a single trashed item without reading its target', async () => {
  const uid = process.getuid!();
  mock.files.set(root + '/Documents', {
    directory: false,
    link: true,
    uid,
    ino: 3,
    mode: 0o120777,
    size: 20,
    modified: 1000,
    canonical: '/Users/Fixture/Documents',
  });
  expect((await service().list()).items.find((item) => item.name === 'Documents')).toMatchObject({
    directory: false,
    size: 20,
  });
  expect(mock.read).not.toHaveBeenCalled();
});
it('denies emptying on incomplete inventories or lost permissions', async () => {
  access.require.mockRejectedValue(
    Object.assign(new Error('Choose the Trash folder'), { code: 'FILE_ACCESS_REQUIRED' }),
  );
  const result = await service().list();
  expect(result.canEmpty).toBe(false);
  expect(result.locations[0]).toMatchObject({ state: 'unavailable', canRequestAccess: true });
});
it('never grants an ordinary folder selected in place of Trash', async () => {
  access.require.mockRejectedValueOnce(
    Object.assign(new Error('Needs access'), { code: 'FILE_ACCESS_REQUIRED' }),
  );
  const trash = service(),
    value = await trash.list();
  mock.open.mockResolvedValue({
    canceled: false,
    filePaths: [home + '/Documents'],
    bookmarks: ['capability'],
  });
  await expect(trash.requestAccess(window, value.locations[0].id)).rejects.toThrow(
    'No other folder',
  );
  expect(access.remember).not.toHaveBeenCalled();
  mock.open.mockResolvedValue({ canceled: true, filePaths: [] });
  await trash.requestAccess(window, value.locations[0].id);
  expect(access.remember).not.toHaveBeenCalled();
});
it('routes macOS privacy denial to settings without opening a misleading folder picker or granting access', async () => {
  access.require.mockRejectedValue(
    Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }),
  );
  const trash = service(),
    value = await trash.list();
  expect(value.canEmpty).toBe(false);
  expect(value.locations[0]).toMatchObject({
    access: 'privacy',
    canRequestAccess: true,
    message: expect.stringContaining('Full Disk Access'),
  });
  expect(value.locations[0].message).not.toContain('EPERM');
  await trash.requestAccess(window, value.locations[0].id);
  expect(mock.settings).toHaveBeenCalledExactlyOnceWith(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  );
  expect(mock.open).not.toHaveBeenCalled();
  expect(access.remember).not.toHaveBeenCalled();
  expect(mock.native).not.toHaveBeenCalled();
  expect(mock.confirm).not.toHaveBeenCalled();
});
it('does not offer a grant for an unverified Trash root', async () => {
  mock.files.get(root)!.link = true;
  const trash = service(),
    value = await trash.list();
  expect(value.locations[0].canRequestAccess).toBe(false);
  await expect(trash.requestAccess(window, value.locations[0].id)).rejects.toThrow('unavailable');
  expect(mock.settings).not.toHaveBeenCalled();
  expect(mock.open).not.toHaveBeenCalled();
});
it('revokes the UI route when the service or window closes', async () => {
  const trash = service(),
    value = await trash.list();
  trash.close();
  await trash.confirmation(window, value.revision);
  await expect(trash.list()).rejects.toThrow('closed');
  expect(mock.native).not.toHaveBeenCalled();
});
it('blocks emptying IDs and builtin aliases from agents, regardless of saved grants', () => {
  for (const command of forbiddenTrashCommands) {
    expect(() => agentCommandID(command, [])).toThrow('native user interface');
    expect(() =>
      agentCommandID('custom.unsafe', [
        {
          id: 'unsafe',
          name: 'Unsafe',
          aliases: [],
          icon: 'trash',
          shortcut: '',
          order: 0,
          pinned: false,
          when: { target: 'any', extensions: [], min: 0, max: 2000 },
          executor: { kind: 'builtin', command },
        },
      ]),
    ).toThrow('native user interface');
  }
});

const add = (file: string, directory = false, ino = 10) =>
  mock.files.set(file, {
    directory,
    uid: process.getuid!(),
    ino,
    mode: directory ? 0o40700 : 0o100600,
    size: directory ? 64 : 15,
    modified: 1000,
  });
const origins = () =>
  Promise.resolve([
    { file: root + '/Notes.txt', originalPath: home + '/Documents/Notes.txt', identity: '1:2' },
  ]);

it('browses folders with scoped breadcrumbs and preserves the whole-Trash confirmation revision', async () => {
  add(root + '/Nested', true, 3);
  add(root + '/Nested/Child.txt', false, 4);
  const trash = service(),
    top = await trash.list();
  const nested = await trash.list(top.items.find((item) => item.name === 'Nested')!.id);
  expect(nested.ancestors?.map((item) => item.name)).toEqual(['Nested']);
  expect(nested.items.map((item) => item.name)).toEqual(['Child.txt']);
  expect(nested.totalItems).toBe(2);
  expect(nested.revision).toBe(top.revision);
  expect(mock.move).not.toHaveBeenCalled();
  expect(mock.native).not.toHaveBeenCalled();
});
it('never previews a trashed symlink or traverses a replaced parent folder', async () => {
  add(root + '/Nested', true, 3);
  add(root + '/Nested/Child.txt', false, 4);
  const preview = vi.fn();
  const trash = new Trash(home, access as unknown as FileAccess, { preview });
  const top = await trash.list();
  const folderID = top.items.find((item) => item.directory)!.id;
  const nested = await trash.list(folderID);
  mock.files.get(root + '/Nested')!.link = true;
  await expect(trash.preview(nested.items[0].id)).rejects.toThrow('changed');
  await expect(trash.list(folderID)).rejects.toThrow('changed');
  expect(preview).not.toHaveBeenCalled();
});
it('expires changed file selections even when a refresh keeps the same inode', async () => {
  const trash = service(),
    top = await trash.list();
  const old = top.items[0].id;
  mock.files.get(root + '/Notes.txt')!.modified++;
  const refreshed = await trash.list();
  expect(refreshed.items[0].id).not.toBe(old);
  await expect(trash.copyPaths([old])).rejects.toThrow('changed');
  expect(mock.clipboard).not.toHaveBeenCalled();
});
it('uses exact receipt identity to show original locations, never filename matching', async () => {
  const trash = new Trash(home, access as unknown as FileAccess, { origins });
  expect((await trash.list()).items[0].originalPath).toBe(home + '/Documents/Notes.txt');
  mock.files.get(root + '/Notes.txt')!.ino++;
  expect((await trash.list()).items[0].originalPath).toBeUndefined();
});
it('restores to an exact original destination with a non-replacing native move', async () => {
  add(home + '/Documents', true);
  const changed = vi.fn();
  const trash = new Trash(home, access as unknown as FileAccess, { origins, changed });
  const top = await trash.list();
  expect(await trash.restore(window, [top.items[0].id], 'original')).toEqual({
    restored: 1,
    cancelled: false,
  });
  expect(mock.move).toHaveBeenCalledExactlyOnceWith(
    root + '/Notes.txt',
    home + '/Documents/Notes.txt',
  );
  expect(mock.files.get(home + '/Documents/Notes.txt')?.ino).toBe(2);
  expect(changed).toHaveBeenCalledOnce();
  expect(mock.native).not.toHaveBeenCalled();
  expect(mock.execute).not.toHaveBeenCalled();
});
it('keeps every selected item when any original destination collides', async () => {
  add(home + '/Documents', true);
  add(home + '/Documents/Notes.txt', false, 50);
  const trash = new Trash(home, access as unknown as FileAccess, { origins });
  const top = await trash.list();
  await expect(trash.restore(window, [top.items[0].id], 'original')).rejects.toThrow(
    'already exists',
  );
  expect(mock.move).not.toHaveBeenCalled();
  expect(mock.files.get(home + '/Documents/Notes.txt')?.ino).toBe(50);
  expect(mock.files.get(root + '/Notes.txt')?.ino).toBe(2);
});
it('requires Restore to… for an item without a proven original destination', async () => {
  const trash = service(),
    top = await trash.list();
  await expect(trash.restore(window, [top.items[0].id], 'original')).rejects.toThrow('Restore to');
  expect(mock.move).not.toHaveBeenCalled();
});
it('cancelling Restore to… neither grants a folder nor moves any item', async () => {
  const trash = service(),
    top = await trash.list();
  mock.open.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await trash.restore(window, [top.items[0].id], 'choose')).toEqual({
    restored: 0,
    cancelled: true,
  });
  expect(access.remember).not.toHaveBeenCalled();
  expect(mock.move).not.toHaveBeenCalled();
});
it('restores an entire nested folder without selecting its child twice', async () => {
  add(home + '/Documents', true, 50);
  add(root + '/Nested', true, 3);
  add(root + '/Nested/Child.txt', false, 4);
  const trash = service(),
    top = await trash.list();
  const folderID = top.items.find((item) => item.directory)!.id;
  const nested = await trash.list(folderID);
  mock.open.mockResolvedValue({ canceled: false, filePaths: [home + '/Documents'] });
  expect(await trash.restore(window, [folderID, nested.items[0].id], 'choose')).toEqual({
    restored: 1,
    cancelled: false,
  });
  expect(mock.move).toHaveBeenCalledOnce();
  expect(mock.files.get(home + '/Documents/Nested/Child.txt')?.ino).toBe(4);
});
it('restores into a folder chosen before the operations lock, without a picker of its own (2026-10-20)', async () => {
  // The picker ran inside the lock, so every queued file operation waited while it was open.
  add(home + '/Documents', true, 50);
  const trash = service(),
    top = await trash.list();
  mock.open.mockResolvedValue({ canceled: false, filePaths: [home + '/Documents'] });
  const folder = await trash.chooseRestoreFolder(window);
  expect(folder).toBe(home + '/Documents');
  expect(access.remember).toHaveBeenCalledOnce();
  mock.open.mockClear();
  expect(await trash.restore(window, [top.items[0].id], { folder: folder! })).toEqual({
    restored: 1,
    cancelled: false,
  });
  expect(mock.open).not.toHaveBeenCalled();
  expect(mock.files.get(home + '/Documents/Notes.txt')?.ino).toBe(2);
  mock.open.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await trash.chooseRestoreFolder(window)).toBeUndefined();
});
it('refuses a symlink destination and never falls back to deleting after a failed move', async () => {
  add(home + '/Documents', true, 50);
  mock.files.get(home + '/Documents')!.canonical = home + '/Elsewhere';
  const trash = new Trash(home, access as unknown as FileAccess, { origins }),
    top = await trash.list();
  await expect(trash.restore(window, [top.items[0].id], 'original')).rejects.toThrow(
    'symbolic link',
  );
  expect(mock.move).not.toHaveBeenCalled();
  mock.files.get(home + '/Documents')!.canonical = undefined;
  mock.move.mockRejectedValue(new Error('Different filesystem'));
  await expect(trash.restore(window, [top.items[0].id], 'original')).rejects.toThrow(
    'Different filesystem',
  );
  expect(mock.files.get(root + '/Notes.txt')?.ino).toBe(2);
  expect(mock.execute).not.toHaveBeenCalled();
});
it('rechecks destination identity after the preflight and keeps sources on a race', async () => {
  add(home + '/Documents', true, 50);
  const trash = new Trash(home, access as unknown as FileAccess, { origins }),
    top = await trash.list();
  access.require.mockImplementation(async (files: string[]) => {
    if (files.includes(root + '/Notes.txt') && mock.files.get(home + '/Documents')!.ino === 50) {
      // Change after destination preflight, on the second source check.
      const checks = access.require.mock.calls.filter(([values]) =>
        values.includes(root + '/Notes.txt'),
      ).length;
      if (checks >= 2) mock.files.get(home + '/Documents')!.ino = 51;
    }
  });
  await expect(trash.restore(window, [top.items[0].id], 'original')).rejects.toThrow(
    'destination changed',
  );
  expect(mock.move).not.toHaveBeenCalled();
});
