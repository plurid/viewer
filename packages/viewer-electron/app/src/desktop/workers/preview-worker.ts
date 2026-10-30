import { errorMessage } from '../../domain/errors';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import type { SQLiteReply, SQLiteRequest } from '../../domain/previews/data/sqlite';
import type { DocumentData } from '../../domain/services';
import type { SavedPage } from '../../domain/previews/saved-page';
import { DocumentCache } from '../previews/document-cache';
import { readSQLite } from '../previews/sqlite';
import { readSavedPage } from '../previews/saved-pages';
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
  /** `format`, the extension the file is read as when its bytes confirmed it; `message`, one
   * message of a mailbox. */
  extract: {
    args: [
      file: string,
      pages: number | undefined,
      chapters: boolean,
      worksheet?: WorksheetWindow,
      format?: string,
      message?: number,
    ];
    reply: DocumentData;
  };
  /** An email's HTML body or a saved web page, with the parts it shows. */
  page: { args: [file: string, format: string, message?: number]; reply: SavedPage };
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
          request.args[4],
          request.args[5],
        );
        value = request.args[2] ? document : { ...document, chapters: undefined };
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'page') {
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        value = await readSavedPage(
          request.args[0],
          request.args[1],
          request.args[2],
          abort.signal,
        );
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
