let folders: ReadonlySet<string> = new Set();
export const knownFolderPaths = () => folders;

export function resetKnownFolders(paths: readonly string[] = []): void {
  folders = new Set(paths);
}

export function retainKnownFolders(paths: readonly string[]): void {
  const retained = new Set(paths);
  folders = new Set([...folders].filter((path) => retained.has(path)));
}

export function knowFolder(path: string, present = true): void {
  if (folders.has(path) === present) return;
  const next = new Set(folders);
  if (present) next.add(path);
  else next.delete(path);
  while (next.size > 500) next.delete(next.values().next().value!);
  folders = next;
}
