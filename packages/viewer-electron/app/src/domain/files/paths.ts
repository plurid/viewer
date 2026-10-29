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
