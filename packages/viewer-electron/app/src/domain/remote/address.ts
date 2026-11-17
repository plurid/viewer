import { parseRemoteEndpoint, remoteConnectionName } from './connections';
import type { RemoteEndpoint } from './connections';
import { hasRemoteLocationScheme, remotePath, validRemoteUnicode } from './location';

export interface SFTPAddress extends RemoteEndpoint {
  kind: 'sftp';
  path?: string;
}

export interface ShareAddress {
  kind: 'share';
  url: string;
}

export interface WebDAVAddress {
  kind: 'webdav';
  url: string;
  insecure: boolean;
}

export interface SavedConnectionAddress {
  kind: 'saved';
  name: string;
}

export type RemoteAddress = SFTPAddress | ShareAddress | WebDAVAddress | SavedConnectionAddress;

function networkAddress(input: string, webdav: boolean): ShareAddress | WebDAVAddress {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+/.test(input))
    throw new Error('Enter a complete server address.');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a complete server address.');
  }
  if (!url.host || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)))
    throw new Error('Enter a server host and a port from 1 to 65535.');
  return webdav
    ? { kind: 'webdav', url: url.href, insecure: url.protocol === 'http:' }
    : { kind: 'share', url: url.href };
}

/** Typed URLs decode escapes once. The scp-style form keeps the server path literal. */
export function parseRemoteAddress(
  input: string,
  savedNames: readonly string[] = [],
): RemoteAddress {
  const address = input.trim();
  if (!address || !validRemoteUnicode(input) || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(input))
    throw new Error('Enter a server address or a saved connection name.');
  if (hasRemoteLocationScheme(address))
    throw new Error('Viewer server locations are internal. Enter an SSH or SFTP server address.');
  if (savedNames.includes(address))
    return { kind: 'saved', name: remoteConnectionName.parse(address) };

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(address)?.[1]?.toLowerCase();
  if (scheme && ['smb', 'afp', 'nfs', 'ftp', 'cifs'].includes(scheme))
    return networkAddress(address, false);
  if (scheme && ['http', 'https', 'webdav', 'davs'].includes(scheme)) {
    const protocol = scheme === 'webdav' ? 'http' : scheme === 'davs' ? 'https' : scheme;
    return networkAddress(protocol + address.slice(address.indexOf(':')), true);
  }
  if (scheme === 'ssh' || scheme === 'sftp') {
    const url = /^(?:ssh|sftp):\/\/([^/?#]+)([^?#]*)$/i.exec(address);
    if (!url) throw new Error('Use ssh://[user@]host[:port][/path].');
    const endpoint = parseRemoteEndpoint(url[1]!);
    if (!url[2]) return { kind: 'sftp', ...endpoint };
    let path: string;
    try {
      path = decodeURIComponent(url[2]);
    } catch {
      throw new Error('Use valid UTF-8 URL escapes in the server path.');
    }
    return { kind: 'sftp', ...endpoint, path: remotePath.parse(path) };
  }

  const scp = /^((?:[^@:/]+@)?(?:\[[^\]]+\]|[^:]+)):(\/.*)$/.exec(address);
  if (scp) return { kind: 'sftp', ...parseRemoteEndpoint(scp[1]!), path: remotePath.parse(scp[2]) };
  if (address.includes('@')) return { kind: 'sftp', ...parseRemoteEndpoint(address) };
  if (scheme || address.includes(':') || address.includes('/'))
    throw new Error('Use an SSH, SFTP, share or WebDAV address.');
  // Punctuation in a saved label is accepted through an exact known-name match above.
  if (!/^(?!-)[\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)*$(?![\s\S])/u.test(address))
    throw new Error('Choose an existing saved connection or enter a complete server address.');
  return { kind: 'saved', name: remoteConnectionName.parse(address) };
}
