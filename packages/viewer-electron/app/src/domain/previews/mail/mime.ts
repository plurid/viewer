/**
 * Internet messages read for preview (RFC 5322 and MIME): header fields, encoded words, parameters,
 * transfer encodings and the part tree. Bodies stay byte ranges of the message until a view
 * decodes the few it shows.
 */

export const mimeLimits = {
  /** One entity's header block. */
  headerBytes: 256 * 1024,
  /** Fields in one header block. */
  fields: 1000,
  /** Parts in one message, multipart containers included. */
  parts: 1000,
  /** Nested multiparts. */
  depth: 16,
} as const;

export interface MimeField {
  /** Lowercase. */
  name: string;
  /** Unfolded, not yet decoded. */
  value: string;
}
export interface MimePart {
  fields: MimeField[];
  /** Lowercase `type/subtype`. */
  type: string;
  parameters: Readonly<Record<string, string>>;
  disposition: string;
  dispositionParameters: Readonly<Record<string, string>>;
  /** Lowercase Content-Transfer-Encoding. */
  encoding: string;
  /** Content-ID without its angle brackets. */
  id?: string;
  location?: string;
  /** Still transfer-encoded. */
  body: Uint8Array;
  children: MimePart[];
}
export interface MimeMessage {
  root: MimePart;
  /** Parts or nesting past the reader's limits were left out. */
  limited: boolean;
}

const LF = 10,
  CR = 13;
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

/** Where `needle` starts in `bytes` at or after `from`, or -1. */
export function indexOfBytes(bytes: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  if (first === undefined) return from;
  for (let at = bytes.indexOf(first, from); at >= 0; at = bytes.indexOf(first, at + 1)) {
    if (at + needle.length > bytes.length) return -1;
    let index = 1;
    while (index < needle.length && bytes[at + index] === needle[index]) index++;
    if (index === needle.length) return at;
  }
  return -1;
}

const decoders = new Map<string, TextDecoder | null>();
function decoderFor(charset: string): TextDecoder | undefined {
  const label = charset.trim().toLowerCase();
  if (!decoders.has(label)) {
    let decoder: TextDecoder | null = null;
    try {
      decoder = new TextDecoder(label);
    } catch {
      // a label TextDecoder does not know, such as UTF-7
    }
    if (decoders.size < 64) decoders.set(label, decoder);
    return decoder ?? undefined;
  }
  return decoders.get(label) ?? undefined;
}
/** Text in `charset`; without one, or with one TextDecoder does not know, UTF-8 when the bytes are
 * valid UTF-8 and Windows-1252 otherwise. */
