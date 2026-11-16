import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { SharingRunner } from '../src/desktop/files/network-sharing';
import type { NetworkShare } from '../src/domain/files/network-sharing';
import {
  NetworkSharing,
  localIPv4,
  openSharingSettings,
  runSharingRead,
  sharingSettingsURLs,
} from '../src/desktop/files/network-sharing';
import { parseSharePoints } from '../src/desktop/files/sharing-parser';
import { guestWarning, sharingAddresses } from '../src/domain/files/network-sharing';
import { createNetworkSharingHandlers } from '../src/desktop/ipc/network-sharing-handlers';
import { methodWindows, schemas } from '../src/desktop/ipc/schemas';
import { agentCommandID, modelLineCommandProblem } from '../src/domain/agents/safety';
import { temporaryRoot } from '../tools/temporary';
import { stat } from '../src/desktop/files/stats';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

// The text layout emitted by macOS sharing -l, including its separate SMB name.
function record(
  name = 'Laptop backup',
  folder = '/Shared/Backup',
  guest = '1',
  readOnly = '0',
  shared = '1',
) {
  return `name:\t\t${name}\npath:\t\t${folder}\n\tsmb:\t{\n    \t\tname:\t${name}\n    \t\tshared:\t${shared}\n    \t\tguest access:\t${guest}\n    \t\tread-only:\t${readOnly}\n    \t\tsealed:\t0\n\t}\n`;
}
const output = (...records: string[]) => '\n\t\t\tList of Share Points\n' + records.join('\n');
const share: NetworkShare = {
  name: 'Bäckup 日本 2026',
  path: '/Shared/Backup',
  guests: true,
  readOnly: false,
  guestWritable: false,
};
const runner =
  (text: string): SharingRunner =>
  async (read) => ({
    ok: true,
    stderr: '',
    stdout: read === 'shares' ? text : read === 'host' ? 'Studio-Mac\n' : 'state = running',
  });

describe('share point parsing', () => {
  it('accepts the empty output emitted with no share points and the explicit empty message', () => {
    expect(parseSharePoints('')).toEqual([]);
    expect(parseSharePoints('No share point records.\n')).toEqual([]);
  });
  it.each([
    ['0', '0'],
    ['0', '1'],
    ['1', '0'],
    ['1', '1'],
  ])('reads guest %s and read-only %s without guessing', (guests, readOnly) => {
    expect(parseSharePoints(output(record(share.name, share.path, guests, readOnly)))).toEqual([
      { path: share.path, name: share.name, guests: guests === '1', readOnly: readOnly === '1' },
    ]);
  });
  it('reads several names, spaces, non-ASCII and ignores unknown fields and disabled SMB shares', () => {
    expect(
      parseSharePoints(
        output(
          record(),
          record(share.name, '/Shared/Second', '0', '1'),
          record('Disabled', '/Shared/Disabled', '1', '0', '0'),
        ),
      ),
    ).toHaveLength(2);
    expect(parseSharePoints(output(record().replace('sealed:', 'future field:')))).toHaveLength(1);
  });
  it('uses the SMB name instead of the record name', () => {
    expect(
      parseSharePoints(output(record().replace('name:\t\tLaptop backup', 'name:\t\tRecord')))?.[0]
        ?.name,
    ).toBe('Laptop backup');
  });
  it.each([
    'garbage',
    'List of Share Points',
    output(record().slice(0, -3)),
    output(record().replace('guest access:\t1', 'guest access:\tmaybe')),
    output(record().replace('read-only:\t0\n', '')),
    output(record().replace('/Shared/Backup', 'relative')),
    output(record(), record().replace('shared:\t1', 'shared:\t2')),
    output(record().replace('sealed:\t0', 'shared:\t1')),
    output(record()) + 'garbage',
    output(record()) + '\0',
  ])('treats malformed or truncated output as unknown (%#)', (text) => {
    expect(parseSharePoints(text)).toBeUndefined();
  });
});

