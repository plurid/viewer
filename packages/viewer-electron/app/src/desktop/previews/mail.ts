import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { DocumentData } from '../../domain/services';
import type { MailboxRow, MailboxSpan } from '../../domain/previews/mail/mailbox';
import type { SavedPage } from '../../domain/previews/saved-page';
import { fileCoordination } from '../files/file-coordination';
import { documentBytes } from './formats';
import {
  emlxMessage,
  mailLimits,
  messagePage,
  messageText,
  readMessage,
} from '../../domain/previews/mail/message';
import {
  MailboxScanner,
  mailboxLimits,
  mailboxMessage,
  mailboxRow,
} from '../../domain/previews/mail/mailbox';

const chunkBytes = 1024 * 1024;
/** Where the messages of recently listed mailboxes lie, by file version: opening one reads only
 * its own bytes. */
const scanned = new Map<string, MailboxSpan[]>();

/** Caller must hold a read coordination claim for this file. */
async function openMailbox(file: string) {
  const handle = await open(
    fileCoordination.path(file),
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
  );
  const info = await handle.stat().catch(async (error: unknown) => {
    await handle.close();
    throw error;
  });
  if (!info.isFile()) {
    await handle.close();
    throw new Error('This mailbox is not a regular file.');
  }
  return { handle, size: info.size, version: mailboxVersion(file, info) };
}
/** The key of a mailbox's scanned messages. */
const mailboxVersion = (file: string, info: Stats) =>
  JSON.stringify([file, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
const messageTooLarge = 'This message is larger than 64 MB.';

/** Reads the mailbox from its start, a chunk at a time, until `until` is located or a limit
 * reached; only each message's first header bytes are kept. */
async function scan(
  handle: FileHandle,
  size: number,
  signal: AbortSignal | undefined,
  until?: number,
): Promise<{ rows: MailboxRow[]; spans: MailboxSpan[]; truncated: boolean }> {
  const rows: MailboxRow[] = [];
  const scanner = new MailboxScanner((span, header) => rows.push(mailboxRow(span, header)));
  const buffer = Buffer.allocUnsafe(chunkBytes);
  const limit = Math.min(size, mailboxLimits.scanBytes);
  let position = 0;
  while (position < limit && !scanner.stopped) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(chunkBytes, limit - position),
      position,
    );
    if (!bytesRead) break;
    scanner.write(buffer.subarray(0, bytesRead));
    position += bytesRead;
    // a message's end is known once the next one starts
    if (until !== undefined && scanner.spans.length > until + 1)
      return { rows, spans: scanner.spans, truncated: false };
  }
  scanner.end();
  if (position < size && !scanner.stopped) {
    // the scan stopped inside the last message it found
    scanner.spans.pop();
    rows.pop();
  }
  return {
    rows,
    spans: scanner.spans,
    truncated: scanner.stopped || position < size,
  };
}

/** One message of an open mailbox, from where a scan found it. */
async function mailboxMessageAt(
  handle: FileHandle,
  size: number,
  version: string,
  message: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const spans = scanned.get(version) ?? (await scan(handle, size, signal, message)).spans;
  const span = spans[message];
  if (!span || span.end < 0) throw new Error('This message is no longer in the mailbox.');
  const length = span.end - span.start;
  if (length > mailLimits.messageBytes) throw new Error(messageTooLarge);
  const bytes = Buffer.alloc(length);
  const { bytesRead } = await handle.read(bytes, 0, length, span.start);
  if (bytesRead !== length || !bytes.subarray(0, 5).equals(Buffer.from('From ')))
    throw new Error('The mailbox changed while it was read. Open it again.');
  return mailboxMessage(bytes);
}
/** One message of a mailbox, from where a scan found it. */
async function mailboxBytes(
  file: string,
  message: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const { handle, size, version } = await openMailbox(file);
  try {
    return await mailboxMessageAt(handle, size, version, message, signal);
  } finally {
    await handle.close();
  }
}

/** The RFC 822 bytes of a message file, or of a mailbox's message. Caller must hold a read
 * coordination claim for this file. */
async function messageBytes(
  file: string,
  format: string,
  message: number | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (format === 'mbox') {
    if (message === undefined) throw new Error('Choose a message of this mailbox.');
    return mailboxBytes(file, message, signal);
  }
  const bytes = await documentBytes(file, mailLimits.messageBytes);
  return format === 'emlx' ? emlxMessage(bytes) : bytes;
}

/**
 * The RFC 822 bytes of an open message file, or of one message of an open mailbox: what a saved
 * attachment is read from. The caller holds a read coordination claim for `file`, owns the handle,
 * and checks the file's version once it has what it needs.
 */
export async function openedMessageBytes(
  file: string,
  handle: FileHandle,
  format: string,
  message: number | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const info = await handle.stat();
  if (!info.isFile()) throw new Error('This message is not a regular file.');
  if (format === 'mbox') {
    if (message === undefined) throw new Error('Choose a message of this mailbox.');
    return mailboxMessageAt(handle, info.size, mailboxVersion(file, info), message, signal);
  }
  if (message !== undefined) throw new Error('This file holds one message, not a mailbox.');
  if (info.size > mailLimits.messageBytes) throw new Error(messageTooLarge);
  const bytes = new Uint8Array(info.size);
  for (let offset = 0; offset < bytes.length;) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) throw new Error('The message changed while it was read. Open it again.');
    offset += bytesRead;
  }
  return format === 'emlx' ? emlxMessage(bytes) : bytes;
}

/** A message's header, text and attachments, or a mailbox's list of messages. */
export async function extractMail(
  file: string,
  format: string,
  signal?: AbortSignal,
  message?: number,
): Promise<DocumentData> {
  const result: DocumentData = {
    path: file,
    metadata: {},
    evidence: [],
    text: '',
    truncated: false,
  };
  if (format === 'mbox' && message === undefined) {
    const { handle, size, version } = await openMailbox(file);
    try {
      const listed = await scan(handle, size, signal);
      if (scanned.size >= 4) scanned.delete(scanned.keys().next().value!);
      scanned.set(version, listed.spans);
      result.mailbox = { messages: listed.rows, truncated: listed.truncated };
      result.truncated = listed.truncated;
      result.metadata.messages = String(listed.rows.length);
      for (const row of listed.rows.slice(0, 2000))
        result.evidence.push({ source: 'message', text: [row.subject, row.from].join('\n') });
    } finally {
      await handle.close();
    }
  } else {
    const bytes = await messageBytes(file, format, message, signal);
    const mail = readMessage(bytes);
    result.mail = mail;
    result.truncated = mail.limited;
    for (const key of ['subject', 'from', 'to', 'date'] as const)
      if (mail[key]) result.metadata[key] = mail[key];
    result.evidence.push({
      source: 'message',
      text: [mail.subject, mail.from, messageText(bytes)].join('\n').slice(0, 150_000),
    });
  }
  result.text = result.evidence
    .map((item) => '[' + item.source + ']\n' + item.text)
    .join('\n\n')
    .slice(0, 150_000);
  return result;
}

/** A message's HTML body and the images it shows. Caller must hold a read coordination claim. */
export async function mailPage(
  file: string,
  format: string,
  message: number | undefined,
  signal?: AbortSignal,
): Promise<SavedPage> {
  return messagePage(await messageBytes(file, format, message, signal));
}
