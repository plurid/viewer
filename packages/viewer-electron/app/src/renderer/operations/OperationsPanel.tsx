import { useState } from 'react';
import { formatBytes } from '../../domain/files';
import { report, setOperationsOpen, useViewer } from '../state/store';
import { IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';

export function OperationsPanel() {
  const jobs = useViewer((state) => state.jobs);
  const open = useViewer((state) => state.operationsOpen);
  const [all, setAll] = useState<Record<string, boolean>>({});
  if (!open) return null;
  return (
    <aside className="operations-panel" aria-label="File operations">
      <header>
        <strong>File operations</strong>
        <IconButton
          icon="close"
          label="Close operations"
          onClick={() => setOperationsOpen(false)}
        />
      </header>
      {!jobs.length && (
        <p className="muted panel-empty">Copy, move, rename, and Trash progress appears here.</p>
      )}
      {jobs.map((job) => (
        <section className={`operation operation-${job.status}`} key={job.id}>
          <div className="operation-title">
            <Icon
              name={
                job.kind === 'trash'
                  ? 'trash'
                  : job.kind === 'rename'
                    ? 'rename'
                    : job.kind === 'move'
                      ? 'move'
                      : 'copy'
              }
            />
            <strong>{job.kind[0].toUpperCase() + job.kind.slice(1)}</strong>
            <span className="muted">{job.status}</span>
            {['queued', 'running', 'collision'].includes(job.status) && (
              <IconButton
                icon="close"
                label="Cancel operation"
                onClick={() => {
                  void window.viewer.cancelJob(job.id).catch(report);
                }}
              />
            )}
          </div>
          <p title={job.current || job.destination || job.sources[0]}>
            {job.current || job.destination || job.sources[0]}
          </p>
          {['queued', 'running'].includes(job.status) && (
            <progress max={Math.max(job.itemsTotal, 1)} value={job.itemsDone} />
          )}
          <div className="operation-count muted">
            {job.itemsDone} / {job.itemsTotal} items{' '}
            {job.bytesDone > 0 && `· ${formatBytes(job.bytesDone)} transferred`}
          </div>
          {job.collision && (
            <div className="collision">
              <strong>“{job.collision.destination.split(/[\\/]/).pop()}” already exists.</strong>
              <p>Replace sends the existing item to Trash.</p>
              <label>
                <input
                  type="checkbox"
                  checked={!!all[job.id]}
                  onChange={(event) => setAll({ ...all, [job.id]: event.target.checked })}
                />
                Use for remaining conflicts
              </label>
              <div className="collision-actions">
                {[
                  ['skip', 'Skip'],
                  ['keep-both', 'Keep both'],
                  ['replace', 'Replace'],
                ].map(([decision, label]) => (
                  <button
                    key={decision}
                    onClick={() => {
                      void window.viewer
                        .resolveCollision(job.id, decision as 'skip', !!all[job.id])
                        .catch(report);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {job.errors.map((error, index) => (
            <p className="error" key={index}>
              {error.path.split(/[\\/]/).pop()}: {error.message}
            </p>
          ))}
          {job.undoable && (
            <button
              onClick={() => {
                void window.viewer.undo(job.id).catch(report);
              }}
            >
              Undo {job.kind}
            </button>
          )}
        </section>
      ))}
    </aside>
  );
}
