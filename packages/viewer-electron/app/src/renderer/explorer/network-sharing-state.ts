import { useEffect, useSyncExternalStore } from 'react';
import type { NetworkSharingSnapshot } from '../../domain/files/network-sharing';
import { getState } from '../state/store';

let snapshot: NetworkSharingSnapshot = { status: 'unknown', shares: [], service: 'unknown', host: '', ipv4: [] };
let pending: Promise<NetworkSharingSnapshot> | undefined;
let pendingPaths = new Set<string>();
let pendingForced = false;
const listeners = new Set<() => void>();
const watched = new Map<string, number>();
let queued = false;
let observers = 0;
export function networkSharingEnabled(): boolean { return getState()?.bootstrap?.networkSharingAvailable === true; }
export function readNetworkSharing(paths = [...watched.keys()], force = false): Promise<NetworkSharingSnapshot> {
  if (!networkSharingEnabled()) return Promise.resolve(snapshot);
  paths = [...new Set([...watched.keys(), ...paths])];
  if (pending) return paths.every((path) => pendingPaths.has(path)) && (!force || pendingForced) ? pending : pending.then(() => readNetworkSharing(paths, force));
  pendingPaths = new Set(paths);
  pendingForced = force;
  const request = paths.length ? { kind: 'refresh' as const, paths, force } : { kind: 'refresh' as const, force };
  return pending = window.viewer.networkSharing(request).then((value) => {
    snapshot = value;
    listeners.forEach((listener) => listener());
    return value;
  }).catch(() => {
    snapshot = { status: 'unknown', shares: [], service: 'unknown', host: '', ipv4: [] };
    listeners.forEach((listener) => listener());
    return snapshot;
  }).finally(() => { pending = undefined; });
}
export function refreshNetworkSharing(): void { void readNetworkSharing().catch(() => {}); }
export function refreshSharingOnRequest(): void { void readNetworkSharing(undefined, true).catch(() => {}); }
export function followNetworkSharing(): () => void {
  if (!networkSharingEnabled()) return () => {};
  if (!observers++) window.addEventListener('focus', refreshSharingOnRequest);
  refreshNetworkSharing();
  return () => { if (!--observers) window.removeEventListener('focus', refreshSharingOnRequest); };
}
function watch(path: string): () => void {
  if (!networkSharingEnabled() || !path.startsWith('/')) return () => {};
  watched.set(path, (watched.get(path) ?? 0) + 1);
  if (!queued) {
    queued = true;
    queueMicrotask(() => { queued = false; refreshNetworkSharing(); });
  }
  return () => { const count = watched.get(path) ?? 0; if (count > 1) watched.set(path, count - 1); else watched.delete(path); };
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useNetworkSharing(): NetworkSharingSnapshot { return useSyncExternalStore(subscribe, () => snapshot); }
export function useSharingFolder(path: string) {
  const value = useNetworkSharing();
  useEffect(() => watch(path), [path]);
  return value.folders?.find((folder) => folder.path === path);
}
export function sharedFolders(file: string) {
  if (!networkSharingEnabled() || snapshot.status !== 'ready') return [];
  return snapshot.folders?.find((folder) => folder.path === file && folder.status === 'ready')?.shares ?? [];
}
export function sharedFolder(file: string) {
  const shares = sharedFolders(file);
  return shares.find((share) => share.guestWritable) ?? shares.find((share) => share.guestWriteUnknown) ?? shares.find((share) => share.guests) ?? shares[0];
}
