import { afterEach, expect, it, vi } from 'vitest';
import type { SharingFolder, SharingRunner } from '../src/desktop/files/network-sharing';
import { NetworkSharing } from '../src/desktop/files/network-sharing';
import { SharingMetadata } from '../src/desktop/files/sharing-metadata';
import { createNetworkSharingHandlers } from '../src/desktop/ipc/network-sharing-handlers';

afterEach(() => vi.useRealTimers());
const run: SharingRunner = async (kind) => ({
  ok: true,
  stderr: '',
  stdout:
    kind === 'shares'
      ? JSON.stringify({
          Share: {
            path: '/Shared',
            smb_name: 'Share',
            smb_shared: 1,
            smb_guest_access: 0,
            smb_read_only: 0,
          },
        })
      : '',
});
function slowFolders() {
  let active = 0;
  let maximum = 0;
  const folder = vi.fn(async (file: string): Promise<SharingFolder> => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 150));
    active--;
    return { directory: true, canonical: file, identity: file, mode: 0o755 };
  });
  return { folder, maximum: () => maximum };
}
it('queues ordinary reads while retaining the bound of two running operations', async () => {
  vi.useFakeTimers();
  const metadata = new SharingMetadata(1000);
  const ports = slowFolders();
  const work = Promise.allSettled(
    ['/A', '/B', '/C', '/D'].map((file) => metadata.read('folder', file, () => ports.folder(file))),
  );
  await vi.runAllTimersAsync();
  expect((await work).every((result) => result.status === 'fulfilled')).toBe(true);
  expect(ports.maximum()).toBe(2);
});
it('keeps a forced share refresh and subsequent navigation known with two windows inspecting folders', async () => {
  vi.useFakeTimers();
  const ports = slowFolders();
  const service = new NetworkSharing({
    available: true,
    run,
    folder: ports.folder,
    addresses: () => [],
  });
  const initial = service.refresh(true);
  await vi.runAllTimersAsync();
  await initial;
  const first = service.inspect(['/First']);
  const second = service.inspect(['/Second']);
  await vi.advanceTimersByTimeAsync(0);
  const dialog = service.inspect(['/Shared'], true);
  await vi.runAllTimersAsync();
  expect((await dialog).folders?.[0]).toMatchObject({
    status: 'ready',
    shares: [{ name: 'Share' }],
  });
  expect((await Promise.all([first, second])).every((value) => value.status === 'ready')).toBe(
    true,
  );
  await vi.advanceTimersByTimeAsync(1000);
  const navigation = service.inspect(['/Shared']);
  await vi.runAllTimersAsync();
  expect((await navigation).folders?.[0]?.shares).toHaveLength(1);
  expect(ports.maximum()).toBe(2);
});
it.each([true, false])(
  'opens the fixed Settings address while metadata is busy, with folder access %s',
  async (allowAccess) => {
    vi.useFakeTimers();
    const ports = slowFolders();
    const service = new NetworkSharing({
      available: true,
      run,
      folder: ports.folder,
      addresses: () => [],
    });
    const initial = service.refresh(true);
    await vi.runAllTimersAsync();
    await initial;
    ports.folder.mockClear();
    const background = [service.inspect(['/First']), service.inspect(['/Second'])];
    await vi.advanceTimersByTimeAsync(0);
    const openSettings = vi.fn(async () => {});
    const fileAccess = {
      require: vi.fn(async () => {
        if (!allowAccess) throw new Error('Folder access is unavailable.');
      }),
    };
    const handler = createNetworkSharingHandlers({
      available: true,
      sharing: service,
      isAgent: () => false,
      fileAccess,
      openSettings,
    }).networkSharing;
    const result = await Promise.resolve(handler([{ kind: 'settings', path: '/Shared' }], 1)).catch(
      (error: unknown) => error,
    );
    expect(result).not.toBeInstanceOf(Error);
    expect(openSettings).toHaveBeenCalledOnce();
    expect(fileAccess.require).not.toHaveBeenCalled();
    expect(ports.folder).not.toHaveBeenCalledWith('/Shared');
    await vi.runAllTimersAsync();
    await Promise.all(background);
  },
);
