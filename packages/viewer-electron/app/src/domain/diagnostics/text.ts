export const diagnosticTextLimit = 8000;

/** Bound work before scanning and never leave half of a Unicode scalar for URL encoding. */
export function boundedText(text: string, limit = diagnosticTextLimit): string {
  let end = Math.max(0, Math.min(text.length, limit));
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end] ?? ''))
    end--;
  return text
    .slice(0, end)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

export function boundedTextTail(text: string, limit: number): string {
  let start = Math.max(0, text.length - limit);
  if (
    start &&
    /[\uDC00-\uDFFF]/.test(text[start] ?? '') &&
    /[\uD800-\uDBFF]/.test(text[start - 1]!)
  )
    start++;
  return boundedText(text.slice(start), limit);
}

/** Normalization must precede privacy checks, so later formatting cannot rebuild an identity. */
export function withoutControls(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '');
}

/** The review and clipboard must share a complete, visibly bounded Markdown document. */
export function boundedReport(text: string, limit = 64 * 1024): string {
  const encoder = new TextEncoder();
  const bounded = boundedText(text, limit);
  if (text.length <= limit && encoder.encode(bounded).length <= limit) return bounded;
  const notice = '\n\nReport shortened to fit this window.\n';
  const budget = limit - encoder.encode(notice).length;
  let bytes = 0;
  let end = 0;
  for (const character of bounded) {
    const length = encoder.encode(character).length;
    if (bytes + length > budget) break;
    bytes += length;
    end += character.length;
  }
  const lastLine = bounded.lastIndexOf('\n', end - 1);
  return (lastLine < 0 ? '' : bounded.slice(0, lastLine).trimEnd()) + notice;
}
