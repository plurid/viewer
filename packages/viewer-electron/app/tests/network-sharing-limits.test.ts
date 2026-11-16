import { expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import { NetworkSharing, sharingFolder } from '../src/desktop/files/network-sharing';
import { SharingMetadata } from '../src/desktop/files/sharing-metadata';
import { networkSharingFolderGuard, createNetworkSharingHandlers } from '../src/desktop/ipc/network-sharing-handlers';
import { temporaryRoot } from '../tools/temporary';

const run = (points = '{}', names = '', guest = ''): SharingRunner => async (kind) => ({
  ok: true, stderr: '', stdout: kind === 'shares' ? points : kind === 'sharepoints' ? names : kind === 'guest' ? guest : '',
});
it('retains timed-out work, coalesces the same path and caps actual outstanding reads at two', async () => {
  const metadata = new SharingMetadata(10);
  let finish: (value: string) => void = () => {};
  const first = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  await expect(metadata.read('folder', '/hanging', first)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  await expect(metadata.read('folder', '/hanging/', first)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  expect(first).toHaveBeenCalledTimes(1);
  const second = vi.fn(async () => new Promise<never>(() => {}));
  await expect(metadata.read('folder', '/second', second)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  const excess = vi.fn(async () => 'unexpected');
  await expect(metadata.read('folder', '/third', excess)).rejects.toMatchObject({ code: 'EBUSY' });
  expect(excess).not.toHaveBeenCalled();
  finish('done');
  await vi.waitFor(async () => expect(await metadata.read('folder', '/healthy', async () => 'healthy')).toBe('healthy'));
});
it('confirms empty JSON and no-record output against Open Directory and skips all row metadata when empty', async () => {
  for (const points of ['{}', 'No share point records.']) {
    const folder = vi.fn(sharingFolder);
    const execute = vi.fn(run(points));
    const service = new NetworkSharing({ available: true, run: execute, folder, addresses: () => [] });
    const result = await service.inspect(Array.from({ length: 1001 }, (_, index) => '/fixtures/' + index));
    expect(result.status).toBe('ready');
    expect(result.folders).toHaveLength(1001);
    expect(execute).toHaveBeenCalledWith('sharepoints');
    expect(folder).not.toHaveBeenCalled();
    for (const names of ['A share', '\nOther share\n']) {
      const inconsistent = new NetworkSharing({ available: true, run: run(points, names), folder, addresses: () => [] });
      expect((await inconsistent.refresh()).status).toBe('unknown');
    }
    const failure = new NetworkSharing({ available: true, run: async (kind) => kind === 'sharepoints' ? { ok: false, stdout: '', stderr: 'Directory unavailable' } : run(points)(kind), folder, addresses: () => [] });
    expect((await failure.refresh()).status).toBe('unknown');
  }
});
it.each([['false', 'off'], ['true', 'on'], ['', 'unknown']])('reads an explicit global SMB guest value (%s)', async (value, expected) => {
  const sharing = new NetworkSharing({ available: true, run: run('{}', '', value), folder: sharingFolder, addresses: () => [] });
  expect((await sharing.refresh()).guestAccess).toBe(expected);
});
it('shares fresh root and ancestor metadata between rows in the same inspection', async () => {
  const root = await temporaryRoot('viewer-sharing-memo-');
  const child = path.join(root, 'Child');
  await mkdir(child);
  const folder = vi.fn(sharingFolder);
  const points = JSON.stringify({ Fixture: { path: root, smb_name: 'Fixture', smb_shared: 1, smb_guest_access: 0, smb_read_only: 0 } });
  const sharing = new NetworkSharing({ available: true, run: run(points), folder, addresses: () => [] });
  await sharing.inspect([root, child, child + '/']);
  const canonical = (await sharingFolder(root)).canonical;
  expect(folder.mock.calls.filter(([file]) => file === root || file === canonical)).toHaveLength(1);
  const parents = folder.mock.calls.map(([file]) => file).filter((file) => file !== child + '/');
  expect(new Set(parents).size).toBe(parents.length);
});
it('wires the bridge folder guard through access and bounded directory validation before opening Settings', async () => {
  const root = await temporaryRoot('viewer-sharing-guard-');
  const file = path.join(root, 'File');
  await writeFile(file, 'fixture', { flag: 'wx' });
  const folder = vi.fn(sharingFolder);
  const sharing = new NetworkSharing({ available: true, run: run(), folder, addresses: () => [] });
  const access = { require: vi.fn(async (_files: readonly string[]) => {}) };
  const guard = networkSharingFolderGuard(access, sharing);
  const openSettings = vi.fn(async () => {});
  const handler = createNetworkSharingHandlers({ available: true, sharing, isAgent: () => false, requireFolder: guard, access: async (path) => access.require([path]), openSettings }).networkSharing;
  await expect(handler([{ kind: 'settings', path: file }], 1)).rejects.toThrow('Choose one folder');
  expect(openSettings).not.toHaveBeenCalled();
  await handler([{ kind: 'settings', path: root }], 1);
  expect(access.require).toHaveBeenCalledWith([root]);
  expect(folder).toHaveBeenCalledWith(root);
  expect(openSettings).toHaveBeenCalledTimes(1);
  access.require.mockRejectedValueOnce(new Error('Access required'));
  folder.mockClear();
  await expect(guard(root)).rejects.toThrow('Access required');
  expect(folder).not.toHaveBeenCalled();
});
