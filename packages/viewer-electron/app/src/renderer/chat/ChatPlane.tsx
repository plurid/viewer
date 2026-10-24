import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatPane as Pane } from '../../domain/contracts';
import type { ChatDocument, ChatReply, ChatSummary } from '../../domain/chat';
import { modelPermissionCovers } from '../../domain/model-permissions';
import { acceptsDrop, droppedPaths } from '../explorer/sections';
import { report, useViewer } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { useModelPermission } from '../ui/ModelDataPermission';
import { reviewOperationPlan } from '../ui/OperationReview';
import { Empty, Loading } from '../ui/primitives';
import { useWorkspace } from '../workspace/context';
import { chatDraft, flushChatDraft, keepChatDraft } from './drafts';

function documentReply(reply: ChatReply): ChatDocument {
  if (Array.isArray(reply)) throw new Error('The conversation could not be opened.');
  return reply;
}

export default function ChatPlane({ pane }: { pane: Pane }) {
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
  const workspace = useWorkspace();
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transcript = useRef<HTMLDivElement>(null);
  const receive = useCallback(
    (next: ChatDocument) => {
      if (next.id !== pane.conversationID) return;
      setDocument((previous) => (previous && previous.revision > next.revision ? previous : next));
    },
    [pane.conversationID],
  );

  useEffect(() => {
    let live = true;
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
      .catch((value: Error) => {
        if (live) setError(value.message);
      });
    return () => {
      live = false;
      unsubscribe();
      clearTimeout(timer.current);
      void flushChatDraft(pane.conversationID).catch(report);
    };
  }, [pane.conversationID, receive]);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [document?.messages.length]);

  const act = async (work: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (value) {
      setError((value as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const attach = (paths: string[]) =>
    act(async () => {
      const reply = await window.viewer.chat({ kind: 'attach', id: pane.conversationID, paths });
      receive(documentReply(reply));
    });
  const changed = (text: string) => {
    setDraft(text);
    keepChatDraft(pane.conversationID, text, ++revision.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushChatDraft(pane.conversationID).catch((value: Error) => setError(value.message));
    }, 250);
  };
  const send = () =>
    act(async () => {
      if (!provider || !draft.trim()) return;
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
      if (revision.current === sentRevision) setDraft('');
    });
  const exportTranscript = () =>
    act(async () => {
      if (!document) return;
      const text = [
        `# ${document.title}`,
        ...document.messages.map((message) => `## ${message.role}\n\n${message.text}`),
        ...(draft ? [`## Draft\n\n${draft}`] : []),
      ].join('\n\n');
      const session = crypto.randomUUID();
      try {
        await window.viewer.textSaveAs(text, 'Conversation.md', session);
      } finally {
        await window.viewer.textEditEnd(session);
      }
    });

  if (!document)
    return error ? (
      <Empty title="Chat unavailable" detail={error} />
    ) : (
      <Loading label="Opening Chat…" />
    );
  const running = document.status === 'running';
  return (
    <section
      className="chat-plane"
      aria-label="Conversation"
      onDragOver={(event) => {
        if (acceptsDrop(event) && !running) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!acceptsDrop(event) || running) return;
        event.preventDefault();
        void droppedPaths(event)
          .then(attach)
          .catch((value: Error) => setError(value.message));
      }}
    >
      <header className="chat-toolbar">
        <ChoiceButton
          label="Chat model"
          value={provider?.id ?? ''}
          choices={providers.map((item) => ({ value: item.id, label: item.name }))}
          onChoose={setProviderID}
          disabled={busy || running || !providers.length}
        />
        <button
          disabled={busy || running}
          onClick={() =>
            void act(async () => {
              const path = await window.viewer.chooseFolder(pane.path);
              if (path) await attach([path]);
            })
          }
        >
          Add folder…
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const reply = await window.viewer.chat({ kind: 'list' });
              if (Array.isArray(reply)) setRecent(reply);
            })
          }
        >
          Conversations
        </button>
        <button disabled={busy} onClick={() => void exportTranscript()}>
          Export…
        </button>
      </header>
      {!!recent.length && (
        <ChoiceButton
          label="Open conversation"
          value={pane.conversationID}
          choices={recent.map((item) => ({
            value: item.id,
            label: item.title,
            detail: item.problem ?? item.path,
          }))}
          onChoose={(id) => void workspace.openChat(id).catch(report)}
        />
      )}
      <div className="chat-context" aria-label="Attached context">
        {document.scopes.length ? (
          document.scopes.map((scope) => (
            <span key={scope.path} title={scope.path}>
              {scope.path}
            </span>
          ))
        ) : (
          <span>Drop files or folders here to add context.</span>
        )}
      </div>
      <div className="chat-transcript" ref={transcript} role="log" aria-live="polite">
        {!document.messages.length && (
          <p className="muted">
            Ask about the attached files. Proposed changes appear for your review.
          </p>
        )}
        {document.messages.map((message) =>
          message.role === 'tool' ? (
            <details className="chat-tool" key={message.id}>
              <summary>Inspected context</summary>
              <pre>{message.text}</pre>
            </details>
          ) : (
            <article className="chat-message" data-role={message.role} key={message.id}>
              <strong>{message.role === 'user' ? 'You' : (provider?.name ?? 'Assistant')}</strong>
              <p>{message.text}</p>
              {message.proposal && (
                <button
                  onClick={() =>
                    void act(async () => {
                      const proposal = message.proposal!;
                      if (proposal.kind === 'operation') {
                        const plan = await window.viewer.operationPlan({
                          kind: 'get',
                          id: proposal.id,
                        });
                        if (!Array.isArray(plan)) reviewOperationPlan(plan);
                      } else window.dispatchEvent(new Event('viewer:agent-review'));
                    })
                  }
                >
                  Review proposal
                </button>
              )}
            </article>
          ),
        )}
        {running && <p role="status">Inspecting context…</p>}
      </div>
      {(error || document.error || permission.error) && (
        <p className="chat-error" role="alert">
          {error || document.error || permission.error}
        </p>
      )}
      {!provider ? (
        <button onClick={() => void window.viewer.openSettings('settings.providers').catch(report)}>
          Add a model in Settings
        </button>
      ) : (
        !allowed &&
        !permission.loading && (
          <div className="chat-permission">
            <span>
              {provider.endpoint} needs permission to receive{' '}
              {level === 'excerpts' ? 'bounded file excerpts' : 'file names and your request'}.
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  window.viewer.providerPermissionSet(provider.id, provider.endpoint, level),
                )
              }
            >
              Allow {level}
            </button>
          </div>
        )
      )}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Chat message"
          placeholder="Ask about these files…"
          maxLength={16000}
          value={draft}
          disabled={busy}
          onChange={(event) => changed(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!busy && !running && allowed && draft.trim()) void send();
            }
          }}
        />
        {running ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                receive(
                  documentReply(
                    await window.viewer.chat({ kind: 'stop', id: pane.conversationID }),
                  ),
                );
              })
            }
          >
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={busy || !allowed || !draft.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}
