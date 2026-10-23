import { useSyncExternalStore } from 'react';

/** Commands that steer the recording or only show something: not part of a macro. */
const unrecorded = new Set(['record-macro', 'keymap-help', 'palette', 'plane-hints', 'settings']);
let recording: readonly string[] | null = null;
const listeners = new Set<() => void>();
const publish = (next: readonly string[] | null) => {
  recording = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/**
 * RECORD MACRO (2026-10-23): the commands run while recording, by keys, menus or the palette, become
 * a command sequence saved as a custom action. Agents' commands are not recorded: they are not
 * remembered as the person's.
 */
export const macroRecording = () => recording;
export const useMacroRecording = () => useSyncExternalStore(subscribe, () => recording);
export function startMacro(): void {
  publish([]);
}
export function stopMacro(): string[] {
  const commands = [...(recording ?? [])];
  publish(null);
  return commands;
}
export function recordCommand(id: string): void {
  if (!recording || unrecorded.has(id) || id.startsWith('custom.') || id.includes(':')) return;
  if (recording.length >= 50) return;
  publish([...recording, id]);
}
