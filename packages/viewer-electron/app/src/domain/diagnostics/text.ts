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

function terminalCSIEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (code === 0x18 || code === 0x1a) return end + 1;
    if (
      (code < 0x20 && code !== 0x1b) ||
      code === 0x7f ||
      /\p{Cf}/u.test(text[end]!) ||
      (code >= 0x20 && code <= 0x3f)
    )
      end++;
    else return code >= 0x40 && code <= 0x7e ? end + 1 : end;
  }
  return end;
}

function terminalStringEnd(text: string, start: number, bell: boolean): number {
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\u009c' || (bell && text[index] === '\u0007')) return index + 1;
    if (text[index] === '\u001b' && text[index + 1] === '\\') return index + 2;
  }
  return text.length;
}

/** Removing only ESC leaves terminal parameters next to names and hides their boundaries. */
export function withoutTerminalSequences(text: string): string {
  let output = '';
  let kept = 0;
  for (let index = 0; index < text.length;) {
    const character = text[index]!;
    let end = index;
    if (character === '\u001b') {
      const next = text[index + 1] ?? '';
      if (next === '[') end = terminalCSIEnd(text, index + 2);
      else if (next === ']' || /^[PX^_]$/.test(next))
        end = terminalStringEnd(text, index + 2, next === ']');
      else {
        end = index + 1;
        while (text.charCodeAt(end) >= 0x20 && text.charCodeAt(end) <= 0x2f) end++;
        if (text.charCodeAt(end) >= 0x30 && text.charCodeAt(end) <= 0x7e) end++;
      }
    } else if (character === '\u009b') end = terminalCSIEnd(text, index + 1);
    else if (/^[\u0090\u0098\u009d-\u009f]$/.test(character))
      end = terminalStringEnd(text, index + 1, character === '\u009d');
    else if (character === '\u009c') end = index + 1;
    else if (character === '[' && /[\d;:]/.test(text[index + 1] ?? '')) {
      // Older log entries lost ESC but retained their SGR color parameters.
      const candidate = terminalCSIEnd(text, index + 1);
      if (text[candidate - 1] === 'm') end = candidate;
    }
    if (end > index) {
      output += text.slice(kept, index);
      index = end;
      kept = end;
    } else index++;
  }
  return output + text.slice(kept);
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
  return lastLine < 0 ? notice.trimStart() : bounded.slice(0, lastLine).trimEnd() + notice;
}
