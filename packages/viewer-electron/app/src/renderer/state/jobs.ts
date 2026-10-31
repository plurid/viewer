// File operation jobs as reported by the desktop service.
import type { OperationJob, OperationProgress } from '../../domain/contracts';
import { getState, subscribe, update, type ViewerState } from './core';
import { isActiveJob } from '../../domain/operations/jobs';
import { requestRefresh } from './refresh';

/** Resolves once the job reaches a final status, as reported to this window. */
export function settledJob(id: string): Promise<OperationJob> {
  return new Promise((resolve) => {
    let stop = () => {};
    const check = () => {
      const job = getState().jobs.find((job) => job.id === id);
      if (!job || !['completed', 'failed', 'cancelled'].includes(job.status)) return;
      stop();
      resolve(job);
    };
    stop = subscribe(check);
    check();
  });
}
export function setOperationsOpen(open: boolean, history = false): void {
  update({
    ...getState(),
    operationsOpen: open,
    operationsHistory:
      history || getState().jobs.some((job) => !job.dismissed && job.status === 'failed'),
    acknowledgedJobs: open
      ? [
          ...new Set([
            ...getState().acknowledgedJobs,
            ...getState()
              .jobs.filter((job) => job.status === 'failed')
              .map((job) => job.id),
          ]),
        ]
      : getState().acknowledgedJobs,
  });
}
export function needsOperations(state = getState()): boolean {
  return state.jobs.some(isActiveJob) || needsOperationsAttention(state);
}
export function needsOperationsAttention(state = getState()): boolean {
  return state.jobs.some(
    (job) =>
      job.status === 'collision' ||
      (!job.dismissed && job.status === 'failed' && !state.acknowledgedJobs.includes(job.id)),
  );
}
/** The jobs Undo and Redo can reach, as a string: unchanged while a job only makes progress. */
export function undoSignature(state: ViewerState): string {
  return (
    state.jobs.length +
    ':' +
    state.jobs
      .filter((job) => job.undoable || job.redoable)
      .map((job) => job.id + (job.undoable ? 'u' : '') + (job.redoable ? 'r' : ''))
      .join(',')
  );
}
export function setJobs(jobs: OperationJob[]): void {
  // A jobs() reply can race newer IPC events. It must never rewind a job.
  const merged = new Map(jobs.map((job) => [job.id, job]));
  for (const job of getState().jobs) {
    const fetched = merged.get(job.id);
    if (!fetched || job.revision > fetched.revision) merged.set(job.id, job);
  }
  for (const job of merged.values()) receiveJob(job);
}
const undoableSince = new Map<string, number>(),
  redoableSince = new Map<string, number>();
/** When this window saw the job become undoable or redoable, so Undo and Redo can pick the
 * most recent action across file operations and lens edits. */
export function undoableTime(id: string): number {
  return undoableSince.get(id) ?? 0;
}
export function redoableTime(id: string): number {
  return redoableSince.get(id) ?? 0;
}
export function receiveJob(job: OperationJob): void {
  const old = getState().jobs.find((item) => item.id === job.id);
  if (old && job.revision < old.revision) return;
  if (job.undoable && !old?.undoable) undoableSince.set(job.id, Date.now());
  if (job.redoable && !old?.redoable) redoableSince.set(job.id, Date.now());
  const jobs = [job, ...getState().jobs.filter((item) => item.id !== job.id)].slice(0, 100);
  // a job that fell off the list can no longer be undone from this window
  if (undoableSince.size > jobs.length || redoableSince.size > jobs.length) {
    const listed = new Set(jobs.map((item) => item.id));
    for (const times of [undoableSince, redoableSince])
      for (const id of times.keys()) if (!listed.has(id)) times.delete(id);
  }
  const needsDecision =
    job.status === 'collision' ||
    (job.status === 'queued' && jobs.some((item) => item.status === 'collision'));
  update({
    ...getState(),
    jobs,
    operationsOpen:
      needsDecision ||
      (getState().operationsOpen &&
        (getState().operationsHistory ||
          jobs.some((job) => isActiveJob(job) || (!job.dismissed && job.status === 'failed')))),
    acknowledgedJobs:
      getState().operationsOpen && job.status === 'failed'
        ? [...new Set([...getState().acknowledgedJobs, job.id])]
        : getState().acknowledgedJobs,
  });
  if (old && old.status !== job.status && !isActiveJob(job))
    requestRefresh([
      ...job.sources,
      ...(job.destination ? [job.destination] : []),
      ...job.completed.flatMap((item) => [item.source, item.destination ?? '']).filter(Boolean),
    ]);
}
/** False asks the caller for an authoritative snapshot after an unknown/missed revision. */
export function receiveProgress(progress: OperationProgress): boolean {
  const job = getState().jobs.find((job) => job.id === progress.id);
  if (!job) return false;
  if (progress.revision <= job.revision) return true;
  if (progress.revision !== job.revision + 1 || job.status !== 'running') return false;
  update({
    ...getState(),
    jobs: getState().jobs.map((job) => (job.id === progress.id ? { ...job, ...progress } : job)),
  });
  return true;
}
