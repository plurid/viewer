import type { ChatDocument } from '../../domain/models/chat';
import { RevisionedWriteQueue } from '../persistence/revisioned-write-queue';

interface Draft {
  text: string;
  revision: number;
}

const drafts = new Map<string, Draft>();
const writes = new RevisionedWriteQueue<string, Draft>(async (id, draft) => {
  await window.viewer.chat({ kind: 'draft', id, ...draft });
  if (drafts.get(id) === draft) drafts.delete(id);
});

export function chatDraft(document: ChatDocument): Draft {
  return drafts.get(document.id) ?? { text: document.draft, revision: document.draftRevision };
}

export function keepChatDraft(id: string, text: string, revision: number): void {
  const draft = { text, revision };
  drafts.set(id, draft);
  writes.put(id, draft);
}

/** A culled plane and the quit handshake share this queue. Failed drafts stay recoverable. */
export function flushChatDraft(id: string): Promise<void> {
  return writes.flushKey(id);
}

export async function flushChatDrafts(): Promise<void> {
  await writes.flush();
}
