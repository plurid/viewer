import { FolderSizes } from './folder-sizes';

// Independent of indexing, SQLite, document extraction and recursive watching.
const port = process.parentPort;
const sizes = new FolderSizes((value) => port.postMessage({ event: 'folder-size', value }));
port.on('message', (event) => {
  const request = event.data as { id: string; method: string; args: unknown[] };
  try {
    let value: unknown;
    if (request.method === 'size-start') value = sizes.start(request.args[0] as string[]);
    else if (request.method === 'size-get') value = sizes.get(request.args[0] as string);
    else if (request.method === 'size-cancel') sizes.cancel(request.args[0] as string);
    else if (request.method === 'close') sizes.close();
    else throw new Error('Unknown folder-size operation.');
    port.postMessage({ id: request.id, value });
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
