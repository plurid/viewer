import { memo, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../domain/models/chat';
import { messageAuthor } from './presentation';

const followDistance = 40;

/** Attribution belongs to the message; changing the next model never relabels old answers. */
export const Transcript = memo(function Transcript({
  messages,
  running,
  onReview,
  onOpen,
}: {
  messages: readonly ChatMessage[];
  running: boolean;
  onReview(proposal: NonNullable<ChatMessage['proposal']>): void;
  onOpen?(path: string): void;
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (transcript.current && follow.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length, running]);
  return (
    <div
      className="chat-transcript"
      ref={transcript}
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      aria-relevant="additions text"
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        follow.current =
          element.scrollHeight - element.clientHeight - element.scrollTop <= followDistance;
      }}
    >
      {!messages.length && !running && (
        <div className="chat-empty">
          <strong>Ask about your files</strong>
          <p>Ask about the attached files. Proposed changes appear for your review.</p>
        </div>
      )}
      {messages.map((message) =>
        message.role === 'tool' ? (
          <details className="chat-tool" key={message.id}>
            <summary>Inspected context</summary>
            <pre>{message.text}</pre>
            {message.links?.map((link) => (
              <button key={link.path} onClick={() => onOpen?.(link.path)}>
                Open current file: {link.path.split('/').at(-1)}
              </button>
            ))}
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
              <button type="button" onClick={() => onReview(message.proposal!)}>
                Review proposal
              </button>
            )}
          </article>
        ),
      )}
      {running && (
        <p className="chat-running" role="status">
          Reply in progress…
        </p>
      )}
    </div>
  );
});
