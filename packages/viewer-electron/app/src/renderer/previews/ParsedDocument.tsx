import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FileEntry, Resource, ResourceRead } from '../../domain/contracts';
import type { PreviewContext } from './contracts';
import type { TextPreviewProps } from './modules/TextPreview';
import TextPreview from './modules/TextPreview';
import { PreviewToolbar, usePreviewCommands } from './controls';
import { usePreviewState } from './state';
import { Empty, Loading } from '../ui/primitives';
import { editingPlane, registerEditingPlane } from '../editing/planes';
import { continueEditing, continuesEditing } from '../editing/sessions';
import { activeWorkspace, report, useViewer } from '../state/store';
import { errorMessage } from '../../domain/errors';

/** What a module made of a file's text. Without a document, the file is shown as text. */
export interface ParsedText<T> {
  document?: T;
  /** Shown above the document, or above the text when there is none. */
  notice?: string;
}

/** Reads a file's text: the bounded resource read unless a module needs its own. */
export type SourceReader = (
  resource: Resource,
  services: PreviewContext['services'],
  signal: AbortSignal,
) => Promise<ResourceRead>;

export interface ParsedDocumentProps<T> {
  context: PreviewContext;
  /** The document view's name in its toggle and commands, such as Notebook. */
  label: string | ((document: T) => string);
  /** A module-level function: the text is parsed again only when it changes. */
  parse(read: ResourceRead, entry: FileEntry): ParsedText<T>;
  read?: SourceReader;
  /** A short count for the toolbar, such as `12 cells`. */
  summary?(document: T): string;
  children(document: T): ReactNode;
}

const readResource: SourceReader = (resource, services) => services.read(resource.id);

/**
 * A file shown as its parsed document, with Source showing it in the text preview, where it can
 * be edited. Source opens by itself for a search result's line, for Edit and for unsaved edits.
 */
export function ParsedDocument<T>({
  context,
  label,
  parse,
  read: reader = readResource,
  summary,
  children,
}: ParsedDocumentProps<T>) {
  const { resource, services, signal } = context;
  const paneID = context.editing?.paneID;
  const [read, setRead] = useState<ResourceRead | null>(null);
  const [error, setError] = useState('');
  // read again after an edit, a change on disk or a return from Source
  const [revision, setRevision] = useState(0);
  const [source, setSource] = usePreviewState(context, 'text.source', false);
  const editing = useRef(false);
  const bufferID = useViewer((state) => {
    const pane = paneID && activeWorkspace(state).panes.find((item) => item.id === paneID);
    return pane && pane.type === 'preview' ? pane.bufferID : undefined;
  });
  const editingAsked = !!paneID && (continuesEditing(paneID) || !!bufferID);
  const evidenceLine =
    context.evidence?.anchor.kind === 'text' ? context.evidence.anchor.line : undefined;
  useEffect(() => {
    if (editingAsked || evidenceLine) setSource(true);
  }, [editingAsked, evidenceLine, setSource]);
  useEffect(() => {
    let live = true;
    reader(resource, services, signal)
      .then((value) => {
        if (!live || signal.aborted) return;
        setError('');
        setRead(value);
      })
      .catch((reason: unknown) => {
        if (live && !signal.aborted) setError(errorMessage(reason));
      });
    return () => {
      live = false;
    };
  }, [reader, resource, services, signal, revision]);
  const parsed = useMemo(
    () => (read && !read.binary ? parse(read, resource.entry) : undefined),
    [parse, read, resource.entry],
  );
  const document = parsed?.document;
  const name = document === undefined ? '' : typeof label === 'string' ? label : label(document);
  const editable = !!read && !read.binary && !read.truncated;
  const choose = useCallback(
    async (next: boolean) => {
      if (!next && editing.current) {
        // leaving Source ends editing first, asking about unsaved edits
        await editingPlane(paneID)?.done?.();
        if (editing.current) return;
      }
      if (!next) setRevision((value) => value + 1);
      setSource(next);
    },
    [paneID, setSource],
  );
  const editingChanged = useCallback((active: boolean) => {
    const ended = editing.current && !active;
    editing.current = active;
    if (ended) setRevision((value) => value + 1);
  }, []);
  // In Source the text preview registers its own editing; here Edit opens Source and starts it.
  useEffect(() => {
    if (!paneID || source || document === undefined || !editable) return;
    return registerEditingPlane(paneID, {
      edit: () => {
        continueEditing(paneID, crypto.randomUUID());
        setSource(true);
      },
      dirty: () => false,
      changedOnDisk: () => setRevision((value) => value + 1),
    });
  }, [paneID, source, document, editable, setSource]);
  const commands = useMemo(
    () => [
      {
        id: 'view-source',
        label: source ? `Show ${name.toLowerCase()}` : 'Show source',
        aliases: ['vs'],
        run: () => choose(!source),
      },
    ],
    [source, name, choose],
  );
  // without a document the text preview is the whole view and owns the commands
  usePreviewCommands(
    document === undefined ? { ...context, commands: undefined } : context,
    commands,
  );
  const sourceProps = useMemo<TextPreviewProps>(
    () => ({ ...context, commands: undefined, onEditingChange: editingChanged }),
    [context, editingChanged],
  );
  if (error) return <Empty icon="warning" title="The file could not be read" detail={error} />;
  if (!read) return <Loading />;
  if (document === undefined)
    return (
      <div className="text-viewer parsed-document">
        {parsed?.notice && <p className="inline-warning">{parsed.notice}</p>}
        <TextPreview {...context} />
      </div>
    );
  return (
    <div className="text-viewer parsed-document">
      <PreviewToolbar context={context}>
        <button
          type="button"
          className={source ? '' : 'selected'}
          aria-pressed={!source}
          onClick={() => void choose(false).catch(report)}
        >
          {name}
        </button>
        <button
          type="button"
          className={source ? 'selected' : ''}
          aria-pressed={source}
          onClick={() => void choose(true).catch(report)}
        >
          Source
        </button>
        {summary && (
          <>
            <span className="toolbar-spacer" />
            <span className="muted tabular">{summary(document)}</span>
          </>
        )}
      </PreviewToolbar>
      {parsed?.notice && <p className="inline-warning">{parsed.notice}</p>}
      {source ? <TextPreview {...sourceProps} /> : children(document)}
    </div>
  );
}
