import { expect, it, vi } from 'vitest';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import { NetworkSharing } from '../src/desktop/files/network-sharing';
import {
  SharingVolumes,
  parseSharingMounts,
  sharingVolume,
} from '../src/desktop/files/sharing-volumes';

const mounts = {
  precise: true,
  mounts: [
    { path: '/', local: true },
    { path: '/Volumes/Network', local: false },
    { path: '/Volumes/Other network', local: false },
    { path: '/Volumes/Local', local: true },
  ],
};

it('invalidates cached fallback mounts as soon as a volume notification arrives', async () => {
  const run = vi.fn<SharingRunner>(async () => ({
    ok: true,
    stdout: '/dev/disk on / (apfs, local)\n',
    stderr: '',
  }));
  let changed!: () => void;
  const volumes = new SharingVolumes(
    run,
    () => undefined,
    () => 0,
    (notify) => {
      changed = notify;
      return () => {};
    },
  );
  const stop = volumes.watch(() => {});
  await volumes.read();
  await volumes.read();
  expect(run).toHaveBeenCalledTimes(1);
  changed();
  await volumes.read();
  expect(run).toHaveBeenCalledTimes(2);
  stop();
});

it('uses native mount notifications without polling or spawning a mount process', async () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const run = vi.fn(runner([]));
  let notify!: () => void;
  const release = vi.fn();
  const volumes = new SharingVolumes(
    run,
    () => mounts.mounts,
    Date.now,
    (listener) => {
      notify = listener;
      return release;
    },
  );
  const stop = volumes.watch(changed);
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(changed).not.toHaveBeenCalled();
    notify();
    expect(changed).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    stop();
    expect(release).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    stop();
    vi.useRealTimers();
  }
});
const runner =
  (points: string[]): SharingRunner =>
  async (kind) => ({
    ok: true,
    stderr: '',
    stdout:
      kind === 'shares'
        ? JSON.stringify(
            Object.fromEntries(
              points.map((path, index) => [
                index,
                { path, smb_name: 'Share', smb_shared: 1, smb_guest_access: 1, smb_read_only: 0 },
              ]),
            ),
          )
        : '',
  });
it('does not start two network row reads that would otherwise hang and block local sharing', async () => {
  const folder = vi.fn(async (file: string) => {
    if (file.startsWith('/Volumes/Network') || file.startsWith('/Volumes/Other network'))
      return new Promise<never>(() => {});
    return { directory: true, identity: file, canonical: file, mode: 0o755 };
  });
  const sharing = new NetworkSharing({
    available: true,
    run: runner(['/fixtures/Shared']),
    folder,
    acl: async () => 'none',
    addresses: () => [],
    volumes: async () => mounts,
    timeoutMs: 10,
  });
  const [first, second] = await Promise.all([
    sharing.inspect(['/Volumes/Network/Folder']),
    sharing.inspect(['/Volumes/Other network/Folder']),
  ]);
  expect(first.folders?.[0]).toMatchObject({ status: 'ready', shares: [] });
  expect(second.folders?.[0]).toMatchObject({ status: 'ready', shares: [] });
  const local = await sharing.inspect(['/fixtures/Shared']);
  expect(local.folders?.[0]?.shares).toHaveLength(1);
  expect(folder.mock.calls.every(([file]) => !file.startsWith('/Volumes/'))).toBe(true);
});
it('stops at a network ancestor when a local volume is mounted inside it', async () => {
  const local = '/Volumes/Network/Local';
  const folder = vi.fn(async (file: string) => {
    if (file === '/Volumes/Network') return new Promise<never>(() => {});
    return { directory: true, identity: file, canonical: file, mode: 0o755 };
  });
  const sharing = new NetworkSharing({
    available: true,
    run: runner([local]),
    folder,
    acl: async () => 'none',
    addresses: () => [],
    volumes: async () => ({ ...mounts, mounts: [...mounts.mounts, { path: local, local: true }] }),
    timeoutMs: 10,
  });
  const value = await sharing.inspect([local + '/Child']);
  expect(value.folders?.[0]).toMatchObject({ status: 'ready' });
  expect(value.folders?.[0]?.shares).toHaveLength(1);
  expect(folder.mock.calls.some(([file]) => file === '/Volumes/Network')).toBe(false);
});
it('keeps a hung stat scoped after its canonical path is known', async () => {
  const sharing = new NetworkSharing({
    available: true,
    run: runner(['/Volumes/Local/Shared', '/fixtures/Shared']),
    addresses: () => [],
    acl: async () => 'none',
    volumes: async () => mounts,
    timeoutMs: 10,
    folder: async (file, resolved) => {
      resolved?.(file);
      if (file === '/Volumes/Local/Shared') return new Promise<never>(() => {});
      return { directory: true, mode: 0o755, identity: file, canonical: file };
    },
  });
  const value = await sharing.inspect([
    '/Volumes/Local/Shared/Child',
    '/fixtures/Shared',
    '/fixtures/Outside',
  ]);
  expect(value.status).toBe('ready');
  expect(value.folders?.map((folder) => folder.status)).toEqual(['unknown', 'ready', 'ready']);
  expect(value.folders?.[1]?.shares).toHaveLength(1);
});
it('uses the longest kernel mount and treats unescaped fallback network records as uncertain', () => {
  expect(sharingVolume('/Volumes/Network/Child', mounts)).toBe('network');
  expect(sharingVolume('/Volumes/Local/Child', mounts)).toBe('local');
  expect(sharingVolume('/volumes/network/Child', mounts)).toBe('unknown');
  expect(
    sharingVolume('/Volumes/Local/Café/Child', {
      precise: true,
      mounts: [...mounts.mounts, { path: '/Volumes/Local/Cafe\u0301', local: false }],
    }),
  ).toBe('unknown');
  const fallback = {
    precise: false,
    mounts: parseSharingMounts(
      '/dev/disk on / (apfs, local)\n//host/share on /Volumes/Network (smbfs, nodev)\n',
    ),
  };
  expect(sharingVolume('/Volumes/Network/Child', fallback)).toBe('unknown');
  expect(sharingVolume('/fixtures/Shared', fallback)).toBe('local');
  expect(sharingVolume('/fixtures/Line\nbreak', fallback)).toBe('unknown');
  expect(parseSharingMounts('garbage')).toBeUndefined();
});
it('keeps legacy fallback process reads within the five-second interval and runs none with the current helper', async () => {
  let now = 0;
  const run = vi.fn<SharingRunner>(async () => ({
    ok: true,
    stdout: '/dev/disk on / (apfs, local)\n',
    stderr: '',
  }));
  const legacy = new SharingVolumes(
    run,
    () => undefined,
    () => now,
  );
  for (let index = 0; index < 20; index++) {
    now = index * 100;
    await legacy.read();
  }
  expect(run).toHaveBeenCalledExactlyOnceWith('mounts');
  const native = new SharingVolumes(run, () => mounts.mounts);
  await native.read(true);
  expect(run).toHaveBeenCalledTimes(1);
});
it('falls back without a helper and keeps a failed mount read unknown', async () => {
  const run = vi.fn<SharingRunner>(async () => ({ ok: false, stdout: '', stderr: 'Unavailable' }));
  const absent = new SharingVolumes(run, () => {
    throw new Error('No native helper');
  });
  const snapshot = await absent.read();
  expect(sharingVolume('/Volumes/Unresolved/Child', snapshot)).toBe('unknown');
  await absent.read();
  expect(run).toHaveBeenCalledExactlyOnceWith('mounts');
});
