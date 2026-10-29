import path from 'node:path';

/**
 * Whether `file` is `root` or inside it. Both are resolved and compared segment by segment on
 * this platform's separator, so `..` cannot step out and `/a/bc` is not inside `/a/b`.
 */
export function containsPath(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}
