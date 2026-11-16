import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { NetworkSharingSnapshot, SharingServiceState } from '../../domain/files/network-sharing';
import { stat } from './stats';
import { parseSharePoints } from './sharing-parser';

export const networkSharingAvailable = process.platform === 'darwin' && !process.mas;
type SharingRead = 'shares' | 'service' | 'host';
export interface SharingOutput {
  stdout: string;
  stderr: string;
  ok: boolean;
}
export type SharingRunner = (read: SharingRead) => Promise<SharingOutput>;
const reads: Record<SharingRead, { file: string; args: string[] }> = {
  shares: { file: '/usr/sbin/sharing', args: ['-l'] },
  service: { file: '/bin/launchctl', args: ['print', 'system/com.apple.smbd'] },
  host: { file: '/usr/sbin/scutil', args: ['--get', 'LocalHostName'] },
};

export const runSharingRead: SharingRunner = (read) =>
  new Promise((resolve) => {
    const { file, args } = reads[read];
    execFile(file, args, { timeout: 2000, maxBuffer: 1024 * 1024, encoding: 'utf8', shell: false },
      (error, stdout, stderr) => resolve({ stdout, stderr, ok: !error }));
  });

export function localIPv4(interfaces: ReturnType<typeof os.networkInterfaces>): string[] {
  return [...new Set(Object.values(interfaces).flatMap((addresses) =>
    (addresses ?? []).filter((item) => item.family === 'IPv4' && !item.internal &&
      !/^(?:0|127|169\.254)\./.test(item.address)).map((item) => item.address)))].sort();
}

interface SharingPorts {
  available: boolean;
  run: SharingRunner;
  folder: (file: string) => Promise<{ directory: boolean; mode: number }>;
  addresses: () => string[];
}
const empty = (status: NetworkSharingSnapshot['status']): NetworkSharingSnapshot => ({
  status, shares: [], service: 'unknown', host: '', ipv4: [],
});

/** Listings only read this cache. Explicit view openings and focus changes refresh it. */
export class NetworkSharing {
  private value = empty('unknown');
  private pending?: Promise<NetworkSharingSnapshot>;
  constructor(private readonly ports: SharingPorts = {
    available: networkSharingAvailable,
    run: runSharingRead,
    folder: async (file) => {
      const info = await stat(file);
      return { directory: info.isDirectory(), mode: info.mode };
    },
    addresses: () => localIPv4(os.networkInterfaces()),
  }) {}

  snapshot(): NetworkSharingSnapshot {
    return this.value;
  }

  refresh(): Promise<NetworkSharingSnapshot> {
    if (!this.ports.available) return Promise.resolve(this.value = empty('unavailable'));
    return this.pending ??= this.read().finally(() => { this.pending = undefined; });
  }

  private async read(): Promise<NetworkSharingSnapshot> {
    try {
      const [listing, service, host] = await Promise.all([
        this.ports.run('shares'), this.ports.run('service'), this.ports.run('host'),
      ]);
      const points = listing.ok ? parseSharePoints(listing.stdout) : undefined;
      if (!points) return this.value = empty('unknown');
      const shares = await Promise.all(points.map(async (point) => {
        try {
          const file = path.normalize(point.path);
          const info = await this.ports.folder(file);
          if (info.directory) return {
            ...point, path: file, guestWritable: point.guests && !point.readOnly && !!(info.mode & 0o002),
          };
        } catch { /* A stale share point is not a folder the person can share. */ }
        return undefined;
      }));
      // A loaded on-demand job can accept SMB connections even while its process is idle.
      const state: SharingServiceState = service.ok ? 'running'
        : /Could not find service/.test(service.stderr) ? 'off' : 'unknown';
      const name = host.ok ? host.stdout.trim() : '';
      return this.value = {
        status: 'ready', shares: shares.filter((share) => share !== undefined), service: state,
        host: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name) ? name : '',
        ipv4: this.ports.addresses(),
      };
    } catch {
      return this.value = empty('unknown');
    }
  }
}

export function sharingSettingsURLs(major: number): string[] {
  return major >= 13
    ? ['x-apple.systempreferences:com.apple.Sharing-Settings.extension?Services_PersonalFileSharing',
      'x-apple.systempreferences:com.apple.Sharing-Settings.extension']
    : ['x-apple.systempreferences:com.apple.preferences.sharing?Services_PersonalFileSharing',
      'x-apple.systempreferences:com.apple.preferences.sharing'];
}

export async function openSharingSettings(major: number, open: (url: string) => Promise<void>): Promise<void> {
  const [specific, general] = sharingSettingsURLs(major);
  try { await open(specific!); } catch { await open(general!); }
}
