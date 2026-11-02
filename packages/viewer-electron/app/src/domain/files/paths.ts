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

/** Display only: navigation must retain the resolved absolute path. */
export function relativePathLabel(folder: string, file: string): string {
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
