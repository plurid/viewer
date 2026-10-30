import type { MimePart } from './mime';
import type { SavedPage, SavedPagePart } from '../saved-page';
import {
  decodeText,
  decodeTransfer,
  decodeWords,
  field,
  parseMime,
  partName,
  partText,
  splitOutside,
  transferSize,
} from './mime';
import { escapeHtml, partExtension, rewritePage, savedPageLimits } from '../saved-page';

export const mailLimits = {
  /** One message, a file or a mailbox's. */
  messageBytes: 64 * 1024 * 1024,
  /** Plain text shown, in characters. */
  textCharacters: 1_000_000,
  attachments: 500,
  /** A header value shown, in characters. */
  fieldCharacters: 4000,
} as const;

export interface MailAttachment {
  name: string;
  type: string;
  /** Decoded bytes. */
  size: number;
}
export interface MailMessage {
  subject: string;
  from: string;
  to: string;
  cc: string;
  /** The Date header as written. */
  date: string;
  /** The Date header as milliseconds since 1970, when it reads as a time. */
  time?: number;
  /** The plain text body. */
  text?: string;
  /** The message has an HTML body, which Viewer shows as a page of its own. */
  html: boolean;
  attachments: MailAttachment[];
  /** Parts, text or attachments past the reader's limits were left out. */
  limited: boolean;
}

/** An Apple Mail `.emlx` file: a line with the message's length in bytes, the message, then a
 * property list of Mail's flags, which is not read. */
export function emlxMessage(bytes: Uint8Array): Uint8Array {
  const end = bytes.indexOf(10);
  const length = end > 0 ? Number(new TextDecoder().decode(bytes.subarray(0, end)).trim()) : NaN;
  if (!Number.isSafeInteger(length) || length < 0)
    throw new Error('This file does not start with an Apple Mail message length.');
  return bytes.subarray(end + 1, Math.min(bytes.length, end + 1 + length));
}

const shown = (value: string | undefined) =>
  decodeWords(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, mailLimits.fieldCharacters);
/** An address list as people read it: display names unquoted, one comma between addresses. */
export function addressList(value: string | undefined): string {
  return splitOutside(shown(value), ',')
    .map((address) =>
      address
        .trim()
        .replace(/^"((?:[^"\\]|\\.)*)"(?=\s*<)/, (_all, name: string) =>
          name.replace(/\\(.)/g, '$1'),
        ),
    )
    .filter(Boolean)
    .join(', ');
}

const disposed = (part: MimePart) => part.disposition === 'attachment';
const isText = (part: MimePart) => part.type === 'text/plain' || part.type === 'text/html';
interface Bodies {
  texts: MimePart[];
  htmls: MimePart[];
  attachments: MimePart[];
  /** Parts an HTML body may show: related resources, by Content-ID and location. */
  related: MimePart[];
}
/** The parts that make the message: its text and HTML bodies, the resources an HTML body shows,
 * and its attachments. Of an alternative's forms the first plain text and the last, richest, HTML
 * are its bodies. */
function bodies(root: MimePart): Bodies {
  const found: Bodies = { texts: [], htmls: [], attachments: [], related: [] };
  const visit = (part: MimePart, body: boolean) => {
    if (part.type.startsWith('multipart/') && part.children.length) {
      if (part.type === 'multipart/alternative') {
        const texts = found.texts.length,
          htmls = found.htmls.length;
        for (const child of part.children) visit(child, body);
        found.texts.splice(texts + 1);
        found.htmls.splice(htmls, Math.max(0, found.htmls.length - htmls - 1));
        return;
      }
      if (part.type === 'multipart/related') {
        const start = part.parameters.start?.replace(/^<|>$/g, '');
        const root =
          part.children.find((child) => start && child.id === start) ?? part.children[0]!;
        visit(root, body);
        for (const child of part.children)
          if (child !== root) {
            if (disposed(child)) found.attachments.push(child);
            else found.related.push(child);
          }
        return;
      }
      // mixed and others: the first part is the body; later inline text continues it
      part.children.forEach((child, index) =>
        visit(child, body && (index === 0 || (isText(child) && !partName(child)))),
      );
      return;
    }
    if (body && isText(part) && !disposed(part)) {
      (part.type === 'text/html' ? found.htmls : found.texts).push(part);
      return;
    }
    found.attachments.push(part);
  };
  visit(root, true);
  return found;
}

const extensionNames: Readonly<Record<string, string>> = {
  'message/rfc822': 'eml',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/calendar': 'ics',
  'application/pdf': 'pdf',
};
/** The name an attachment is listed by; one without a name takes its subject or kind. */
function attachmentName(part: MimePart, index: number): string {
  const name = partName(part);
  if (name) return name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  if (part.type === 'message/rfc822') {
    const subject = /^subject:(.*)$/im.exec(
      decodeText(part.body.subarray(0, 64 * 1024)).replace(/\r?\n[ \t]+/g, ' '),
    );
    if (subject?.[1]?.trim()) return shown(subject[1]).slice(0, 200) + '.eml';
  }
  const extension = extensionNames[part.type] ?? partExtension(part.type) ?? 'bin';
  return `Attachment ${index + 1}.${extension}`;
}

