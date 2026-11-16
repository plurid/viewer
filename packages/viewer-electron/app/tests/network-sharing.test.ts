import { describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { NetworkShare, NetworkAddressFamily } from '../src/domain/files/network-sharing';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import {
  NetworkSharing,
  physicalAddresses,
  sharingFolder,
  runSharingRead,
  openSharingSettings,
  sharingSettingsURLs,
} from '../src/desktop/files/network-sharing';
import { parseSharePoints } from '../src/desktop/files/sharing-parser';
import {
  guestWarning,
  sharingAddresses,
  modelCommandLabel,
} from '../src/domain/files/network-sharing';
import { createNetworkSharingHandlers } from '../src/desktop/ipc/network-sharing-handlers';
import { schemas } from '../src/desktop/ipc/schemas';
import { agentCommandID } from '../src/domain/agents/safety';
import { temporaryRoot } from '../tools/temporary';
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const record = (folder = '/Shared/Backup', guests = 1, readOnly = 0, name = 'Backup 日本') => ({
  path: folder,
  smb_name: name,
  smb_shared: 1,
  smb_guest_access: guests,
  smb_read_only: readOnly,
  smb_sealed: 0,
});
const output = (...records: ReturnType<typeof record>[]) =>
  JSON.stringify(Object.fromEntries(records.map((value, index) => ['Record ' + index, value])));
const run =
  (text: string): SharingRunner =>
  async (read) => ({
    ok: true,
    stderr: '',
    stdout: read === 'shares' ? text : read === 'host' ? 'Studio-Mac' : '',
  });
const share: NetworkShare = {
  path: '/Shared/Backup',
  name: 'Backup 日本',
  guests: true,
  readOnly: false,
  guestWritable: false,
};
describe('structured share points', () => {
  it('requires explicit no-share output, never empty output', () => {
    expect(parseSharePoints('')).toBeUndefined();
    expect(parseSharePoints('No share point records.\n')).toEqual([]);
    expect(parseSharePoints('{}')).toEqual([]);
  });
  it('reads several points, Unicode, spaces and boolean fields while ignoring future fields', () => {
    expect(parseSharePoints(output(record(), record('/Shared/Second', 0, 1, 'My backup')))).toEqual(
      [
        { path: share.path, name: share.name, guests: true, readOnly: false },
        { path: '/Shared/Second', name: 'My backup', guests: false, readOnly: true },
      ],
    );
    expect(parseSharePoints(JSON.stringify({ Disabled: { ...record(), smb_shared: 0 } }))).toEqual(
      [],
    );
  });
  it('keeps a line break in a name as data and refuses forgeable text records', () => {
    const name = 'Folder\npath:\t/Other\n\tsmb:\t{\n\tguest access:\t0';
    expect(parseSharePoints(output(record('/Shared/Backup', 1, 0, name)))?.[0]).toMatchObject({
      name,
      guests: true,
      readOnly: false,
    });
    expect(
      parseSharePoints(
        'List of Share Points\nname:\t' +
          name +
          '\npath:\t/Shared/Backup\n\tsmb:\t{\nname:\tForged\nshared:\t1\nguest access:\t0\nread-only:\t1\n}',
      ),
    ).toBeUndefined();
  });
  it.each([
    'garbage',
    '[]',
    '{"broken":',
    output({ ...record(), smb_guest_access: 2 }),
    output({ ...record(), path: 'relative' }),
    output(record()) + '\0',
  ])('fails closed for malformed output (%#)', (value) => {
    expect(parseSharePoints(value)).toBeUndefined();
  });
});
describe('identity and permissions', () => {
  it('matches descendants, trailing slashes and symbolic aliases by the shared folder identity', async () => {
    const root = await temporaryRoot('viewer-sharing-identity-');
    const shared = path.join(root, 'Shared');
    const child = path.join(shared, 'Child');
    const alias = path.join(root, 'Alias');
    await mkdir(child, { recursive: true });
    await symlink(shared, alias);
    const service = new NetworkSharing({
      available: true,
      run: run(output(record(shared + '/'))),
      folder: sharingFolder,
      acl: async () => 'none',
      addresses: () => [],
    });
    const paths = [shared, shared + '/', child, alias, path.join(alias, 'Child')];
    const result = await service.inspect(paths);
    expect(result.status).toBe('ready');
    expect(
      result.folders?.every((folder) => folder.status === 'ready' && folder.shares.length === 1),
    ).toBe(true);
    expect(result.folders?.find((folder) => folder.path === child)?.shares[0]).toMatchObject({
      inside: true,
      relative: 'Child',
    });
    expect(result.folders?.find((folder) => folder.path === alias)?.shares[0].inside).toBe(false);
    await chmod(shared, 0o777);
    await chmod(child, 0o755);
    expect((await service.inspect([child], true)).folders?.[0]?.shares[0]).toMatchObject({
      inside: true,
      guestWritable: true,
    });
    if (process.platform === 'darwin') {
      const cased = shared.slice(0, -6) + 'sHARED';
      expect((await service.inspect([cased])).folders?.[0]?.shares).toHaveLength(1);
    }
  });
  it('uses real folder modes, ACL grants and uncertainty for the write warning', async () => {
    const root = await temporaryRoot('viewer-sharing-permissions-');
    const folder = path.join(root, 'Shared');
    await mkdir(folder);
    for (const [mode, acl, writable, unknown] of [
      [0o755, 'none', false, false],
      [0o777, 'none', true, false],
      [0o755, 'write', true, false],
      [0o755, 'unknown', false, true],
    ] as const) {
      await chmod(folder, mode);
      const service = new NetworkSharing({
        available: true,
        run: run(output(record(folder))),
        folder: sharingFolder,
        acl: async () => acl,
        addresses: () => [],
      });
      expect((await service.refresh()).shares[0]).toMatchObject({
        guestWritable: writable,
        guestWriteUnknown: unknown,
      });
    }
    const service = new NetworkSharing({
      available: true,
      run: run(output(record(folder, 1, 1))),
      folder: sharingFolder,
      acl: async () => 'write',
      addresses: () => [],
    });
    expect((await service.refresh()).shares[0]?.guestWritable).toBe(false);
  });
  it('drops missing and non-folder points but never drops a permission failure', async () => {
    const root = await temporaryRoot('viewer-sharing-stale-');
    const file = path.join(root, 'File');
    await writeFile(file, 'fixture');
    const service = new NetworkSharing({
      available: true,
      run: run(output(record(file), record(path.join(root, 'Missing')))),
      folder: sharingFolder,
      addresses: () => [],
    });
    expect(await service.refresh()).toMatchObject({ status: 'ready', shares: [] });
    const unreadable = new NetworkSharing({
      available: true,
      run: run(output(record())),
      folder: async () => {
        throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      },
      addresses: () => [],
    });
    expect((await unreadable.refresh()).status).toBe('unknown');
  });
  it('bounds a hung share stat and permits a later refresh', async () => {
    const folder = vi.fn(async () => new Promise<never>(() => {}));
    const service = new NetworkSharing({
      available: true,
      run: run(output(record())),
      folder,
      timeoutMs: 10,
      addresses: () => [],
    });
    expect((await service.refresh()).status).toBe('unknown');
    expect((await service.refresh(true)).status).toBe('unknown');
    expect(folder).toHaveBeenCalledTimes(2);
  });
  it('throttles navigation but permits a requested refresh and runs no tool in Store builds', async () => {
    let now = 0;
    const execute = vi.fn(run('{}'));
    const service = new NetworkSharing({
      available: true,
      run: execute,
      folder: sharingFolder,
      addresses: () => [],
      now: () => now,
    });
    await service.refresh();
    for (let index = 0; index < 20; index++) await service.refresh();
    expect(execute).toHaveBeenCalledTimes(4);
    now = 5001;
    await service.refresh();
    expect(execute).toHaveBeenCalledTimes(8);
    await service.refresh(true);
    expect(execute).toHaveBeenCalledTimes(12);
    const store = new NetworkSharing({
      available: false,
      run: execute,
      folder: sharingFolder,
      addresses: () => [],
    });
    expect((await store.refresh()).status).toBe('unavailable');
    expect(execute).toHaveBeenCalledTimes(12);
  });
});
describe('addresses, warnings and authority', () => {
  it('offers physical interfaces with labels, local names and encoded nested paths', () => {
    const address = (ip: string, family: NetworkAddressFamily = 'IPv4') => ({
      address: ip,
      family,
      internal: false,
      netmask: '',
      cidr: null,
      mac: '',
      scopeid: 0,
    });
    const interfaces = physicalAddresses(
      'Hardware Port: Wi-Fi\nDevice: en0\nHardware Port: USB Ethernet\nDevice: en4\n',
      {
        en0: [address('192.168.1.2'), address('fe80::1', 'IPv6')],
        en4: [address('10.0.0.2')],
        utun0: [address('10.8.0.1')],
        bridge0: [address('172.16.0.1')],
      },
    );
    expect(interfaces.map((item) => item.name)).toEqual(['en4', 'en0', 'en0']);
    const addresses = sharingAddresses(
      { ...share, relative: 'Sub folder' },
      'Studio-Mac',
      ['192.168.1.2'],
      interfaces,
    );
    expect(addresses[0]).toEqual({
      system: 'Windows',
      address: '\\\\192.168.1.2\\Backup 日本\\Sub folder',
      label: 'Wi-Fi',
    });
    expect(
      addresses.some((item) => item.address === '\\\\Studio-Mac.local\\Backup 日本\\Sub folder'),
    ).toBe(true);
    expect(addresses.at(-1)?.address).toBe(
      'smb://Studio-Mac.local/Backup%20%E6%97%A5%E6%9C%AC/Sub%20folder',
    );
    const v6 = interfaces.filter((item) => item.family === 'IPv6');
    expect(
      sharingAddresses(share, 'A-very-long-Mac-name', [], v6).map((item) => item.address),
    ).toEqual([
      '\\\\A-very-long-Mac-name.local\\Backup 日本',
      'smb://A-very-long-Mac-name.local/Backup%20%E6%97%A5%E6%9C%AC',
    ]);
    expect(sharingAddresses(share, 'Studio-Mac', [])).toEqual([]);
  });
  it('does not under-claim unknown guest write permission and never leaks the dynamic command label', () => {
    expect(guestWarning(share)).toBe(
      'Anyone on the same network can open this folder without a password.',
    );
    expect(guestWarning({ ...share, guestWritable: true })).toContain(
      'They can also add, change and delete',
    );
    expect(guestWarning({ ...share, guestWriteUnknown: true })).toContain(
      'Guests may also be able',
    );
    expect(modelCommandLabel({ id: 'network-sharing', label: 'Share on the Network…' })).toBe(
      modelCommandLabel({ id: 'network-sharing', label: 'Network Sharing…' }),
    );
  });
  it('runs the implemented human flow, then rejects an agent at the same desktop handler', async () => {
    const service = new NetworkSharing({
      available: true,
      run: run('{}'),
      folder: sharingFolder,
      addresses: () => [],
    });
    let agent = false;
    const open = vi.fn(async () => {});
    const handler = createNetworkSharingHandlers({
      available: true,
      sharing: service,
      isAgent: () => agent,
      requireFolder: async () => {},
      openSettings: open,
    }).networkSharing;
    expect(schemas.networkSharing.safeParse([{ kind: 'refresh' }]).success).toBe(true);
    expect(await handler([{ kind: 'refresh' }], 1)).toMatchObject({ status: 'ready' });
    agent = true;
    for (const request of [
      { kind: 'refresh' },
      { kind: 'settings', path: '/Shared/Backup' },
    ] as const)
      await expect(handler([request], 1)).rejects.toThrow('only to the person');
    expect(open).not.toHaveBeenCalled();
    expect(() => agentCommandID('network-sharing', [])).toThrow();
  });
  it('uses only fixed bounded read tools and a fixed Settings URL with fallback', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      (callback as (error: null, stdout: string, stderr: string) => void)(null, '{}', '');
      return {} as ReturnType<typeof execFile>;
    });
    for (const read of ['shares', 'service', 'host', 'interfaces'] as const)
      await runSharingRead(read);
    expect(vi.mocked(execFile).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['/usr/sbin/sharing', ['-l', '-f', 'json']],
      ['/bin/launchctl', ['print', 'system/com.apple.smbd']],
      ['/usr/sbin/scutil', ['--get', 'LocalHostName']],
      ['/usr/sbin/networksetup', ['-listallhardwareports']],
    ]);
    for (const call of vi.mocked(execFile).mock.calls)
      expect(call[2]).toMatchObject({ timeout: 2000, shell: false, maxBuffer: 1048576 });
    const open = vi.fn(async (_url: string) => {});
    open.mockRejectedValueOnce(new Error('No anchor'));
    await openSharingSettings(15, open);
    expect(open.mock.calls.flat()).toEqual(sharingSettingsURLs(15));
    expect(schemas.networkSharing.safeParse([{ kind: 'remove', password: 'unused' }]).success).toBe(
      false,
    );
  });
});
