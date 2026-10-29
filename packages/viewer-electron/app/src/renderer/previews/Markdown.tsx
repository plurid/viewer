import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import type { Components, UrlTransform } from 'react-markdown';
import { highlightedLines } from './highlight';
import { languageByID, languageFor, loadPrismGrammar } from './languages';
import { relativeLinkTarget } from '../../domain/workspaces/planes';

/** A Prism grammar, loaded on first use: the component renders again once it is ready. */
export function usePrismGrammar(id: string | undefined): Prism.Grammar | undefined {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!id || Prism.languages[id]) return;
    let live = true;
    void loadPrismGrammar(id).then(() => {
      if (live) setLoaded((count) => count + 1);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return id ? Prism.languages[id] : undefined;
}

/** Code highlighted in the language it names (`rust`, `ts`, `sh`): a fence, a notebook cell. */
export function HighlightedCode({ language, text }: { language: string; text: string }) {
  const id =
    languageByID(language)?.prism ??
    languageFor({ name: '', extension: language })?.prism ??
    language;
  const grammar = usePrismGrammar(id);
  const lines = useMemo(
    () => (grammar && text.length <= 1_000_000 ? highlightedLines(text, grammar) : null),
    [grammar, text],
  );
  if (!lines) return <code className={`language-${language}`}>{text}</code>;
  return (
    <code className={`language-${language}`}>
      {lines.map((segments, line) => (
        <span key={line}>
          {line > 0 && '\n'}
          {segments.map((segment, index) =>
            segment.className ? (
              <span key={index} className={segment.className}>
                {segment.text}
              </span>
            ) : (
              segment.text
            ),
          )}
        </span>
      ))}
    </code>
  );
}

export interface MarkdownContentProps {
  text: string;
  /** The document's own path: its relative links open beside its plane. */
  path: string;
  openRelated?(path: string): void;
  /** Images the document embeds, by the URL its text names them with: `data:` URIs only. */
  images?: Readonly<Record<string, string>>;
}

/** Markdown without its raw HTML. Local links act, other images are only named, and a fence
 * that names its language is highlighted in it. */
export function MarkdownContent({ text, path, openRelated, images }: MarkdownContentProps) {
  const embedded = (url: string | undefined) =>
    url && images && Object.hasOwn(images, url) ? images[url] : undefined;
  // an embedded image keeps its name through the URL check; everything else is checked as usual
  const urlTransform: UrlTransform | undefined = images
    ? (url) => (embedded(url) ? url : defaultUrlTransform(url))
    : undefined;
  const components: Components = {
    // Only relative links to local files act, opening them beside this plane.
    a: ({ children, href }) => {
      const target = openRelated && relativeLinkTarget(path, href);
      return target ? (
        <button
          type="button"
          className="markdown-link"
          title={target}
          onClick={() => openRelated?.(target)}
        >
          {children}
        </button>
      ) : (
        <span className="markdown-link">{children}</span>
      );
    },
    img: ({ alt, src }) => {
      const source = embedded(typeof src === 'string' ? src : undefined);
      return source ? (
        <img className="markdown-image" src={source} alt={alt ?? ''} />
      ) : (
        <span className="muted">[Image: {alt || 'external image'}]</span>
      );
    },
    code: ({ className, children }) => {
      const fence = /language-([\w+#-]+)/.exec(className ?? '');
      return fence ? (
        <HighlightedCode language={fence[1]!} text={String(children).replace(/\n$/, '')} />
      ) : (
        <code className={className}>{children}</code>
      );
    },
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={urlTransform}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
