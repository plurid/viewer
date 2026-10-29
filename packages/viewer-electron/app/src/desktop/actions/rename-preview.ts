import { UtilityClient } from '../workers/utility-client';
import type { RenameInput } from '../../domain/operations/batch-rename';
import type { WorkerBackend } from '../workers/utility-client';
import type { RenameMethods } from './rename-worker';
/** A fresh isolated worker gets two seconds. Timeout/cancel terminates that worker. */
export async function boundedRename(
  worker: string,
  input: RenameInput,
  signal: AbortSignal,
  backend?: WorkerBackend,
): Promise<string[]> {
  const client = new UtilityClient<RenameMethods>(worker, {
    name: 'Viewer rename preview',
    timeout: 2000,
    backend,
  });
  try {
    return await client.call('rename', [input], signal);
  } finally {
    await client.close();
  }
}
