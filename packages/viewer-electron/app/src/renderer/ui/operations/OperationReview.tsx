import { useState } from 'react';
import type { OperationIntent, OperationPlan } from '../../../domain/operations/operation-plan';
import { Dialog, Loading } from '../primitives';
import { setOperationsOpen } from '../../state/store';
import { transformDescription } from '../../../domain/operations/transforms';
import { sendWindowEvent, useWindowEvent } from '../../app/window-events';
export function reviewOperationPlan(plan: OperationPlan) {
  sendWindowEvent('viewer:operation-plan', plan);
}
export async function prepareOperationReview(title: string, intents: OperationIntent[]) {
  const plan = await window.viewer.operationPlan({ kind: 'prepare', title, intents });
  if (!Array.isArray(plan)) reviewOperationPlan(plan);
}
export function OperationReviewControls() {
  const [plan, setPlan] = useState<OperationPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkpoint, setCheckpoint] = useState(false);
  const [page, setPage] = useState(0);
  useWindowEvent('viewer:operation-plan', (plan) => {
    setPlan(plan);
    setError('');
    setCheckpoint(false);
    setPage(0);
  });
  if (!plan) return null;
  const selected = plan.rows.filter((row) => row.approved),
    start = page * 100;
  const close = () => {
    if (!busy) setPlan(undefined);
  };
  const edit = (id: string, value: Partial<OperationPlan['rows'][number]>) =>
    setPlan({
      ...plan,
      rows: plan.rows.map((row) => (row.id === id ? { ...row, ...value } : row)),
    });
  return (
    <Dialog wide title={plan.title} onClose={close} className="operation-review-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void window.viewer
            .operationPlan({
              kind: 'apply',
              id: plan.id,
              revision: plan.revision,
              checkpoint,
              rows: plan.rows.map(({ id, approved, destination, name }) => ({
                id,
                approved,
                destination,
                name,
              })),
            })
            .then(() => {
              setPlan(undefined);
              setOperationsOpen(true);
            })
            .catch((error: Error) => setError(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body operation-review-body">
          <p className="muted">
            {selected.length} of {plan.rows.length} changes selected. Source versions and folder
            permissions are checked again before the queued operations start.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setPlan({ ...plan, rows: plan.rows.map((row) => ({ ...row, approved: true })) })
              }
            >
              Select all changes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setPlan({ ...plan, rows: plan.rows.map((row) => ({ ...row, approved: false })) })
              }
            >
              Clear selection
            </button>
          </div>
          {plan.rows.slice(start, start + 100).map((row) => (
            <div className="operation-review-row" key={row.id}>
              <input
                aria-label={'Include ' + (row.source ?? row.name)}
                type="checkbox"
                disabled={busy}
                checked={row.approved}
                onChange={(event) => edit(row.id, { approved: event.target.checked })}
              />
              <div>
                <strong>
                  {row.kind} {row.source?.split('/').pop() ?? row.name}
                </strong>
                <span className="muted">{row.source}</span>
                {row.sources?.slice(1).map((source) => (
                  <span className="muted" key={source}>
                    {source}
                  </span>
                ))}
                {row.transform && <p>{transformDescription(row.transform)}</p>}
                {row.kind === 'rename' || row.kind === 'mkdir' || row.kind === 'convert' ? (
                  <label>
                    Name
                    <input
                      aria-label="Destination name"
                      disabled={busy}
                      value={row.name ?? ''}
                      onChange={(event) => edit(row.id, { name: event.target.value })}
                    />
                  </label>
                ) : null}
                {row.destination && (
                  <label>
                    Destination folder
                    <input
                      aria-label="Destination folder"
                      disabled={busy}
                      value={row.destination}
                      onChange={(event) => edit(row.id, { destination: event.target.value })}
                    />
                  </label>
                )}
                {row.issue && <p className="error">{row.issue}</p>}
              </div>
            </div>
          ))}
          {plan.rows.length > 100 && (
            <div className="settings-actions">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {start + 1}–{Math.min(start + 100, plan.rows.length)} of {plan.rows.length}
              </span>
              <button
                type="button"
                disabled={start + 100 >= plan.rows.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
          <label className="review-checkpoint">
            <input
              type="checkbox"
              disabled={busy}
              checked={checkpoint}
              onChange={(event) => setCheckpoint(event.target.checked)}
            />
            <span>
              Save a content checkpoint first
              <small>
                Files and mode within the configured retention budget. Existing destination contents
                are included for copy plans.
              </small>
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {busy && <Loading label="Checking and queuing changes…" />}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !selected.length || plan.status !== 'review'}
          >
            Apply {selected.length} {selected.length === 1 ? 'change' : 'changes'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
