/** Generated private Trash fixture + real macOS exclusive rename. No system
 * Trash, erasure, cleanup, or human approval simulation is involved. */
import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, lstat, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BrowserWindow } from 'electron';
import type { FileAccess } from '../src/desktop/file-access';
import type { MacFiles } from '../src/desktop/macos-files';
import { Trash } from '../src/desktop/trash';

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../src/desktop/macos-files', () => ({
  macFiles: () => {
    const binding = createRequire(import.meta.url)(
      path.resolve(process.env.VIEWER_TEST_MAC_BINDING!),
    ) as MacFiles;
    return {
      volumes: async () => [],
      renameExclusive: binding.renameExclusive,
      trashConfirmation: () => {
        throw new Error('Native confirmation is forbidden in this generated restore test.');
      },
    };
  },
}));
const window = { isDestroyed: () => false } as BrowserWindow;
it.skipIf(process.platform !== 'darwin' || !process.env.VIEWER_TEST_MAC_BINDING)(
  'restores generated files, folders and a symlink without overwriting a colliding file',
  async () => {
    const created = await mkdtemp(path.join(os.tmpdir(), 'viewer-native-restore-'));
    const home = await realpath(created),
      root = path.join(home, '.Trash'),
      destination = path.join(home, 'Destination');
    await mkdir(root, { mode: 0o700 });
    await mkdir(destination);
    const folder = path.join(root, 'Nested'),
      file = path.join(root, 'Notes.txt');
    await mkdir(folder);
    await writeFile(path.join(folder, 'Unicode-ș.txt'), 'Generated nested contents.');
    await writeFile(file, 'Generated note.');
    const sentinel = path.join(home, 'Sentinel.txt');
    await writeFile(sentinel, 'Keep this generated sentinel.');
    await symlink(sentinel, path.join(root, 'Sentinel link'));
    const access = {
      require: async () => {},
      remember: async () => {},
      scoped: false,
    } as unknown as FileAccess;
    const sources = [file, folder, path.join(root, 'Sentinel link')];
    const receipts = await Promise.all(
      sources.map(async (file) => {
        const info = await lstat(file);
        return {
          file,
          originalPath: path.join(destination, path.basename(file)),
          identity: `${info.dev}:${info.ino}`,
        };
      }),
    );
    const trash = new Trash(home, access, { origins: async () => receipts });
    const top = await trash.list();
    await writeFile(path.join(destination, 'Notes.txt'), 'Keep this collision.');
    await expect(
      trash.restore(
        window,
        top.items.map((item) => item.id),
        'original',
      ),
    ).rejects.toThrow('already exists');
    expect(await readFile(path.join(destination, 'Notes.txt'), 'utf8')).toBe(
      'Keep this collision.',
    );
    expect(await readFile(file, 'utf8')).toBe('Generated note.');
    const candidates = top.items.filter((item) => item.directory || item.symbolicLink);
    expect(
      await trash.restore(
        window,
        candidates.map((item) => item.id),
        'original',
      ),
    ).toEqual({ restored: 2, cancelled: false });
    expect(await readFile(path.join(destination, 'Nested/Unicode-ș.txt'), 'utf8')).toBe(
      'Generated nested contents.',
    );
    expect((await lstat(path.join(destination, 'Sentinel link'))).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, 'utf8')).toBe('Keep this generated sentinel.');
    expect((await trash.list()).items.map((item) => item.name)).toEqual(['Notes.txt']);
    trash.close();
    console.log('Generated native restore fixtures retained:', home);
  },
);
