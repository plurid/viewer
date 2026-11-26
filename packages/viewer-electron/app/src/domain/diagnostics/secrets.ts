import { boundedText, withoutTerminalSequences } from './text';

type ValueBoundary = 'field' | 'argument' | 'query';
function valueEnd(text: string, start: number, boundary: ValueBoundary): number {
  const delimiter =
    boundary === 'argument' ? /\s/ : boundary === 'query' ? /[\s&#]/ : /[\s"',;&<>)]/;
  let closing = '';
  for (let index = start; index < text.length; index++) {
    const character = text[index]!;
    if (character === '\\' && (boundary === 'argument' ? closing !== "'" : closing)) index++;
    else if (closing) {
      if (character === closing) {
        if (boundary !== 'argument') return index + 1;
        closing = '';
      }
    } else if ((index === start || boundary === 'argument') && /["'\x60“‘]/.test(character)) {
      closing = character === '“' ? '”' : character === '‘' ? '’' : character;
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

function credentialSuffix(key: string): string | undefined {
  return /(?:password|passwd|pwd|pass|secret|token|cookie|authorization|apikey|accesskey|privatekey|askpassprompt|askpassanswer|askpassresponse|askpasssocket|sshaskpass|sshaskpassrequire)$/.exec(
    key,
  )?.[0];
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

export function isCredentialLabel(key: string): boolean {
  return Boolean(credentialSuffix(normalizedKey(key)));
}

/** Only assignments before env's executable have an unambiguous shell value boundary. */
function environmentCommandAssignments(text: string): Set<number> {
  const positions = new Set<number>();
  const assignment = /[A-Za-z_][A-Za-z0-9_]*=/y;
  for (const command of text.matchAll(
    /(?:^|[\r\n])[ \t]*(?:exec[ \t]+)?(?:\/usr\/bin\/)?env[ \t]+/g,
  )) {
    let start = command.index + command[0].length;
    while (start < text.length) {
      assignment.lastIndex = start;
      if (!assignment.test(text)) break;
      positions.add(start);
      start = valueEnd(text, start, 'argument');
      while (text[start] === ' ' || text[start] === '\t') start++;
    }
  }
  return positions;
}

/** Unquoted dotenv values can contain spaces and punctuation through the end of the line. */
function paddedFieldEnd(text: string, start: number): number {
  if (/^["'\x60“‘]/.test(text.slice(start, start + 1))) return valueEnd(text, start, 'field');
  const newline = text.slice(start).search(/[\r\n]/);
  return newline < 0 ? text.length : start + newline;
}

/** Key and value scanning is bounded and never retries a long value at each character. */
export function redactCredentials(input: string): string {
  const original = withoutTerminalSequences(boundedText(input));
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
  const credentialLabels = new Map<number, number>();
  const envAssignments = environmentCommandAssignments(text);
  const shellOption =
    /(?<!\S)(?<quote>['"]?)(?<option>--[A-Za-z][A-Za-z0-9_-]{0,79}|-u)(?:\k<quote>[ \t]+|\k<quote>=|=)/;
  const jsonMember = /"(?<member>[A-Za-z][A-Za-z0-9_-]{0,79})"[ \t\r\n]*:[ \t\r\n]*/;
  const fieldLabel = /\b(?<field>[A-Za-z][A-Za-z0-9_-]{0,79})["']?[ \t]*(?<separator>[:=])[ \t]*/;
  const assignments = new RegExp(
    [shellOption.source, jsonMember.source, fieldLabel.source].join('|'),
    'gi',
  );
  for (let match = assignments.exec(text); match; match = assignments.exec(text)) {
    const { option, quote, member, field, separator } = match.groups!;
    if (option) {
      if (option.toLowerCase() !== '-u' && !isCredentialLabel(option.slice(2))) continue;
      const start = assignments.lastIndex;
      const equals = match[0].endsWith('=');
      if (equals) credentialLabels.set(match.index + (quote?.length ?? 0) + 2, start);
      // In '--flag=value with spaces' the quote opens before the value.
      const wordEnd = valueEnd(text, equals ? match.index : start, 'argument');
      const quotedEquals =
        equals && quote && !match[0].endsWith(quote + '=') && text[wordEnd - 1] === quote;
      spans.push({ start, end: quotedEquals ? wordEnd - 1 : wordEnd });
      // An option with no value may be followed by another credential option.
      if (equals || !/^['"]?-/.test(text.slice(start))) assignments.lastIndex = wordEnd;
      continue;
    }
    const key = normalizedKey(member ?? field!);
    const suffix = credentialSuffix(key);
    if (!suffix) continue;
    const query = !member && /[?&]/.test(text[match.index - 1] ?? '');
    const equals = match.index + (field?.length ?? 0);
    const flag = text.slice(Math.max(0, match.index - 2), match.index) === '--';
    const padded = separator === '=' && /[ \t]$/.test(match[0]);
    const shell =
      separator === '=' &&
      text[equals] === '=' &&
      (flag ||
        envAssignments.has(match.index) ||
        (!padded && (match.index === 0 || /\s/.test(text[match.index - 1]!))));
    // Whitespace after a shell equals sign already starts the next argument.
    const start = shell ? equals + 1 : assignments.lastIndex;
    if (separator === '=' && text[equals] === '=' && suffix === key)
      credentialLabels.set(match.index, equals + 1);
    const boundary: ValueBoundary = query ? 'query' : shell ? 'argument' : 'field';
    let end = member ? jsonValueEnd(text, start) : valueEnd(text, start, boundary);
    if (padded && !shell && !query) end = paddedFieldEnd(text, start);
    if (!member && !query && !shell && /(?:cookie|authorization)$/.test(key)) {
      const lineEnd = text.slice(start).search(/[\r\n]/);
      end = Math.max(end, lineEnd < 0 ? text.length : start + lineEnd);
    }
    spans.push({ start, end });
    assignments.lastIndex = Math.max(assignments.lastIndex, end);
  }
  for (const match of text.matchAll(/\b(?:Bearer|Basic)\s{1,32}/gi)) {
    const start = match.index + match[0].length;
    spans.push({ start, end: valueEnd(text, start, 'argument') });
  }
  let compact = '';
  const positions: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (/[\s"'“”‘’\x60<>()\[\]]/.test(text[index]!)) continue;
    compact += text[index];
    positions.push(index);
  }
  const lower = compact.toLowerCase();
  for (let start = lower.indexOf('viewer-license-1'); start >= 0;) {
    let end = start + 'viewer-license-1'.length;
    while (end < compact.length && /[A-Za-z0-9_+/.=-]/.test(compact[end]!)) end++;
    spans.push({ start: positions[start]!, end: positions[end - 1]! + 1 });
    start = lower.indexOf('viewer-license-1', end);
  }
  for (const match of text.matchAll(
    /\b(?:sk|pk|rk|gh[pousr]|xox[abprs]|glpat|github_pat)[-_][A-Za-z0-9_-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b[a-fA-F0-9]{20,}\b|\b[A-Za-z0-9+/]{12,}={1,2}(?![A-Za-z0-9=])/g,
  )) {
    const end = match.index + match[0].length;
    // A credential label such as "authorization=" can also look like a padded token.
    if (credentialLabels.get(match.index) !== end) spans.push({ start: match.index, end });
  }
  for (const match of text.matchAll(
    /-----BEGIN [A-Z ]{1,32}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{1,32}PRIVATE KEY-----|$)/g,
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
