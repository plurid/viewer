export type SharingServiceState = 'running' | 'off' | 'unknown';

export interface NetworkShare {
  path: string;
  name: string;
  guests: boolean;
  readOnly: boolean;
  guestWritable: boolean;
}

export interface SharingAddress {
  system: 'Windows' | 'Mac';
  address: string;
}

export interface NetworkSharingSnapshot {
  status: 'ready' | 'unknown' | 'unavailable';
  shares: NetworkShare[];
  service: SharingServiceState;
  host: string;
  ipv4: string[];
}

export type NetworkSharingRequest =
  | { kind: 'refresh' }
  | { kind: 'settings'; path: string };

export function guestWarning(share: NetworkShare): string | undefined {
  if (!share.guests) return undefined;
  const warning = 'Anyone on the same network can open this folder without a password.';
  return share.guestWritable
    ? warning + ' They can also add, change and delete files in this folder.'
    : warning;
}

export function sharingAddresses(
  share: NetworkShare,
  host: string,
  ipv4: readonly string[],
): SharingAddress[] {
  if (!ipv4.length) return [];
  const addresses: SharingAddress[] = [];
  // Explorer's address bar takes literal UNC names, including spaces. A URL needs a path segment.
  const uncName = !/[\\/\u0000-\u001f]/.test(share.name);
  if (host && uncName) addresses.push({ system: 'Windows', address: `\\\\${host}\\${share.name}` });
  if (uncName)
    for (const address of ipv4)
      addresses.push({ system: 'Windows', address: `\\\\${address}\\${share.name}` });
  if (host)
    addresses.push({
      system: 'Mac',
      address: `smb://${host}.local/${encodeURIComponent(share.name)}`,
    });
  return addresses;
}

export function sharingServiceText(service: SharingServiceState): string {
  return service === 'running'
    ? 'File Sharing is on.'
    : service === 'off'
      ? 'File Sharing is off. Nobody can connect to this share.'
      : 'File Sharing service status is unknown.';
}
