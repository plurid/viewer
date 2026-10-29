import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatPane } from '../../domain/contracts';
import type { ChatDocument, ChatMessage, ChatReply, ChatSummary } from '../../domain/models/chat';
import { modelPermissionCovers } from '../../domain/models/permissions';
import { errorMessage } from '../../domain/errors';
import { report, useViewer } from '../state/store';
import { useModelPermission } from '../ui/models/ModelDataPermission';
import { reviewOperationPlan } from '../ui/operations/OperationReview';
import { useWorkspace } from '../workspace/context';
import { chatDraft, flushChatDraft, keepChatDraft } from './drafts';
import { messageAuthor } from './presentation';
import { sendWindowEvent } from '../app/window-events';

const draftDelay = 250;

function documentReply(reply: ChatReply): ChatDocument {
  if (Array.isArray(reply)) throw new Error('The conversation could not be opened.');
  return reply;
}

/** Conversation ordering, drafts, consent and reviewed actions share one controller. */
export function useConversation(pane: ChatPane) {
  const [document, setDocument] = useState<ChatDocument>();
  const [draft, setDraft] = useState('');
  const [providerID, setProviderID] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<ChatSummary[]>([]);
  const providers = useViewer((state) => state.settings.settings.providers);
  const provider = providers.find((item) => item.id === providerID) ?? providers[0];
  const permission = useModelPermission(provider);
  const level = document?.level ?? 'names';
  const allowed = !!provider && modelPermissionCovers(permission.permission, provider, level);
  const running = document?.status === 'running';
  const workspace = useWorkspace();
  const revision = useRef(0);
  const pending = useRef(0);
  const active = useRef(pane.conversationID);
  active.current = pane.conversationID;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const receive = useCallback((next: ChatDocument) => {
    if (next.id !== active.current) return;
    setDocument((previous) =>
      previous?.id === next.id && previous.revision > next.revision ? previous : next,
    );
  }, []);

  useEffect(() => {
    let live = true;
    setDocument(undefined);
    setError('');
    setDraft('');
    const unsubscribe = window.viewer.onEvent((event) => {
      if (live && event.type === 'chat') receive(event.document);
    });
    void window.viewer
      .chat({ kind: 'open', id: pane.conversationID })
      .then((reply) => {
        const next = documentReply(reply);
        if (!live) return;
        const kept = chatDraft(next);
        revision.current = kept.revision;
        setDraft(kept.text);
        setProviderID(next.providerID);
        receive(next);
      })
      .catch((value: unknown) => {
        if (live) setError(errorMessage(value));
      });
    return () => {
      live = false;
      unsubscribe();
      clearTimeout(timer.current);
      void flushChatDraft(pane.conversationID).catch(report);
    };
  }, [pane.conversationID, receive]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    const id = active.current;
    setError('');
    pending.current++;
    setBusy(true);
    try {
      await work();
    } catch (value) {
      if (id === active.current) setError(errorMessage(value));
    } finally {
      pending.current--;
      if (id === active.current) setBusy(pending.current > 0);
    }
  }, []);
  const attachPaths = async (paths: string[]) => {
    receive(
      documentReply(await window.viewer.chat({ kind: 'attach', id: pane.conversationID, paths })),
    );
  };
  const changed = (text: string) => {
    setDraft(text);
    keepChatDraft(pane.conversationID, text, ++revision.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushChatDraft(pane.conversationID).catch((value: unknown) =>
        setError(errorMessage(value)),
      );
    }, draftDelay);
  };
  const send = async () => {
    if (pending.current || running || !allowed || !provider || !draft.trim()) return;
    await run(async () => {
      const sentRevision = revision.current;
      clearTimeout(timer.current);
      await flushChatDraft(pane.conversationID);
      const reply = await window.viewer.chat({
        kind: 'send',
        id: pane.conversationID,
        text: draft,
        providerID: provider.id,
      });
      receive(documentReply(reply));
      if (active.current === pane.conversationID && revision.current === sentRevision) setDraft('');
    });
  };
  const exportTranscript = () =>
    run(async () => {
      if (!document) return;
      const text = [
        `# ${document.title}`,
        ...document.messages.map((message) => `## ${messageAuthor(message)}\n\n${message.text}`),
        ...(draft ? [`## Draft\n\n${draft}`] : []),
      ].join('\n\n');
      const session = crypto.randomUUID();
      try {
        await window.viewer.textSaveAs(text, 'Conversation.md', session);
      } finally {
        await window.viewer.textEditEnd(session);
      }
    });
  const review = useCallback(
    (proposal: NonNullable<ChatMessage['proposal']>) =>
      run(async () => {
        if (proposal.kind === 'operation') {
          const plan = await window.viewer.operationPlan({ kind: 'get', id: proposal.id });
          if (!Array.isArray(plan)) reviewOperationPlan(plan);
        } else sendWindowEvent('viewer:agent-review');
      }),
    [run],
  );

  return {
    state: {
      document,
      draft,
      providers,
      provider,
      permission,
      level,
      allowed,
      busy,
      recent,
      running,
      error: error || document?.error || permission.error,
    },
    actions: {
      changed,
      selectProvider: setProviderID,
      send,
      exportTranscript,
      attach: (paths: string[]) => run(() => attachPaths(paths)),
      addFolder: () =>
        run(async () => {
          const path = await window.viewer.chooseFolder(pane.path);
          if (path) await attachPaths([path]);
        }),
      loadRecent: () =>
        run(async () => {
          const reply = await window.viewer.chat({ kind: 'list' });
          if (Array.isArray(reply)) setRecent(reply);
        }),
      open: (id: string) => run(() => workspace.openChat(id)),
      stop: () =>
        run(async () => {
          receive(
            documentReply(await window.viewer.chat({ kind: 'stop', id: pane.conversationID })),
          );
        }),
      grantPermission: () =>
        run(async () => {
          if (provider)
            await window.viewer.providerPermissionSet(provider.id, provider.endpoint, level);
        }),
      review,
      reportError: (value: unknown) => setError(errorMessage(value)),
    },
  };
}
