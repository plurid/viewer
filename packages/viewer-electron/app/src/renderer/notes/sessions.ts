import type { NoteDocument } from '../../domain/editing/notes';
import { errorMessage } from '../../domain/errors';

export interface NoteSession {
  editorKey: string;
  document: NoteDocument;
  text: string;
  title: string;
  error?: string;
  timer?: ReturnType<typeof setTimeout>;
  pending?: Promise<void>;
}
const sessions = new Map<string, NoteSession>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let generation = 0;
const notify = () => {
  generation++;
  for (const listener of listeners) listener();
};
export const noteGeneration = () => generation;
export const subscribeNotes = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const noteSession = (paneID: string) => sessions.get(paneID);
export async function loadNote(paneID: string, id: string, refresh = false): Promise<void> {
  const held = sessions.get(paneID);
  if (
    held &&
    (!refresh ||
      held.pending ||
      held.text !== held.document.text ||
      held.title !== held.document.title)
  )
    return;
  if (loading.has(paneID)) return loading.get(paneID);
  const pending = window.viewer
    .notes({ kind: 'read', id })
    .then((reply) => {
      if (reply.kind !== 'document') throw new Error('The note could not be opened.');
      const latest = sessions.get(paneID);
      if (
        latest &&
        (latest.pending ||
          latest.text !== latest.document.text ||
          latest.title !== latest.document.title)
      )
        return;
      if (
        latest?.document.id === reply.document.id &&
        latest.document.revision === reply.document.revision
      )
        return;
      sessions.set(paneID, {
        editorKey: crypto.randomUUID(),
        document: reply.document,
        text: reply.document.text,
        title: reply.document.title,
      });
      notify();
    })
    .finally(() => loading.delete(paneID));
  loading.set(paneID, pending);
  return pending;
}
export function changeNote(paneID: string, change: { text?: string; title?: string }): void {
  const session = sessions.get(paneID);
  if (!session) return;
  Object.assign(session, change);
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    void flushNote(paneID).catch(() => {});
  }, 500);
  notify();
}
export async function flushNote(paneID: string): Promise<void> {
  const session = sessions.get(paneID);
  if (!session) return;
  clearTimeout(session.timer);
  session.timer = undefined;
  if (session.pending) {
    await session.pending;
    return flushNote(paneID);
  }
  if (session.text === session.document.text && session.title === session.document.title) return;
  const text = session.text,
    rawTitle = session.title,
    title = rawTitle.trim() || 'Untitled note';
  session.pending = window.viewer
    .notes({
      kind: 'write',
      id: session.document.id,
      revision: session.document.revision,
      title,
      text,
    })
    .then((reply) => {
      if (reply.kind !== 'document') throw new Error('The note could not be saved.');
      session.document = reply.document;
      if (session.title === rawTitle) session.title = reply.document.title;
      session.error = undefined;
    })
    .catch((error: unknown) => {
      session.error = errorMessage(error);
      throw error;
    })
    .finally(() => {
      session.pending = undefined;
      notify();
    });
  notify();
  await session.pending;
  if (session.text !== session.document.text || session.title !== session.document.title)
    await flushNote(paneID);
}
export async function flushNotes(): Promise<void> {
  await Promise.all([...sessions.keys()].map(flushNote));
}
