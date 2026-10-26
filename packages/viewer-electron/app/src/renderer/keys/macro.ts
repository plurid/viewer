import { useSyncExternalStore } from 'react';
import { quoteWord } from '../../domain/command-line/lex';
import { plainCommandID } from '../../domain/command-line/verbs';
import { getState } from '../state/store';

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
 * Record macro: the commands run while recording, by keys, menus or the palette, become
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
  if (!recording || unrecorded.has(id) || id.startsWith('custom.') || recording.length >= 50)
    return;
  // a workspace by its name, which a later session still has: its id is this one's
  if (id.startsWith('workspace:')) {
    const name = getState().saved.workspaces.find((space) => `workspace:${space.id}` === id)?.name;
    if (name) publish([...recording, `tabn ${quoteWord(name)}`]);
    return;
  }
  if (id.includes(':')) return;
  publish([...recording, id]);
}
/** A line run while recording, from the command line or a key, recorded as it was written. */
export function recordLine(line: string): void {
  const text = line.trim();
  if (!recording || !text || recording.length >= 50) return;
  if (plainCommandID(text) && (unrecorded.has(text) || text.startsWith('custom.'))) return;
  publish([...recording, text]);
}
