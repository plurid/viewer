import type { TextBuffer } from '../../domain/editing/documents';
import { report } from '../state/core';
import { RevisionedWriteQueue } from '../persistence/revisioned-write-queue';

/**
 * UNSAVED TEXT (2026-10-23). The renderer's copy of each buffer it holds: written to the profile half
 * a second after the last change and at every flush, so a quit or a crash keeps what was typed. A
 * buffer is removed only by `discardBuffer`, which a person's Save or Don't Save asks for.
 */
interface Held {
  buffer: TextBuffer;
  timer?: ReturnType<typeof setTimeout>;
}
const held = new Map<string, Held>();
const writes = new RevisionedWriteQueue<string, TextBuffer>((_id, buffer) =>
  window.viewer.bufferWrite(buffer),
);
const listeners = new Set<() => void>();
let generation = 0;
function changed(): void {
  generation++;
  for (const listener of listeners) listener();
}
export function subscribeBuffers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const buffersGeneration = () => generation;

/** A buffer as last kept: from this window, or read back from the profile. */
export async function readBuffer(id: string): Promise<TextBuffer | null> {
  const known = held.get(id);
  if (known) return known.buffer;
  const buffer = await window.viewer.bufferRead(id);
  if (buffer && !held.has(id)) held.set(id, { buffer });
  return held.get(id)?.buffer ?? null;
}
/** The text held for a buffer in this window, without asking the profile. */
export const heldBuffer = (id: string): TextBuffer | undefined => held.get(id)?.buffer;

/** Keeps new text for a buffer; it reaches the profile half a second after the last change. */
export function keepBuffer(next: Omit<TextBuffer, 'revision' | 'updated'>): void {
  const previous = held.get(next.id);
  clearTimeout(previous?.timer);
  const entry: Held = {
    buffer: { ...next, revision: (previous?.buffer.revision ?? 0) + 1, updated: Date.now() },
  };
  if (!writes.put(next.id, entry.buffer)) return;
  entry.timer = setTimeout(() => void writes.flushKey(next.id).catch(report), 500);
  held.set(next.id, entry);
  changed();
}
/** Writes every change not yet in the profile: at a flush, before a quit. */
export async function flushBuffers(): Promise<void> {
  for (const entry of held.values()) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
  await writes.flush();
}
/** Removes unsaved text a person chose to discard, or saved. */
export async function discardBuffer(id: string): Promise<void> {
  clearTimeout(held.get(id)?.timer);
  await writes.retire(id, () => window.viewer.bufferDiscard(id));
  held.delete(id);
  changed();
}
