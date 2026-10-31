import { effectiveWindowSettings } from '../../state/effective-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Prism from 'prismjs';
import { PreviewToolbar, usePreviewCommands } from '../controls';
import { headerItem } from '../../workspace/header-overflow';
import type { PreviewContext } from '../contracts';
import { Empty, Loading } from '../../ui/primitives';
import { DelimitedTable } from '../DataTable';
import { activeWorkspace, useViewer } from '../../state/store';
import { FileEditor } from '../../editing/FileEditor';
import { registerEditingPlane } from '../../editing/planes';
import { continuesEditing } from '../../editing/sessions';
import { editorFont } from '../../editing/font';
import { highlightedLines } from '../highlight';
import { languageFor, loadPrismGrammar } from '../languages';
import { MarkdownContent, usePrismGrammar } from '../Markdown';
import { usePreviewState } from '../state';
import { usePreviewScroll } from '../scroll';
import { StructuredTree } from '../StructuredTree';
import { UnknownFile } from '../UnknownFile';
import { decodeBinaryPlist } from '../../../domain/previews/data/plist';
import { isStructured, inspectStructured } from '../../../domain/previews/data/structured';
import type { ApplicationSettings } from '../../../domain/services';

function Code({
  text,
  language,
  line: targetLine,
  settings,
  wordWrap,
  state,
}: {
  text: string;
  /** Prism's grammar id, from the language table. */
  language?: string;
  line?: number;
  settings: ApplicationSettings['editor'];
  wordWrap: boolean;
  state?: PreviewContext['state'];
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
  usePreviewScroll(state, scroll, 'source', { restore: !targetLine });
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

/** A binary property list's values as JSON; it must fit in 8 MB. */
async function binaryPlist(url: string, signal: AbortSignal) {
  const bytes = new Uint8Array(await (await fetch(url, { signal })).arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw new Error('The property list is too large.');
  return JSON.stringify(decodeBinaryPlist(bytes), null, 2);
}

export default function TextPreview(context: TextPreviewProps) {
  const { resource, signal, services } = context;
  // a binary property list is decoded here and shown as the JSON it holds, read-only
  const [data, setData] = useState<{
    text: string;
    truncated: boolean;
    binary: boolean;
    decoded?: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  const [raw, setRaw] = usePreviewState(context, 'text.source', false);
  const markdownRef = useRef<HTMLElement>(null);
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
  usePreviewScroll(context.state, markdownRef, 'markdown', {
    ready: !!data && !raw && !editing,
    restore: !context.evidence,
  });
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
      .then(async ([value]) => {
        if (value.binary && resource.entry.extension === 'plist')
          value = await binaryPlist(resource.url, signal).then(
            (text) => ({ text, truncated: false, binary: false, decoded: true }),
            () => value,
          );
        if (!signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!signal.aborted) setError(error.message);
      });
  }, [resource.id, resource.url, resource.entry, services, signal, reading]);
  const editable = !!paneID && !!data && !data.binary && !data.truncated && !data.decoded;
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
        ? inspectStructured(data.text, data.decoded ? 'json' : resource.entry.extension)
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
        // the header's size and wrap buttons, which Essential leaves here
        {
          id: 'text-smaller',
          label: 'Smaller preview text',
          aliases: ['zoom out', 'font size'],
          available: !!data && !data.binary && scale > 0.6,
          run: () => setScale((value) => Math.max(0.6, value - 0.1)),
        },
        {
          id: 'text-larger',
          label: 'Larger preview text',
          aliases: ['zoom in', 'font size'],
          available: !!data && !data.binary && scale < 2.5,
          run: () => setScale((value) => Math.min(2.5, value + 0.1)),
        },
        {
          id: 'text-size-reset',
          label: 'Reset preview text size',
          aliases: ['actual size', 'font size'],
          available: !!data && !data.binary && scale !== 1,
          run: () => setScale(1),
        },
        {
          id: 'text-wrap',
          label: wrap ? 'Stop wrapping lines' : 'Wrap lines',
          aliases: ['wrap', 'word wrap'],
          available: !!data && !data.binary,
          run: () => setWrap((value) => !value),
        },
      ],
      [raw, data, resource.entry.extension, setRaw, scale, setScale, wrap, setWrap],
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
  if (data.binary) return <UnknownFile {...context} />;
  const ext = resource.entry.extension;
  const markdown = ['md', 'markdown', 'mdx'].includes(ext);
  const language = languageFor(resource.entry)?.prism;
  return (
    <div className="text-viewer">
      {!(structured && !raw && !structured.error) && (
        <PreviewToolbar context={context}>
          {(markdown || isStructured(ext)) && (
            <>
              <button
                {...headerItem('document', 5, ['preview.view-source'])}
                className={!raw ? 'selected' : ''}
                onClick={() => setRaw(false)}
              >
                {markdown ? 'Document' : 'Tree'}
              </button>
              <button
                {...headerItem('source', 5, ['preview.view-source'])}
                className={raw ? 'selected' : ''}
                onClick={() => setRaw(true)}
              >
                Source
              </button>
            </>
          )}
          {editable && (
            <button
              {...headerItem('edit', 3, ['edit-file'])}
              title="Edit Text (⌘E)"
              onClick={startEditing}
            >
              Edit
            </button>
          )}
          <span className="toolbar-spacer" />
          {/* Essential leaves the text size to "…" */}
          {context.toolbar !== 'essential' && (
            <>
              <button
                {...headerItem('smaller', 8, ['preview.text-smaller'])}
                aria-label="Smaller preview text"
                disabled={scale <= 0.6}
                onClick={() => setScale((value) => Math.max(0.6, value - 0.1))}
              >
                −
              </button>
              <button
                {...headerItem('size', 8, ['preview.text-size-reset'])}
                title="Reset preview text size"
                onClick={() => setScale(1)}
              >
                {Math.round(textSettings.fontSize)} px
              </button>
              <button
                {...headerItem('larger', 8, ['preview.text-larger'])}
                aria-label="Larger preview text"
                disabled={scale >= 2.5}
                onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}
              >
                +
              </button>
            </>
          )}
          <button
            {...headerItem('wrap', 6, ['preview.text-wrap'])}
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            Wrap
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
          state={context.state}
          delimiter={ext === 'tsv' ? '\t' : ','}
          anchor={context.evidence?.anchor.kind === 'cells' ? context.evidence.anchor : undefined}
        />
      ) : markdown && !raw ? (
        <article className="markdown" ref={markdownRef}>
          <MarkdownContent
            text={data.text}
            path={context.resource.entry.path}
            openRelated={context.openRelated}
          />
        </article>
      ) : structured && !raw && !structured.error ? (
        <StructuredTree
          context={context}
          data={structured}
          viewControls={
            <>
              <button aria-pressed={true} onClick={() => setRaw(false)}>
                Tree
              </button>
              <button onClick={() => setRaw(true)}>Source</button>
              {editable && <button onClick={startEditing}>Edit</button>}
            </>
          }
        />
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
            state={context.state}
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
