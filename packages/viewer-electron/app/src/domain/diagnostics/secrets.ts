import { boundedText, withoutTerminalSequences } from './text';

function valueEnd(text: string, start: number): number {
  const quote = text[start];
  if (quote === '"' || quote === "'" || quote === '\x60' || quote === '“' || quote === '‘') {
    const close = quote === '“' ? '”' : quote === '‘' ? '’' : quote;
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === '\\') index++;
      else if (text[index] === close) return index + 1;
    }
    return text.length;
  }
  let end = start;
  while (end < text.length && !/[\s"',;&<>)]/.test(text[end]!)) end++;
  return end;
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
  const assignments = /\b[A-Za-z][A-Za-z0-9_-]{0,79}["']?\s{0,32}[:=]\s{0,32}/g;
  for (let match = assignments.exec(text); match; match = assignments.exec(text)) {
    const key = match[0]
      .replace(/["'\s:=]/g, '')
      .toLowerCase()
      .replace(/[-_]/g, '');
    if (
      !/(?:password|passwd|pwd|pass|secret|token|cookie|authorization|apikey|accesskey|privatekey)$/.test(
        key,
      )
    )
      continue;
    const start = match.index + match[0].length;
    let end = valueEnd(text, start);
    if (/(?:cookie|authorization)$/.test(key)) {
      const lineEnd = text.slice(start).search(/[\r\n]/);
      end = lineEnd < 0 ? text.length : start + lineEnd;
    }
    spans.push({ start, end });
    assignments.lastIndex = Math.max(assignments.lastIndex, end);
  }
  for (const pattern of [
    /(?:^|\s)(?:-u|--(?:password|passwd|pwd|pass|token|api-key))(?:=|\s{1,32})/gi,
    /\b(?:Bearer|Basic)\s{1,32}/gi,
  ]) {
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const start = match.index + match[0].length;
      const end = valueEnd(text, start);
      spans.push({ start, end });
      pattern.lastIndex = Math.max(pattern.lastIndex, end);
    }
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
  ))
    spans.push({ start: match.index, end: match.index + match[0].length });
  for (const match of text.matchAll(
    /-----BEGIN [A-Z ]{1,32}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{1,32}PRIVATE KEY-----|$)/g,
  ))
    spans.push({ start: match.index, end: match.index + match[0].length });
  const ordered = spans
    .map((span) => ({
      start: offsets[span.start] ?? original.length,
      end:
        span.end > span.start
          ? (offsets[span.end - 1] ?? original.length - 1) + 1
          : original.length,
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
