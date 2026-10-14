/** Pure and mocked safety regressions. No filesystem removals or real native menus. */
import { beforeEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { Trash } from '../src/desktop/trash';
import { applicationsPath, linuxMounts, trashRoots } from '../src/desktop/trash-locations';
import { trashName, forbiddenTrashCommands } from '../src/domain/trash';
import { agentCommandID } from '../src/domain/agent-safety';
import type { FileAccess } from '../src/desktop/file-access';
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
  open: vi.fn(),
  confirm: vi.fn(),
  menu: vi.fn(),
  execute: vi.fn(),
  read: vi.fn(),
}));
vi.mock('../src/desktop/macos-files', () => ({
  macFiles: () => ({
    volumes: async () => [
      { path: '/', name: 'Local' },
      { path: '/Volumes/External', name: 'External' },
    ],
    trashMenu: mock.native,
  }),
}));
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: mock.menu },
  dialog: { showOpenDialog: mock.open, showMessageBox: mock.confirm },
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
it('lists Trash without launching a native menu, confirmation or removal process', async () => {
  const value = await service().list();
  expect(value.items).toMatchObject([
    { name: 'Notes.txt', directory: false, size: 13, location: 'Home' },
  ]);
  expect(value.canEmpty).toBe(true);
  expect(mock.native).not.toHaveBeenCalled();
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.confirm).not.toHaveBeenCalled();
});
it('opens native UI with the sealed inventory and exposes no emptying method', async () => {
  const trash = service();
  const value = await trash.list();
  await trash.menu(window, value.revision);
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
    'requestAccess',
    'menu',
  ]);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.confirm).not.toHaveBeenCalled();
});
it('rejects arbitrary, stale and changed inventories before displaying native UI', async () => {
  const trash = service(),
    value = await trash.list();
  await expect(trash.menu(window, 'forged')).rejects.toThrow('Refresh');
  mock.files.get(root + '/Notes.txt')!.modified++;
  await expect(trash.menu(window, value.revision)).rejects.toThrow('changed');
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
  access.require.mockRejectedValue(new Error('Choose the Trash folder'));
  const result = await service().list();
  expect(result.canEmpty).toBe(false);
  expect(result.locations[0]).toMatchObject({ state: 'unavailable', canRequestAccess: true });
});
it('never grants an ordinary folder selected in place of Trash', async () => {
  access.require.mockRejectedValueOnce(new Error('Needs access'));
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
it('revokes the UI route when the service or window closes', async () => {
  const trash = service(),
    value = await trash.list();
  trash.close();
  await trash.menu(window, value.revision);
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
