import { expect, it, vi } from 'vitest';
import { chmod, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import { NetworkSharing, sharingFolder } from '../src/desktop/files/network-sharing';
import { temporaryRoot } from '../tools/temporary';
import { guestWarning } from '../src/domain/files/network-sharing';

const listing =
  (paths: string[]): SharingRunner =>
  async (kind) => ({
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

it('keeps the whole state unknown when a locked recorded alias cannot be resolved', async () => {
  const root = await temporaryRoot('viewer-sharing-locked-alias-');
  const open = path.join(root, 'Top', 'Open');
  const locked = path.join(root, 'Locked');
  const alias = path.join(locked, 'LinkToOpen');
  await mkdir(open, { recursive: true });
  await mkdir(locked);
  await symlink(open, alias);
  await chmod(locked, 0);
  try {
    const sharing = new NetworkSharing({
      available: true,
      run: listing([alias]),
      folder: sharingFolder,
      acl: async () => 'none',
      addresses: () => [],
    });
    const value = await sharing.inspect([open], true);
    console.log(
      JSON.stringify({
        reproduction: 'S-A',
        status: value.status,
        folderStatus: value.folders?.[0]?.status,
        shares: value.folders?.[0]?.shares.length,
      }),
    );
    expect(value.status).toBe('unknown');
  } finally {
    await chmod(locked, 0o700);
  }
});

it('retries only missing metadata at most once per second without relaunching tools on twenty navigations', async () => {
  let now = 0;
  let present = false;
  const missing = '/fixtures/Missing';
  const run = vi.fn(listing([missing, '/fixtures/Shared']));
  const folder = vi.fn(async (file: string) => {
    if (file === missing && !present) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    return { directory: true, mode: 0o755, identity: file, canonical: file };
  });
  const sharing = new NetworkSharing({
    available: true,
    run,
    folder,
    acl: async () => 'none',
    addresses: () => [],
    now: () => now,
  });
  await sharing.refresh();
  run.mockClear();
  folder.mockClear();
  for (let index = 1; index <= 20; index++) {
    now = index * 100;
    expect((await sharing.inspect(['/fixtures/Outside'])).status).toBe('ready');
  }
  const pathReads = folder.mock.calls.filter(([file]) => file === missing).length;
  console.log(
    JSON.stringify({
      reproduction: 'S-B',
      navigations: 20,
      milliseconds: now,
      toolCalls: run.mock.calls.length,
      shareListCalls: run.mock.calls.filter(([kind]) => kind === 'shares').length,
      missingPathReads: pathReads,
    }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(pathReads).toBe(2);
  present = true;
  now = 3000;
  expect((await sharing.inspect([missing])).folders?.[0]?.shares).toHaveLength(1);
  expect(run).not.toHaveBeenCalled();
});
it('uses physical interfaces for offline state when virtual interfaces still have addresses', async () => {
  const hardware = 'Hardware Port: Wi-Fi\nDevice: en0\n\nHardware Port: Ethernet\nDevice: en1\n';
  const virtual = {
    address: 'fe80::1',
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6' as const,
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: 'fe80::1/64',
    scopeid: 1,
  };
  const physical = {
    address: '192.168.1.12',
    netmask: '255.255.255.0',
    family: 'IPv4' as const,
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: '192.168.1.12/24',
  };
  const run = listing(['/fixtures/Shared']);
  for (const online of [false, true]) {
    const sharing = new NetworkSharing({
      available: true,
      run: async (kind) =>
        kind === 'interfaces' ? { ok: true, stderr: '', stdout: hardware } : run(kind),
      folder: async (file) => ({ directory: true, mode: 0o755, identity: file, canonical: file }),
      addresses: () => [],
      acl: async () => 'none',
      network: () => ({
        utun0: [virtual],
        awdl0: [virtual],
        llw0: [virtual],
        bridge0: [virtual],
        en0: online ? [physical] : [],
        en1: [],
      }),
    });
    expect((await sharing.refresh()).network).toBe(online ? 'connected' : 'offline');
  }
});
it('keeps world-write mode information with a legacy helper and respects checked ACL denials', async () => {
  const root = await temporaryRoot('viewer-sharing-legacy-mode-');
  const folder = path.join(root, 'Shared');
  await mkdir(folder);
  for (const [mode, acl, expected, uncertain] of [
    [0o777, 'unavailable', true, false],
    [0o755, 'unavailable', false, true],
    [0o777, 'none', false, false],
  ] as const) {
    await chmod(folder, mode);
    const sharing = new NetworkSharing({
      available: true,
      run: listing([folder]),
      folder: sharingFolder,
      addresses: () => [],
      acl: async () => acl,
    });
    const share = (await sharing.inspect([folder], true)).folders?.[0]?.shares[0];
    expect(share).toMatchObject({ guestWritable: expected, guestWriteUnknown: uncertain });
    if (expected) expect(guestWarning(share!)).toContain('Guests can also modify');
    else if (uncertain) expect(guestWarning(share!)).toContain('Guests may also be able to modify');
  }
});
