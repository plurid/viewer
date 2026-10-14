import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import type { PreviewContext } from '../contracts';
import { Empty, Loading } from '../../ui/primitives';
import { DelimitedTable } from '../DataTable';
import { getState, report } from '../../state/store';

function JSONNode({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const [limit, setLimit] = useState(100);
  if (depth > 40) return <span className="muted">Maximum tree depth reached</span>;
  const expandable = value !== null && typeof value === 'object';
  const pairs = expandable ? Object.entries(value as Record<string, unknown>) : [];
  return (
    <div className="json-node">
      <div className="json-value">
        {expandable && (
          <button
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <span className="json-key">{name}</span>
        <span className="muted">: </span>
        {expandable ? (
          <span className="muted">
            {Array.isArray(value) ? `[${pairs.length} items]` : `{${pairs.length} keys}`}
          </span>
        ) : (
          <span className={`json-${typeof value}`}>{JSON.stringify(value)}</span>
        )}
      </div>
      {open && expandable && (
        <div className="json-children">
          {pairs.slice(0, limit).map(([key, child]) => (
            <JSONNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
          {pairs.length > limit && (
            <button onClick={() => setLimit(limit + 100)}>
              Show next {Math.min(100, pairs.length - limit)} items
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function Code({
  text,
  extension,
  line: targetLine,
}: {
  text: string;
  extension: string;
  line?: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.split('\n'), [text]);
  const language =
    (
      {
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        sh: 'bash',
        html: 'markup',
        xml: 'markup',
        svg: 'markup',
      } as Record<string, string>
    )[extension] || extension;
  const virtual = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 22,
    overscan: 12,
  });
  useEffect(() => {
    if (targetLine)
      virtual.scrollToIndex(Math.min(lines.length - 1, targetLine - 1), { align: 'center' });
  }, [targetLine, lines.length, virtual]);
  return (
    <div className="code-scroll" ref={scroll} tabIndex={0} aria-label="File text">
      <div
        style={{
          height: virtual.getTotalSize(),
          minWidth: '100%',
          width: 'max-content',
          position: 'relative',
        }}
      >
        {virtual.getVirtualItems().map((item) => {
          const line = lines[item.index];
          const grammar = Prism.languages[language];
          // Highlighted HTML comes exclusively from Prism's escaping tokenizer, never from file HTML.
          const highlighted =
            grammar && line.length < 10000 ? Prism.highlight(line, grammar, language) : null;
          return (
            <div
              className={'code-line' + (item.index + 1 === targetLine ? ' evidence-line' : '')}
              key={item.key}
              style={{ position: 'absolute', top: item.start, height: item.size }}
            >
              <span className="line-number" aria-hidden="true">
                {item.index + 1}
              </span>
              {highlighted ? (
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              ) : (
                <code>{line}</code>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export default function TextPreview(context: PreviewContext) {
  const { resource, signal, services } = context;
  const [data, setData] = useState<{ text: string; truncated: boolean; binary: boolean } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [raw, setRaw] = useState(false);
  const evidenceLine =
    context.evidence?.anchor.kind === 'text' ? context.evidence.anchor.line : undefined;
  useEffect(() => {
    if (evidenceLine) setRaw(true);
  }, [evidenceLine]);
  useEffect(() => {
    void services
      .read(resource.id)
      .then((value) => {
        if (!signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message);
      });
  }, [resource.id, services, signal]);
  const json = useMemo(() => {
    if (!data || resource.entry.extension !== 'json' || data.truncated) return null;
    try {
      return { value: JSON.parse(data.text) as unknown };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [data, resource.entry.extension]);
  usePreviewCommands(
    context,
    useMemo(
      () => [
        {
          id: 'view-source',
          label: raw ? 'Show document' : 'Show source',
          aliases: ['vs'],
          available:
            !!data &&
            !data.binary &&
            ['md', 'markdown', 'mdx', 'json'].includes(resource.entry.extension),
          run: () => setRaw((value) => !value),
        },
      ],
      [raw, data, resource.entry.extension],
    ),
  );
  if (error) return <Empty icon="warning" title="Text could not be read" detail={error} />;
  if (!data) return <Loading />;
  if (data.binary)
    return (
      <Empty icon="file" title="Preview unavailable">
        {getState().bootstrap.platform === 'darwin' && (
          <button
            onClick={() => {
              void window.viewer.nativeFilePanel('preview', [resource.entry.path]).catch(report);
            }}
          >
            Quick Look in macOS
          </button>
        )}
        <button
          onClick={() => {
            void window.viewer.openExternal(resource.entry.path).catch(report);
          }}
        >
          Open in Default App
        </button>
      </Empty>
    );
  const ext = resource.entry.extension;
  const markdown = ['md', 'markdown', 'mdx'].includes(ext);
  return (
    <div className="text-viewer">
      {(markdown || ext === 'json') && (
        <PreviewToolbar context={context}>
          <button className={!raw ? 'selected' : ''} onClick={() => setRaw(false)}>
            {markdown ? 'Document' : 'Tree'}
          </button>
          <button className={raw ? 'selected' : ''} onClick={() => setRaw(true)}>
            Source
          </button>
        </PreviewToolbar>
      )}
      {data.truncated && (
        <p className="inline-warning">
          Showing the first 4 MB. Open in another app to read the entire file.
        </p>
      )}
      {['csv', 'tsv'].includes(ext) ? (
        <DelimitedTable
          text={data.text}
          delimiter={ext === 'tsv' ? '\t' : ','}
          anchor={context.evidence?.anchor.kind === 'cells' ? context.evidence.anchor : undefined}
        />
      ) : markdown && !raw ? (
        <article className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ children }) => <span className="markdown-link">{children}</span>,
              img: ({ alt }) => <span className="muted">[Image: {alt || 'external image'}]</span>,
            }}
          >
            {data.text}
          </ReactMarkdown>
        </article>
      ) : json && !raw ? (
        'error' in json ? (
          <div className="json-scroll">
            <p className="error">Invalid JSON: {json.error}</p>
            <Code text={data.text} extension={ext} />
          </div>
        ) : (
          <div className="json-scroll">
            <JSONNode name="root" value={json.value} />
          </div>
        )
      ) : (
        <Code text={data.text} extension={ext} line={evidenceLine} />
      )}
    </div>
  );
}
