import { useState } from 'react';
import type { CheckpointRecord } from '../../../domain/operations/change-plan';
import { formatBytes } from '../../../domain/files/entries';
import { report, setOperationsOpen } from '../../state/store';
import { Dialog, Loading } from '../primitives';
import { useWindowEvent } from '../../app/window-events';
export function CheckpointControls() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<CheckpointRecord[]>();
  const [usage, setUsage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const reply = await window.viewer.checkpoints({ kind: 'list' });
    if (reply && 'records' in reply) {
      setRecords(reply.records);
      setUsage(formatBytes(reply.usedBytes) + ' of ' + formatBytes(reply.budgetBytes));
    }
  };
  useWindowEvent('viewer:checkpoints', () => {
    setOpen(true);
    setError('');
    void refresh().catch(report);
  });
  if (!open) return null;
  return (
    <Dialog title="Content Checkpoints" onClose={() => !busy && setOpen(false)}>
      <div className="dialog-body project-controls">
        <p className="muted">
          {usage && `${usage} used · `}Keeps contents and permissions, not Finder tags or ACLs.
        </p>
        {!records ? (
          <Loading />
        ) : records.length === 0 ? (
          <p>No checkpoints. Choose Keep a copy of the originals when you review a batch change.</p>
        ) : (
          records.map((record) => (
            <div className="project-control-row checkpoint-record" key={record.id}>
              <div>
                <strong>{record.title}</strong>
                <p className="muted">
                  {new Date(record.created).toLocaleString()} · {formatBytes(record.bytes)}
                </p>
                {record.status !== 'ready' && (
                  <small className="muted">
                    This copy was not finished, so it can’t be restored. Remove it.
                  </small>
                )}
              </div>
              <button
                disabled={busy || record.status !== 'ready'}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void window.viewer
                    .chooseFolder()
                    .then(async (destination) => {
                      if (!destination) return;
                      await window.viewer.checkpoints({
                        kind: 'restore',
                        id: record.id,
                        destination,
                      });
                      setOperationsOpen(true);
                      setOpen(false);
                    })
                    .catch((error: Error) => setError(error.message))
                    .finally(() => setBusy(false));
                }}
              >
                Restore to Folder…
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void window.viewer
                    .checkpoints({ kind: 'remove', id: record.id })
                    .then(refresh)
                    .catch((error: Error) => setError(error.message))
                    .finally(() => setBusy(false));
                }}
              >
                Remove
              </button>
            </div>
          ))
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button disabled={busy} onClick={() => setOpen(false)}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
