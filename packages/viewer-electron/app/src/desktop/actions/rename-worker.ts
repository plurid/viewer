import { workerPort } from '../workers/worker-port';
import { renameNames, type RenameInput } from '../../domain/operations/batch-rename';
import { errorMessage } from '../../domain/errors';
import type { ClientMethods, WorkerRequest } from '../workers/utility-client';

export type RenameMethods = { rename: { args: [input: RenameInput]; reply: string[] } };
workerPort.on('message', (event) => {
  const request = event.data as WorkerRequest<RenameMethods & ClientMethods>;
  try {
    const value = request.method === 'rename' ? renameNames(request.args[0]) : true;
    workerPort.postMessage({ id: request.id, value });
  } catch (error) {
    workerPort.postMessage({ id: request.id, error: errorMessage(error) });
  }
});
