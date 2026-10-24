import type { ChatPane as Pane } from '../../domain/contracts';
import { acceptsDrop, droppedPaths } from '../explorer/sections';
import { report } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { Empty, Loading } from '../ui/primitives';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { useConversation } from './useConversation';

export default function ChatPlane({ pane }: { pane: Pane }) {
  const { state, actions } = useConversation(pane);
  const {
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
    error,
  } = state;
  if (!document)
    return error ? (
      <Empty title="Chat unavailable" detail={error} />
    ) : (
      <Loading label="Opening Chat…" />
    );
  return (
    <section
      className="chat-plane"
      aria-label="Conversation"
      onDragOver={(event) => {
        if (acceptsDrop(event) && !running && !busy) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!acceptsDrop(event) || running || busy) return;
        event.preventDefault();
        void droppedPaths(event).then(actions.attach).catch(actions.reportError);
      }}
    >
      <header className="chat-toolbar">
        <ChoiceButton
          label="Chat model"
          value={provider?.id ?? ''}
          choices={providers.map((item) => ({ value: item.id, label: item.name }))}
          onChoose={actions.selectProvider}
          disabled={busy || running || !providers.length}
        />
        <button disabled={busy || running} onClick={() => void actions.addFolder()}>
          Add folder…
        </button>
        <button disabled={busy} onClick={() => void actions.loadRecent()}>
          Conversations
        </button>
        <button disabled={busy} onClick={() => void actions.exportTranscript()}>
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
          onChoose={(id) => void actions.open(id)}
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
      <Transcript messages={document.messages} running={running} onReview={actions.review} />
      {error && (
        <p className="chat-error" role="alert">
          {error}
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
            <button disabled={busy} onClick={() => void actions.grantPermission()}>
              Allow {level}
            </button>
          </div>
        )
      )}
      <Composer
        draft={draft}
        busy={busy}
        running={running}
        allowed={allowed}
        onChange={actions.changed}
        onSend={() => void actions.send()}
        onStop={() => void actions.stop()}
      />
    </section>
  );
}
