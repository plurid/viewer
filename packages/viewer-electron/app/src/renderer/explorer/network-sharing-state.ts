import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  NetworkFolderSharing,
  NetworkSharingSnapshot,
} from '../../domain/files/network-sharing';
import { getState } from '../state/store';

let snapshot: NetworkSharingSnapshot = {
  status: 'unknown',
  shares: [],
  service: 'unknown',
  host: '',
  ipv4: [],
};
interface SharingRead {
  paths: Set<string>;
  promise: Promise<NetworkSharingSnapshot>;
}
const pending = new Set<SharingRead>();
const versions = new Map<string, number>();
let sequence = 0;
let snapshotVersion = 0;
const listeners = new Set<() => void>();
const watched = new Map<string, number>();
let queued = false;
let observers = 0;
export function networkSharingEnabled(): boolean {
  return getState()?.bootstrap?.networkSharingAvailable === true;
}
async function readSharingChunks(paths: string[], force: boolean): Promise<NetworkSharingSnapshot> {
  const folders: NetworkFolderSharing[] = [];
  let value = snapshot;
  for (let start = 0; start < Math.max(paths.length, 1); start += 1000) {
    const chunk = paths.slice(start, start + 1000);
    value = await window.viewer.networkSharing(
      chunk.length
        ? { kind: 'refresh', paths: chunk, force: force && start === 0 }
        : { kind: 'refresh', force },
    );
    if (value.status !== 'ready') return value;
    folders.push(...(value.folders ?? []));
  }
  return { ...value, folders };
}
export function readNetworkSharing(
  paths = [...watched.keys()],
  force = false,
): Promise<NetworkSharingSnapshot> {
  if (!networkSharingEnabled()) return Promise.resolve(snapshot);
  paths = [...new Set(paths)];
  if (!force) {
    const existing = [...pending]
      .reverse()
      .find((read) => paths.every((path) => read.paths.has(path)));
    if (existing) return existing.promise;
  }
  const version = ++sequence;
  const promise = readSharingChunks(paths, force)
    .catch((): NetworkSharingSnapshot => ({
      status: 'unknown',
      shares: [],
      service: 'unknown',
      host: '',
      ipv4: [],
    }))
    .then((value) => {
      const keep = new Set([
        ...watched.keys(),
        ...paths,
        ...[...pending].flatMap((read) => [...read.paths]),
      ]);
      const folders = new Map(
        snapshot.folders
          ?.filter((folder) => keep.has(folder.path))
          .map((folder) => [folder.path, folder]),
      );
      for (const folder of value.folders ??
        paths.map((path) => ({ path, status: 'unknown' as const, shares: [] }))) {
        if ((versions.get(folder.path) ?? 0) > version) continue;
        folders.set(folder.path, folder);
        versions.set(folder.path, version);
      }
      for (const path of versions.keys()) if (!keep.has(path)) versions.delete(path);
      // A slow row read must not replace a newer answer requested for an open detail view.
      const fields = version >= snapshotVersion ? value : snapshot;
      snapshotVersion = Math.max(snapshotVersion, version);
      snapshot = { ...fields, folders: [...folders.values()] };
      listeners.forEach((listener) => listener());
      return value;
    })
    .finally(() => {
      pending.delete(read);
    });
  const read: SharingRead = { paths: new Set(paths), promise };
  pending.add(read);
  return promise;
}
export function refreshNetworkSharing(): void {
  void readNetworkSharing().catch(() => {});
}
export function refreshSharingOnRequest(): void {
  void readNetworkSharing(undefined, true).catch(() => {});
}
export function followNetworkSharing(): () => void {
  if (!networkSharingEnabled()) return () => {};
  if (!observers++) window.addEventListener('focus', refreshSharingOnRequest);
  refreshNetworkSharing();
  return () => {
    if (!--observers) window.removeEventListener('focus', refreshSharingOnRequest);
  };
}
function watch(path: string, refresh = true): () => void {
  if (!networkSharingEnabled() || !path.startsWith('/')) return () => {};
  watched.set(path, (watched.get(path) ?? 0) + 1);
  if (refresh && !queued) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      refreshNetworkSharing();
    });
  }
  return () => {
    const count = watched.get(path) ?? 0;
    if (count > 1) watched.set(path, count - 1);
    else watched.delete(path);
  };
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useNetworkSharing(): NetworkSharingSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
export function useSharingFolder(path: string) {
  const value = useNetworkSharing();
  useEffect(() => watch(path), [path]);
  return value.folders?.find((folder) => folder.path === path);
}
export function useFreshSharingFolder(path: string) {
  const snapshot = useNetworkSharing();
  const folder = snapshot.folders?.find((folder) => folder.path === path);
  const request = useRef({ version: 0 });
  const [checked, setChecked] = useState<string>();
  const refresh = useCallback(() => {
    if (!networkSharingEnabled()) return;
    const version = ++request.current.version;
    setChecked(undefined);
    void readNetworkSharing([path], true).then(() => {
      if (request.current.version === version) setChecked(path);
    });
  }, [path]);
  useEffect(() => {
    const requests = request.current;
    const stop = watch(path, false);
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      requests.version++;
      stop();
      window.removeEventListener('focus', refresh);
    };
  }, [path, refresh]);
  const checking = checked !== path;
  return { snapshot, folder: checking ? undefined : folder, checking, refresh };
}
export function sharedFolders(file: string) {
  if (!networkSharingEnabled() || snapshot.status !== 'ready') return [];
  return snapshot.folders?.find((folder) => folder.path === file)?.shares ?? [];
}
export function sharedFolder(file: string) {
  const shares = sharedFolders(file);
  return (
    shares.find((share) => share.guestWritable) ??
    shares.find((share) => share.guestWriteUnknown) ??
    shares.find((share) => share.guests) ??
    shares[0]
  );
}
