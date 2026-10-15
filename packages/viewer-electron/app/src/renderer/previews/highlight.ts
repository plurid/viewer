import Prism from 'prismjs';

export interface HighlightSegment {
  text: string;
  /** Prism token classes, or empty for plain text. */
  className: string;
}

/**
 * Tokenizes a whole document once and splits the tokens into lines, so tokens that
 * span lines (block comments, template strings) keep their colour on every line. The
 * segments are plain text for React to render; no markup is produced.
 */
export function highlightedLines(text: string, grammar: Prism.Grammar): HighlightSegment[][] {
  const lines: HighlightSegment[][] = [[]];
  const visit = (stream: Prism.TokenStream, className: string) => {
    if (typeof stream === 'string') {
      stream.split('\n').forEach((part, index) => {
        if (index) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, className });
      });
    } else if (Array.isArray(stream)) for (const item of stream) visit(item, className);
    else {
      const aliases = Array.isArray(stream.alias)
        ? stream.alias
        : stream.alias
          ? [stream.alias]
          : [];
      visit(
        stream.content,
        [className, 'token', stream.type, ...aliases].filter(Boolean).join(' '),
      );
    }
  };
  visit(Prism.tokenize(text, grammar), '');
  return lines;
}
