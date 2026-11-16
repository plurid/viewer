export type SharingServiceState = 'running' | 'off' | 'unknown';
export function modelCommandLabel(command: { id: string; label: string }): string {
  return command.id === 'network-sharing' ? 'Network sharing' : command.label;
}

export interface NetworkShare {
  path: string;
  name: string;
  guests: boolean;
  readOnly: boolean;
  guestWritable: boolean;
  guestWriteUnknown?: boolean;
  identity?: string;
  inside?: boolean;
  relative?: string;
}

export type NetworkInterfaceKind = 'Wi-Fi' | 'Ethernet';
export interface SharingInterface {
  name: string;
  kind: NetworkInterfaceKind;
  address: string;
  family: 'IPv4' | 'IPv6';
}

export interface NetworkFolderSharing {
  path: string;
  status: 'ready' | 'unknown';
  shares: NetworkShare[];
}

export interface SharingAddress {
  system: 'Windows' | 'Mac';
  address: string;
  label?: string;
}

export interface NetworkSharingSnapshot {
  status: 'ready' | 'unknown' | 'unavailable';
  shares: NetworkShare[];
  service: SharingServiceState;
  host: string;
  ipv4: string[];
  interfaces?: SharingInterface[];
  folders?: NetworkFolderSharing[];
}

export type NetworkSharingRequest =
  | { kind: 'refresh'; paths?: string[]; force?: boolean }
  | { kind: 'settings'; path: string };

export function guestWarning(share: NetworkShare): string | undefined {
  if (!share.guests) return undefined;
  const warning = 'Anyone on the same network can open this folder without a password.';
  return share.guestWritable
    ? warning + ' They can also add, change and delete files in this folder.'
    : share.guestWriteUnknown
      ? warning + ' Guests may also be able to add, change and delete files in this folder because its permissions could not be read.'
    : warning;
}

export function sharingAddresses(
  share: NetworkShare,
  host: string,
  ipv4: readonly string[],
  interfaces?: readonly SharingInterface[],
): SharingAddress[] {
  if (!ipv4.length && !interfaces?.length) return [];
  const addresses: SharingAddress[] = [];
  // Explorer's address bar takes literal UNC names, including spaces. A URL needs a path segment.
  const uncName = !/[\\/\u0000-\u001f]/.test(share.name);
  const segments = [share.name, ...(share.relative?.split('/') ?? [])];
  const uncPath = segments.join('\\');
  if (uncName)
    for (const address of ipv4)
      addresses.push({ system: 'Windows', address: `\\\\${address}\\${uncPath}`, label: interfaces?.find((item) => item.address === address)?.kind ?? 'Local network' });
  if (host && uncName) {
    addresses.push({ system: 'Windows', address: `\\\\${host}.local\\${uncPath}`, label: 'Local host name' });
    if (host.length <= 15) addresses.push({ system: 'Windows', address: `\\\\${host}\\${uncPath}`, label: 'Short host name' });
  }
  if (host)
    addresses.push({
      system: 'Mac',
      address: `smb://${host}.local/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`,
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
