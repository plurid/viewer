import { boundedDiagnosticInput, DiagnosticLicenseKey } from './license-key';
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
    if (character === '"') index = valueEnd(text, index, 'field') - 1;
    else if (character === '{') closing.push('}');
    else if (character === '[') closing.push(']');
    else if (character === '}' || character === ']') {
      if (closing.pop() !== character) return text.length;
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
const shellOption = new RegExp(
  `(?<!\\S)(?<quote>['"]?)(?<option>--${namePattern}|-u)(?:\\k<quote>[ \\t]+|\\k<quote>=|=)`,
);
const jsonMember = new RegExp(`"(?<member>${namePattern})"[ \\t\\r\\n]*:[ \\t\\r\\n]*`);
const fieldLabel = new RegExp(
  `(?<!\\w)(?<label>(?<opening>["'\\x60“‘]?)(?<field>${namePattern})["'\\x60”’]?)[ \\t]*(?<separator>[:=])[ \\t]*`,
);

type FieldOperand = 'before' | 'plain' | 'quoted';

/** A free-text assignment owns its whole line, including quoted words continued on later lines. */
export class CredentialField {
  private closing: string;
  private escaped = false;
  private operand: FieldOperand;

  constructor(label = '') {
    this.closing = unclosedLabelQuote(label);
    this.operand = this.closing ? 'quoted' : 'before';
  }

  get continues(): boolean {
    return Boolean(this.closing || this.escaped);
  }

  /** A quoted operand can contain text that looks like another field, option or bearer token. */
  scan(ch: string): boolean {
    let literal = this.operand === 'quoted';
    if (!this.continues) {
      if (/\s/.test(ch)) {
        if (literal) this.operand = 'plain';
        literal = false;
      } else if (this.operand === 'before') {
        // A leading double quote may also open the name of a structured JSON member.
        this.operand = closingQuotes[ch] ? 'quoted' : 'plain';
      }
    }
    if (this.escaped) this.escaped = false;
    else if (ch === '\\' && this.closing !== "'") this.escaped = true;
    else if (this.closing) {
      if (ch === this.closing) this.closing = '';
    } else this.closing = closingQuotes[ch] ?? '';
    return literal;
  }
}

function fieldEnd(text: string, start: number, label?: string, literal?: Uint8Array): number {
  const field = new CredentialField(label);
  for (let index = start; index < text.length; index++) {
    const ch = text[index]!;
    if (!field.continues && (ch === '\r' || ch === '\n')) return index;
    if (ch === '\r' && text[index + 1] === '\n') index++;
    if (field.scan(ch) && literal) literal[index] = 1;
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

function memberEnd(text: string, start: number): number {
  const end = jsonValueEnd(text, start);
  try {
    JSON.parse(text.slice(start, end));
    if (/^\s*(?:[,}\]]|$)/.test(text.slice(end))) return end;
  } catch {
    // A malformed member has no reliable narrow value boundary.
  }
  return Math.max(end, fieldEnd(text, start));
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
    text += /\p{Cc}/u.test(character) && !/[\n\r]/.test(character) ? ' ' : character;
    offsets.push(index);
  }
  const spans: { start: number; end: number }[] = [];
  const literal = new Uint8Array(text.length);
  const assignmentLabels = new Map<number, number>();
  const assignments = new RegExp(
    [shellOption.source, jsonMember.source, fieldLabel.source].join('|'),
    'gi',
  );
  for (let match = assignments.exec(text); match; match = assignments.exec(text)) {
    if (literal[match.index]) continue;
    const { option, quote, member, field, label, opening, separator } = match.groups!;
    if (option) {
      if (option.toLowerCase() !== '-u' && !isCredentialLabel(option.slice(2))) continue;
      const start = assignments.lastIndex;
      const equals = match[0].endsWith('=');
      if (equals) assignmentLabels.set(match.index + (quote?.length ?? 0) + 2, start);
      // In '--flag=value with spaces' the quote opens before the value.
      const wordEnd = valueEnd(text, equals ? match.index : start, 'argument');
      const quotedEquals =
        equals && quote && !match[0].endsWith(quote + '=') && text[wordEnd - 1] === quote;
      spans.push({ start, end: quotedEquals ? wordEnd - 1 : wordEnd });
      // An option with no value may be followed by another credential option.
      if (equals || !/^['"]?-/.test(text.slice(start))) assignments.lastIndex = wordEnd;
      continue;
    }
    const name = member ?? field!;
    const sensitive = isCredentialLabel(name);
    const nameStart = match.index + (opening?.length ?? 0);
    const equals = nameStart + name.length;
    const query = separator === '=' && text[equals] === '=' && inQuery(text, nameStart);
    // Whitespace after an equals sign is padding only in a free-text assignment.
    const start = query ? equals + 1 : assignments.lastIndex;
    if (separator === '=' && text[equals] === '=') {
      // A padded base64 token has a multiple of four characters, including its padding.
      const assignedName = (name.length + 1) % 4 !== 0 && /[^=\r\n]/.test(text[start] ?? '');
      if (sensitive || assignedName) assignmentLabels.set(nameStart, equals + 1);
    }
    if (!sensitive) continue;
    let end: number;
    if (member) end = memberEnd(text, start);
    else if (query) {
      end = start;
      while (end < text.length && !/[\s&#]/.test(text[end]!)) end++;
    } else end = fieldEnd(text, start, label, literal);
    spans.push({ start, end });
    // Another assignment on a masked line can introduce a value on the next line.
    if (member || query || end === text.length) assignments.lastIndex = end;
  }
  for (const match of text.matchAll(/\b(?:Bearer|Basic)\s+/gi)) {
    if (literal[match.index]) continue;
    const start = match.index + match[0].length;
    spans.push({ start, end: valueEnd(text, start, 'argument') });
  }
  const license = new DiagnosticLicenseKey((start, _markerEnd, last) => {
    spans.push({ start, end: last + 1 });
  });
  for (let index = 0; index < text.length; index++) license.scan(text[index]!, index);
  license.finish();
  for (const match of text.matchAll(
    /\b(?:sk|pk|rk|gh[pousr]|xox[abprs]|glpat|github_pat)[-_][A-Za-z0-9_-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b[a-fA-F0-9]{20,}\b|\b[A-Za-z0-9+/]{12,}={1,2}(?![A-Za-z0-9=])/g,
  )) {
    const end = match.index + match[0].length;
    if (assignmentLabels.get(match.index) !== end) spans.push({ start: match.index, end });
  }
  for (const match of text.matchAll(
    /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,32}PRIVATE KEY-----|$)/g,
  ))
    spans.push({ start: match.index, end: match.index + match[0].length });
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