export function decodeText(bytes: Uint8Array, charset?: string): string {
  const named = charset && decoderFor(charset);
  if (named) return named.decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const base64Values = (() => {
  const table = new Int8Array(256).fill(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let index = 0; index < alphabet.length; index++) table[alphabet.charCodeAt(index)] = index;
  // the URL-safe alphabet, which some writers use
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();
/** Base64 as mail carries it: line breaks and other stray characters are skipped, and decoding
 * stops at the first padding. */
export function decodeBase64(input: Uint8Array | string): Uint8Array {
  const code = (index: number) =>
    typeof input === 'string' ? input.charCodeAt(index) : (input[index] ?? 0);
  const output = new Uint8Array(Math.floor((input.length * 3) / 4) + 3);
  let size = 0,
    bits = 0,
    count = 0;
  for (let index = 0; index < input.length; index++) {
    const character = code(index);
    if (character === 61) break;
    const value = character < 256 ? (base64Values[character] ?? -1) : -1;
    if (value < 0) continue;
    bits = (bits << 6) | value;
    if (++count === 4) {
      output[size++] = (bits >> 16) & 255;
      output[size++] = (bits >> 8) & 255;
      output[size++] = bits & 255;
      bits = count = 0;
    }
  }
  if (count === 2) output[size++] = (bits >> 4) & 255;
  else if (count === 3) {
    output[size++] = (bits >> 10) & 255;
    output[size++] = (bits >> 2) & 255;
  }
  return output.subarray(0, size);
}
/** The decoded length of base64 without decoding it. */
export function base64Size(input: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (character === 61) break;
    if ((base64Values[character] ?? -1) >= 0) count++;
  }
  return Math.floor((count * 3) / 4);
}

const hex = (character: number) =>
  character >= 48 && character <= 57
    ? character - 48
    : character >= 65 && character <= 70
      ? character - 55
      : character >= 97 && character <= 102
        ? character - 87
        : -1;
/** Quoted-printable: soft line breaks join lines; an `=` that starts no escape stays as written. */
export function decodeQuotedPrintable(input: Uint8Array, header = false): Uint8Array {
  const output = new Uint8Array(input.length);
  let size = 0;
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (header && character === 95) {
      output[size++] = 32;
      continue;
    }
    if (character !== 61) {
      output[size++] = character;
      continue;
    }
    const next = input[index + 1];
    if (next === LF) {
      index += 1;
      continue;
    }
    if (next === CR && input[index + 2] === LF) {
      index += 2;
      continue;
    }
    const high = hex(next ?? 0),
      low = hex(input[index + 2] ?? 0);
    if (high >= 0 && low >= 0) {
      output[size++] = high * 16 + low;
      index += 2;
    } else output[size++] = character;
  }
  return output.subarray(0, size);
}
/** A body as its Content-Transfer-Encoding gives it; 7bit, 8bit, binary and unknown encodings
 * are read as they are. */
export function decodeTransfer(body: Uint8Array, encoding: string): Uint8Array {
  if (encoding === 'base64') return decodeBase64(body);
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}
/** A body's decoded length, counted without decoding base64. */
export function transferSize(body: Uint8Array, encoding: string): number {
  if (encoding === 'base64') return base64Size(body);
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body).length;
  return body.length;
}

const encodedWord = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
/** RFC 2047 encoded words in a header value. Adjacent words in one charset are decoded together,
 * so a character split between them survives; the space between words is not text. */
export function decodeWords(value: string): string {
  if (!value.includes('=?')) return value;
  let output = '',
    cursor = 0,
    pending: { charset: string; bytes: number[] } | undefined;
  const flush = () => {
    if (pending) output += decodeText(Uint8Array.from(pending.bytes), pending.charset);
    pending = undefined;
  };
  for (const match of value.matchAll(encodedWord)) {
    const between = value.slice(cursor, match.index);
    if (!pending || between.trim()) {
      flush();
      output += between;
    }
    const charset = match[1]!.split('*')[0]!;
    const text = ascii(match[3]!);
    const bytes =
      match[2]!.toLowerCase() === 'b' ? decodeBase64(text) : decodeQuotedPrintable(text, true);
    if (pending && pending.charset.toLowerCase() !== charset.toLowerCase()) flush();
    pending ??= { charset, bytes: [] };
    for (const byte of bytes) pending.bytes.push(byte);
    cursor = match.index + match[0].length;
  }
  flush();
  return output + value.slice(cursor);
}

/** Splits on `separator` outside quoted strings, comments and angle brackets. */
export function splitOutside(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '',
    quoted = false,
    comment = 0,
    angle = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (quoted) {
      current += character;
      if (character === '\\') current += value[++index] ?? '';
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '(') comment++;
    else if (character === ')' && comment) comment--;
    else if (character === '<') angle = true;
    else if (character === '>') angle = false;
    else if (character === separator && !comment && !angle) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}
