import { errorMessage } from '../../domain/errors';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import type { SQLiteReply, SQLiteRequest } from '../../domain/previews/data/sqlite';
import type { DocumentData } from '../../domain/services';
import { DocumentCache } from '../previews/document-cache';
import { readSQLite } from '../previews/sqlite';
import type { ClientMethods, WorkerRequest } from './utility-client';
import { workerPort } from './worker-port';

/**
 * Reading documents for previews, apart from the search index. In the index's worker a preview
 * waited for the index to open and for every step of a crawl: a 2 KB book took seconds. The cache
 * is keyed by each file's version, so a changed file is read again without any watcher.
 */
export type PreviewMethods = {
  /** Answers once the worker runs: `warmPreviews` starts it while the window is idle. */
  ready: { args: []; reply: true };
  extract: {
    args: [file: string, pages: number | undefined, chapters: boolean, worksheet?: WorksheetWindow];
    reply: DocumentData;
  };
  /** SQLite reads synchronously, here rather than in the process that draws windows. */
  sqlite: { args: [file: string, request: SQLiteRequest]; reply: SQLiteReply };
};

const documents = new DocumentCache();
const controllers = new Map<string, AbortController>();
const port = workerPort;
port.on('message', async (event) => {
  const request = event.data as WorkerRequest<PreviewMethods & ClientMethods>;
  try {
    let value: unknown;
    if (request.method === 'ready') value = true;
    else if (request.method === 'extract') {
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        const document = await documents.read(
          request.args[0],
          request.args[1],
          abort.signal,
          request.args[3],
        );
        value = request.args[2] ? document : { ...document, chapters: undefined };
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'sqlite') {
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        value = await readSQLite(request.args[0], request.args[1], { signal: abort.signal });
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'cancel') {
      controllers.get(request.args[0])?.abort();
      value = true;
    } else if (request.method === 'close') {
      for (const abort of controllers.values()) abort.abort();
      documents.invalidate();
      value = true;
    } else throw new Error('Unknown preview operation.');
    port.postMessage({ id: request.id, value });
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: errorMessage(error),
      code: (error as NodeJS.ErrnoException).code,
    });
  }
});
