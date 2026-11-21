import { useEffect, useSyncExternalStore } from 'react';

let microphones: MediaDeviceInfo[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Keep labels learned during active capture; empty IDs mean enumeration was redacted. */
export async function readMicrophones(): Promise<void> {
  const devices = await navigator.mediaDevices?.enumerateDevices();
  if (!devices) return;
  const audioInputs = devices.filter((item) => item.kind === 'audioinput').slice(0, 100);
  if (
    audioInputs.length > 0 &&
    audioInputs.every((item) => !item.deviceId) &&
    microphones.some((item) => item.deviceId)
  )
    return;
  microphones = audioInputs.map((item) =>
    item.label
      ? item
      : (microphones.find((known) => known.deviceId === item.deviceId && known.label) ?? item),
  );
  for (const listener of listeners) listener();
}
export function useMicrophones(refreshKey?: unknown): readonly MediaDeviceInfo[] {
  useEffect(() => {
    const read = () => {
      void readMicrophones().catch(() => {});
    };
    read();
    navigator.mediaDevices?.addEventListener('devicechange', read);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', read);
  }, [refreshKey]);
  return useSyncExternalStore(subscribe, () => microphones);
}