const unquote = (value: string) => {
  const text = value.trim();
  return text.startsWith('"') && text.endsWith('"') && text.length > 1
    ? text.slice(1, -1).replace(/\\(.)/g, '$1')
    : text;
};
const percentBytes = (value: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const high = hex(value.charCodeAt(index + 1)),
      low = hex(value.charCodeAt(index + 2));
    if (value[index] === '%' && high >= 0 && low >= 0) {
      bytes.push(high * 16 + low);
      index += 2;
    } else bytes.push(value.charCodeAt(index) & 255);
  }
  return Uint8Array.from(bytes);
};
/**
 * A structured field's value and its parameters: `text/plain; charset=utf-8`. RFC 2231 continued
 * and charset-encoded parameters are joined and decoded; encoded words in a plain parameter, which
 * many writers use for file names, are decoded too.
 */
export function fieldParameters(value: string): {
  value: string;
  parameters: Record<string, string>;
} {
  const [head = '', ...rest] = splitOutside(value, ';');
  const parameters: Record<string, string> = Object.create(null);
  const sections = new Map<string, { index: number; encoded: boolean; value: string }[]>();
  for (const item of rest.slice(0, 64)) {
    const equals = item.indexOf('=');
    if (equals < 1) continue;
    const key = item.slice(0, equals).trim().toLowerCase();
    const raw = item.slice(equals + 1);
    const extended = /^([^*]+)(?:\*(\d{1,3}))?(\*)?$/.exec(key);
    if (!extended || (!extended[2] && !extended[3])) {
      if (!Object.hasOwn(parameters, key)) parameters[key] = decodeWords(unquote(raw));
      continue;
    }
    const name = extended[1]!;
    const list = sections.get(name) ?? [];
    list.push({ index: Number(extended[2] ?? 0), encoded: !!extended[3], value: unquote(raw) });
    sections.set(name, list);
  }
  for (const [name, list] of sections) {
    list.sort((a, b) => a.index - b.index);
    let charset = '';
    const bytes: number[] = [];
    for (const [position, section] of list.entries()) {
      let text = section.value;
      if (section.encoded && position === 0) {
        const parts = /^([^']*)'[^']*'(.*)$/.exec(text);
        if (parts) {
          charset = parts[1]!;
          text = parts[2]!;
        }
      }
      for (const byte of section.encoded ? percentBytes(text) : ascii(text)) bytes.push(byte);
    }
    parameters[name] = decodeText(Uint8Array.from(bytes), charset || undefined);
  }
  return { value: head.trim().toLowerCase(), parameters };
}

/** The end of a header block: after its blank line, or undefined when it has none. */
function headerEnd(bytes: Uint8Array): { header: number; body: number } | undefined {
  if (bytes[0] === LF) return { header: 0, body: 1 };
  if (bytes[0] === CR && bytes[1] === LF) return { header: 0, body: 2 };
  const limit = Math.min(bytes.length, mimeLimits.headerBytes);
  for (let at = bytes.indexOf(LF); at >= 0 && at < limit; at = bytes.indexOf(LF, at + 1)) {
    if (bytes[at + 1] === LF) return { header: at + 1, body: at + 2 };
    if (bytes[at + 1] === CR && bytes[at + 2] === LF) return { header: at + 1, body: at + 3 };
  }
  return undefined;
}
/** Unfolded header fields. Raw 8-bit text reads as UTF-8 when it is, Windows-1252 otherwise; a
 * line that is no field, such as an mbox `From ` line, is skipped. */
export function parseFields(header: Uint8Array): MimeField[] {
  const fields: MimeField[] = [];
  const text = decodeText(header);
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      const last = fields.at(-1);
      if (last && last.value.length < mimeLimits.headerBytes) last.value += ' ' + line.trim();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 1 || !/^[\x21-\x39\x3b-\x7e]+$/.test(line.slice(0, colon))) continue;
    if (fields.length >= mimeLimits.fields) break;
    fields.push({ name: line.slice(0, colon).toLowerCase(), value: line.slice(colon + 1).trim() });
  }
  return fields;
}
export const field = (fields: readonly MimeField[], name: string) =>
  fields.find((item) => item.name === name)?.value;

const lineEnd = (bytes: Uint8Array, at: number) => {
  const end = bytes.indexOf(LF, at);
  return end < 0 ? bytes.length : end + 1;
};
/** Where each delimiter line of `boundary` starts and ends in `body`, and whether it closes. */
function delimiters(body: Uint8Array, boundary: string) {
  const marker = ascii('--' + boundary);
  const found: { start: number; next: number; closing: boolean }[] = [];
  for (
    let at = indexOfBytes(body, marker);
    at >= 0 && found.length <= mimeLimits.parts;
    at = indexOfBytes(body, marker, at + marker.length)
  ) {
    if (at > 0 && body[at - 1] !== LF) continue;
    let after = at + marker.length;
    const closing = body[after] === 45 && body[after + 1] === 45;
    if (closing) after += 2;
    const next = lineEnd(body, after);
    // transport padding only: a longer boundary that starts with this one is not this delimiter
    let rest = after;
    while (rest < next && [32, 9, CR, LF].includes(body[rest]!)) rest++;
    if (rest < next) continue;
    // the line break before a delimiter belongs to it
    const start = at > 1 && body[at - 2] === CR ? at - 2 : at > 0 ? at - 1 : at;
    found.push({ start, next, closing });
    if (closing) break;
  }
  return found;
}

/** The part tree of `bytes`, one RFC 5322 message. A message without a blank line after its
 * headers has no body. */
export function parseMime(bytes: Uint8Array): MimeMessage {
  let parts = 0,
    limited = false;
  const entity = (data: Uint8Array, depth: number, digest: boolean): MimePart => {
    parts++;
    let end = headerEnd(data);
    if (!end && data.length > mimeLimits.headerBytes) {
      if (!depth) throw new Error('The message headers exceed the reader limit.');
      // a part without its blank line: all body
      end = { header: 0, body: 0 };
    }
    const fields = parseFields(data.subarray(0, end?.header ?? data.length));
    const body = end ? data.subarray(end.body) : new Uint8Array();
    const contentType = fieldParameters(
      field(fields, 'content-type') ?? (digest ? 'message/rfc822' : 'text/plain'),
    );
    const disposition = fieldParameters(field(fields, 'content-disposition') ?? '');
    const id = field(fields, 'content-id')?.trim().replace(/^<|>$/g, '');
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(contentType.value) ? contentType.value : 'text/plain';
    const part: MimePart = {
      fields,
      type,
      parameters: contentType.parameters,
      disposition: disposition.value,
      dispositionParameters: disposition.parameters,
      encoding: (field(fields, 'content-transfer-encoding') ?? '').trim().toLowerCase(),
      id: id || undefined,
      location: field(fields, 'content-location')?.trim() || undefined,
      body,
      children: [],
    };
    const boundary = part.parameters.boundary;
    if (!type.startsWith('multipart/') || !boundary) return part;
    if (depth >= mimeLimits.depth) {
      limited = true;
      return part;
    }
    const found = delimiters(body, boundary);
    for (let index = 0; index < found.length; index++) {
      const delimiter = found[index]!;
      if (delimiter.closing) break;
      if (parts >= mimeLimits.parts) {
        limited = true;
        break;
      }
      const stop = found[index + 1]?.start ?? body.length;
      part.children.push(
        entity(body.subarray(delimiter.next, stop), depth + 1, type === 'multipart/digest'),
      );
    }
    return part;
  };
  const root = entity(bytes, 0, false);
  return { root, limited };
}

/** A part's file name: Content-Disposition's, then Content-Type's. */
export const partName = (part: MimePart) =>
  (part.dispositionParameters.filename || part.parameters.name || '').trim();
/** A part's text, transfer-decoded and in its charset, with line breaks as `\n`. */
export function partText(part: MimePart): string {
  return decodeText(decodeTransfer(part.body, part.encoding), part.parameters.charset).replace(
    /\r\n?/g,
    '\n',
  );
}
