import { useId } from 'react';
import { chatDraftLimit } from '../../domain/models/chat';
import { DictationButton } from '../speech/DictationButton';

export function Composer({
  draft,
  busy,
  running,
  allowed,
  hint,
  describedBy,
  target = '',
  onChange,
  onSend,
  onStop,
}: {
  draft: string;
  busy: boolean;
  running: boolean;
  allowed: boolean;
  hint?: string;
  describedBy?: string;
  target?: string;
  onChange(text: string): void;
  onSend(): void;
  onStop(): void;
}) {
  const hintID = useId();
  const canSend = !busy && !running && allowed && !!draft.trim();
  return (
    <form
      className="chat-composer"
      aria-label="Chat composer"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <textarea
        aria-label="Chat message"
        aria-describedby={[hintID, describedBy].filter(Boolean).join(' ')}
        placeholder="Ask about these files…"
        rows={3}
        maxLength={chatDraftLimit}
        value={draft}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <div className="chat-composer-actions">
        <p className="chat-composer-hint" id={hintID}>
          {hint ?? 'Command or Control + Enter to send.'}
        </p>
        {running ? (
          <button
            type="button"
            className="button-secondary chat-stop"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="primary"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            disabled={!canSend}
          >
            Send
          </button>
        )}
        <DictationButton
          target={JSON.stringify([target, draft])}
          destination="Chat draft · review before sending"
          maxLength={Math.max(0, chatDraftLimit - draft.length - (draft ? 1 : 0))}
          disabled={busy || running || draft.length >= chatDraftLimit}
          onUse={(text) => onChange((draft ? draft + ' ' : '') + text)}
        />
      </div>
    </form>
  );
}
