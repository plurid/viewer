import {
  hasRemoteLocationScheme,
  parseRemoteLocation,
  remoteAncestry,
  remoteContains,
} from '../remote/location';

/**
 * Whether `file` is `root` or inside it, for absolute paths the desktop has already resolved.
 * Pure string work, on either separator, for the renderer and the domain; the desktop uses
 * `containsPath` (desktop/files/containment.ts), which also resolves `..`.
 */
export function pathContains(root: string, file: string): boolean {
  if (hasRemoteLocationScheme(root) || hasRemoteLocationScheme(file))
    return remoteContains(root, file);
  if (file === root) return true;
  // Backslashes are ordinary filename characters on POSIX paths.
  if (root.startsWith('/') && !root.startsWith('//')) {
    const base = root.replace(/\/+$/, '');
    return file.startsWith(base + '/');
  }
  const base = root.replace(/[\\/]+$/, '');
  return file.startsWith(base + '/') || file.startsWith(base + '\\');
}

/** Root through the current folder, retaining drive and network-share roots. */
export function pathAncestry(path: string): string[] {
  if (hasRemoteLocationScheme(path)) return remoteAncestry(path);
  const prefix = path.match(/^([A-Za-z]:[\\/]|(?:\/\/|\\\\)[^\\/]+[\\/][^\\/]+|[\\/])/);
  if (!prefix) return [path];
  const root = prefix[0];
  const posix = root === '/';
  const separator = posix ? '/' : path.includes('\\') ? '\\' : '/';
  const trail = [root];
  for (const part of path
    .slice(root.length)
    .split(posix ? '/' : /[\\/]/)
    .filter(Boolean)) {
    const parent = trail.at(-1)!;
    trail.push(parent + (parent.endsWith(separator) ? '' : separator) + part);
  }
  return trail;
}

/** Display only: navigation must retain the resolved absolute path. */
export function relativePathLabel(folder: string, file: string): string {
  if (hasRemoteLocationScheme(folder) || hasRemoteLocationScheme(file)) {
    const base = hasRemoteLocationScheme(folder) ? parseRemoteLocation(folder) : undefined;
    const target = hasRemoteLocationScheme(file) ? parseRemoteLocation(file) : undefined;
    if (!base || !target || base.connectionID !== target.connectionID) return file;
    const baseParts = base.path.split('/').filter(Boolean);
    const targetParts = target.path.split('/').filter(Boolean);
    let common = 0;
    while (common < baseParts.length && baseParts[common] === targetParts[common]) common++;
    return (
      [...Array<string>(baseParts.length - common).fill('..'), ...targetParts.slice(common)].join(
        '/',
      ) || '.'
    );
  }
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(folder);
  const split = (value: string) => {
    const normalized = windows ? value.replace(/\\/g, '/') : value;
    const root = windows
      ? normalized.match(/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+)(?=\/|$)/)?.[0]
      : normalized.startsWith('/')
        ? '/'
        : undefined;
    return root
      ? { root, parts: normalized.slice(root.length).split('/').filter(Boolean) }
      : undefined;
  };
  const base = split(folder),
    target = split(file);
  const equal = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!base || !target || !equal(base.root, target.root)) return file;
  let common = 0;
  while (
    common < base.parts.length &&
    common < target.parts.length &&
    equal(base.parts[common]!, target.parts[common]!)
  )
    common++;
  return (
    [...Array<string>(base.parts.length - common).fill('..'), ...target.parts.slice(common)].join(
      windows ? '\\' : '/',
    ) || '.'
  );
}
