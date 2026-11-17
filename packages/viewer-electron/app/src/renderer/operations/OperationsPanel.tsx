import { useEffect, useRef, useState } from 'react';
import type { CollisionDecision } from '../../domain/contracts';
import { formatBytes } from '../../domain/files/entries';
import { copyPaths, report, setOperationsOpen, useViewer } from '../state/store';
import { Dialog, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { PathLabel, useHome } from '../ui/PathLabel';
import { homeText } from '../../domain/files/path-label';
import { baseName } from '../../domain/workspaces/planes';
import { dialogOpen } from '../ui/modal';
import { isActiveJob } from '../../domain/operations/jobs';
import { plural } from '../../domain/plural';
import { operationLabel, statusLabel } from '../ui/status-labels';

export function OperationsPanel() {
  const jobs = useViewer((state) => state.jobs);
  const open = useViewer((state) => state.operationsOpen);
  const history = useViewer((state) => state.operationsHistory);
  const visibleJobs = jobs
    .filter((job) => isActiveJob(job) || (!job.dismissed && (history || job.status === 'failed')))
    .toSorted((a, b) => Number(b.status === 'collision') - Number(a.status === 'collision'));
  const finished = jobs.filter((job) => !job.dismissed && !isActiveJob(job));
  const [clearing, setClearing] = useState(false);
  const [all, setAll] = useState<Record<string, boolean>>({});
  const home = useHome();
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
    <Panel
      ref={panel}
      className="operations-panel"
      label="File Operations"
      role="dialog"
      title="File Operations"
      actions={
        <button
          disabled={clearing || !finished.length}
          onClick={() => {
            setClearing(true);
            void window.viewer
              .dismissJobs(finished.map((job) => job.id))
              .catch(report)
              .finally(() => setClearing(false));
          }}
        >
          Clear Finished
        </button>
      }
      onClose={() => setOperationsOpen(false)}
      closeLabel="Close operations"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !replace) {
          event.preventDefault();
          event.stopPropagation();
          setOperationsOpen(false);
        }
      }}
    >
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
            <strong>{operationLabel(job.kind)}</strong>
            <span className="muted">{statusLabel(job.status)}</span>
            {isActiveJob(job) && (
              <IconButton
                icon="close"
                label="Cancel operation"
                onClick={() => {
                  void window.viewer.cancelJob(job.id).catch(report);
                }}
              />
            )}
          </div>
          <p>
            <PathLabel path={job.current || job.destination || job.sources[0] || ''} />
          </p>
          {['queued', 'running'].includes(job.status) && (
            <progress
              max={job.progress === undefined ? Math.max(job.itemsTotal, 1) : 1}
              value={job.progress ?? job.itemsDone}
            />
          )}
          <div className="operation-count muted">
            {job.detail && <span>{homeText(job.detail, home)} · </span>}
            {job.itemsDone.toLocaleString('en-US')} of {plural(job.itemsTotal, 'item')}{' '}
            {job.bytesDone > 0 && `· ${formatBytes(job.bytesDone)} transferred`}
            {job.errorCount > 0 && ` · ${plural(job.errorCount, 'error')}`}
          </div>
          {job.collision && (
            <div className="collision">
              <strong>“{baseName(job.collision.destination)}” already exists.</strong>
              <p>
                {job.collision.replaceable === false
                  ? job.kind === 'mkdir' || job.kind === 'mkfile'
                    ? 'A new item can’t replace an existing one.'
                    : 'The existing item holds what you’re moving, so it can’t be replaced.'
                  : 'Replace moves the existing item to the Trash once its replacement is ready.'}
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
                  ['keep-both', 'Keep Both'],
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
              {baseName(error.path)}: {homeText(error.message, home)}
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
                    <PathLabel path={file!} layout="wrap" />
                  </p>
                ))}
              <button
                onClick={() => {
                  void copyPaths(
                    [job.recovery!.source, job.recovery!.destination, job.recovery!.staging].filter(
                      (file): file is string => !!file,
                    ),
                  ).catch(report);
                }}
              >
                Copy Recovery Paths
              </button>
            </div>
          )}
          {job.undoable && (
            <button
              onClick={() => {
                void window.viewer.undo(job.id).catch(report);
              }}
            >
              Undo {operationLabel(job.kind)}
            </button>
          )}
        </section>
      ))}
      {replace && (
        <Dialog title="Replace existing item?" onClose={() => setReplace(null)}>
          <div className="dialog-copy">
            <p>
              “{baseName(replace.path)}” moves to the Trash once its replacement is ready. If the
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
    </Panel>
  );
}
