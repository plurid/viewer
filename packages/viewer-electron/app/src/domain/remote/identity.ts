import type { IdentityKind } from '../files/item-identity';
import type { Digest } from '../previews/digest';
import { parseRemoteLocation } from './location';

const base64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The existing Digest port returns hex, keeping hashing synchronous and free of Node imports. */
export function remoteIdentity(location: string, kind: IdentityKind, digest: Digest): string {
  if (!['file', 'directory', 'symlink', 'other'].includes(kind))
    throw new Error('Use a valid server item kind.');
  const { connectionID, path } = parseRemoteLocation(location);
  const hex = digest('sha256', new TextEncoder().encode(path));
  if (hex.length !== 64 || !/^[a-f0-9]{64}$/.test(hex))
    throw new Error('The SHA-256 digest must be lowercase hexadecimal.');
  let encoded = '';
  let bits = 0;
  let value = 0;
  for (let index = 0; index < hex.length && encoded.length < 22; index += 2) {
    value = (value << 8) | Number.parseInt(hex.slice(index, index + 2), 16);
    bits += 8;
    while (bits >= 6 && encoded.length < 22) {
      bits -= 6;
      encoded += base64url[(value >>> bits) & 63];
    }
  }
  return 'sftp.' + connectionID + ':' + kind + ':' + encoded;
}

export interface RemoteTimestamps {
  created: 0;
  modified: number;
}

export function remoteTimestamps(mtimeSeconds: number): RemoteTimestamps {
  if (!Number.isInteger(mtimeSeconds) || mtimeSeconds < 0 || mtimeSeconds > 0xffffffff)
    throw new Error('Use an unsigned SFTP v3 modification time in seconds.');
  return { created: 0, modified: mtimeSeconds * 1000 };
}
