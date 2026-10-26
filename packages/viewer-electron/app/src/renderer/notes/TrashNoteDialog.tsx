import { useEffect, useState } from 'react';
import type { NoteDocument, NoteSummary } from '../../domain/editing/notes';
import { errorMessage } from '../../domain/errors';
import { Dialog, Loading } from '../ui/primitives';
import { flushNotes } from './sessions';

export function TrashNoteDialog({
  note,
  onClose,
  onTrashed,
}: {
  note: NoteSummary;
  onClose(): void;
  onTrashed?(): void;
}) {
  const [current, setCurrent] = useState<NoteDocument>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    void flushNotes()
      .then(() => window.viewer.notes({ kind: 'read', id: note.id }))
      .then((reply) => {
        if (reply.kind === 'document' && live) setCurrent(reply.document);
      })
      .catch((error) => {
        if (live) setError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [note.id, refresh]);
  const trash = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError('');
    try {
      const reply = await window.viewer.notes({
        kind: 'trash',
        id: current.id,
        revision: current.revision,
      });
      if (reply.kind !== 'trashed') throw new Error('The note was not moved to Trash.');
      onTrashed?.();
      onClose();
    } catch (error) {
      setError(errorMessage(error));
      setCurrent(undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Move to Trash?"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="notes-library-body">
        <strong>{current?.title ?? note.title}</strong>
        <p>
          This {note.kind === 'checklist' ? 'checklist' : 'note'} and its open views will close. Its
          saved document goes to the system Trash.
        </p>
        {!current && !error && <Loading label="Saving open drafts…" />}
        {error && (
          <p role="alert" className="error">
            {error}{' '}
            <button
              disabled={busy}
              onClick={() => {
                setError('');
                setRefresh((value) => value + 1);
              }}
            >
              Review latest
            </button>
          </p>
        )}
      </div>
      <footer>
        <button disabled={busy} data-autofocus onClick={onClose}>
          Cancel
        </button>
        <button className="danger" disabled={!current || busy} onClick={() => void trash()}>
          {busy ? 'Moving…' : 'Move to Trash'}
        </button>
      </footer>
    </Dialog>
  );
}
