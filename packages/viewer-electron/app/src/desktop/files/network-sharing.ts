import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  NetworkShare,
  NetworkFolderSharing,
  NetworkSharingSnapshot,
  SharingInterface,
} from '../../domain/files/network-sharing';
import { itemIdentity } from '../../domain/files/item-identity';
import { stat } from './stats';
import { macFiles } from '../native/macos-files';
import type { GuestACLState } from '../native/macos-files';
import { parseSharePoints } from './sharing-parser';
import { containsPath } from './containment';
import { SharingMetadata } from './sharing-metadata';

export const networkSharingAvailable = process.platform === 'darwin' && !process.mas;
type SharingRead = 'shares' | 'sharepoints' | 'service' | 'host' | 'interfaces' | 'guest';
export interface SharingOutput {
  stdout: string;
  stderr: string;
  ok: boolean;
}
export type SharingRunner = (read: SharingRead) => Promise<SharingOutput>;
const reads: Record<SharingRead, { file: string; args: string[] }> = {
  shares: { file: '/usr/sbin/sharing', args: ['-l', '-f', 'json'] },
  service: { file: '/bin/launchctl', args: ['print', 'system/com.apple.smbd'] },
  host: { file: '/usr/sbin/scutil', args: ['--get', 'LocalHostName'] },
  interfaces: { file: '/usr/sbin/networksetup', args: ['-listallhardwareports'] },
  sharepoints: { file: '/usr/bin/dscl', args: ['.', '-list', '/SharePoints'] },
  guest: { file: '/usr/bin/plutil', args: ['-extract', 'AllowGuestAccess', 'raw', '-expect', 'bool', '-o', '-', '/Library/Preferences/SystemConfiguration/com.apple.smb.server.plist'] },
};
export const runSharingRead: SharingRunner = (read) =>
  new Promise((resolve) => {
    const { file, args } = reads[read];
    execFile(
      file,
      args,
      { timeout: 2000, maxBuffer: 1024 * 1024, encoding: 'utf8', shell: false },
      (error, stdout, stderr) => resolve({ stdout, stderr, ok: !error }),
    );
  });

