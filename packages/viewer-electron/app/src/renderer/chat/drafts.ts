import type { ChatDocument } from '../../domain/chat';

interface Draft {
  text: string;
  revision: number;
}

const drafts = new Map<string, Draft>();
const writes = new Map<string, Promise<void>>();

export function chatDraft(document: ChatDocument): Draft {
  return drafts.get(document.id) ?? { text: document.draft, revision: document.draftRevision };
}

export function keepChatDraft(id: string, text: string, revision: number): void {
  drafts.set(id, { text, revision });
}

/** A culled plane and the quit handshake share this queue. Failed drafts stay recoverable. */
export function flushChatDraft(id: string): Promise<void> {
  const previous = writes.get(id) ?? Promise.resolve();
  const work = previous
    .catch(() => {})
    .then(async () => {
      const draft = drafts.get(id);
      if (!draft) return;
      await window.viewer.chat({ kind: 'draft', id, ...draft });
      if (drafts.get(id) === draft) drafts.delete(id);
    });
  writes.set(id, work);
  void work
    .finally(() => {
      if (writes.get(id) === work) writes.delete(id);
    })
    .catch(() => {});
  return work;
}

export async function flushChatDrafts(): Promise<void> {
  await Promise.all([...new Set([...drafts.keys(), ...writes.keys()])].map(flushChatDraft));
}
