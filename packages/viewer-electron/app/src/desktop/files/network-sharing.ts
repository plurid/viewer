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
import type { SharePoint } from './sharing-parser';
import { containsPath } from './containment';
import { SharingMetadata } from './sharing-metadata';
import { SharingVolumes, sharingVolume } from './sharing-volumes';
import type { SharingVolumeSnapshot } from './sharing-volumes';

export const networkSharingAvailable = process.platform === 'darwin' && !process.mas;
type SharingRead =
  'shares' | 'sharepoints' | 'service' | 'host' | 'interfaces' | 'guest' | 'mounts';
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
  mounts: { file: '/sbin/mount', args: [] },
  guest: {
    file: '/usr/bin/plutil',
    args: [
      '-extract',
      'AllowGuestAccess',
      'raw',
      '-expect',
      'bool',
      '-o',
      '-',
      '/Library/Preferences/SystemConfiguration/com.apple.smb.server.plist',
    ],
  },
};
export const runSharingRead: SharingRunner = (read) =>
  new Promise((resolve) => {
    const { file, args } = reads[read];
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (output: SharingOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };
    try {
      const child = execFile(
        file,
        args,
        { timeout: 2000, maxBuffer: 1024 * 1024, encoding: 'utf8', shell: false },
        (error, stdout, stderr) => finish({ stdout, stderr, ok: !error }),
      );
      // execFile's timeout only sends SIGTERM. An unresponsive tool cannot keep a refresh open.
      if (!settled)
        timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* The process may have exited meanwhile. */
          }
          finish({ stdout: '', stderr: '', ok: false });
        }, 2250);
    } catch {
      finish({ stdout: '', stderr: '', ok: false });
    }
  });
