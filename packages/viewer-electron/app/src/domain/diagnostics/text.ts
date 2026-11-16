export const diagnosticTextLimit = 8000;

/** Bound work before scanning and never leave half of a Unicode scalar for URL encoding. */
export function boundedText(text: string, limit = diagnosticTextLimit): string {
  let end = Math.max(0, Math.min(text.length, limit));
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end] ?? ''))
    end--;
  return text.slice(0, end).replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  );
}

export function boundedTextTail(text: string, limit: number): string {
  let start = Math.max(0, text.length - limit);
  if (start && /[\uDC00-\uDFFF]/.test(text[start] ?? '') && /[\uD800-\uDBFF]/.test(text[start - 1]!))
    start++;
  return boundedText(text.slice(start), limit);
}

/** Normalization must precede privacy checks, so later formatting cannot rebuild an identity. */
export function withoutControls(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '');
}
