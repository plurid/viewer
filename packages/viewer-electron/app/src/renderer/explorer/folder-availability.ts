import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
import { folderPath } from '../../domain/files/folder-visits';

let folders: ReadonlySet<string> = new Set();
let identities = new Map<string, string>();
let generation = 0;
let snapshot = {
  generation,
  paths: folders,
  identities: identities as ReadonlyMap<string, string>,
};
export const knownFolderSnapshot = () => snapshot;
const listeners = new Set<() => void>();
const remaps = new Set<(changes: FileChange[]) => void>();
export const knownFolderPaths = () => folders;
export const knownFolderIdentity = (path: string) =>
  identities.get(folderPath(path)) ?? folderPath(path);
export function subscribeKnownFolders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function subscribeFolderRemaps(listener: (changes: FileChange[]) => void): () => void {
  remaps.add(listener);
  return () => {
    remaps.delete(listener);
  };
}
function publish(): void {
  snapshot = { generation, paths: folders, identities };
  for (const listener of listeners) listener();
}
export function resetKnownFolders(paths: readonly string[] = []): void {
  generation++;
  folders = new Set(paths);
  identities = new Map(paths.map((path) => [path, path]));
  publish();
}
export function learnFolderAliases(aliases: Record<string, string> = {}): void {
  acceptKnownFolders([], aliases);
}
export function acceptKnownFolders(
  paths: readonly string[],
  aliases: Record<string, string> = {},
): void {
  let changed = false;
  identities = new Map(identities);
  const next = new Set(folders);
  for (const [path, target] of Object.entries(aliases)) {
    if (identities.get(path) === target) continue;
    identities.set(path, target);
    changed = true;
  }
  for (const path of paths) {
    const canonical = knownFolderIdentity(path);
    if (!next.has(path) || !next.has(canonical)) changed = true;
    next.add(path);
    next.add(canonical);
    if (!identities.has(canonical)) identities.set(canonical, canonical);
  }
  while (identities.size > 1000) identities.delete(identities.keys().next().value!);
  while (next.size > 1000) next.delete(next.values().next().value!);
  if (changed) {
    folders = next;
    publish();
  }
}
export function forgetKnownFolders(paths: readonly string[]): void {
  const removed = new Set(paths.map(knownFolderIdentity));
  identities = new Map(identities);
  folders = new Set([...folders].filter((path) => !removed.has(knownFolderIdentity(path))));
  for (const [path, target] of identities) if (removed.has(target)) identities.delete(path);
  generation++;
  publish();
}
export function knowFolder(
  path: string,
  present = true,
  canonical = knownFolderIdentity(path),
): void {
  if (folders.has(path) === present && (!present || identities.get(path) === canonical)) return;
  const next = new Set(folders);
  identities = new Map(identities);
  if (present) {
    next.add(path);
    next.add(canonical);
    identities.set(path, canonical);
    identities.set(canonical, canonical);
  } else {
    next.delete(path);
    identities.delete(path);
  }
  while (next.size > 1000) next.delete(next.values().next().value!);
  while (identities.size > 1000) identities.delete(identities.keys().next().value!);
  folders = next;
  publish();
}
export function remapKnownFolders(changes: FileChange[]): void {
  const map = pathMapper(changes);
  folders = new Set([...folders].map(map));
  identities = new Map([...identities].map(([path, target]) => [map(path), map(target)]));
  for (const listener of remaps) listener(changes);
  publish();
}
