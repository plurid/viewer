import { useSyncExternalStore } from 'react';
import type { NetworkSharingSnapshot } from '../../domain/files/network-sharing';
import { getState } from '../state/store';

let snapshot: NetworkSharingSnapshot = {
  status: 'unknown',
  shares: [],
  service: 'unknown',
  host: '',
  ipv4: [],
};
let pending: Promise<NetworkSharingSnapshot> | undefined;
const listeners = new Set<() => void>();
let observers = 0;

export function networkSharingEnabled(): boolean {
  return getState()?.bootstrap?.networkSharingAvailable === true;
}

export function readNetworkSharing(): Promise<NetworkSharingSnapshot> {
  if (!networkSharingEnabled()) return Promise.resolve(snapshot);
  return (pending ??= window.viewer
    .networkSharing({ kind: 'refresh' })
    .then((value) => {
      snapshot = value;
      listeners.forEach((listener) => listener());
      return value;
    })
    .finally(() => {
      pending = undefined;
    }));
}

export function refreshNetworkSharing(): void {
  void readNetworkSharing().catch(() => {});
}

export function followNetworkSharing(): () => void {
  if (!networkSharingEnabled()) return () => {};
  if (!observers++) window.addEventListener('focus', refreshNetworkSharing);
  refreshNetworkSharing();
  return () => {
    if (!--observers) window.removeEventListener('focus', refreshNetworkSharing);
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

export function sharedFolder(file: string) {
  if (!networkSharingEnabled() || snapshot.status !== 'ready') return undefined;
  const shares = snapshot.shares.filter((share) => share.path === file);
  // A stricter share name must not conceal another name that lets guests into the same folder.
  return (
    shares.find((share) => share.guestWritable) ?? shares.find((share) => share.guests) ?? shares[0]
  );
}
