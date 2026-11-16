import { boundedText, withoutControls } from './text';

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
  const text = withoutControls(boundedText(input));
  const spans: { start: number; end: number }[] = [];
  const assignments = /\b[A-Za-z][A-Za-z0-9_-]{0,79}["']?\s{0,32}[:=]\s{0,32}/g;
  for (let match = assignments.exec(text); match; match = assignments.exec(text)) {
    const key = match[0].replace(/["'\s:=]/g, '').toLowerCase().replace(/[-_]/g, '');
    if (!/(?:password|passwd|pwd|pass|secret|token|cookie|authorization|apikey|accesskey|privatekey)$/.test(key))
      continue;
    const start = match.index + match[0].length;
    const end = /(?:cookie|authorization)$/.test(key) ? text.length : valueEnd(text, start);
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
  const license = /\bviewer-license-1/gi;
  for (let match = license.exec(text); match; match = license.exec(text)) {
    let end = match.index + match[0].length;
    while (end < text.length && /[A-Za-z0-9_+/.=\s"'“”‘’\x60<>()\[\]-]/.test(text[end]!)) end++;
    spans.push({ start: match.index, end });
    license.lastIndex = end;
  }
  for (const match of text.matchAll(/\b(?:sk|pk|rk|gh[pousr]|xox[abprs])[-_][A-Za-z0-9_-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g))
    spans.push({ start: match.index, end: match.index + match[0].length });
  const ordered = spans.toSorted((a, b) => a.start - b.start || b.end - a.end);
  let output = '';
  let end = 0;
  for (const span of ordered) {
    if (span.start < end) {
      end = Math.max(end, span.end);
      continue;
    }
    output += text.slice(end, span.start) + '[redacted]';
    end = span.end;
  }
  return output + text.slice(end);
}
