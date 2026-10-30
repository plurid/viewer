import { createElement, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PreviewContext } from './contracts';
import type { Resource } from '../../domain/contracts';
import type { EPUBChapter, EPUBReference } from '../../domain/previews/documents/epub';
import { epubReference } from '../../domain/previews/documents/epub';

const allowed = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'sup',
  'sub',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'dl',
  'dt',
  'dd',
  'section',
  'article',
  'aside',
  'figure',
  'figcaption',
]);
const blocked = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'svg',
  'math',
  'link',
  'meta',
  'head',
  'title',
  'template',
  'audio',
  'video',
  'source',
]);
const blocks = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'br',
  'tr',
  'section',
  'aside',
]);
type BookNode =
  | { key: number; text: string; start: number }
  | {
      key: number;
      tag: string;
      anchor?: string;
      source?: string;
      alt?: string;
      href?: string;
      children: BookNode[];
    };
export interface BookChapter {
  nodes: BookNode[];
  text: string;
  limited: boolean;
}
export interface BookMatch {
  chapter: number;
  start: number;
  end: number;
  quote: string;
}

/** A template stays inert, including its images. Only the allowlisted React tree is mounted. */
export function readBookChapter(html: string): BookChapter {
  const template = document.createElement('template');
  template.innerHTML = html.slice(0, 400000);
  let count = 0,
    text = '',
    limited = html.length > 400000;
  const convert = (node: Node, depth = 0): BookNode[] => {
    if (++count > 20000 || depth > 100) {
      limited = true;
      return [];
    }
    const key = count;
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length,
        value = node.textContent || '';
      text += value;
      return [{ key, text: value, start }];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const element = node as Element,
      tag = element.tagName.toLowerCase();
    if (blocked.has(tag)) return [];
    const children = Array.from(element.childNodes).flatMap((node) => convert(node, depth + 1));
    if (blocks.has(tag)) text += '\n';
    return [
      {
        key,
        tag: allowed.has(tag) || tag === 'a' || tag === 'img' ? tag : 'span',
        anchor:
          (element.getAttribute('id') || element.getAttribute('name') || '').slice(0, 512) ||
          undefined,
        source: tag === 'img' ? element.getAttribute('src') || undefined : undefined,
        alt: tag === 'img' ? element.getAttribute('alt') || 'Book illustration' : undefined,
        href: tag === 'a' ? element.getAttribute('href') || undefined : undefined,
        children,
      },
    ];
  };
  const nodes = Array.from(template.content.childNodes).flatMap((node) => convert(node));
  return { nodes, text, limited };
}

/** Cooperatively search sanitized chapter text; cancellation never presents an obsolete query. */
export async function searchBook(
  chapters: readonly EPUBChapter[],
  query: string,
  signal: AbortSignal,
): Promise<{ matches: BookMatch[]; limited: boolean }> {
  const term = query.trim().slice(0, 160);
  const matches: BookMatch[] = [];
  let limited = false;
  if (!term) return { matches, limited };
  for (let chapter = 0; chapter < chapters.length; chapter++) {
    signal.throwIfAborted();
    const data = readBookChapter(chapters[chapter]!.html);
    limited ||= data.limited;
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    for (;;) {
      const match = pattern.exec(data.text);
      if (!match) break;
      const start = match.index,
        end = start + match[0].length;
      matches.push({
        chapter,
        start,
        end,
        quote: data.text.slice(Math.max(0, start - 45), end + 75).replace(/\s+/g, ' '),
      });
      if (matches.length >= 200) return { matches, limited: true };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { matches, limited };
}

function BookImage({ part, alt, context }: { part: string; alt: string; context: PreviewContext }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [resource, setResource] = useState<Resource>();
  const [error, setError] = useState('');
  const { services, signal, active } = context;
  const parent = context.resource.id;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((previous) => previous || entries.some((entry) => entry.isIntersecting)),
      { root: element.closest('.epub-chapter'), rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !active || signal.aborted) return;
    let live = true,
      owned: Resource | undefined;
    setError('');
    setResource(undefined);
    const cancel = () => {
      live = false;
      if (owned) {
        void services.release(owned.id).catch(() => {});
        owned = undefined;
      }
    };
    signal.addEventListener('abort', cancel, { once: true });
    void services.archiveEntry(parent, part).then(
      (value) => {
        if (!live || signal.aborted) {
          void services.release(value.id).catch(() => {});
          return;
        }
        owned = value;
        setResource(value);
      },
      (error: Error) => {
        if (live) setError(error.message);
      },
    );
    return () => {
      signal.removeEventListener('abort', cancel);
      cancel();
    };
  }, [visible, active, signal, parent, part, services]);
  return (
    <span ref={ref} className="epub-image">
      {error ? (
        <span role="img" aria-label={alt + '. ' + error}>
          {alt} · {error}
        </span>
      ) : resource && active && !signal.aborted ? (
        <img
          src={resource.url}
          alt={alt}
          width={resource.dimensions?.width}
          height={resource.dimensions?.height}
          decoding="async"
          onError={() => setError('Illustration could not be decoded.')}
        />
      ) : (
        <span className="muted">{alt}</span>
      )}
    </span>
  );
}

