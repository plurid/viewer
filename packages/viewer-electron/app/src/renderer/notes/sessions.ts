import type { NoteDocument } from '../../domain/editing/notes';
import { noteSchema } from '../../domain/editing/notes';
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
const removalLocks = new Set<string>();
const trashedNotes = new Set<string>();
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
/** A typed task handoff carries only its new blank note. It never needs a private
 * read during agent dispatch, and retries cannot overwrite a person's edits. */
export function initializeTaskNote(paneID: string, input: NoteDocument): void {
  const document = noteSchema.parse(input);
  if (document.text || document.revision !== 0 || document.kind !== 'note')
    throw new Error('A new task can initialize only its blank note.');
  const current = sessions.get(paneID);
  if (current) {
    if (current.document.id !== document.id)
      throw new Error('This note view already belongs to another document.');
    return;
  }
  sessions.set(paneID, {
    editorKey: crypto.randomUUID(),
    document,
    text: '',
    title: document.title,
  });
  notify();
}
export const noteLocked = (id: string) => removalLocks.has(id);
export async function prepareNoteTrash(id: string): Promise<void> {
  removalLocks.add(id);
  notify();
  await Promise.all(
    [...sessions]
      .filter(([, session]) => session.document.id === id)
      .map(([paneID]) => flushNote(paneID)),
  );
}
export function finishNoteTrash(id: string, trashed: boolean): void {
  removalLocks.delete(id);
  if (trashed) {
    trashedNotes.add(id);
    for (const [paneID, session] of sessions) {
      if (session.document.id !== id) continue;
      clearTimeout(session.timer);
      sessions.delete(paneID);
    }
  }
  notify();
}
export async function loadNote(paneID: string, id: string, refresh = false): Promise<void> {
  if (trashedNotes.has(id)) throw new Error('This note was moved to Trash.');
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
      if (trashedNotes.has(id)) return;
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
  if (!session || noteLocked(session.document.id)) return;
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
