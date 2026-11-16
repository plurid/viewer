import { expect, it, vi } from 'vitest';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import { NetworkSharing, sharingFolder } from '../src/desktop/files/network-sharing';
import { temporaryRoot } from '../tools/temporary';
import { sharingAddresses } from '../src/domain/files/network-sharing';

function listing(paths: string[]): SharingRunner {
  return async (kind) => ({
    ok: true,
    stderr: '',
    stdout:
      kind === 'shares'
        ? JSON.stringify(
            Object.fromEntries(
              paths.map((file, index) => [
                index,
                {
                  path: file,
                  smb_name: 'Share ' + index,
                  smb_shared: 1,
                  smb_guest_access: 1,
                  smb_read_only: 0,
                },
              ]),
            ),
          )
        : '',
  });
}
it('rechecks a cached identity mismatch during ordinary navigation without any forced UI read', async () => {
  const root = await temporaryRoot('viewer-sharing-recheck-');
  const file = path.join(root, 'Shared');
  await mkdir(file);
  const run = vi.fn(listing([file]));
  const sharing = new NetworkSharing({
    available: true,
    run,
    folder: sharingFolder,
    acl: async () => 'none',
    addresses: () => [],
  });
  await sharing.refresh();
  await rename(file, path.join(root, 'Moved'));
  await mkdir(file);
  expect((await sharing.inspect([file])).folders?.[0]?.shares).toHaveLength(1);
  expect(run.mock.calls.filter(([kind]) => kind === 'shares')).toHaveLength(2);
});
it('does not cache the absence of a listed share path when its folder comes back', async () => {
  const root = await temporaryRoot('viewer-sharing-returned-');
  const file = path.join(root, 'Shared');
  const moved = path.join(root, 'Moved');
  await mkdir(file);
  await rename(file, moved);
  const sharing = new NetworkSharing({
    available: true,
    run: listing([file]),
    folder: sharingFolder,
    acl: async () => 'none',
    addresses: () => [],
  });
  expect((await sharing.refresh()).shares).toEqual([]);
  await rename(moved, file);
  expect((await sharing.inspect([file])).folders?.[0]?.shares).toHaveLength(1);
});
it.each(['EACCES', 'ETIMEDOUT'])(
  'limits an unreadable share (%s) to folders that could be inside it',
  async (code) => {
    const blocked = '/Volumes/Unavailable/Shared';
    const readable = '/fixtures/Shared';
    const sharing = new NetworkSharing({
      available: true,
      run: listing([blocked, readable]),
      addresses: () => [],
      acl: async () => 'none',
      timeoutMs: 10,
      folder: async (file) => {
        if (file === blocked) {
          if (code === 'ETIMEDOUT') return new Promise<never>(() => {});
          throw Object.assign(new Error('Access unavailable'), { code });
        }
        return { directory: true, mode: 0o755, identity: file, canonical: file };
      },
    });
    const value = await sharing.inspect([
      blocked,
      blocked + '/Child',
      readable,
      '/fixtures/Outside',
      '/Volumes/Other/Folder',
    ]);
    expect(value.status).toBe('ready');
    expect(value.folders?.map((folder) => folder.status)).toEqual([
      'unknown',
      'unknown',
      'ready',
      'ready',
      'ready',
    ]);
    expect(value.folders?.[2]?.shares).toHaveLength(1);
  },
);
it('reports no network without suppressing local host addresses', async () => {
  const execute = listing(['/fixtures/Shared']);
  const sharing = new NetworkSharing({
    available: true,
    run: async (kind) =>
      kind === 'host' ? { ok: true, stderr: '', stdout: 'Studio-Mac' } : execute(kind),
    folder: async (file) => ({ directory: true, mode: 0o755, identity: file, canonical: file }),
    acl: async () => 'none',
    addresses: () => [],
    network: () => ({}),
  });
  const value = await sharing.refresh();
  expect(value.network).toBe('offline');
  expect(
    sharingAddresses(value.shares[0]!, value.host, value.ipv4, value.interfaces).map(
      (address) => address.address,
    ),
  ).toContain('smb://Studio-Mac.local/Share%200');
});