export function localIPv4(interfaces: ReturnType<typeof os.networkInterfaces>): string[] {
  return [
    ...new Set(
      Object.values(interfaces).flatMap((addresses) =>
        (addresses ?? [])
          .filter(
            (item) =>
              item.family === 'IPv4' && !item.internal && !/^(?:0|127)\./.test(item.address),
          )
          .map((item) => item.address),
      ),
    ),
  ].sort();
}
export function physicalAddresses(
  output: string,
  interfaces: ReturnType<typeof os.networkInterfaces>,
): SharingInterface[] {
  const result: SharingInterface[] = [];
  let kind: SharingInterface['kind'] | undefined;
  for (const line of output.split('\n')) {
    if (line.startsWith('Hardware Port:')) {
      kind = /Wi-Fi|AirPort/i.test(line)
        ? 'Wi-Fi'
        : /Ethernet|LAN|Thunderbolt/i.test(line)
          ? 'Ethernet'
          : undefined;
    } else if (kind && /^Device: en\d+$/.test(line.trim())) {
      const name = line.slice(line.indexOf(':') + 1).trim();
      for (const item of interfaces[name] ?? [])
        if (
          !item.internal &&
          (item.family === 'IPv4' || item.family === 'IPv6') &&
          !/^(?:0|127)\./.test(item.address)
        )
          result.push({ name, kind, address: item.address, family: item.family });
    }
  }
  return result.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export type GuestACL = GuestACLState;
export interface SharingFolder {
  directory: boolean;
  mode: number;
  identity: string;
  canonical: string;
}
export async function sharingFolder(file: string): Promise<SharingFolder> {
  const info = await stat(file);
  return {
    directory: info.isDirectory(),
    mode: info.mode,
    identity: itemIdentity(info),
    canonical: await realpath(file),
  };
}
interface SharingPorts {
  available: boolean;
  run: SharingRunner;
  folder: (file: string) => Promise<SharingFolder>;
  addresses: () => string[];
  acl?: (file: string) => Promise<GuestACL>;
  network?: () => ReturnType<typeof os.networkInterfaces>;
  now?: () => number;
  timeoutMs?: number;
}
const empty = (status: NetworkSharingSnapshot['status']): NetworkSharingSnapshot => ({
  status,
  shares: [],
  service: 'unknown',
  host: '',
  ipv4: [],
  interfaces: [],
});
export class NetworkSharing {
  private value = empty('unknown');
  private pending?: Promise<NetworkSharingSnapshot>;
  private refreshed = -Infinity;
  private pendingForced = false;
  private metadata: SharingMetadata;
  private folders = new Map<string, Promise<SharingFolder>>();
  constructor(
    private readonly ports: SharingPorts = {
      available: networkSharingAvailable,
      run: runSharingRead,
      folder: sharingFolder,
      addresses: () => [],
      network: () => os.networkInterfaces(),
      acl: async (file) => {
        try {
          const read = macFiles().guestACL;
          if (!read) return 'unavailable';
          try { return await read(file); } catch { return 'unreadable'; }
        } catch {
          return 'unavailable';
        }
      },
    },
  ) { this.metadata = new SharingMetadata(ports.timeoutMs ?? 700); }
  snapshot(): NetworkSharingSnapshot {
    return this.value;
  }
  refresh(force = false): Promise<NetworkSharingSnapshot> {
    if (!this.ports.available) return Promise.resolve((this.value = empty('unavailable')));
    if (this.pending) return force && !this.pendingForced ? this.pending.then(() => this.refresh(true)) : this.pending;
    const now = (this.ports.now ?? Date.now)();
    if (!force && now - this.refreshed < 5000) return Promise.resolve(this.value);
    this.refreshed = now;
    this.pendingForced = force;
    return (this.pending = this.read().finally(() => {
      this.pending = undefined;
    }));
  }
  private folder(file: string): Promise<SharingFolder> {
    return this.metadata.read('folder', file, () => this.ports.folder(file));
  }
  async requireFolder(file: string): Promise<void> {
    if (!(await this.folder(file)).directory) throw new Error('Choose one folder.');
  }
  private async access(file: string, mode: number, share: NetworkShare): Promise<NetworkShare> {
    if (!share.guests || share.readOnly)
      return { ...share, accessPath: file, guestWritable: false, guestWriteUnknown: false, guestWriteReason: undefined };
    if (mode & 0o002) return { ...share, accessPath: file, guestWritable: true, guestWriteUnknown: false, guestWriteReason: undefined };
    let acl: GuestACL = 'unknown';
    try {
      acl = await this.metadata.read('access-list', file, () => this.ports.acl?.(file) ?? Promise.resolve('unavailable'));
    } catch {
      /* Unknown permissions must never reassure a guest share. */
    }
    return {
      ...share, accessPath: file, guestWritable: acl === 'write',
      guestWriteUnknown: acl !== 'write' && acl !== 'none',
      guestWriteReason: acl === 'unavailable' ? 'build' : acl === 'unreadable' ? 'access-list' : acl === 'unknown' ? 'permissions' : undefined,
    };
  }
  private async read(): Promise<NetworkSharingSnapshot> {
    try {
      const [listing, service, host, hardware, guest] = await Promise.all([
        this.ports.run('shares'),
        this.ports.run('service'),
        this.ports.run('host'),
        this.ports.run('interfaces'),
        this.ports.run('guest'),
      ]);
      const points = listing.ok ? parseSharePoints(listing.stdout) : undefined;
      if (!points) return (this.value = empty('unknown'));
      if (!points.length) {
        const directory = await this.ports.run('sharepoints');
        if (!directory.ok || directory.stdout.trim()) return (this.value = empty('unknown'));
      }
      const shares: NetworkShare[] = [];
      const folders = new Map<string, Promise<SharingFolder>>();
      for (const point of points) {
        try {
          const info = await this.folder(point.path);
          folders.set(point.path, Promise.resolve(info));
          folders.set(info.canonical, Promise.resolve(info));
          if (!info.directory) continue;
          shares.push(
            await this.access(info.canonical, info.mode, {
              ...point,
              path: info.canonical,
              identity: info.identity,
              guestWritable: false,
            }),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      const name = host.ok ? host.stdout.trim() : '';
      this.folders = folders;
      const interfaces =
        this.ports.network && hardware.ok
          ? physicalAddresses(hardware.stdout, this.ports.network())
          : undefined;
      return (this.value = {
        status: 'ready',
        shares,
        service: service.ok
          ? 'running'
          : /Could not find service/.test(service.stderr)
            ? 'off'
            : 'unknown',
        host: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name) ? name : '',
        ipv4: interfaces
          ? interfaces.filter((item) => item.family === 'IPv4').map((item) => item.address)
          : this.ports.addresses(),
        interfaces,
        guestAccess: guest.ok && guest.stdout.trim() === 'false' ? 'off' : guest.ok && guest.stdout.trim() === 'true' ? 'on' : 'unknown',
      });
    } catch {
      return (this.value = empty('unknown'));
    }
  }
  async inspect(paths: readonly string[], force = false): Promise<NetworkSharingSnapshot> {
    const previous = this.value;
    const snapshot = await this.refresh(force);
    if (snapshot.status !== 'ready') return snapshot;
    if (!snapshot.shares.length) return { ...snapshot, folders: paths.map((path) => ({ path, status: 'ready', shares: [] })) };
    const reads = snapshot !== previous ? new Map(this.folders) : new Map<string, Promise<SharingFolder>>();
    const folder = (file: string) => {
      let read = reads.get(file);
      if (!read) {
        read = this.folder(file).then((info) => {
          if (!reads.has(info.canonical)) reads.set(info.canonical, Promise.resolve(info));
          return info;
        });
        reads.set(file, read);
      }
      return read;
    };
    const folders: NetworkFolderSharing[] = [];
    for (const requested of paths) {
      try {
        const target = await folder(requested);
        let current = target;
        let ancestor = target.canonical;
        const relative: string[] = [];
        const shares: NetworkShare[] = [];
        for (;;) {
          for (const share of snapshot.shares)
            if (share.identity === current.identity) {
              const access = await this.access(target.canonical, target.mode, share);
              shares.push({
                ...access,
                inside: relative.length > 0,
                relative: [...relative].reverse().join('/'),
              });
            }
          const parent = path.dirname(ancestor);
          if (parent === ancestor) break;
          relative.push(path.basename(ancestor));
          ancestor = parent;
          current = await folder(parent);
        }
        if (!force && !shares.length && snapshot.shares.some((share) => containsPath(share.path, target.canonical)))
          return this.inspect(paths, true);
        folders.push({ path: requested, status: 'ready', shares });
      } catch {
        folders.push({ path: requested, status: 'unknown', shares: [] });
      }
    }
    return { ...snapshot, folders };
  }
}
export function sharingSettingsURLs(major: number): string[] {
  return major >= 13
    ? [
        'x-apple.systempreferences:com.apple.Sharing-Settings.extension?Services_PersonalFileSharing',
        'x-apple.systempreferences:com.apple.Sharing-Settings.extension',
      ]
    : [
        'x-apple.systempreferences:com.apple.preferences.sharing?Services_PersonalFileSharing',
        'x-apple.systempreferences:com.apple.preferences.sharing',
      ];
}
export async function openSharingSettings(
  major: number,
  open: (url: string) => Promise<void>,
): Promise<void> {
  const [specific, general] = sharingSettingsURLs(major);
  try {
    await open(specific!);
  } catch {
    await open(general!);
  }
}
