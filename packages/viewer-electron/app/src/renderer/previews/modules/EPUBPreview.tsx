import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DocumentData } from '../../../domain/services';
import type { PreviewContext } from '../contracts';
import { usePreviewState } from '../state';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { Empty, IconButton, Loading } from '../../ui/primitives';
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
]);
/** Construct React nodes with no source attributes, event handlers, URLs or executable HTML. */
export function chapterNodes(html: string): ReactNode {
  const document = new DOMParser().parseFromString(html.slice(0, 400000), 'text/html');
  let count = 0;
  const convert = (node: Node, depth = 0): ReactNode => {
    if (++count > 20000 || depth > 100) return null;
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (blocked.has(tag)) return null;
    if (tag === 'img')
      return element.getAttribute('alt')
        ? createElement('p', { key: count, className: 'muted' }, element.getAttribute('alt'))
        : null;
    const key = count;
    const children = Array.from(element.childNodes).map((node) => convert(node, depth + 1));
    return createElement(allowed.has(tag) ? tag : 'span', { key }, ...children);
  };
  return Array.from(document.body.childNodes).map((node) => convert(node));
}
export default function EPUBPreview(context: PreviewContext) {
  const [document, setDocument] = useState<DocumentData>();
  const [error, setError] = useState('');
  const [chapter, setChapter] = usePreviewState(context, 'epub.chapter', 0);
  const [size, setSize] = usePreviewState(context, 'epub.size', 17);
  const [contents, setContents] = usePreviewState(context, 'epub.contents', true);
  useEffect(() => {
    let live = true;
    void context.services
      .document(context.resource.id)
      .then((document) => {
        if (live && !context.signal.aborted) setDocument(document);
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, [context.resource.id, context.services, context.signal]);
  const chapters = document?.chapters || [];
  const position = Math.min(chapter, Math.max(0, chapters.length - 1));
  const nodes = useMemo(() => chapterNodes(chapters[position]?.html || ''), [chapters, position]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'epub-contents',
          label: 'Show / hide contents',
          available: !!chapters.length,
          run: () => setContents((value) => !value),
        },
        {
          id: 'epub-next',
          label: 'Next chapter',
          available: position < chapters.length - 1,
          run: () => setChapter(position + 1),
        },
        {
          id: 'epub-previous',
          label: 'Previous chapter',
          available: position > 0,
          run: () => setChapter(position - 1),
        },
      ],
      [chapters.length, position, setChapter, setContents],
    ),
  );
  if (error) return <Empty icon="warning" title="EPUB could not be opened" detail={error} />;
  if (!document) return <Loading label="Reading EPUB…" />;
  return (
    <div className="epub-viewer">
      <PreviewToolbar context={context}>
        <IconButton
          icon="sidebar"
          label="Show contents"
          aria-pressed={contents}
          onClick={() => setContents(!contents)}
        />
        <IconButton
          icon="left"
          label="Previous chapter"
          disabled={!position}
          onClick={() => setChapter(position - 1)}
        />
        <span>
          {position + 1} / {chapters.length}
        </span>
        <IconButton
          icon="right"
          label="Next chapter"
          disabled={position >= chapters.length - 1}
          onClick={() => setChapter(position + 1)}
        />
        <span className="toolbar-spacer" />
        <button aria-label="Smaller text" onClick={() => setSize(Math.max(12, size - 1))}>
          A−
        </button>
        <button aria-label="Larger text" onClick={() => setSize(Math.min(30, size + 1))}>
          A+
        </button>
      </PreviewToolbar>
      <div className="epub-body">
        {contents && (
          <nav aria-label="EPUB contents">
            {chapters.map((item, index) => (
              <button
                key={index}
                aria-current={position === index ? 'page' : undefined}
                onClick={() => setChapter(index)}
              >
                {item.title}
              </button>
            ))}
          </nav>
        )}
        <article key={position} className="epub-chapter" style={{ fontSize: size }}>
          {nodes}
          {document.truncated && (
            <p className="muted">This preview reached its extraction limit.</p>
          )}
        </article>
      </div>
    </div>
  );
}
