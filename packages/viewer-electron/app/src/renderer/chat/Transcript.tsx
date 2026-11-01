import { chatSelection } from './selection';
import type { ChatSelection } from './selection';
import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../domain/models/chat';
import type { ChatPane } from '../../domain/contracts';
import { messageAuthor } from './presentation';
import { Disclosure } from '../ui/Disclosure';

const followDistance = 40;

/** Attribution belongs to the message; changing the next model never relabels old answers. */
export const Transcript = memo(function Transcript({
  messages,
  running,
  onReview,
  onOpen,
  onQuote,
  focusMessage,
}: {
  messages: readonly ChatMessage[];
  running: boolean;
  onReview(proposal: NonNullable<ChatMessage['proposal']>): void;
  onOpen?(path: string): void;
  onQuote?(selection: ChatSelection): void;
  focusMessage?: ChatPane['focusMessage'];
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const focused = useRef<ChatPane['focusMessage']>(undefined);
  const [selection, setSelection] = useState<ChatSelection>();
  useEffect(() => {
    if (transcript.current && follow.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length, running]);
  useEffect(() => {
    if (!focusMessage || focused.current === focusMessage) return;
    const node = transcript.current?.querySelector<HTMLElement>(
      `[data-chat-text="${CSS.escape(focusMessage.id)}"]`,
    );
    const text = node?.firstChild;
    if (
      !node ||
      !text ||
      text.nodeType !== Node.TEXT_NODE ||
      focusMessage.end > (text.textContent?.length ?? 0)
    )
      return;
    focused.current = focusMessage;
    follow.current = false;
    node.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(text, focusMessage.start);
    range.setEnd(text, focusMessage.end);
    const selected = window.getSelection();
    selected?.removeAllRanges();
    selected?.addRange(range);
  }, [focusMessage, messages]);
  return (
    <div
      className="chat-transcript"
      ref={transcript}
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      aria-relevant="additions text"
      tabIndex={0}
      onMouseUp={() => setSelection(chatSelection(transcript.current!, window.getSelection()))}
      onKeyUp={() => setSelection(chatSelection(transcript.current!, window.getSelection()))}
      onScroll={(event) => {
        const element = event.currentTarget;
        follow.current =
          element.scrollHeight - element.clientHeight - element.scrollTop <= followDistance;
      }}
    >
      {selection && onQuote && (
        <button
          className="chat-quote-action"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onQuote(selection);
            setSelection(undefined);
          }}
        >
          Ask about selection
        </button>
      )}
      {!messages.length && !running && (
        <div className="chat-empty">
          <strong>Ask about your files</strong>
          <p>Ask about the attached files. Proposed changes appear for your review.</p>
        </div>
      )}
      {messages.map((message) =>
        message.role === 'tool' ? (
          <Disclosure
            variant="compact"
            className="chat-tool"
            key={message.id}
            summary="Inspected context"
          >
            <pre>{message.text}</pre>
            {message.links?.map((link) => (
              <button key={link.path} onClick={() => onOpen?.(link.path)}>
                Open current file: {link.path.split('/').at(-1)}
              </button>
            ))}
          </Disclosure>
        ) : (
          <article
            className="chat-message"
            data-role={message.role}
            data-model={message.provider?.model}
            key={message.id}
          >
            <strong title={message.provider?.model}>{messageAuthor(message)}</strong>
            <p data-chat-text={message.id}>{message.text}</p>
            {onQuote && !!message.text.length && (
              <button
                aria-label="Branch from this message"
                onClick={() =>
                  onQuote({
                    messageID: message.id,
                    start: 0,
                    end: Math.min(message.text.length, 16000),
                  })
                }
              >
                Ask about this…
              </button>
            )}
            {!!message.links?.length && (
              <ul className="chat-files" aria-label="Files to open">
                {message.links.map((link) => (
                  <li key={link.path}>
                    <button type="button" title={link.path} onClick={() => onOpen?.(link.path)}>
                      {link.path.split('/').at(-1)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
