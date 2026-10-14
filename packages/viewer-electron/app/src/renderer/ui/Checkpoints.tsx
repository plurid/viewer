import { useEffect, useState } from 'react';
import type { CheckpointRecord } from '../../domain/change-plan';
import { formatBytes } from '../../domain/files';
import { report, setOperationsOpen } from '../state/store';
import { Dialog, Loading } from './primitives';
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
  useEffect(() => {
    const show = () => {
      setOpen(true);
      setError('');
      void refresh().catch(report);
    };
    window.addEventListener('viewer:checkpoints', show);
    return () => window.removeEventListener('viewer:checkpoints', show);
  }, []);
  if (!open) return null;
  return (
    <Dialog title="Content checkpoints" onClose={() => !busy && setOpen(false)}>
      <div className="dialog-body project-controls">
        <p className="muted">
          {usage}. File contents and mode; Finder tags and ACLs are not included.
        </p>
        {!records ? (
          <Loading />
        ) : records.length === 0 ? (
          <p>No checkpoints. Enable one when reviewing batch changes.</p>
        ) : (
          records.map((record) => (
            <div className="project-control-row checkpoint-record" key={record.id}>
              <div>
                <strong>{record.title}</strong>
                <p className="muted">
                  {new Date(record.created).toLocaleString()} · {formatBytes(record.bytes)}
                </p>
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
                Restore to folder…
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
