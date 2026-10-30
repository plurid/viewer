import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { DocumentData } from '../../../domain/services';
import type { MailAttachment, MailMessage } from '../../../domain/previews/mail/message';
import type { Mailbox } from '../../../domain/previews/mail/mailbox';
import type { AttachmentDestination, PreviewContext } from '../contracts';
import { formatBytes } from '../../../domain/files/entries';
import { mailboxLimits } from '../../../domain/previews/mail/mailbox';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { usePreviewState } from '../state';
import { useOfficeDocument } from '../useOfficeDocument';
import { useHtmlPreview } from '../web/useHtmlPreview';
import { Empty, Loading } from '../../ui/primitives';
import { report } from '../../state/store';
import './mail.css';

type MailView = 'html' | 'text';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shownDate = (date: string, time?: number) =>
  time === undefined ? date : dateTime.format(time);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The message's HTML body, served from its own parts with no scripts and nothing remote. */
function MessageFrame({ context, message }: { context: PreviewContext; message?: number }) {
  const capability = useHtmlPreview(context, 0, message);
  if (capability.status === 'loading') return <Loading label="Opening message…" />;
  if (capability.status === 'closed') return null;
  if (capability.status === 'error')
    return (
      <Empty icon="warning" title="The message could not be shown" detail={capability.message} />
    );
  return (
    <>
      {!!capability.preview.blocked && (
        <p className="inline-warning" role="status">
          Remote images are blocked.
        </p>
      )}
      <iframe
        key={capability.preview.id}
        className="html-preview-frame mail-frame"
        title="Message body"
        src={capability.preview.url}
        sandbox=""
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        tabIndex={context.interactive ? 0 : -1}
        style={{ pointerEvents: context.interactive ? 'auto' : 'none' }}
      />
    </>
  );
}

/** A message's attachments, each saved beside the message or to a folder chosen, where the host
 * can save them; all at once when there are several. `index` is the message's place in a mailbox. */