const systemSharingVolumes = new SharingVolumes(runSharingRead);
export const watchSharingVolumes = (changed: () => void): (() => void) =>
  systemSharingVolumes.watch(changed);

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
type CanonicalFolder = (canonical: string) => void;
export async function sharingFolder(
  file: string,
  resolved?: CanonicalFolder,
): Promise<SharingFolder> {
  const canonical = await realpath(file);
  resolved?.(canonical);
  try {
    const info = await stat(canonical);
    return {
      directory: info.isDirectory(),
      mode: info.mode,
      identity: itemIdentity(info),
      canonical,
    };
  } catch (error) {
    throw Object.assign(error as Error, { canonical });
  }
}
function comparableSharingPath(file: string): string {
  // These system aliases can still be recognized when a volume or privacy grant is unavailable.
  return path
    .resolve(file)
    .replace(/^\/System\/Volumes\/Data(?=\/)/, '')
    .replace(/^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/, '')
    .normalize('NFD')
    .toLowerCase();
}
interface SharingPorts {
  available: boolean;
  run: SharingRunner;
  folder: (file: string, resolved?: CanonicalFolder) => Promise<SharingFolder>;
  addresses: () => string[];
  acl?: (file: string) => Promise<GuestACL>;
  network?: () => ReturnType<typeof os.networkInterfaces>;
  now?: () => number;
  timeoutMs?: number;
  volumes?: (force?: boolean) => Promise<SharingVolumeSnapshot>;
}
const empty = (status: NetworkSharingSnapshot['status']): NetworkSharingSnapshot => ({
  status,
  shares: [],
  service: 'unknown',
  host: '',
  ipv4: [],
  interfaces: [],
});
interface MissingShare {
  point: SharePoint;
  checked: number;
}
export class NetworkSharing {
  private value = empty('unknown');
  private pending?: Promise<NetworkSharingSnapshot>;
  private refreshed = -Infinity;
  private queuedForce?: Promise<NetworkSharingSnapshot>;
  private metadata: SharingMetadata;
  private folders = new WeakMap<NetworkSharingSnapshot, Map<string, Promise<SharingFolder>>>();
  private unchecked = new WeakMap<NetworkSharingSnapshot, string[]>();
  private missing = new WeakMap<NetworkSharingSnapshot, MissingShare[]>();
  private canonical = new Map<string, string>();
  constructor(
    private readonly ports: SharingPorts = {
      available: networkSharingAvailable,
      run: runSharingRead,
      folder: sharingFolder,
      addresses: () => [],
      network: () => os.networkInterfaces(),
      volumes: (force) => systemSharingVolumes.read(force),
      acl: async (file) => {
        try {
          const read = macFiles().guestACL;
          if (!read) return 'unavailable';
          try {
            return await read(file);
          } catch {
            return 'unreadable';
          }
        } catch {
          return 'unavailable';
        }
      },
    },
  ) {
    this.metadata = new SharingMetadata(ports.timeoutMs ?? 700);
  }
  snapshot(): NetworkSharingSnapshot {
    return this.value;
  }
  refresh(force = false): Promise<NetworkSharingSnapshot> {
    if (!this.ports.available) return Promise.resolve((this.value = empty('unavailable')));
    if (this.pending) {
      if (!force) return this.pending;
      if (!this.queuedForce)
        this.queuedForce = this.pending.then(() => {
          this.queuedForce = undefined;
          return this.refresh(true);
        });
      return this.queuedForce;
    }
    const now = (this.ports.now ?? Date.now)();
    if (!force && now - this.refreshed < 5000) {
      if (!this.missing.get(this.value)?.some((share) => now - share.checked >= 1000))
        return Promise.resolve(this.value);
      return (this.pending = this.retryMissing(this.value, now).finally(() => {
        this.pending = undefined;
      }));
    }
    this.refreshed = now;
    return (this.pending = this.read().finally(() => {
      this.pending = undefined;
    }));
  }
  private folder(file: string): Promise<SharingFolder> {
    const key = path.resolve(file);
    return this.metadata
      .read('folder', file, async () => {
        this.canonical.delete(key);
        try {
          return await this.ports.folder(file, (canonical) => this.canonical.set(key, canonical));
        } catch (error) {
          const failure = error as NodeJS.ErrnoException & { canonical?: string };
          if (!failure.canonical) failure.canonical = this.canonical.get(key);
          throw failure;
        } finally {
          this.canonical.delete(key);
        }
      })
      .catch((error: NodeJS.ErrnoException & { canonical?: string }) => {
        if (!error.canonical && this.canonical.has(key)) error.canonical = this.canonical.get(key);
        throw error;
      });
  }
  private async access(file: string, mode: number, share: NetworkShare): Promise<NetworkShare> {
    if (!share.guests || share.readOnly)
      return {
        ...share,
        accessPath: file,
        guestWritable: false,
        guestWriteUnknown: false,
        guestWriteReason: undefined,
      };
    let acl: GuestACL = 'unknown';
    try {
      acl = await this.metadata.read(
        'access-list',
        file,
        () => this.ports.acl?.(file) ?? Promise.resolve('unavailable'),
      );
    } catch {
      /* Unknown permissions must never reassure a guest share. */
    }
    const writable = acl === 'write' || (acl === 'unavailable' && (mode & 0o002) !== 0);
    return {
      ...share,
      accessPath: file,
      guestWritable: writable,
      guestWriteUnknown: !writable && acl !== 'none',
      guestWriteReason:
        writable || acl === 'none'
          ? undefined
          : acl === 'unavailable'
            ? 'build'
            : acl === 'unreadable'
              ? 'access-list'
              : acl === 'unknown'
                ? 'permissions'
                : undefined,
    };
  }
  private async retryMissing(
    snapshot: NetworkSharingSnapshot,
    now: number,
  ): Promise<NetworkSharingSnapshot> {
    const missing: MissingShare[] = [];
    const shares = [...snapshot.shares];
    const unchecked = [...(this.unchecked.get(snapshot) ?? [])];
    const folders = new Map<string, Promise<SharingFolder>>();
    for (const entry of this.missing.get(snapshot) ?? []) {
      if (now - entry.checked < 1000) {
        missing.push(entry);
        continue;
      }
      try {
        const info = await this.folder(entry.point.path);
        if (!info.directory) continue;
        shares.push(
          await this.access(info.canonical, info.mode, {
            ...entry.point,
            path: info.canonical,
            identity: info.identity,
            guestWritable: false,
          }),
        );
        folders.set(entry.point.path, Promise.resolve(info));
        folders.set(info.canonical, Promise.resolve(info));
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { canonical?: string };
        if (failure.code === 'ENOENT') missing.push({ point: entry.point, checked: now });
        else if (failure.canonical) unchecked.push(failure.canonical);
        else return (this.value = empty('unknown'));
      }
    }
    const value = { ...snapshot, shares };
    this.missing.set(value, missing);
    this.unchecked.set(value, unchecked);
    this.folders.set(value, folders);
    return (this.value = value);
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
      if (
        !points.length &&
        (listing.stdout.trim() === 'No share point records.' ||
          Object.keys(JSON.parse(listing.stdout)).length === 0)
      ) {
        const directory = await this.ports.run('sharepoints');
        if (!directory.ok || directory.stdout.trim()) return (this.value = empty('unknown'));
      }
      const shares: NetworkShare[] = [];
      const volumes = await this.ports.volumes?.();
      const folders = new Map<string, Promise<SharingFolder>>();
      const unchecked: string[] = [];
      const missing: MissingShare[] = [];
      for (const point of points) {
        if (volumes && sharingVolume(point.path, volumes) === 'network') continue;
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
          const failure = error as NodeJS.ErrnoException & { canonical?: string };
          if (failure.code === 'ENOENT')
            missing.push({ point, checked: (this.ports.now ?? Date.now)() });
          else if (failure.canonical) unchecked.push(failure.canonical);
          else throw error;
        }
      }
      const name = host.ok ? host.stdout.trim() : '';
      const network = this.ports.network?.();
      const interfaces =
        network && hardware.ok ? physicalAddresses(hardware.stdout, network) : undefined;
      const snapshot: NetworkSharingSnapshot = {
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
        network: interfaces ? (interfaces.length ? 'connected' : 'offline') : 'unknown',
        guestAccess:
          guest.ok && guest.stdout.trim() === 'false'
            ? 'off'
            : guest.ok && guest.stdout.trim() === 'true'
              ? 'on'
              : 'unknown',
      };
      this.folders.set(snapshot, folders);
      this.unchecked.set(snapshot, unchecked);
      this.missing.set(snapshot, missing);
      return (this.value = snapshot);
    } catch {
      return (this.value = empty('unknown'));
    }
  }
  async inspect(
    paths: readonly string[],
    force = false,
    rechecked = false,
  ): Promise<NetworkSharingSnapshot> {
    if (!this.ports.available) return this.refresh(force);
    const volumes = await this.ports.volumes?.(force);
    const previous = this.value;
    const snapshot = await this.refresh(force);
    if (snapshot.status !== 'ready') return snapshot;
    const unchecked = this.unchecked.get(snapshot) ?? [];
    const uncertain = (file: string) =>
      unchecked.some((share) =>
        containsPath(comparableSharingPath(share), comparableSharingPath(file)),
      );
    if (!snapshot.shares.length && !unchecked.length)
      return { ...snapshot, folders: paths.map((path) => ({ path, status: 'ready', shares: [] })) };
    const reads =
      snapshot !== previous
        ? new Map(this.folders.get(snapshot))
        : new Map<string, Promise<SharingFolder>>();
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
      const volume = volumes ? sharingVolume(requested, volumes) : 'local';
      if (volume !== 'local') {
        folders.push({
          path: requested,
          status: volume === 'network' ? 'ready' : 'unknown',
          shares: [],
        });
        continue;
      }
      try {
        const target = await folder(requested);
        const targetVolume = volumes ? sharingVolume(target.canonical, volumes) : 'local';
        if (targetVolume !== 'local') {
          folders.push({
            path: requested,
            status: targetVolume === 'network' ? 'ready' : 'unknown',
            shares: [],
          });
          continue;
        }
        if (!target.directory) throw new Error('Choose one folder.');
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
          const parentVolume = volumes ? sharingVolume(parent, volumes) : 'local';
          if (parentVolume === 'network') break;
          if (parentVolume === 'unknown') throw new Error('Could not check sharing volume.');
          relative.push(path.basename(ancestor));
          ancestor = parent;
          current = await folder(parent);
        }
        if (
          !shares.length &&
          snapshot.shares.some((share) => containsPath(share.path, target.canonical))
        ) {
          if (!rechecked) return this.inspect(paths, true, true);
          folders.push({ path: requested, status: 'unknown', shares: [] });
          continue;
        }
        folders.push({
          path: requested,
          status: uncertain(requested) || uncertain(target.canonical) ? 'unknown' : 'ready',
          shares,
        });
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
