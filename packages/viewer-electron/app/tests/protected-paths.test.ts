import type * as FileSystemModule from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const folder = (dev: number, ino: number) => ({
  dev,
  ino,
  isDirectory: () => true,
  isSymbolicLink: () => false,
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemModule>();
  const mounted: Record<string, ReturnType<typeof folder>> = {
    '/Volumes': folder(1, 5),
    '/Volumes/Backup': folder(2, 10),
    '/Volumes/Backup/Projects': folder(2, 11),
  };
  return {
    ...actual,
    lstat: vi.fn(async (file: string) => mounted[file] ?? actual.lstat(file)),
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
});
