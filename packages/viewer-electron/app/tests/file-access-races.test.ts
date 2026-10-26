import type * as FileSystemModule from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { FileAccess } from '../src/desktop/files/file-access';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

const canonical = vi.hoisted(() => ({
  file: '',
  started: false,
  release: undefined as (() => void) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemModule>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (args[0] === canonical.file) {
        canonical.started = true;
        await new Promise<void>((resolve) => {
          canonical.release = resolve;
        });
      }
      return actual.realpath(...args);
    },
  };
});

it('does not approve a released scope after its canonical filesystem read finishes', async () => {
  const root = await temporaryRoot('viewer-access-race-');
  const profile = path.join(root, 'private'),
    chosen = path.join(root, 'chosen');
  await mkdir(profile);
  await mkdir(chosen);
  const file = path.join(chosen, 'Generated.txt');
  await writeFile(file, 'Generated delayed canonical read.');
  const stop = vi.fn(),
    access = new FileAccess(profile, { start: () => stop });
  try {
    await access.remember(chosen, true, 'chosen');
    await access.require([chosen]);
    canonical.file = file;
    const pending = access.require([file]);
    const denied = expect(pending).rejects.toMatchObject({ code: 'FILE_ACCESS_REQUIRED' });
    await vi.waitFor(() => expect(canonical.started).toBe(true));
    await access.revoke(chosen, async () => {});
    expect(stop).toHaveBeenCalledExactlyOnceWith();
    canonical.release!();
    await denied;
  } finally {
    canonical.release?.();
    canonical.file = '';
    canonical.started = false;
    await access.close();
    await trashTemporary(root);
  }
});
