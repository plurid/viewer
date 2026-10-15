/** Read-only public macOS metadata on newly generated files. No system Trash,
 * removals, confirmation or cleanup. All fixtures remain available for review. */
import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { lstat, mkdir, realpath, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MacFiles } from '../src/desktop/macos-files';
import { temporaryRoot } from '../tools/temporary';

it.skipIf(process.platform !== 'darwin' || !process.env.VIEWER_TEST_MAC_BINDING)(
  'reads date-added separately from old modification times and skips links and missing files',
  async () => {
    const native = createRequire(import.meta.url)(
      path.resolve(process.env.VIEWER_TEST_MAC_BINDING!),
    ) as MacFiles;
    const started = Date.now();
    const root = await realpath(await temporaryRoot('viewer-native-trash-metadata-'));
    const file = path.join(root, 'Generated.txt'),
      folder = path.join(root, 'Generated folder'),
      link = path.join(root, 'Generated link');
    await writeFile(file, 'Generated metadata fixture.');
    await mkdir(folder);
    await symlink(file, link);
    const old = new Date('2000-01-01T00:00:00Z');
    await utimes(file, old, old);
    const values = await native.datesAdded([file, folder, link, path.join(root, 'Missing.txt')]);
    expect(values.map((value) => value.path)).toEqual([file, folder]);
    for (const value of values) {
      const info = await lstat(value.path);
      expect(value.identity).toBe(`${info.dev}:${info.ino}`);
      expect(value.size).toBe(info.size);
      expect(Math.abs(value.modified - info.mtimeMs)).toBeLessThan(0.01);
      // This machine's APFS fixture supplies the public key. Other volumes may
      // omit it; the mocked service/presentation tests cover that behavior.
      expect(value.added).toBeTypeOf('number');
      expect(value.added!).toBeGreaterThanOrEqual(started - 5000);
      expect(value.added!).toBeLessThanOrEqual(Date.now() + 5000);
    }
    expect(values[0].modified).toBe(old.valueOf());
    expect(await native.datesAdded([])).toEqual([]);
    expect(() => native.datesAdded(['relative.txt'])).toThrow('Invalid native file argument');
    expect(() => native.datesAdded(Array(4001).fill(file))).toThrow('Invalid native file argument');
    console.log('Generated native metadata fixtures preserved:', root);
  },
);