describe('sharing addresses and guest warnings', () => {
  it('leaves UNC spaces literal, percent-encodes the SMB URL and includes every IPv4', () => {
    expect(sharingAddresses(share, 'Studio-Mac', ['192.168.1.12', '10.0.0.3'])).toEqual([
      { system: 'Windows', address: '\\\\Studio-Mac\\Bäckup 日本 2026' },
      { system: 'Windows', address: '\\\\192.168.1.12\\Bäckup 日本 2026' },
      { system: 'Windows', address: '\\\\10.0.0.3\\Bäckup 日本 2026' },
      { system: 'Mac', address: 'smb://Studio-Mac.local/B%C3%A4ckup%20%E6%97%A5%E6%9C%AC%202026' },
    ]);
    expect(
      sharingAddresses({ ...share, name: 'Files #1%' }, 'Studio-Mac', ['10.0.0.3']).at(-1)?.address,
    ).toBe('smb://Studio-Mac.local/Files%20%231%25');
    expect(sharingAddresses(share, 'Studio-Mac', [])).toEqual([]);
    expect(sharingAddresses(share, '', ['10.0.0.3'])).toHaveLength(1);
  });
  it('excludes loopback and deduplicates assigned IPv4 interfaces, including local links', () => {
    const address = (ip: string, internal = false) => ({
      address: ip,
      family: 'IPv4' as const,
      internal,
      netmask: '255.255.255.0',
      cidr: ip + '/24',
      mac: '00:00:00:00:00:00',
    });
    expect(
      localIPv4({
        lo0: [address('127.0.0.1', true)],
        en0: [address('192.168.1.12')],
        en1: [address('10.0.0.3'), address('192.168.1.12'), address('169.254.1.1')],
      }),
    ).toEqual(['10.0.0.3', '169.254.1.1', '192.168.1.12']);
  });
  it('states both strengths plainly and omits a warning for registered users only', () => {
    expect(guestWarning(share)).toBe(
      'Anyone on the same network can open this folder without a password.',
    );
    expect(guestWarning({ ...share, guestWritable: true })).toBe(
      'Anyone on the same network can open this folder without a password. They can also add, change and delete files in this folder.',
    );
    expect(guestWarning({ ...share, guests: false })).toBeUndefined();
  });
});

describe('read-only desktop sharing cache', () => {
  it('ignores missing paths and files, combines folder permissions with the guest policy, and caches', async () => {
    const root = await temporaryRoot('viewer-network-sharing-');
    await mkdir(path.join(root, 'Folder'), { mode: 0o777 });
    await writeFile(path.join(root, 'File'), 'fixture');
    const run = vi.fn(
      runner(
        output(
          record('Folder', path.join(root, 'Folder')),
          record('File', path.join(root, 'File')),
          record('Gone', path.join(root, 'Gone')),
        ),
      ),
    );
    const service = new NetworkSharing({
      available: true,
      run,
      folder: async (file) => {
        const info = await stat(file);
        return { directory: info.isDirectory(), mode: 0o777 };
      },
      addresses: () => ['10.0.0.3'],
    });
    expect(service.snapshot().status).toBe('unknown');
    expect(run).not.toHaveBeenCalled();
    const pending = service.refresh();
    expect(service.refresh()).toBe(pending);
    expect(await pending).toMatchObject({
      status: 'ready',
      service: 'running',
      host: 'Studio-Mac',
      shares: [{ name: 'Folder', guestWritable: true }],
    });
    for (let index = 0; index < 100; index++) service.snapshot();
    expect(run).toHaveBeenCalledTimes(3);
    await service.refresh();
    expect(run).toHaveBeenCalledTimes(6);
  });
  it.each([
    [true, false, 0o777, true],
    [true, true, 0o777, false],
    [true, false, 0o755, false],
    [false, false, 0o777, false],
  ])(
    'uses guest, read-only and Everyone write together (%#)',
    async (guests, readOnly, mode, writable) => {
      const service = new NetworkSharing({
        available: true,
        run: runner(
          output(record('Backup', '/Shared/Backup', guests ? '1' : '0', readOnly ? '1' : '0')),
        ),
        folder: async () => ({ directory: true, mode: Number(mode) }),
        addresses: () => [],
      });
      expect((await service.refresh()).shares[0]?.guestWritable).toBe(writable);
    },
  );
  it('clears stale results on parse/run failure and reports an absent service without an error', async () => {
    let text = output(record());
    const run: SharingRunner = async (read) =>
      read === 'service'
        ? {
            ok: false,
            stdout: '',
            stderr: 'Could not find service "com.apple.smbd" in domain for system',
          }
        : runner(text)(read);
    const service = new NetworkSharing({
      available: true,
      run,
      folder: async () => ({ directory: true, mode: 0o755 }),
      addresses: () => [],
    });
    expect((await service.refresh()).service).toBe('off');
    text = 'truncated';
    expect(await service.refresh()).toMatchObject({ status: 'unknown', shares: [] });
    const failing = new NetworkSharing({
      available: true,
      run: async () => {
        throw new Error('timeout');
      },
      folder: vi.fn(),
      addresses: () => [],
    });
    expect((await failing.refresh()).status).toBe('unknown');
    const storeRun = vi.fn(runner(text));
    const store = new NetworkSharing({
      available: false,
      run: storeRun,
      folder: vi.fn(),
      addresses: () => [],
    });
    expect((await store.refresh()).status).toBe('unavailable');
    expect(storeRun).not.toHaveBeenCalled();
  });
  it('executes only fixed absolute read commands, without a shell, with bounded work', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      (callback as (error: null, stdout: string, stderr: string) => void)(null, '', '');
      return {} as ReturnType<typeof execFile>;
    });
    for (const read of ['shares', 'service', 'host'] as const) await runSharingRead(read);
    expect(vi.mocked(execFile).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [
        '/usr/sbin/sharing',
        ['-l'],
        { timeout: 2000, maxBuffer: 1048576, encoding: 'utf8', shell: false },
      ],
      [
        '/bin/launchctl',
        ['print', 'system/com.apple.smbd'],
        { timeout: 2000, maxBuffer: 1048576, encoding: 'utf8', shell: false },
      ],
      [
        '/usr/sbin/scutil',
        ['--get', 'LocalHostName'],
        { timeout: 2000, maxBuffer: 1048576, encoding: 'utf8', shell: false },
      ],
    ]);
  });
});

