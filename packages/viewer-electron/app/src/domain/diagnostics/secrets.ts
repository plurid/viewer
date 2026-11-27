import { boundedDiagnosticInput, scanLicenseRecord } from './license-key';
import { withoutTerminalSequences } from './text';

export const closingQuotes: Readonly<Record<string, string | undefined>> = {
  "'": "'",
  '"': '"',
  '\x60': '\x60',
  '“': '”',
  '‘': '’',
};

export function unclosedLabelQuote(label: string): string {
  const closing = closingQuotes[label[0] ?? ''];
  return closing && !label.endsWith(closing) ? closing : '';
}

type ValueBoundary = 'field' | 'argument';
function valueEnd(text: string, start: number, boundary: ValueBoundary): number {
  const delimiter = boundary === 'argument' ? /\s/ : /[\s"',;&<>)]/;
  let closing = '';
  for (let index = start; index < text.length; index++) {
    const character = text[index]!;
    if (character === '\\' && (boundary === 'argument' ? closing !== "'" : closing)) {
      if (!closing && /[\r\n]/.test(text[index + 1] ?? '')) return index + 1;
      index += text.startsWith('\r\n', index + 1) ? 2 : 1;
    } else if (closing) {
      if (character === closing) {
        if (boundary !== 'argument') return index + 1;
        closing = '';
      }
    } else if ((index === start || boundary === 'argument') && closingQuotes[character]) {
      closing = closingQuotes[character]!;
    } else if (delimiter.test(character)) return index;
  }
  return text.length;
}

function jsonValueEnd(text: string, start: number): number {
  if (text[start] === '"') return valueEnd(text, start, 'field');
  if (text[start] !== '{' && text[start] !== '[') {
    let index = start;
    while (index < text.length && !/[\s,}\]]/.test(text[index]!)) index++;
    return index;
  }

  const closing: string[] = [];
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (character === '\r' || character === '\n') return index;
    if (character === '"') index = valueEnd(text, index, 'field') - 1;
    else if (character === '{') closing.push('}');
    else if (character === '[') closing.push(']');
    else if (character === '}' || character === ']') {
      if (closing.pop() !== character) return index + 1;
      if (!closing.length) return index + 1;
    }
  }
  return text.length;
}

export function isCredentialLabel(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[-_]/g, '');
  return /(?:password|passwd|pwd|pass|secret|token|cookie|authorization|apikey|accesskey|privatekey|askpassprompt|askpassanswer|askpassresponse|askpasssocket|sshaskpass|sshaskpassrequire)$/.test(
    normalized,
  );
}

// Fields use shell identifiers, extended with hyphens for option, header and JSON names.
const namePattern = /[A-Za-z_][A-Za-z0-9_-]*/.source;
const optionWord = new RegExp(`^(?<quote>['"]?)(?<option>--${namePattern}|-u)\\k<quote>$`, 'i');

export function isCredentialOption(word: string): boolean {
  const option = optionWord.exec(word)?.groups?.option;
  return !!option && (option.toLowerCase() === '-u' || isCredentialLabel(option.slice(2)));
}

