import { useId } from 'react';
import type { ChatPane as Pane } from '../../domain/contracts';
import { acceptsDrop, droppedPaths } from '../explorer/sections';
import { report } from '../state/store';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { Icon } from '../ui/Icon';
import { Empty, Loading } from '../ui/primitives';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { useConversation } from './useConversation';
import './chat.css';
import { useWorkspace } from '../workspace/context';

export default function ChatPlane({ pane }: { pane: Pane }) {
  const workspace = useWorkspace();
  const errorID = useId();
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
      <Empty icon="warning" title="Chat unavailable" detail={error} />
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
      <header
        className="chat-toolbar"
        aria-label="Chat controls"
        data-viewer-overlay-protected="chat-toolbar"
      >
        <ChoiceButton
          className="chat-model"
          label="Chat model"
          value={provider?.id ?? ''}
          placeholder="Choose a model"
          choices={providers.map((item) => ({ value: item.id, label: item.name }))}
          onChoose={actions.selectProvider}
          disabled={busy || running || !providers.length}
        />
        <button type="button" disabled={busy || running} onClick={() => void actions.addFolder()}>
          Add folder…
        </button>
        <button type="button" disabled={busy} onClick={() => void actions.loadRecent()}>
          Conversations
        </button>
        <button type="button" disabled={busy} onClick={() => void actions.exportTranscript()}>
          Export…
        </button>
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
      </header>
      <div className="chat-context" role="group" aria-label="Attached context">
        <span className="chat-context-label">Context</span>
        {document.scopes.length ? (
          <ul className="chat-context-items">
            {document.scopes.map((scope) => (
              <li key={scope.path} title={scope.path}>
                <Icon name={scope.directory ? 'folder' : 'file'} size={14} />
                <span>{scope.path}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Drop files or folders here to add context.</p>
        )}
      </div>
      <Transcript
        messages={document.messages}
        running={running}
        onReview={actions.review}
        onOpen={(path) =>
          void workspace
            .openPath(path, { paneID: pane.id, linked: true, activate: true })
            .catch(actions.reportError)
        }
      />
      <footer className="chat-footer" data-viewer-overlay-protected="chat-composer">
        {error && (
          <p className="chat-error" role="alert" id={errorID}>
            <Icon name="warning" size={16} />
            <span>{error}</span>
          </p>
        )}
        {!provider ? (
          <div className="chat-setup">
            <p>Choose a model to start a conversation.</p>
            <button
              type="button"
              onClick={() => void window.viewer.openSettings('settings.providers').catch(report)}
            >
              Add a model in Settings
            </button>
          </div>
        ) : permission.loading ? (
          <p className="chat-permission-loading" role="status">
            Checking data permission…
          </p>
        ) : !allowed ? (
          <div className="chat-permission">
            <p>
              <span className="chat-endpoint">{provider.endpoint}</span> needs permission to receive{' '}
              {level === 'excerpts' ? 'bounded file excerpts' : 'file names and your request'}.
            </p>
            <button type="button" disabled={busy} onClick={() => void actions.grantPermission()}>
              Allow {level}
            </button>
          </div>
        ) : null}
        <Composer
          draft={draft}
          busy={busy}
          running={running}
          allowed={allowed}
          describedBy={error ? errorID : undefined}
          hint={
            !provider
              ? 'Add a model in Settings to send a message.'
              : !allowed
                ? 'You can write a message before allowing data access.'
                : running
                  ? 'Reply in progress. You can write your next message.'
                  : undefined
          }
          onChange={actions.changed}
          onSend={() => void actions.send()}
          onStop={() => void actions.stop()}
        />
      </footer>
    </section>
  );
}
