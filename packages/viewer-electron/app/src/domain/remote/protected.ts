import { remotePath, remoteUTF8Bytes, validRemoteUnicode } from './location';
import { remoteLimits } from './limits';

export const remoteSystemRoots = Object.freeze([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/home',
  '/opt',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/srv',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
  '/Users',
  '/Library',
  '/System',
  '/Applications',
  '/Volumes',
  '/private',
]);

function normalizedAbsolutePath(path: string): string {
  if (
    !path.startsWith('/') ||
    path.includes('\0') ||
    !validRemoteUnicode(path) ||
    remoteUTF8Bytes(path) > remoteLimits.serverPathBytes
  )
    throw new Error('A protected server path must be an absolute UTF-8 path.');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return remotePath.parse('/' + parts.join('/'));
}

/** Callers must pass SFTP REALPATH results. This guard cannot resolve server symlinks. */
export function isProtectedRemotePath(
  resolvedPath: string,
  home: string,
  trashRoots?: readonly string[],
): boolean {
  const path = normalizedAbsolutePath(resolvedPath);
  const normalizedHome = normalizedAbsolutePath(home);
  const roots = [
    normalizedHome + '/.local/share/Trash',
    normalizedHome + '/.viewer-trash',
    ...(trashRoots ?? []),
  ];
  const trash = roots.map(normalizedAbsolutePath);
  return (
    path === normalizedHome ||
    remoteSystemRoots.includes(path) ||
    /^\/lib[^/]*$/.test(path) ||
    trash.some((root) => path === root || path.startsWith(root === '/' ? '/' : root + '/'))
  );
}
