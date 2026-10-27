import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm, rmdir, unlink } from 'node:fs/promises';
import {
  discardOwnTemporaryFile,
  removeEmptyDirectory,
  removePrivateData,
  unlinkVerified,
} from '../src/desktop/operations/removal';

vi.mock('node:fs/promises', () => ({
  rm: vi.fn(async () => {}),
  rmdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const attempts = [
  ['empty directory', () => removeEmptyDirectory('/generated/empty')],
  ['verified source', () => unlinkVerified('/generated/source')],
  ['private data', () => removePrivateData('/generated/private', '/generated/private/item')],
] as const;

describe('preserved validation filesystem', () => {
  it('leaves temporary artifacts alone without failing completed publication', async () => {
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '1');
    await expect(discardOwnTemporaryFile('/generated/temporary')).resolves.toBeUndefined();
    expect(unlink).not.toHaveBeenCalled();
  });

  it.each(attempts)('blocks removal of %s before entering the filesystem', async (_name, run) => {
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '1');
    await expect(run()).rejects.toMatchObject({ code: 'TEST_REMOVAL_BLOCKED' });
    expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it('retains ordinary adapter behavior outside preservation checks', async () => {
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
    vi.stubEnv('VIEWER_TEST_PRESERVE', '0');
    await discardOwnTemporaryFile('/generated/temporary');
    await removeEmptyDirectory('/generated/empty');
    await unlinkVerified('/generated/source');
    expect(unlink).toHaveBeenCalledTimes(2);
    expect(rmdir).toHaveBeenCalledExactlyOnceWith('/generated/empty');
  });

  it('retains temporary artifacts during operator acceptance with explicit Trash enabled', async () => {
    vi.stubEnv('VIEWER_TEST_NO_REMOVAL', '0');
    vi.stubEnv('VIEWER_TEST_PRESERVE', '1');
    await discardOwnTemporaryFile('/generated/temporary');
    expect(unlink).not.toHaveBeenCalled();
  });
});
