import { z } from 'zod';
import { decodeWords, field, parseFields } from './mime';
import { addressList } from './message';
import { mailListLimits } from './formats';

export const mailboxLimits = {
  /** Messages listed; the scan stops after them. */
  messages: mailListLimits.messages,
  /** Bytes of the file scanned for messages. */
  scanBytes: 2_000_000_000,
  /** Bytes of one message's header kept for its row. */
  headerBytes: 16 * 1024,
  /** Characters of a row's sender or subject. */
  rowCharacters: 300,
} as const;

/** One message of a mailbox, opened by its place in the list. */
export const mailboxMessageRequestSchema = z
  .object({
    requestID: z.string().min(1).max(200),
    message: z
      .number()
      .int()
      .min(0)
      .max(mailboxLimits.messages - 1),
  })
  .strict();
export type MailboxMessageRequest = z.input<typeof mailboxMessageRequestSchema>;

export interface MailboxRow {
  date: string;
  time?: number;
  from: string;
  subject: string;
  /** The message's bytes in the file. */
  size: number;
}
export interface Mailbox {
  messages: MailboxRow[];
  /** The scan stopped at its message or byte limit; later messages are not listed. */
  truncated: boolean;
}
/** Where a message lies in the file: from its `From ` line to the next one. */
export interface MailboxSpan {
  start: number;
  end: number;
}

const from = Uint8Array.from('From ', (character) => character.charCodeAt(0));
/** An envelope line's date, as `asctime` writes it: `Mon Jan  5 09:12:00 2026`. */
const envelopeDate = /\d{1,2}:\d{2}(?::\d{2})?\s.*\d{4}/;

/**
 * Finds messages in an mbox file read in order, a chunk at a time, keeping only the start of the
 * header of the message it is in. A message starts at a `From ` line at the start of the file,
 * after a blank line, or one that carries an envelope date, so a body line that starts with `From `
 * stays body.
 */
export class MailboxScanner {
  readonly spans: MailboxSpan[] = [];
  /** The scan reached its message limit; later messages are not listed. */
  stopped = false;
  private offset = 0;
  private lineStart = 0;
  private previousBlank = true;
  /** The start of a line that began in an earlier chunk. */
  private carried: Uint8Array | undefined;
  private header: Uint8Array[] = [];
  private headerSize = 0;
  private headerDone = true;

  constructor(
    private found: (span: MailboxSpan, header: Uint8Array) => void = () => {},
    private limits: { messages: number; headerBytes: number } = mailboxLimits,
  ) {}

  /** Bytes of the file so far; the scanner copies what it keeps. */
  write(chunk: Uint8Array): void {
    let at = 0;
    while (at < chunk.length && !this.stopped) {
      const newline = chunk.indexOf(10, at);
      const stop = newline < 0 ? chunk.length : newline + 1;
      const piece = chunk.subarray(at, stop);
      this.keep(piece);
      this.offset += piece.length;
      at = stop;
      if (newline < 0) {
        // only a line's start says whether it separates messages
        if ((this.carried?.length ?? 0) < 256)
          this.carried = join(this.carried, piece.subarray(0, 256 - (this.carried?.length ?? 0)));
        continue;
      }
      const line = this.carried ? join(this.carried, piece.subarray(0, 256)) : piece;
      this.carried = undefined;
      this.endLine(line);
    }
  }
  /** The last message runs to the end of the file. */
  end(): void {
    this.close(this.offset);
  }

  private keep(piece: Uint8Array): void {
    if (this.headerDone || this.headerSize >= this.limits.headerBytes) return;
    const kept = piece.slice(0, this.limits.headerBytes - this.headerSize);
    this.header.push(kept);
    this.headerSize += kept.length;
  }
  private endLine(line: Uint8Array): void {
    const blank = line.length === 1 || (line.length === 2 && line[0] === 13);
    if (from.every((byte, index) => line[index] === byte) && this.separates(line)) {
      this.close(this.lineStart);
      if (this.spans.length >= this.limits.messages) this.stopped = true;
      else {
        this.spans.push({ start: this.lineStart, end: -1 });
        this.header = [];
        this.headerSize = 0;
        this.headerDone = false;
      }
    } else if (blank) this.headerDone = true;
    this.previousBlank = blank;
    this.lineStart = this.offset;
  }
  private separates(line: Uint8Array): boolean {
    return (
      this.lineStart === 0 ||
      this.previousBlank ||
      envelopeDate.test(String.fromCharCode(...line.subarray(0, 256)))
    );
  }
  private close(end: number): void {
    const span = this.spans.at(-1);
    if (!span || span.end >= 0) return;
    span.end = end;
    const header = join(undefined, ...this.header);
    this.header = [];
    this.headerDone = true;
    this.found(span, header);
  }
}
function join(first: Uint8Array | undefined, ...rest: Uint8Array[]): Uint8Array {
  const parts = first ? [first, ...rest] : rest;
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    output.set(part, at);
    at += part.length;
  }
  return output;
}

/** A mailbox row from a message's header: its date, sender and subject. */
export function mailboxRow(span: MailboxSpan, header: Uint8Array): MailboxRow {
  const fields = parseFields(header);
  const limit = (value: string) => value.slice(0, mailboxLimits.rowCharacters);
  const date = (field(fields, 'date') ?? '').trim();
  const time = date ? Date.parse(date.replace(/\s*\([^)]*\)\s*$/, '')) : NaN;
  return {
    date: limit(date),
    time: Number.isFinite(time) ? time : undefined,
    from: limit(addressList(field(fields, 'from'))),
    subject: limit(
      decodeWords(field(fields, 'subject') ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
    size: span.end - span.start,
  };
}

/** A message as stored in a mailbox, without its `From ` line, and with the `>` that quotes a
 * body line starting `From ` removed. */
export function mailboxMessage(bytes: Uint8Array): Uint8Array {
  const first = bytes.indexOf(10);
  const body = first < 0 ? new Uint8Array() : bytes.subarray(first + 1);
  const output = new Uint8Array(body.length);
  let size = 0;
  for (let at = 0; at < body.length;) {
    const end = body.indexOf(10, at);
    const stop = end < 0 ? body.length : end + 1;
    let start = at;
    if (body[at] === 62) {
      let quotes = at;
      while (body[quotes] === 62) quotes++;
      if (from.every((byte, index) => body[quotes + index] === byte)) start = at + 1;
    }
    output.set(body.subarray(start, stop), size);
    size += stop - start;
    at = stop;
  }
  return output.subarray(0, size);
}