/** What a message's preview shows: its header, plain text, whether it has HTML, and its
 * attachments with their decoded sizes. */
export function readMessage(bytes: Uint8Array): MailMessage {
  const { root, limited } = parseMime(bytes);
  const found = bodies(root);
  const date = shown(field(root.fields, 'date'));
  const time = date ? Date.parse(date.replace(/\s*\([^)]*\)\s*$/, '')) : NaN;
  let text: string | undefined;
  if (found.texts.length) {
    text = found.texts.map(plainText).join('\n\n').replace(/\s+$/, '');
    if (text.length > mailLimits.textCharacters) text = text.slice(0, mailLimits.textCharacters);
  }
  const attachments = found.attachments.slice(0, mailLimits.attachments).map((part, index) => ({
    name: attachmentName(part, index),
    type: part.type,
    size: transferSize(part.body, part.encoding),
  }));
  return {
    subject: shown(field(root.fields, 'subject')),
    from: addressList(field(root.fields, 'from')),
    to: addressList(field(root.fields, 'to')),
    cc: addressList(field(root.fields, 'cc')),
    date,
    time: Number.isFinite(time) ? time : undefined,
    text,
    html: found.htmls.length > 0,
    attachments,
    limited:
      limited ||
      found.attachments.length > mailLimits.attachments ||
      (text?.length ?? 0) >= mailLimits.textCharacters,
  };
}

/** Plain text as written; `format=flowed` lines are joined where their writer wrapped them. */
function plainText(part: MimePart): string {
  const text = partText(part);
  if (part.parameters.format?.toLowerCase() !== 'flowed') return text;
  const deleteSpace = part.parameters.delsp?.toLowerCase() === 'yes';
  const lines: string[] = [];
  let joining = false;
  for (let line of text.split('\n')) {
    if (line.startsWith(' ')) line = line.slice(1);
    const soft = line.endsWith(' ') && line !== '-- ';
    const content = soft && deleteSpace ? line.slice(0, -1) : line;
    if (joining) lines[lines.length - 1] += content;
    else lines.push(content);
    joining = soft;
  }
  return lines.join('\n');
}

/** A short text for search and the index: the plain body, or the HTML body without its markup. */
export function messageText(bytes: Uint8Array): string {
  const { root } = parseMime(bytes);
  const found = bodies(root);
  if (found.texts.length) return found.texts.map(plainText).join('\n\n');
  return found.htmls
    .map((part) =>
      partText(part)
        .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/[ \t]+/g, ' '),
    )
    .join('\n\n');
}

/**
 * The message's HTML body as a page: images it names by Content-ID or location come from the
 * message's own parts, every other resource is removed and counted as blocked. A message without
 * HTML shows its plain text.
 */
export function messagePage(bytes: Uint8Array): SavedPage {
  const { root } = parseMime(bytes);
  const found = bodies(root);
  if (!found.htmls.length) {
    const text = found.texts.map(plainText).join('\n\n');
    return {
      html: `<!doctype html><meta charset="utf-8"><pre style="white-space:pre-wrap">${escapeHtml(text.slice(0, mailLimits.textCharacters))}</pre>`,
      parts: [],
      blocked: 0,
    };
  }
  const source = found.htmls.map(partText).join('\n');
  if (source.length > savedPageLimits.htmlBytes)
    throw new Error('The HTML body of this message exceeds 4 MB.');
  const byID = new Map<string, MimePart>();
  const byLocation = new Map<string, MimePart>();
  for (const part of [...found.related, ...found.attachments]) {
    if (part.id && !byID.has(part.id)) byID.set(part.id, part);
    if (part.location && !byLocation.has(part.location)) byLocation.set(part.location, part);
  }
  const parts: SavedPagePart[] = [];
  const served = new Map<MimePart, string>();
  let total = 0;
  const serve = (part: MimePart | undefined) => {
    if (!part) return undefined;
    const known = served.get(part);
    if (known) return known;
    const extension = partExtension(part.type);
    if (!extension || extension === 'css' || parts.length >= savedPageLimits.parts)
      return undefined;
    const data = decodeTransfer(part.body, part.encoding);
    if (data.length > savedPageLimits.partBytes || total + data.length > savedPageLimits.pageBytes)
      return undefined;
    total += data.length;
    const path = `parts/${parts.length + 1}.${extension}`;
    parts.push({ path, type: part.type, data });
    served.set(part, path);
    return path;
  };
  const page = rewritePage(source, (reference, kind) => {
    if (kind === 'navigation') return undefined;
    if (/^cid:/i.test(reference)) {
      let id = reference.slice(4);
      try {
        id = decodeURIComponent(id);
      } catch {
        // an ID with a bare percent sign is used as written
      }
      return serve(byID.get(id.replace(/^<|>$/g, '')));
    }
    return serve(byLocation.get(reference));
  });
  return { html: page.html, parts, blocked: page.blocked };
}
