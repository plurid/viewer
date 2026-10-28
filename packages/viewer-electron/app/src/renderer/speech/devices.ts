import { useEffect, useSyncExternalStore } from 'react';

let microphones: MediaDeviceInfo[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Keep labels learned during active capture; closed-session permissions deliberately stay denied. */
export async function readMicrophones(): Promise<void> {
  const devices = await navigator.mediaDevices?.enumerateDevices();
  if (!devices) return;
  microphones = devices
    .filter((item) => item.kind === 'audioinput')
    .slice(0, 100)
    .map((item) =>
      item.label
        ? item
        : (microphones.find((known) => known.deviceId === item.deviceId && known.label) ?? item),
    );
  for (const listener of listeners) listener();
}
export function useMicrophones(): readonly MediaDeviceInfo[] {
  useEffect(() => {
    const read = () => {
      void readMicrophones().catch(() => {});
    };
    read();
    navigator.mediaDevices?.addEventListener('devicechange', read);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', read);
  }, []);
  return useSyncExternalStore(subscribe, () => microphones);
}
