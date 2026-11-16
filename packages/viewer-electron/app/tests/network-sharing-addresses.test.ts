import { expect, it } from 'vitest';
import type { NetworkShare } from '../src/domain/files/network-sharing';
import { guestWarning, sharingAddresses, windowsSharingAddressProblem } from '../src/domain/files/network-sharing';

const share: NetworkShare = { path: '/Shared/Top', name: 'Top', relative: '', guests: true, readOnly: false, guestWritable: false };
it('never appends a separator to share-root addresses', () => {
  expect(sharingAddresses(share, 'Studio-Mac', ['192.168.1.12']).map((item) => item.address)).toEqual([
    '\\\\192.168.1.12\\Top', '\\\\Studio-Mac.local\\Top', '\\\\Studio-Mac\\Top', 'smb://Studio-Mac.local/Top',
  ]);
});
it('offers local host names even when physical interface discovery fails', () => {
  expect(sharingAddresses(share, 'A-long-host-name-over-15', []).map((item) => item.address)).toEqual([
    '\\\\A-long-host-name-over-15.local\\Top', 'smb://A-long-host-name-over-15.local/Top',
  ]);
});
it.each(['a\\b', 'a\nb', 'a\x7fb'])('explains why a nested name cannot form a Windows address', (relative) => {
  const nested = { ...share, relative };
  const addresses = sharingAddresses(nested, 'Studio-Mac', ['192.168.1.12']);
  expect(addresses.every((item) => item.system === 'Mac')).toBe(true);
  expect(addresses[0]?.address).toBe('smb://Studio-Mac.local/Top/' + encodeURIComponent(relative));
  expect(windowsSharingAddressProblem(nested)).toContain('character Windows cannot use');
});
it('describes future guest access while the service is off, and respects the global switch', () => {
  expect(guestWarning(share, 'off')).toBe('File Sharing is off, so nobody can connect now. If it is turned on, anyone on the same network will be able to open this folder without a password.');
  expect(guestWarning({ ...share, guestWritable: true }, 'off')).toContain('Guests will also be able to modify');
  expect(guestWarning(share, 'running')).toBe('Anyone on the same network can open this folder without a password.');
  expect(guestWarning(share, 'running', 'off')).toBeUndefined();
  expect(guestWarning({ ...share, guestWriteUnknown: true, guestWriteReason: 'build' })).toContain('could not check this folder\'s access list with this build');
  expect(guestWarning({ ...share, guestWriteUnknown: true, guestWriteReason: 'permissions' })).not.toContain('could not be read');
});
