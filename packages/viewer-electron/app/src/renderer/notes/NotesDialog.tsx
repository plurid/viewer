import { useEffect, useState } from 'react';
import type { NoteSummary } from '../../domain/editing/notes';
import { errorMessage } from '../../domain/errors';
import type { WorkspaceController } from '../workspace/context';
import { Dialog, Loading } from '../ui/primitives';
import './notes.css';
import { flushNotes } from './sessions';
import { TrashNoteDialog } from './TrashNoteDialog';
import { IconButton } from '../ui/primitives';

export function NotesDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceController;
  onClose(): void;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>(),
    [query, setQuery] = useState(''),
    [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [trashing, setTrashing] = useState<NoteSummary>();
  useEffect(() => {
    let live = true;
    void flushNotes()
      .then(() => window.viewer.notes({ kind: 'list' }))
      .then((reply) => {
        if (live && reply.kind === 'list') {
          setNotes(reply.notes);
          setProblems(reply.problems);
        }
      })
      .catch((error) => {
        if (live) setError(errorMessage(error));
      });
    const stop = window.viewer.onEvent((event) => {
      if (event.type === 'note-trash-finished' && event.trashed)
        setNotes((notes) => notes?.filter((note) => note.id !== event.id));
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  const open = async (note: NoteSummary) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await workspace.openNote(note.id);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const filtered = notes?.filter(
    (note) =>
      !query.trim() ||
      `${note.title} ${note.kind}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog title="Notes" onClose={onClose}>
      <div className="notes-library-body">
        <label className="field-label">
          Find note
          <input
            data-autofocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes and checklists"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {problems.map((problem) => (
          <p role="status" className="inline-warning" key={problem}>
            {problem}
          </p>
        ))}
        {!notes && !error && <Loading label="Opening notes…" />}
        {filtered?.length === 0 && (
          <p className="muted">
            {query
              ? 'No matching notes.'
              : 'Create a note or checklist from the Text menu. Closing its plane keeps it here.'}
          </p>
        )}
        <div className="notes-list">
          {filtered?.map((note) => (
            <div className="notes-library-row" key={note.id}>
              <button disabled={busy} onClick={() => void open(note)}>
                <strong>{note.title}</strong>
                <small>
                  {note.kind === 'checklist' ? 'Checklist' : 'Markdown note'} ·{' '}
                  {new Date(note.updated).toLocaleString()}
                </small>
              </button>
              <IconButton
                icon="trash"
                label={`Move ${note.title} to Trash`}
                disabled={busy}
                onClick={() => setTrashing(note)}
              />
            </div>
          ))}
        </div>
      </div>
      <footer>
        <button onClick={onClose}>Done</button>
      </footer>
      {trashing && (
        <TrashNoteDialog
          note={trashing}
          onClose={() => setTrashing(undefined)}
          onTrashed={() => setNotes((notes) => notes?.filter((note) => note.id !== trashing.id))}
        />
      )}
    </Dialog>
  );
}