function Attachments({
  context,
  attachments,
  index,
}: {
  context: PreviewContext;
  attachments: readonly MailAttachment[];
  index?: number;
}) {
  const [saving, setSaving] = useState(false);
  const save = context.saveAttachments;
  const run = (parts: readonly number[], destination: AttachmentDestination) => {
    if (!save) return;
    setSaving(true);
    void save({
      message: index,
      attachments: parts.map((part) => ({ part, name: attachments[part]!.name })),
      destination,
    })
      .catch(report)
      .finally(() => setSaving(false));
  };
  const all = attachments.map((_attachment, part) => part);
  return (
    <section className="mail-attachments" aria-label="Attachments">
      <ul>
        {attachments.map((attachment, part) => (
          <li key={part} title={attachment.name}>
            <span className="mail-attachment-name">{attachment.name}</span>
            <span className="muted">
              {attachment.type} · {formatBytes(attachment.size)}
            </span>
            {save && (
              <span className="mail-attachment-actions">
                <button
                  type="button"
                  disabled={saving}
                  aria-label={`Save ${attachment.name}`}
                  onClick={() => run([part], 'beside')}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={saving}
                  aria-label={`Save ${attachment.name} to…`}
                  onClick={() => run([part], 'choose')}
                >
                  Save to…
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {save && attachments.length > 1 && (
        <div className="mail-attachments-all">
          <button type="button" disabled={saving} onClick={() => run(all, 'beside')}>
            Save All
          </button>
          <button type="button" disabled={saving} onClick={() => run(all, 'choose')}>
            Save All to…
          </button>
        </div>
      )}
    </section>
  );
}

/** One message: its header, attachments and body. `index` is its place in a mailbox. */
function MessageView({
  context,
  mail,
  index,
}: {
  context: PreviewContext;
  mail: MailMessage;
  index?: number;
}) {
  const [view, setView] = usePreviewState<MailView>(context, 'mail.view', 'html');
  const html = mail.html && (view === 'html' || mail.text === undefined);
  const save = context.saveAttachments;
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'mail-view',
          label: html ? 'Show plain text' : 'Show HTML message',
          available: mail.html && mail.text !== undefined,
          run: () => setView(html ? 'text' : 'html'),
        },
        {
          id: 'mail-save-attachments',
          label: mail.attachments.length === 1 ? 'Save attachment' : 'Save all attachments',
          aliases: ['attachments', 'save attachments'],
          available: !!save && mail.attachments.length > 0,
          run: () =>
            save?.({
              message: index,
              attachments: mail.attachments.map(({ name }, part) => ({ part, name })),
              destination: 'beside',
            }),
        },
      ],
      [html, mail.html, mail.text, mail.attachments, setView, save, index],
    ),
  );
  return (
    <article className="mail-message" aria-label={mail.subject || 'Message'}>
      <header className="mail-header">
        <h2 className="mail-subject">{mail.subject || 'No subject'}</h2>
        <dl className="card-fields">
          {mail.from && <Field label="From">{mail.from}</Field>}
          {mail.to && <Field label="To">{mail.to}</Field>}
          {mail.cc && <Field label="Cc">{mail.cc}</Field>}
          {mail.date && <Field label="Date">{shownDate(mail.date, mail.time)}</Field>}
        </dl>
        {mail.attachments.length > 0 && (
          <Attachments context={context} attachments={mail.attachments} index={index} />
        )}
        {mail.html && mail.text !== undefined && (
          <div className="html-preview-tabs" role="group" aria-label="Message view">
            <button type="button" aria-pressed={html} onClick={() => setView('html')}>
              HTML
            </button>
            <button type="button" aria-pressed={!html} onClick={() => setView('text')}>
              Plain text
            </button>
          </div>
        )}
      </header>
      {html ? (
        <MessageFrame context={context} message={index} />
      ) : (
        <pre className="mail-text" tabIndex={0}>
          {mail.text ?? ''}
        </pre>
      )}
      {mail.limited && (
        <p className="inline-warning">Parts of this message are past the reading limits.</p>
      )}
    </article>
  );
}

/** One message of a mailbox, read on its own when it is chosen. */
function useMailboxMessage(context: PreviewContext, message: number | undefined) {
  const { services, resource, signal } = context;
  const [result, setResult] = useState<{ key: string; data?: DocumentData; error?: string }>();
  const key = `${resource.id}:${message}`;
  useEffect(() => {
    if (message === undefined || signal.aborted) return;
    const requestID = crypto.randomUUID();
    let alive = true;
    services.document(resource.id, { requestID, message }).then(
      (data) => {
        if (alive && !signal.aborted) setResult({ key, data });
      },
      (error: Error) => {
        if (alive && !signal.aborted) setResult({ key, error: error.message });
      },
    );
    return () => {
      alive = false;
      void services.cancelDocument(resource.id, requestID).catch(() => {});
    };
  }, [services, resource.id, signal, key, message]);
  return result?.key === key ? result : undefined;
}

function MailboxView({ context, mailbox }: { context: PreviewContext; mailbox: Mailbox }) {
  const [chosen, setChosen] = usePreviewState(context, 'mail.message', 0);
  const count = mailbox.messages.length;
  const index = Math.max(0, Math.min(chosen, count - 1));
  const message = useMailboxMessage(context, count ? index : undefined);
  const list = useRef<HTMLOListElement>(null);
  const choose = (next: number) => {
    const position = Math.max(0, Math.min(next, count - 1));
    setChosen(position);
    list.current?.querySelectorAll<HTMLButtonElement>('button')[position]?.focus();
  };
  const keydown = (event: KeyboardEvent<HTMLOListElement>) => {
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    choose(next);
  };
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'mail-next',
          label: 'Next message',
          available: index < count - 1,
          run: () => setChosen(index + 1),
        },
        {
          id: 'mail-previous',
          label: 'Previous message',
          available: index > 0,
          run: () => setChosen(index - 1),
        },
      ],
      [index, count, setChosen],
    ),
  );
  if (!count)
    return (
      <Empty
        icon="mail"
        title="This mailbox has no messages"
        detail="No message starts with a From line."
      />
    );
  return (
    <div className="mailbox">
      <PreviewToolbar context={context}>
        <span className="muted tabular">
          {(index + 1).toLocaleString()} / {count.toLocaleString()}
          {mailbox.truncated ? '+' : ''}
        </span>
      </PreviewToolbar>
      <div className="mailbox-layout">
        <ol ref={list} className="mailbox-messages" aria-label="Messages" onKeyDown={keydown}>
          {mailbox.messages.map((row, position) => (
            <li key={position}>
              <button
                type="button"
                aria-current={position === index}
                tabIndex={position === index ? 0 : -1}
                onClick={() => choose(position)}
              >
                <span className="mailbox-from">{row.from || 'Unknown sender'}</span>
                <span className="muted tabular">{shownDate(row.date, row.time)}</span>
                <span className="mailbox-subject">{row.subject || 'No subject'}</span>
              </button>
            </li>
          ))}
          {mailbox.truncated && (
            <li className="muted mail-notice">
              The first {mailboxLimits.messages.toLocaleString()} messages are listed.
            </li>
          )}
        </ol>
        <div className="mailbox-message">
          {!message ? (
            <Loading label="Reading message…" />
          ) : message.error ? (
            <Empty icon="warning" title="This message could not be read" detail={message.error} />
          ) : message.data?.mail ? (
            <MessageView key={index} context={context} mail={message.data.mail} index={index} />
          ) : (
            <Empty icon="warning" title="This message could not be read" />
          )}
        </div>
      </div>
    </div>
  );
}

/** An email message, Apple Mail's `.emlx`, or a mailbox's messages. */
export default function MailPreview(context: PreviewContext) {
  const { document, error, retry } = useOfficeDocument(context);
  if (error)
    return (
      <Empty icon="warning" title="This email could not be read" detail={error}>
        <button onClick={context.retry ?? retry}>Try again</button>
      </Empty>
    );
  if (!document) return <Loading label="Reading email…" />;
  if (document.mailbox) return <MailboxView context={context} mailbox={document.mailbox} />;
  if (document.mail)
    return (
      <div className="mail-single">
        <MessageView context={context} mail={document.mail} />
      </div>
    );
  return <Empty icon="warning" title="This file holds no email message" />;
}
