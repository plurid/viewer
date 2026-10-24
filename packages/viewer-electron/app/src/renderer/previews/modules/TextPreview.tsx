import { effectiveWindowSettings } from '../../state/effective-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import type { PreviewContext } from '../contracts';
import { Empty, Loading } from '../../ui/primitives';
import { DelimitedTable } from '../DataTable';
import { activeWorkspace, getState, report, useViewer } from '../../state/store';
import { FileEditor } from '../../editing/FileEditor';
import { registerEditingPlane } from '../../editing/planes';
import { continuesEditing } from '../../editing/sessions';
import { editorFont } from '../../editing/font';
import { relativeLinkTarget } from '../../../domain/workspaces/planes';
import { highlightedLines } from '../highlight';
import { languageByID, languageFor, loadPrismGrammar } from '../languages';

/** A Prism grammar, loaded on first use: the component renders again once it is ready. */
function usePrismGrammar(id: string | undefined): Prism.Grammar | undefined {
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

/** A Markdown fence's code, highlighted in the language it names (`rust`, `ts`, `sh`). */
function FencedCode({ language, text }: { language: string; text: string }) {
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
  language,
  line: targetLine,
}: {
  text: string;
  /** Prism's grammar id, from the language table. */
  language?: string;
  line?: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.split('\n'), [text]);
  // the editor's font settings: a file reads as it edits
  const settings = useViewer((state) => effectiveWindowSettings(state).editor);
  const grammar = usePrismGrammar(language);
  // Whole-document tokens for ordinary files; very large ones fall back to single lines.
  const document = useMemo(
    () => (grammar && text.length <= 1_000_000 ? highlightedLines(text, grammar) : null),
    [text, grammar],
  );
  const virtual = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => settings.lineHeight,
    overscan: 12,
  });
  useEffect(() => {
    if (targetLine)
      virtual.scrollToIndex(Math.min(lines.length - 1, targetLine - 1), { align: 'center' });
  }, [targetLine, lines.length, virtual]);
  return (
    <div
      className="code-scroll"
      ref={scroll}
      tabIndex={0}
      aria-label="File text"
      style={editorFont(settings)}
    >
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
          if (line === undefined) return null;
          const segments = document?.[item.index];
          // Highlighted HTML comes exclusively from Prism's escaping tokenizer, never from file HTML.
          const highlighted =
            !segments && grammar && line.length < 10000
              ? Prism.highlight(line, grammar, language!)
              : null;
          return (
            <div
              className={'code-line' + (item.index + 1 === targetLine ? ' evidence-line' : '')}
              key={item.key}
              style={{ position: 'absolute', top: item.start, height: item.size }}
            >
              <span className="line-number" aria-hidden="true">
                {item.index + 1}
              </span>
              {segments ? (
                <code>
                  {segments.map((segment, index) =>
                    segment.className ? (
                      <span key={index} className={segment.className}>
                        {segment.text}
                      </span>
                    ) : (
                      segment.text
                    ),
                  )}
                </code>
              ) : highlighted ? (
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
export interface TextPreviewProps extends PreviewContext {
  /** A composed preview can reveal source editing without owning its buffers or editor session. */
  onEditingChange?(editing: boolean): void;
}

export default function TextPreview(context: TextPreviewProps) {
  const { resource, signal, services } = context;
  const [data, setData] = useState<{ text: string; truncated: boolean; binary: boolean } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [raw, setRaw] = useState(false);
  // a workspace plane's text may be edited where it is; one holding unsaved edits opens editing
  const paneID = context.editing?.paneID;
  const bufferID = useViewer((state) => {
    const pane = paneID && activeWorkspace(state).panes.find((item) => item.id === paneID);
    return pane && pane.type === 'preview' ? pane.bufferID : undefined;
  });
  // asked for (Edit, a Save As going on) takes the keys; edits restored at launch do not
  const [editing, setEditing] = useState<'asked' | 'restored' | false>(() =>
    !paneID ? false : continuesEditing(paneID) ? 'asked' : bufferID ? 'restored' : false,
  );
  const onEditingChange = context.onEditingChange;
  useEffect(() => onEditingChange?.(!!editing), [editing, onEditingChange]);
  const startEditing = useCallback(() => {
    onEditingChange?.(true);
    setEditing('asked');
  }, [onEditingChange]);
  // read again after editing, which may have saved
  const [reading, setReading] = useState(0);
  const evidenceLine =
    context.evidence?.anchor.kind === 'text' ? context.evidence.anchor.line : undefined;
  useEffect(() => {
    if (evidenceLine) setRaw(true);
  }, [evidenceLine]);
  useEffect(() => {
    // the file's grammar loads beside its text, so it shows highlighted from the first paint
    const grammar = languageFor(resource.entry)?.prism;
    void Promise.all([
      services.read(resource.id),
      grammar ? loadPrismGrammar(grammar).catch(() => undefined) : undefined,
    ])
      .then(([value]) => {
        if (!signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message);
      });
  }, [resource.id, resource.entry, services, signal, reading]);
  const editable = !!paneID && !!data && !data.binary && !data.truncated;
  useEffect(() => {
    if (!paneID || editing || !editable) return;
    return registerEditingPlane(paneID, {
      edit: startEditing,
      dirty: () => false,
      // saved in another app: read again in place, keeping the scroll position
      changedOnDisk: () => setReading((value) => value + 1),
    });
  }, [paneID, editing, editable, startEditing]);
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
  if (editing && paneID)
    return (
      <FileEditor
        resourceID={resource.id}
        paneID={paneID}
        bufferID={bufferID}
        header={context.commands?.header}
        focus={editing === 'asked'}
        onClose={() => {
          onEditingChange?.(false);
          setEditing(false);
          setReading((value) => value + 1);
        }}
      />
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
  const language = languageFor(resource.entry)?.prism;
  return (
    <div className="text-viewer">
      {(markdown || ext === 'json' || editable) && (
        <PreviewToolbar context={context}>
          {(markdown || ext === 'json') && (
            <>
              <button className={!raw ? 'selected' : ''} onClick={() => setRaw(false)}>
                {markdown ? 'Document' : 'Tree'}
              </button>
              <button className={raw ? 'selected' : ''} onClick={() => setRaw(true)}>
                Source
              </button>
            </>
          )}
          {editable && (
            <button title="Edit Text (⌘E)" onClick={startEditing}>
              Edit
            </button>
          )}
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
              // Only relative links to local files act, opening them beside this plane.
              a: ({ children, href }) => {
                const target =
                  context.openRelated && relativeLinkTarget(context.resource.entry.path, href);
                return target ? (
                  <button
                    type="button"
                    className="markdown-link"
                    title={target}
                    onClick={() => context.openRelated?.(target)}
                  >
                    {children}
                  </button>
                ) : (
                  <span className="markdown-link">{children}</span>
                );
              },
              img: ({ alt }) => <span className="muted">[Image: {alt || 'external image'}]</span>,
              // a fence that names its language is highlighted in it
              code: ({ className, children }) => {
                const fence = /language-([\w+#-]+)/.exec(className ?? '');
                return fence ? (
                  <FencedCode language={fence[1]!} text={String(children).replace(/\n$/, '')} />
                ) : (
                  <code className={className}>{children}</code>
                );
              },
            }}
          >
            {data.text}
          </ReactMarkdown>
        </article>
      ) : json && !raw ? (
        'error' in json ? (
          <div className="json-scroll">
            <p className="error">Invalid JSON: {json.error}</p>
            <Code text={data.text} language={language} />
          </div>
        ) : (
          <div className="json-scroll">
            <JSONNode name="root" value={json.value} />
          </div>
        )
      ) : (
        <Code text={data.text} language={language} line={evidenceLine} />
      )}
    </div>
  );
}
