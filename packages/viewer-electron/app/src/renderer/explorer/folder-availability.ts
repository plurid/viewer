import { useSyncExternalStore } from 'react';

let folders: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
export const knownFolderPaths = () => folders;

export function resetKnownFolders(paths: readonly string[] = []): void {
  folders = new Set(paths);
  for (const listener of listeners) listener();
}

export function knowFolder(path: string, present = true): void {
  if (folders.has(path) === present) return;
  const next = new Set(folders);
  if (present) next.add(path);
  else next.delete(path);
  while (next.size > 500) next.delete(next.values().next().value!);
  folders = next;
  for (const listener of listeners) listener();
}

export function useKnownFolders(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => folders,
  );
}
