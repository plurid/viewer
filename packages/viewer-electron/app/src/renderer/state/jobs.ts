// File operation jobs as reported by the desktop service.
import type { OperationJob, OperationProgress } from '../../domain/contracts';
import { getState, subscribe, update } from './core';

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
    operationsHistory: history || getState().jobs.some((job) => job.status === 'failed'),
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
  return state.jobs.some(
    (job) =>
      ['queued', 'running', 'collision'].includes(job.status) ||
      (job.status === 'failed' && !state.acknowledgedJobs.includes(job.id)),
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
export function receiveJob(job: OperationJob): void {
  const old = getState().jobs.find((item) => item.id === job.id);
  if (old && job.revision < old.revision) return;
  const jobs = [job, ...getState().jobs.filter((item) => item.id !== job.id)].slice(0, 100);
  update({
    ...getState(),
    jobs,
    operationsOpen:
      getState().operationsOpen &&
      (getState().operationsHistory ||
        jobs.some((job) => ['queued', 'running', 'collision', 'failed'].includes(job.status))),
    acknowledgedJobs:
      getState().operationsOpen && job.status === 'failed'
        ? [...new Set([...getState().acknowledgedJobs, job.id])]
        : getState().acknowledgedJobs,
  });
  if (old && old.status !== job.status && ['completed', 'failed', 'cancelled'].includes(job.status))
    window.dispatchEvent(new CustomEvent('viewer:refresh'));
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
