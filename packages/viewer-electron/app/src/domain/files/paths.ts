/**
 * Whether `file` is `root` or inside it, for absolute paths the desktop has already resolved.
 * Pure string work, on either separator, for the renderer and the domain; the desktop uses
 * `containsPath` (desktop/files/containment.ts), which also resolves `..`.
 */
export function pathContains(root: string, file: string): boolean {
  if (file === root) return true;
  const base = root.replace(/[\\/]+$/, '');
  return file.startsWith(base + '/') || file.startsWith(base + '\\');
}

/** Root through the current folder, retaining drive and network-share roots. */
export function pathAncestry(path: string): string[] {
  const prefix = path.match(/^([A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+|[\\/])/);
  if (!prefix) return [path];
  const root = prefix[0];
  const separator = path.includes('\\') ? '\\' : '/';
  const trail = [root];
  for (const part of path.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    const parent = trail.at(-1)!;
    trail.push(parent + (parent.endsWith(separator) ? '' : separator) + part);
  }
  return trail;
}
