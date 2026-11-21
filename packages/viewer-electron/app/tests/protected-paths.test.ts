import type * as FileSystemModule from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const folder = (dev: number, ino: number) => ({
  dev,
  ino,
  mode: 0o40700,
  isDirectory: () => true,
  isSymbolicLink: () => false,
});
const link = (dev: number, ino: number) => ({
  dev,
  ino,
  mode: 0o120777,
  isDirectory: () => false,
  isSymbolicLink: () => true,
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemModule>();
  const lstats: Record<string, ReturnType<typeof folder>> = {
    '/Volumes': folder(1, 5),
    '/Volumes/Backup': folder(2, 10),
    '/Volumes/Backup/Projects': folder(2, 11),
    '/Home/Projects': link(1, 20),
    '/Home/Projects/app': folder(2, 12),
    '/Home/VolumesLink': link(1, 21),
    '/Home/VolumesLink/Backup': folder(2, 10),
  };
  const stats: Record<string, ReturnType<typeof folder>> = {
    '/Volumes': folder(1, 5),
    '/Volumes/Backup': folder(2, 10),
    '/Volumes/Backup/Projects': folder(2, 11),
    '/Home/Projects': folder(2, 11),
    '/Home/Projects/app': folder(2, 12),
    '/Home/VolumesLink': folder(1, 5),
    '/Home/VolumesLink/Backup': folder(2, 10),
  };
  return {
    ...actual,
    lstat: vi.fn(async (file: string) => lstats[file] ?? actual.lstat(file)),
    stat: vi.fn(async (file: string) => stats[file] ?? actual.stat(file)),
  };
});
const { ProtectedPaths } = await import('../src/desktop/files/protected-paths');

describe('protected folders (2026-10-20)', () => {
  it('protects a mounted volume’s root, not the folders inside it', async () => {
    // Only /Volumes itself was protected: a disk or a share could be moved to the Trash whole.
    const paths = new ProtectedPaths('/Home');
    await expect(paths.check('/Volumes/Backup', 'moved to the Trash')).rejects.toThrow(
      'mounted volume',
    );
    await expect(paths.check('/Volumes/Backup/Projects', 'moved to the Trash')).resolves.toBe(
      undefined,
    );
  });
  it('allows folders under a linked folder on another volume while protecting volume roots reached through a link', async () => {
    const paths = new ProtectedPaths('/Home');
    await expect(paths.check('/Home/Projects/app', 'moved to the Trash')).resolves.toBe(undefined);
    await expect(paths.check('/Home/VolumesLink/Backup', 'moved to the Trash')).rejects.toThrow(
      'mounted volume',
    );
  });
});
