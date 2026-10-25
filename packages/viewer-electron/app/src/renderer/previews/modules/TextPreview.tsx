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
import { usePreviewState } from '../state';
import { StructuredTree } from '../StructuredTree';
import { isStructured, inspectStructured } from '../../../domain/previews/data/structured';
import type { ApplicationSettings } from '../../../domain/services';

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

function Code({
  text,
  language,
  line: targetLine,
  settings,
  wordWrap,
}: {
  text: string;
  /** Prism's grammar id, from the language table. */
  language?: string;
  line?: number;
  settings: ApplicationSettings['editor'];
  wordWrap: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.split('\n'), [text]);
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
      className={`code-scroll ${wordWrap ? 'is-wrapped' : ''}`}
      ref={scroll}
      tabIndex={0}
      aria-label="File text"
      style={editorFont(settings)}
    >
      <div
        style={{
          height: virtual.getTotalSize(),
          minWidth: '100%',
          width: wordWrap ? '100%' : 'max-content',
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
              data-index={item.index}
              ref={virtual.measureElement}
              style={{
                position: 'absolute',
                top: item.start,
                minHeight: settings.lineHeight,
                width: wordWrap ? '100%' : undefined,
              }}
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
  const [raw, setRaw] = usePreviewState(context, 'text.source', false);
  const preferences = useViewer((state) => effectiveWindowSettings(state));
  const [scale, setScale] = usePreviewState(context, 'text.scale', 1);
  const [wrap, setWrap] = usePreviewState(
    context,
    'text.wrap',
    preferences.previews.textWordWrap ?? false,
  );
  const textSettings = {
    ...preferences.editor,
    fontSize: (preferences.previews.textFontSize ?? 16) * scale,
    lineHeight: (preferences.previews.textLineHeight ?? 20) * scale,
  };
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
  }, [evidenceLine, setRaw]);
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
  const structured = useMemo(
    () =>
      data && !data.truncated && isStructured(resource.entry.extension)
        ? inspectStructured(data.text, resource.entry.extension)
        : null,
    [data, resource.entry.extension],
  );
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
            (['md', 'markdown', 'mdx'].includes(resource.entry.extension) ||
              isStructured(resource.entry.extension)),
          run: () => setRaw((value) => !value),
        },
      ],
      [raw, data, resource.entry.extension, setRaw],
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
      {
        <PreviewToolbar context={context}>
          {(markdown || isStructured(ext)) && (
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
          <span className="toolbar-spacer" />
          <button
            aria-label="Smaller preview text"
            disabled={scale <= 0.6}
            onClick={() => setScale((value) => Math.max(0.6, value - 0.1))}
          >
            −
          </button>
          <button title="Reset preview text size" onClick={() => setScale(1)}>
            {Math.round(textSettings.fontSize)} px
          </button>
          <button
            aria-label="Larger preview text"
            disabled={scale >= 2.5}
            onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}
          >
            +
          </button>
          <button aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>
            Wrap
          </button>
        </PreviewToolbar>
      }
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
      ) : structured && !raw && !structured.error ? (
        <StructuredTree context={context} data={structured} />
      ) : (
        <>
          {structured?.error && !raw && (
            <p className="inline-warning">
              {structured.error.startsWith('Tree inspection is limited')
                ? 'Tree unavailable'
                : `Invalid ${ext.toUpperCase()}`}
              : {structured.error}
            </p>
          )}
          <Code
            text={data.text}
            language={language}
            line={evidenceLine}
            settings={textSettings}
            wordWrap={wrap}
          />
        </>
      )}
    </div>
  );
}
