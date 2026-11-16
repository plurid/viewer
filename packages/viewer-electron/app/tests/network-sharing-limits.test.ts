import { expect, it, vi } from 'vitest';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import { NetworkSharing, sharingFolder } from '../src/desktop/files/network-sharing';
import { SharingMetadata } from '../src/desktop/files/sharing-metadata';
import { createNetworkSharingHandlers } from '../src/desktop/ipc/network-sharing-handlers';
import { schemas } from '../src/desktop/ipc/schemas';
import { temporaryRoot } from '../tools/temporary';

it('starts a new forced read after an older in-flight forced read', async () => {
  const root = await temporaryRoot('viewer-sharing-inflight-');
  const folderPath = path.join(root, 'Shared');
  await mkdir(folderPath);
  const original = await sharingFolder(folderPath);
  let release: (value: typeof original) => void = () => {};
  const folder = vi.fn(sharingFolder).mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const points = JSON.stringify({
    Fixture: {
      path: folderPath,
      smb_name: 'Fixture',
      smb_shared: 1,
      smb_guest_access: 1,
      smb_read_only: 0,
    },
  });
  const service = new NetworkSharing({
    available: true,
    run: async (read) => ({ ok: true, stderr: '', stdout: read === 'shares' ? points : '' }),
    folder,
    acl: async () => 'none',
    addresses: () => [],
  });
  const older = service.refresh(true);
  await vi.waitFor(() => expect(folder).toHaveBeenCalledTimes(1));
  await rename(folderPath, path.join(root, 'Moved'));
  await mkdir(folderPath);
  const replacement = await sharingFolder(folderPath);
  const opened = service.inspect([folderPath], true);
  release(original);
  await older;
  expect((await opened).folders?.[0]?.shares[0]?.identity).toBe(replacement.identity);
});

const run =
  (points = '{}', names = '', guest = ''): SharingRunner =>
  async (kind) => ({
    ok: true,
    stderr: '',
    stdout:
      kind === 'shares' ? points : kind === 'sharepoints' ? names : kind === 'guest' ? guest : '',
  });
it('retains timed-out work, coalesces the same path and caps actual outstanding reads at two', async () => {
  const metadata = new SharingMetadata(10);
  let finish: (value: string) => void = () => {};
  const first = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(metadata.read('folder', '/hanging', first)).rejects.toMatchObject({
    code: 'ETIMEDOUT',
  });
  await expect(metadata.read('folder', '/hanging/', first)).rejects.toMatchObject({
    code: 'ETIMEDOUT',
  });
  expect(first).toHaveBeenCalledTimes(1);
  const expired = vi.fn(async () => 'not needed');
  await expect(metadata.read('access-list', '/hanging', expired)).rejects.toMatchObject({
    code: 'ETIMEDOUT',
  });
  const second = vi.fn(async () => new Promise<never>(() => {}));
  await expect(metadata.read('folder', '/second', second)).rejects.toMatchObject({
    code: 'ETIMEDOUT',
  });
  const excess = vi.fn(async () => 'unexpected');
  await expect(metadata.read('folder', '/third', excess)).rejects.toMatchObject({
    code: 'ETIMEDOUT',
  });
  expect(excess).not.toHaveBeenCalled();
  finish('done');
  await vi.waitFor(async () =>
    expect(await metadata.read('folder', '/healthy', async () => 'healthy')).toBe('healthy'),
  );
  expect(expired).not.toHaveBeenCalled();
});
it('confirms empty JSON and no-record output against Open Directory and skips all row metadata when empty', async () => {
  for (const points of ['{}', 'No share point records.']) {
    const folder = vi.fn(sharingFolder);
    const execute = vi.fn(run(points));
    const service = new NetworkSharing({
      available: true,
      run: execute,
      folder,
      addresses: () => [],
    });
    const result = await service.inspect(
      Array.from({ length: 1001 }, (_, index) => '/fixtures/' + index),
    );
    expect(result.status).toBe('ready');
    expect(result.folders).toHaveLength(1001);
    expect(execute).toHaveBeenCalledWith('sharepoints');
    expect(folder).not.toHaveBeenCalled();
    for (const names of ['A share', '\nOther share\n']) {
      const inconsistent = new NetworkSharing({
        available: true,
        run: run(points, names),
        folder,
        addresses: () => [],
      });
      expect((await inconsistent.refresh()).status).toBe('unknown');
    }
    const failure = new NetworkSharing({
      available: true,
      run: async (kind) =>
        kind === 'sharepoints'
          ? { ok: false, stdout: '', stderr: 'Directory unavailable' }
          : run(points)(kind),
      folder,
      addresses: () => [],
    });
    expect((await failure.refresh()).status).toBe('unknown');
  }
});
it.each([
  ['false', 'off'],
  ['true', 'on'],
  ['', 'unknown'],
])('reads an explicit global SMB guest value (%s)', async (value, expected) => {
  const sharing = new NetworkSharing({
    available: true,
    run: run('{}', '', value),
    folder: sharingFolder,
    addresses: () => [],
  });
  expect((await sharing.refresh()).guestAccess).toBe(expected);
});
it('shares fresh root and ancestor metadata between rows in the same inspection', async () => {
  const root = await temporaryRoot('viewer-sharing-memo-');
  const child = path.join(root, 'Child');
  await mkdir(child);
  const folder = vi.fn(sharingFolder);
  const points = JSON.stringify({
    Fixture: {
      path: root,
      smb_name: 'Fixture',
      smb_shared: 1,
      smb_guest_access: 0,
      smb_read_only: 0,
    },
  });
  const sharing = new NetworkSharing({
    available: true,
    run: run(points),
    folder,
    addresses: () => [],
  });
  await sharing.inspect([root, child, child + '/']);
  const canonical = (await sharingFolder(root)).canonical;
  expect(folder.mock.calls.filter(([file]) => file === root || file === canonical)).toHaveLength(1);
  const parents = folder.mock.calls.map(([file]) => file).filter((file) => file !== child + '/');
  expect(new Set(parents).size).toBe(parents.length);
});
it('validates the Settings request without requiring access to a folder unused by the fixed address', async () => {
  const root = await temporaryRoot('viewer-sharing-guard-');
  const file = path.join(root, 'File');
  await writeFile(file, 'fixture', { flag: 'wx' });
  const folder = vi.fn(sharingFolder);
  const sharing = new NetworkSharing({ available: true, run: run(), folder, addresses: () => [] });
  const access = { require: vi.fn(async (_files: readonly string[]) => {}) };
  const openSettings = vi.fn(async () => {});
  const handler = createNetworkSharingHandlers({
    available: true,
    sharing,
    isAgent: () => false,
    fileAccess: access,
    openSettings,
  }).networkSharing;
  expect(schemas.networkSharing.safeParse([{ kind: 'settings', path: 'relative' }]).success).toBe(
    false,
  );
  expect(schemas.networkSharing.safeParse([{ kind: 'settings', path: file }]).success).toBe(true);
  await handler([{ kind: 'settings', path: file }], 1);
  expect(access.require).not.toHaveBeenCalled();
  expect(folder).not.toHaveBeenCalled();
  expect(openSettings).toHaveBeenCalledTimes(1);
  access.require.mockRejectedValueOnce(new Error('Access required'));
  folder.mockClear();
  const unknown = await handler([{ kind: 'refresh', paths: [root] }], 1);
  expect(unknown.folders?.[0]).toMatchObject({ path: root, status: 'unknown' });
  expect(folder).not.toHaveBeenCalled();
});
