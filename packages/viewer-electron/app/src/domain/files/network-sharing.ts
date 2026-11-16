export type SharingServiceState = 'running' | 'off' | 'unknown';
export type NetworkSharingStatus = 'ready' | 'unknown' | 'unavailable';
export type NetworkFolderStatus = 'ready' | 'unknown';
export type NetworkAddressFamily = 'IPv4' | 'IPv6';
export type GuestWriteReason = 'build' | 'access-list' | 'permissions';
export type GlobalGuestAccess = 'on' | 'off' | 'unknown';
export type NetworkConnectionState = 'connected' | 'offline' | 'unknown';
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
  guestWriteReason?: GuestWriteReason;
  accessPath?: string;
  identity?: string;
  inside?: boolean;
  relative?: string;
}

export type NetworkInterfaceKind = 'Wi-Fi' | 'Ethernet';
export interface SharingInterface {
  name: string;
  kind: NetworkInterfaceKind;
  address: string;
  family: NetworkAddressFamily;
}

export interface NetworkFolderSharing {
  path: string;
  status: NetworkFolderStatus;
  shares: NetworkShare[];
}

export interface SharingAddress {
  system: 'Windows' | 'Mac';
  address: string;
  label?: string;
}

export interface NetworkSharingSnapshot {
  status: NetworkSharingStatus;
  shares: NetworkShare[];
  service: SharingServiceState;
  host: string;
  ipv4: string[];
  interfaces?: SharingInterface[];
  folders?: NetworkFolderSharing[];
  guestAccess?: GlobalGuestAccess;
  network?: NetworkConnectionState;
}

export type NetworkSharingRequest =
  { kind: 'refresh'; paths?: string[]; force?: boolean } | { kind: 'settings'; path: string };

export function guestWarning(
  share: NetworkShare,
  service: SharingServiceState = 'running',
  guestAccess: GlobalGuestAccess = 'unknown',
): string | undefined {
  if (!share.guests || guestAccess === 'off') return undefined;
  const warning =
    service === 'off'
      ? 'File Sharing is off, so nobody can connect now. If it is turned on, anyone on the same network will be able to open this folder without a password.'
      : service === 'unknown'
        ? 'If File Sharing is running, anyone on the same network can open this folder without a password.'
        : 'Anyone on the same network can open this folder without a password.';
  const reason =
    share.guestWriteReason === 'build'
      ? "Viewer could not check this folder's access list with this build."
      : share.guestWriteReason === 'access-list'
        ? "Viewer could not read this folder's access list."
        : 'Viewer could not fully determine guest permissions for this folder.';
  return share.guestWritable
    ? warning +
        (service === 'off'
          ? ' Guests will also be able to modify this folder or its contents.'
          : service === 'unknown'
            ? ' If File Sharing is running, guests can also modify this folder or its contents.'
            : ' Guests can also modify this folder or its contents.')
    : share.guestWriteUnknown
      ? warning +
        (service === 'off'
          ? ' If File Sharing is turned on, guests may also be able to modify this folder or its contents. '
          : service === 'unknown'
            ? ' If File Sharing is running, guests may also be able to modify this folder or its contents. '
            : ' Guests may also be able to modify this folder or its contents. ') +
        reason
      : warning;
}

function sharingSegments(share: NetworkShare): string[] {
  return [share.name, ...(share.relative ? share.relative.split('/') : [])];
}
export function windowsSharingAddressProblem(share: NetworkShare): string | undefined {
  if (sharingSegments(share).some((segment) => /[. ]$/.test(segment)))
    return 'Windows addresses are unavailable because a folder or share name ends with a dot or space.';
  if (sharingSegments(share).some((segment) => /[\\/\u0000-\u001f\u007f:*?"<>|]/.test(segment)))
    return 'Windows addresses are unavailable because a folder or share name contains a character Windows cannot use.';
}

export function sharingAddresses(
  share: NetworkShare,
  host: string,
  ipv4: readonly string[],
  interfaces?: readonly SharingInterface[],
): SharingAddress[] {
  const addresses: SharingAddress[] = [];
  // Explorer's address bar takes literal UNC names, including spaces. A URL needs a path segment.
  const uncName = !windowsSharingAddressProblem(share);
  const segments = sharingSegments(share);
  const uncPath = segments.join('\\');
  if (uncName)
    for (const address of ipv4)
      addresses.push({
        system: 'Windows',
        address: `\\\\${address}\\${uncPath}`,
        label: interfaces?.find((item) => item.address === address)?.kind ?? 'Local network',
      });
  if (host && uncName) {
    addresses.push({
      system: 'Windows',
      address: `\\\\${host}.local\\${uncPath}`,
      label: 'Local host name',
    });
    if (host.length <= 15)
      addresses.push({
        system: 'Windows',
        address: `\\\\${host}\\${uncPath}`,
        label: 'Short host name',
      });
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