const shellOption = new RegExp(
  `(?<!\\S)(?<quote>['"]?)(?<option>--${namePattern}|-u)(?:\\k<quote>[ \\t]+|\\k<quote>=|=)`,
);
const queryPair = /(?<queryPrefix>[?&])(?<parameter>[^\s?#&=]+)=/;
const jsonMember = new RegExp(`"(?<member>${namePattern})"[ \\t]*:[ \\t]*`);
const fieldLabel = new RegExp(
  `(?<!\\w)(?<label>(?<opening>["'\\x60“‘]?)(?<field>${namePattern})["'\\x60”’]?)[ \\t]*(?<separator>[:=])[ \\t]*`,
);

const tokenPattern =
  /\b(?:sk|pk|rk|gh[pousr]|xox[abprs]|glpat|github_pat)[-_][A-Za-z0-9_-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b[a-fA-F0-9]{20,}\b|\b[A-Za-z0-9+/]{12,}={1,2}(?![A-Za-z0-9=])/g;
export const pemLineLimit = 64;
export const privateKeyHeader = /^[ \t]*-----BEGIN ([A-Z ]{0,32}PRIVATE KEY)-----[ \t]*$/;
const privateKeyBegin =
  /^(?<pem>[ \t]*-----BEGIN (?<keyType>[A-Z ]{0,32}PRIVATE KEY)-----[ \t]*)(?=\r|\n|$)/m;

function privateKeyBlockEnd(text: string, start: number, type: string): number {
  const lines = /\r\n|[\r\n]/g;
  lines.lastIndex = start;
  let end = start;
  for (let count = 1; count < pemLineLimit && lines.exec(text); count++) {
    const from = lines.lastIndex;
    const next = text.slice(from).search(/[\r\n]/);
    end = next < 0 ? text.length : from + next;
    if (text.slice(from, end).trim() === '-----END ' + type + '-----') break;
    lines.lastIndex = end;
  }
  return end;
}

/** A free-text assignment owns its whole line, including quoted words continued on later lines. */
export class CredentialField {
  private closing: string;
  private escaped = false;

  constructor(label = '') {
    this.closing = unclosedLabelQuote(label);
  }

  get continues(): boolean {
    return Boolean(this.closing);
  }

  scan(ch: string): void {
    if (this.escaped) this.escaped = false;
    else if (ch === '\\' && this.closing !== "'") this.escaped = true;
    else if (this.closing) {
      if (ch === this.closing) this.closing = '';
    } else this.closing = closingQuotes[ch] ?? '';
  }
}

function fieldEnd(text: string, start: number, label?: string): number {
  const field = new CredentialField(label);
  for (let index = start; index < text.length; index++) {
    const ch = text[index]!;
    if (!field.continues && (ch === '\r' || ch === '\n')) return index;
    if (ch === '\r' && text[index + 1] === '\n') index++;
    field.scan(ch);
  }
  return text.length;
}

/** Standalone query strings are valid too. A fragment or whitespace ends the query. */
function inQuery(text: string, offset: number): boolean {
  if (text[offset - 1] !== '?' && text[offset - 1] !== '&') return false;
  let query = false;
  for (let i = offset - 1; i >= 0 && !/\s/.test(text[i]!); i--) {
    if (text[i] === '#') return false;
    if (text[i] === '?') query = true;
  }
  return query;
}

interface Span {
  start: number;
  end: number;
}

function queryEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && !/[\s&#]/.test(text[end]!)) end++;
  return end;
}

const urlScheme = /^[a-z][a-z\d+.-]*:/i;
// Leading form spaces can precede an absolute URL just like percent-encoded spaces.
const possibleURL = /^[+\s]*(?:[a-z][a-z\d+.-]*(?::|%)|%[\da-f]{2})/i;

/** Preserve source offsets while decoding just the bytes that can form URL syntax. */
function decodeURLLayer(url: string, offsets: number[]): [string, number[]] {
  const next: number[] = [];
  const decoded = url
    .replaceAll('+', ' ')
    .replace(/%([\da-f]{2})|[\s\S]/gi, (raw, hex: string | undefined, at: number) => {
      next.push(offsets[at]!);
      return hex ? String.fromCharCode(parseInt(hex, 16)) : raw;
    });
  next.push(offsets[url.length]!);
  return [decoded, next];
}

function parameterSpans(
  name: string,
  raw: string,
  depth = 0,
  work = { left: raw.length * 16 + 512 },
): Span[] {
  const whole = [{ start: 0, end: raw.length }];
  try {
    for (let layer = 0; layer < 2 && name.includes('%'); layer++) name = decodeURIComponent(name);
  } catch {
    return whole;
  }
  if (isCredentialLabel(name.replace(/[\t\r\n]/g, '')) || name.includes('%')) return whole;
  // An absolute destination must have a scheme colon, literal or encoded.
  if (!/[:%]/.test(raw)) return [];
  const spans: Span[] = [];
  let url = raw;
  let offsets = Array.from({ length: raw.length + 1 }, (_, i) => i);
  for (let layer = 0; layer <= 2; layer++) {
    work.left -= url.length;
    if (depth >= 4 || work.left < 0) return whole;
    const encoded = /\+|%[\da-f]{2}/i.test(url);
    const valid = URL.canParse(url);
    if (valid) {
      const beforeFragment = url.split('#', 1)[0]!;
      const query = beforeFragment.indexOf('?');
      if (query >= 0) {
        let at = query + 1;
        for (const pair of beforeFragment.slice(at).split('&')) {
          const equals = pair.indexOf('=');
          if (equals >= 0) {
            const start = at + equals + 1;
            for (const span of parameterSpans(
              pair.slice(0, equals),
              pair.slice(equals + 1),
              depth + 1,
              work,
            ))
              spans.push({ start: offsets[start + span.start]!, end: offsets[start + span.end]! });
          }
          at += pair.length + 1;
        }
      }
    }
    if (!encoded) return !valid && urlScheme.test(url.trimStart()) ? whole : spans;
    if (layer === 2) {
      if ((!valid && possibleURL.test(url)) || /%(?:25)*(?:3f|3d|26|23)/i.test(url)) return whole;
      break;
    }
    [url, offsets] = decodeURLLayer(url, offsets);
  }
  return spans;
}

function parsedMemberEnd(text: string, start: number): number | undefined {
  const end = jsonValueEnd(text, start);
  try {
    const value = text.slice(start, end);
    JSON.parse(value.startsWith('"') ? value.replace(/\r\n|[\r\n]/g, '\\n') : value);
    if (/^[ \t]*(?:[,}\]\r\n]|$)/.test(text.slice(end))) return end;
  } catch {
    // A malformed member has no reliable narrow value boundary.
  }
  return undefined;
}

function memberEnd(text: string, start: number): number {
  return parsedMemberEnd(text, start) ?? Math.max(jsonValueEnd(text, start), fieldEnd(text, start));
}

/** Key and value scanning is bounded and never retries a long value at each character. */
export function redactCredentials(input: string): string {
  const original = withoutTerminalSequences(boundedDiagnosticInput(input));
  let text = '';
  const offsets: number[] = [];
  // Line boundaries separate values; joining characters only disguise their spelling.
  for (let index = 0; index < original.length; index++) {
    const character = original[index]!;
    if (/\p{Cf}/u.test(character)) continue;
    const visible = /\p{Cc}/u.test(character) && !/[\n\r]/.test(character) ? ' ' : character;
    text += visible;
    offsets.push(index);
  }
  const spans: Span[] = [];
  const assignmentLabels = new Map<number, number>();
  const assignments = new RegExp(
    [
      shellOption.source,
      queryPair.source,
      jsonMember.source,
      fieldLabel.source,
      privateKeyBegin.source,
    ].join('|'),
    'gim',
  );
  for (let match = assignments.exec(text); match; match = assignments.exec(text)) {
    const {
      option,
      quote,
      member,
      field,
      label,
      opening,
      separator,
      pem,
      keyType,
      parameter,
      queryPrefix,
    } = match.groups!;
    if (pem) {
      if (!privateKeyHeader.test(pem)) continue;
      const end = privateKeyBlockEnd(text, assignments.lastIndex, keyType!);
      spans.push({ start: match.index, end });
      assignments.lastIndex = end;
      continue;
    }
    if (queryPrefix) {
      if (!inQuery(text, match.index + 1)) {
        assignments.lastIndex = match.index + 1;
        continue;
      }
      const start = assignments.lastIndex;
      const end = queryEnd(text, start);
      for (const span of parameterSpans(parameter!, text.slice(start, end)))
        spans.push({ start: start + span.start, end: start + span.end });
      assignmentLabels.set(match.index + 1, start);
      assignments.lastIndex = end;
      continue;
    }
    if (option) {
      if (option.toLowerCase() !== '-u' && !isCredentialLabel(option.slice(2))) continue;
      const start = assignments.lastIndex;
      const equals = match[0].endsWith('=');
      if (equals) assignmentLabels.set(match.index + (quote?.length ?? 0) + 2, start);
      // In '--flag=value with spaces' the quote opens before the value.
      const enclosing = equals && quote && !match[0].endsWith(quote + '=');
      const wordEnd = valueEnd(text, equals ? match.index : start, 'argument');
      const quotedEquals = enclosing && text[wordEnd - 1] === quote;
      spans.push({ start, end: quotedEquals ? wordEnd - 1 : wordEnd });
      // An option with no value may be followed by another credential option.
      if (equals || !isCredentialOption(text.slice(start, wordEnd)))
        assignments.lastIndex = wordEnd;
      continue;
    }
    const name = member ?? field!;
    const sensitive = isCredentialLabel(name);
    const nameStart = match.index + (opening?.length ?? 0);
    const equals = nameStart + name.length;
    const start = assignments.lastIndex;
    if (separator === '=' && text[equals] === '=') {
      // A padded base64 token has a multiple of four characters, including its padding.
      const assignedName = (name.length + 1) % 4 !== 0 && /[^=\r\n]/.test(text[start] ?? '');
      if (sensitive || assignedName) assignmentLabels.set(nameStart, equals + 1);
    }
    if (!sensitive) continue;
    const end = member ? memberEnd(text, start) : fieldEnd(text, start, label);
    spans.push({ start, end });
    assignments.lastIndex = end;
  }
  // Shield claimed values from token matching while preserving physical lines and source offsets.
  const unclaimed = text.split('');
  for (const { start, end } of spans) {
    for (let i = start; i < end; i++) {
      if (text[i] !== '\r' && text[i] !== '\n') unclaimed[i] = '\0';
    }
  }
  const remainder = unclaimed.join('');
  for (const line of remainder.matchAll(/[^\r\n]+/g)) {
    scanLicenseRecord(line[0], (start, end) =>
      spans.push({ start: line.index + start, end: line.index + end }),
    );
  }
  for (const match of remainder.matchAll(tokenPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (assignmentLabels.get(start) !== end) spans.push({ start, end });
  }

  const ordered = spans
    .filter((span) => span.end > span.start)
    .map((span) => ({
      start: offsets[span.start] ?? original.length,
      end: (offsets[span.end - 1] ?? original.length - 1) + 1,
    }))
    .toSorted((a, b) => a.start - b.start || b.end - a.end);
  let output = '';
  let end = 0;
  for (const span of ordered) {
    if (span.start < end) {
      end = Math.max(end, span.end);
      continue;
    }
    output += original.slice(end, span.start) + '[redacted]';
    end = span.end;
  }
  return output + original.slice(end);
}
