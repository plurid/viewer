export function Composer({
  draft,
  busy,
  running,
  allowed,
  onChange,
  onSend,
  onStop,
}: {
  draft: string;
  busy: boolean;
  running: boolean;
  allowed: boolean;
  onChange(text: string): void;
  onSend(): void;
  onStop(): void;
}) {
  const canSend = !busy && !running && allowed && !!draft.trim();
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <textarea
        aria-label="Chat message"
        placeholder="Ask about these files…"
        maxLength={chatDraftLimit}
        value={draft}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      {running ? (
        <button type="button" disabled={busy} onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" className="primary" disabled={!canSend}>
          Send
        </button>
      )}
    </form>
  );
}
import { chatDraftLimit } from '../../domain/models/chat';
