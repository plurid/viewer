/** A file operation's lifecycle; the first three mean it is not finished. */
export const jobStatuses = [
  'queued',
  'running',
  'collision',
  'completed',
  'cancelled',
  'failed',
] as const;
export type JobStatus = (typeof jobStatuses)[number];

/** Whether a job is still to finish: waiting, running, or stopped on a name collision. */
export function isActiveJob(job: { status: JobStatus }): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'collision';
}