export function bookNodes(
  content: BookChapter,
  options: {
    chapter?: EPUBChapter;
    chapters?: readonly EPUBChapter[];
    images?: ReadonlySet<string>;
    /** Pictures the book carries as checked `data:` URLs, a FictionBook's, by path. */
    pictures?: ReadonlyMap<string, string>;
    context?: PreviewContext;
    navigate?(target: EPUBReference): void;
    match?: BookMatch;
  } = {},
): ReactNode {
  const render = (node: BookNode): ReactNode => {
    if ('text' in node) {
      const match = options.match;
      if (!match || match.end <= node.start || match.start >= node.start + node.text.length)
        return node.text;
      const start = Math.max(0, match.start - node.start),
        end = Math.min(node.text.length, match.end - node.start);
      return (
        <span key={node.key}>
          {node.text.slice(0, start)}
          <mark data-epub-match>{node.text.slice(start, end)}</mark>
          {node.text.slice(end)}
        </span>
      );
    }
    const props = {
      key: node.key,
      'data-epub-anchor': node.anchor,
      tabIndex: node.anchor ? -1 : undefined,
    };
    if (node.tag === 'img') {
      const target =
        options.chapter?.path && node.source
          ? epubReference(options.chapter.path, node.source)
          : undefined;
      const picture = target && options.pictures?.get(target.path);
      if (picture)
        return (
          <span key={node.key} className="epub-image">
            <img src={picture} alt={node.alt || 'Book illustration'} decoding="async" />
          </span>
        );
      return target && options.context && options.images?.has(target.path) ? (
        <BookImage
          key={node.key}
          part={target.path}
          alt={node.alt || 'Book illustration'}
          context={options.context}
        />
      ) : (
        <span {...props} className="muted">
          {node.alt}
        </span>
      );
    }
    const children = node.children.map(render);
    if (node.tag === 'a') {
      const target =
        options.chapter?.path && node.href
          ? epubReference(options.chapter.path, node.href)
          : undefined;
      return target &&
        options.navigate &&
        options.chapters?.some((chapter) => chapter.path === target.path) ? (
        <a
          {...props}
          href={'#' + encodeURIComponent(target.fragment)}
          onClick={(event) => {
            event.preventDefault();
            options.navigate?.(target);
          }}
        >
          {children}
        </a>
      ) : (
        <span {...props}>{children}</span>
      );
    }
    return createElement(
      node.tag,
      props,
      ...(node.tag === 'br' || node.tag === 'hr' ? [] : children),
    );
  };
  return content.nodes.map(render);
}

export function chapterNodes(html: string): ReactNode {
  return bookNodes(readBookChapter(html));
}
