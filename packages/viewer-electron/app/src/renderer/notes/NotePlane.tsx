/* Private Markdown documents reuse Viewer's editor and reading surface. Closing
 * a plane detaches this view; the document and its pending write remain owned by Notes. */
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NotePane as NotePaneRecord } from '../../domain/contracts';
import {
  checklistItems,
  editChecklist,
  reorderChecklist,
  removeChecklistItem,
} from '../../domain/editing/notes';
import { errorMessage } from '../../domain/errors';
import { effectiveWindowSettings } from '../state/effective-ui';
import { report, updatePane, useViewer } from '../state/store';
import { registerEditingPlane, type EditorHandle } from '../editing/planes';
import { usePreviewControlsSlot } from '../previews/controls';
import { Empty, IconButton, Loading } from '../ui/primitives';
import {
  changeNote,
  flushNote,
  loadNote,
  noteGeneration,
  noteSession,
  noteLocked,
  subscribeNotes,
} from './sessions';
import { TrashNoteDialog } from './TrashNoteDialog';
import './notes.css';
import { DictationButton } from '../speech/DictationButton';

const TextEditor = lazy(() => import('../previews/editor/TextEditor'));
export default function NotePlane({ pane, visible }: { pane: NotePaneRecord; visible: boolean }) {
  useSyncExternalStore(subscribeNotes, noteGeneration);
  const session = noteSession(pane.id);
  const header = usePreviewControlsSlot(pane.id);
  const settings = useViewer((state) => effectiveWindowSettings(state));
  const [source, setSource] = useState(false),
    [error, setError] = useState(''),
    [item, setItem] = useState(''),
    [trashing, setTrashing] = useState(false);
  const editor = useRef<EditorHandle | null>(null);
  const current = useRef(session);
  current.current = session;
  const documentID = session?.document.id;
  const noteTitle = session?.title;
  const exportNote = async () => {
    const note = current.current;
    if (!note) return false;
    const exportID = crypto.randomUUID();
    try {
      return !!(await window.viewer.textSaveAs(
        note.text,
        note.title.replace(/[/\\]/g, '-') + '.md',
        exportID,
      ));
    } finally {
      await window.viewer.textEditEnd(exportID);
    }
  };
  const exported = useRef(exportNote);
  exported.current = exportNote;
  useEffect(() => {
    void loadNote(pane.id, pane.documentID, true).catch((error) => setError(errorMessage(error)));
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'note-changed' && event.id === current.current?.document.id)
        void loadNote(pane.id, event.id, true).catch(report);
    });
    return () => {
      stop();
      void flushNote(pane.id).catch(report);
    };
  }, [pane.id, pane.documentID]);
  useEffect(() => {
    if (
      documentID &&
      noteTitle !== undefined &&
      (pane.documentID !== documentID || pane.title !== noteTitle)
    )
      updatePane(pane.id, { documentID, title: noteTitle });
  }, [pane.id, pane.documentID, pane.title, documentID, noteTitle]);
  useEffect(
    () =>
      registerEditingPlane(pane.id, {
        // Closing a view never discards a privately saved note. Window close joins flushNotes.
        dirty: () => false,
        save: async () => {
          await flushNote(pane.id);
          return true;
        },
        saveAs: () => exported.current(),
        get editor() {
          return editor.current ?? undefined;
        },
      }),
    [pane.id],
  );
  if (!session)
    return error ? (
      <Empty title="Note unavailable" detail={error}>
        <button
          onClick={() => {
            setError('');
            void loadNote(pane.id, pane.documentID).catch((error) => setError(errorMessage(error)));
          }}
        >
          Retry
        </button>
      </Empty>
    ) : (
      <Loading label="Opening note…" />
    );
  const checklist = session.document.kind === 'checklist';
  const items = checklistItems(session.text);
  const changed =
    session.text !== session.document.text || session.title !== session.document.title;
  const toolbar = (
    <div className="preview-toolbar">
      <button aria-pressed={!source} onClick={() => setSource(false)}>
        {checklist ? 'Checklist' : 'Document'}
      </button>
      <button aria-pressed={source} onClick={() => setSource(true)}>
        Source
      </button>
      <span className="muted" role="status">
        {session.error ? 'Not saved' : changed || session.pending ? 'Saving…' : 'Saved privately'}
      </span>
      <span className="toolbar-spacer" />
      <DictationButton
        target={JSON.stringify([pane.id, documentID, session.text])}
        destination={`Append to ${session.title || 'note'}`}
        disabled={!visible || noteLocked(session.document.id)}
        onUse={(text) => {
          const note = current.current;
          if (!note) return;
          const addition = checklist
            ? text
                .split(/\n+/)
                .filter(Boolean)
                .map((line) => '- [ ] ' + line)
                .join('\n')
            : text;
          changeNote(pane.id, {
            text: (note.text ? note.text.replace(/\s*$/, '') + '\n\n' : '') + addition,
          });
        }}
      />
      <button onClick={() => void exportNote().catch(report)}>Export…</button>
      <button onClick={() => setTrashing(true)}>Move to Trash…</button>
    </div>
  );
  const markdown = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children }) => <span>{children}</span>,
        img: ({ alt }) => <span className="muted">[Image: {alt || 'image'}]</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
  return (
    <div
      className="note-plane"
      inert={noteLocked(session.document.id) || undefined}
      style={{ '--note-font-size': `${settings.previews.textFontSize}px` } as React.CSSProperties}
    >
      {header ? createPortal(toolbar, header) : toolbar}
      <label className="note-title">
        Title
        <input
          aria-label="Note title"
          maxLength={255}
          value={session.title}
          onChange={(event) => changeNote(pane.id, { title: event.target.value })}
        />
      </label>
      {session.document.recoveredFrom && (
        <p className="inline-warning">
          Another view changed the original. These edits were saved as a separate recovered note.
        </p>
      )}
      {session.error && (
        <p className="error" role="alert">
          {session.error}{' '}
          <button onClick={() => void flushNote(pane.id).catch(report)}>Retry save</button>
        </p>
      )}
      {source ? (
        <Suspense fallback={<Loading label="Opening editor…" />}>
          <TextEditor
            key={session.editorKey}
            text={session.text}
            language="markdown"
            label={`Edit ${session.title}`}
            settings={{ ...settings.editor, fontSize: settings.previews.textFontSize }}
            onHandle={(handle) => {
              editor.current = handle;
            }}
            onChange={() => {
              if (editor.current) changeNote(pane.id, { text: editor.current.text() });
            }}
            onFinal={(text) => changeNote(pane.id, { text })}
          />
        </Suspense>
      ) : checklist ? (
        <div className="note-reading">
          {items.length === 0 && <p className="muted">Add the first item below.</p>}
          <ol className="note-checklist">
            {items.map((row, index) => (
              <li key={row.line}>
                <input
                  type="checkbox"
                  aria-label={`Complete ${row.text}`}
                  checked={row.checked}
                  onChange={(event) =>
                    changeNote(pane.id, {
                      text: editChecklist(session.text, row.line, {
                        checked: event.target.checked,
                      }),
                    })
                  }
                />
                <input
                  aria-label={`Item ${index + 1}`}
                  value={row.text}
                  onChange={(event) =>
                    changeNote(pane.id, {
                      text: editChecklist(session.text, row.line, { text: event.target.value }),
                    })
                  }
                />
                <button
                  disabled={index === 0}
                  aria-label={`Move item ${index + 1} up`}
                  onClick={() =>
                    changeNote(pane.id, {
                      text: reorderChecklist(session.text, row.line, items[index - 1]!.line),
                    })
                  }
                >
                  Up
                </button>
                <button
                  disabled={index === items.length - 1}
                  aria-label={`Move item ${index + 1} down`}
                  onClick={() =>
                    changeNote(pane.id, {
                      text: reorderChecklist(session.text, row.line, items[index + 1]!.line),
                    })
                  }
                >
                  Down
                </button>
                <IconButton
                  icon="close"
                  label={`Remove item ${index + 1}`}
                  onClick={() =>
                    changeNote(pane.id, { text: removeChecklistItem(session.text, row.line) })
                  }
                />
              </li>
            ))}
          </ol>
          <form
            className="note-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (item.trim()) {
                changeNote(pane.id, {
                  text:
                    session.text +
                    (session.text && !session.text.endsWith('\n') ? '\n' : '') +
                    '- [ ] ' +
                    item.trim() +
                    '\n',
                });
                setItem('');
              }
            }}
          >
            <input
              aria-label="New checklist item"
              value={item}
              onChange={(event) => setItem(event.target.value)}
              placeholder="New item"
            />
            <button disabled={!item.trim()}>Add</button>
          </form>
        </div>
      ) : (
        <article className="markdown note-reading">
          {session.text ? (
            markdown(session.text)
          ) : (
            <button onClick={() => setSource(true)}>Start writing</button>
          )}
        </article>
      )}
      {!visible && <span className="sr-only">Note remains saved while out of view.</span>}
      {trashing && <TrashNoteDialog note={session.document} onClose={() => setTrashing(false)} />}
    </div>
  );
}
