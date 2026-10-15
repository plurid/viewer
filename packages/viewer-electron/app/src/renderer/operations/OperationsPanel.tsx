import { useEffect, useRef, useState } from 'react';
import type { CollisionDecision } from '../../domain/contracts';
import { formatBytes } from '../../domain/files';
import { report, setOperationsOpen, useViewer } from '../state/store';
import { Dialog, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { baseName } from '../../domain/planes';
import { dialogOpen } from '../ui/modal';

export function OperationsPanel() {
  const jobs = useViewer((state) => state.jobs);
  const open = useViewer((state) => state.operationsOpen);
  const history = useViewer((state) => state.operationsHistory);
  const visibleJobs = history
    ? jobs
    : jobs.filter((job) => ['queued', 'running', 'collision', 'failed'].includes(job.status));
  const [all, setAll] = useState<Record<string, boolean>>({});
  const [replace, setReplace] = useState<{ id: string; path: string; applyAll: boolean } | null>(
    null,
  );
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !dialogOpen() &&
        !(event.target as HTMLElement).closest('.operations-button')
      )
        setOperationsOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      if (!dialogOpen() && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <aside
      className="operations-panel"
      aria-label="File operations"
      role="dialog"
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !replace) {
          event.preventDefault();
          event.stopPropagation();
          setOperationsOpen(false);
        }
      }}
    >
      <header>
        <strong>File operations</strong>
        <IconButton
          icon="close"
          label="Close operations"
          onClick={() => setOperationsOpen(false)}
        />
      </header>
      {!visibleJobs.length && <p className="muted panel-empty">No recent file operations.</p>}
      {visibleJobs.map((job) => (
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
                      : job.kind === 'convert'
                        ? 'image'
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
            {job.errorCount > 0 &&
              ` · ${job.errorCount} ${job.errorCount === 1 ? 'error' : 'errors'}`}
          </div>
          {job.collision && (
            <div className="collision">
              <strong>“{baseName(job.collision.destination)}” already exists.</strong>
              <p>
                {job.collision.replaceable === false
                  ? 'The existing item cannot be replaced because it contains the source or is a folder.'
                  : 'Replace sends the existing item to Trash once its replacement is ready.'}
              </p>
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
                  ...(job.collision.replaceable === false ? [] : [['replace', 'Replace']]),
                ].map(([decision, label]) => (
                  <button
                    key={decision}
                    onClick={() => {
                      if (decision === 'replace') {
                        setReplace({
                          id: job.id,
                          path: job.collision!.destination,
                          applyAll: !!all[job.id],
                        });
                        return;
                      }
                      void window.viewer
                        .resolveCollision(job.id, decision as CollisionDecision, !!all[job.id])
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
              {baseName(error.path)}: {error.message}
            </p>
          ))}
          {job.recovery && (
            <div className="operation-recovery">
              <strong>Recovery paths</strong>
              {[
                ['Source', job.recovery.source],
                ['Destination', job.recovery.destination],
                ['Temporary copy', job.recovery.staging],
              ]
                .filter(([, file]) => file)
                .map(([label, file]) => (
                  <p key={label}>
                    <span className="muted">{label}: </span>
                    <span>{file}</span>
                  </p>
                ))}
              <button
                onClick={() => {
                  void window.viewer
                    .copyPaths(
                      [
                        job.recovery!.source,
                        job.recovery!.destination,
                        job.recovery!.staging,
                      ].filter((file): file is string => !!file),
                    )
                    .catch(report);
                }}
              >
                Copy recovery paths
              </button>
            </div>
          )}
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
      {replace && (
        <Dialog title="Replace existing item?" onClose={() => setReplace(null)}>
          <div className="dialog-copy">
            <p>
              “{baseName(replace.path)}” will be sent to Trash once its replacement is ready. If the
              replacement fails, Viewer puts it back when it can.
            </p>
            {replace.applyAll && <p>This applies to the remaining conflicts in this operation.</p>}
          </div>
          <footer>
            <button onClick={() => setReplace(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() => {
                if (
                  jobs.find((job) => job.id === replace.id)?.collision?.destination === replace.path
                )
                  void window.viewer
                    .resolveCollision(replace.id, 'replace', replace.applyAll)
                    .catch(report);
                setReplace(null);
              }}
            >
              Replace
            </button>
          </footer>
        </Dialog>
      )}
    </aside>
  );
}