describe('person-only sharing flow', () => {
  it('refuses agent reads and settings before any side effect, including after a folder await', async () => {
    let agent = true;
    const sharing = { refresh: vi.fn(), snapshot: vi.fn() };
    const openSettings = vi.fn(async () => {});
    const requireFolder = vi.fn(async () => {
      agent = true;
    });
    const handle = createNetworkSharingHandlers({
      available: true,
      sharing,
      isAgent: () => agent,
      requireFolder,
      openSettings,
    }).networkSharing;
    for (const request of [
      { kind: 'refresh' },
      { kind: 'settings', path: '/Shared/Backup' },
    ] as const)
      await expect(handle([request], 1)).rejects.toThrow('only to the person');
    expect(requireFolder).not.toHaveBeenCalled();
    expect(sharing.refresh).not.toHaveBeenCalled();
    agent = false;
    await expect(handle([{ kind: 'settings', path: '/Shared/Backup' }], 1)).rejects.toThrow(
      'only to the person',
    );
    expect(openSettings).not.toHaveBeenCalled();
    agent = false;
    sharing.refresh.mockImplementation(async () => {
      agent = true;
      return { status: 'ready', shares: [] };
    });
    await expect(handle([{ kind: 'refresh' }], 1)).rejects.toThrow('only to the person');
  });
  it('offers no write or password request and rejects the command for agents and model aliases', () => {
    expect(methodWindows.networkSharing).toBe('viewer');
    for (const request of [
      { kind: 'add' },
      { kind: 'remove' },
      { kind: 'settings', path: '/Shared/Backup', password: 'unused' },
      { kind: 'refresh', args: ['-a'] },
    ])
      expect(schemas.networkSharing.safeParse([request]).success).toBe(false);
    expect(() => agentCommandID('network-sharing', [])).toThrow();
    expect(modelLineCommandProblem('network-sharing', [])).toContain('only to the person');
  });
  it('opens only a fixed installed-version Settings URL, falling back to Sharing on refusal', async () => {
    const open = vi.fn(async (_url: string) => {});
    open.mockRejectedValueOnce(new Error('specific pane unavailable'));
    await openSharingSettings(15, open);
    expect(open.mock.calls.flat()).toEqual(sharingSettingsURLs(15));
    expect(sharingSettingsURLs(12)[0]).toBe(
      'x-apple.systempreferences:com.apple.preferences.sharing?Services_PersonalFileSharing',
    );
  });
});
