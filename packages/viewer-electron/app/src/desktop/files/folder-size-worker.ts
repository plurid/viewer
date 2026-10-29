import { FolderSizes } from './folder-sizes';
import { workerPort } from '../workers/worker-port';
import { errorMessage } from '../../domain/errors';
import type { FolderSizeTask } from '../../domain/files/metadata';
import type { ClientMethods, WorkerRequest } from '../workers/utility-client';

export type FolderSizeMethods = {
  'size-start': { args: [paths: string[]]; reply: FolderSizeTask };
  'size-get': { args: [id: string]; reply: FolderSizeTask };
  'size-cancel': { args: [id: string]; reply: undefined };
};

// Independent of indexing, SQLite, document extraction and recursive watching.
const port = workerPort;
const sizes = new FolderSizes((value) => port.postMessage({ event: 'folder-size', value }));
port.on('message', (event) => {
  const request = event.data as WorkerRequest<FolderSizeMethods & ClientMethods>;
  try {
    let value: unknown;
    if (request.method === 'size-start') value = sizes.start(request.args[0]);
    else if (request.method === 'size-get') value = sizes.get(request.args[0]);
    else if (request.method === 'size-cancel') sizes.cancel(request.args[0]);
    else if (request.method === 'close') sizes.close();
    else throw new Error('Unknown folder-size operation.');
    port.postMessage({ id: request.id, value });
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: errorMessage(error),
      code: (error as NodeJS.ErrnoException).code,
    });
  }
});
