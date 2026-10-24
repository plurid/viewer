import { memo, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../domain/models/chat';
import { messageAuthor } from './presentation';

const followDistance = 40;

/** Attribution belongs to the message; changing the next model never relabels old answers. */
export const Transcript = memo(function Transcript({
  messages,
  running,
  onReview,
}: {
  messages: readonly ChatMessage[];
  running: boolean;
  onReview(proposal: NonNullable<ChatMessage['proposal']>): void;
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (transcript.current && follow.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length]);
  return (
    <div
      className="chat-transcript"
      ref={transcript}
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      onScroll={(event) => {
        const element = event.currentTarget;
        follow.current =
          element.scrollHeight - element.clientHeight - element.scrollTop <= followDistance;
      }}
    >
      {!messages.length && (
        <p className="muted">
          Ask about the attached files. Proposed changes appear for your review.
        </p>
      )}
      {messages.map((message) =>
        message.role === 'tool' ? (
          <details className="chat-tool" key={message.id}>
            <summary>Inspected context</summary>
            <pre>{message.text}</pre>
          </details>
        ) : (
          <article
            className="chat-message"
            data-role={message.role}
            data-model={message.provider?.model}
            key={message.id}
          >
            <strong title={message.provider?.model}>{messageAuthor(message)}</strong>
            <p>{message.text}</p>
            {message.proposal && (
              <button onClick={() => onReview(message.proposal!)}>Review proposal</button>
            )}
          </article>
        ),
      )}
      {running && <p role="status">Inspecting context…</p>}
    </div>
  );
});
