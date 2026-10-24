import { UtilityClient } from '../workers/utility-client';
import type { RenameInput } from '../../domain/operations/batch-rename';
/** A fresh isolated worker gets two seconds. Timeout/cancel terminates that worker. */
export async function boundedRename(
  worker: string,
  input: RenameInput,
  signal: AbortSignal,
  backend?: 'process' | 'thread',
): Promise<string[]> {
  const client = new UtilityClient(worker, {
    name: 'Viewer rename preview',
    timeout: 2000,
    backend,
  });
  try {
    return await client.call<string[]>('rename', [input], signal);
  } finally {
    await client.close();
  }
}
