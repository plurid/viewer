import { workerPort } from '../workers/worker-port';
import { renameNames, type RenameInput } from '../../domain/operations/batch-rename';
workerPort.on('message', (event) => {
  const request = event.data as { id: string; method: string; args: unknown[] };
  try {
    const value = request.method === 'rename' ? renameNames(request.args[0] as RenameInput) : true;
    workerPort.postMessage({ id: request.id, value });
  } catch (error) {
    workerPort.postMessage({ id: request.id, error: (error as Error).message });
  }
});
