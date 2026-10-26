import { settledJob } from '../state/jobs';

export class OperationCancelled extends Error {
  constructor() {
    super('The file operation was cancelled.');
  }
}

/** Admission is not completion. A sequence waits through collisions and stops
 * after a cancelled or failed job, rather than queuing every following step. */
export async function operationOutcome(id: string): Promise<void> {
  const job = await settledJob(id);
  if (job.status === 'cancelled') throw new OperationCancelled();
  if (job.status === 'failed')
    throw new Error(
      job.errors.map((error) => error.message).join(' · ') || 'The file operation failed.',
    );
}
