import { describe, it, expect } from 'vitest';
import { mkdir, writeFile, utimes, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Comparisons } from '../src/desktop/comparison/comparison';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
describe('bounded folder comparison', () => {
  it('distinguishes matching metadata from verified content and keeps child symlinks unknown', async () => {
    const root = await temporaryRoot('viewer-compare-');
    const left = path.join(root, 'Left'),
      right = path.join(root, 'Right');
    await Promise.all([mkdir(left), mkdir(right)]);
    try {
      await writeFile(path.join(left, 'Same.txt'), 'equal');
      await writeFile(path.join(right, 'Same.txt'), 'equal');
      await writeFile(path.join(left, 'Changed.txt'), 'aaa');
      await writeFile(path.join(right, 'Changed.txt'), 'bbb');
      for (const side of [left, right])
        for (const name of ['Same.txt', 'Changed.txt'])
          await utimes(path.join(side, name), 100000, 100000);
      await writeFile(path.join(left, 'Only.txt'), 'left');
      await symlink(right, path.join(left, 'Loop'));
      const service = new Comparisons(async () => {});
      const metadata = await service.run('metadata', left, right);
      expect(metadata.rows.find((row) => row.path === 'Changed.txt')?.status).toBe('same-metadata');
      const hashes = await service.run('hashes', left, right, true);
      expect(hashes.rows.find((row) => row.path === 'Changed.txt')?.status).toBe('different');
      expect(hashes.rows.find((row) => row.path === 'Same.txt')?.status).toBe('same');
      expect(hashes.rows.find((row) => row.path === 'Only.txt')?.status).toBe('left-only');
      expect(hashes.rows.find((row) => row.path === 'Loop')?.status).toBe('unknown');
      expect(hashes.rows.some((row) => row.path.startsWith('Loop/'))).toBe(false);
      // Even a unilateral symbolic link cannot become an automatically copyable row.
      expect(hashes.rows.find((row) => row.path === 'Loop')?.left?.kind).toBe('symlink');
    } finally {
      await trashTemporary(root);
    }
  });
  it('marks absence unknown when a nested location cannot be inspected', async () => {
    const root = await temporaryRoot('viewer-compare-');
    const left = path.join(root, 'Left'),
      right = path.join(root, 'Right');
    await Promise.all([
      mkdir(path.join(left, 'Nested'), { recursive: true }),
      mkdir(path.join(right, 'Nested'), { recursive: true }),
    ]);
    try {
      await writeFile(path.join(left, 'Nested', 'File.txt'), 'left');
      const service = new Comparisons(async (files) => {
        if (
          files.some(
            (file) =>
              file.replace(/^\/private\/var\//, '/var/') ===
              path.join(right, 'Nested').replace(/^\/private\/var\//, '/var/'),
          )
        )
          throw new Error('Offline folder');
      });
      const result = await service.run('offline', left, right);
      expect(result.coverage).toBe('partial');
      expect(result.rows.find((row) => row.path === 'Nested/File.txt')?.status).toBe('unknown');
      expect(result.errors.some((error) => error.message === 'Offline folder')).toBe(true);
    } finally {
      await trashTemporary(root);
    }
  });
});
