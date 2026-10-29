import type { ApplicationSettings, IndexedQuery, IndexStatus } from '../../domain/services';
import { FileIndex } from '../search/index-core';
import { IndexWatcher } from '../search/index-watch';
import { extractDocument } from '../previews/formats';
import { inspectFile } from '../files/inspection';
import { readDrawingGeometry } from '../previews/drawing-geometry';
import type { DrawingGeometryOptions } from '../../domain/previews/drawings/geometry';
import { DocumentCache } from '../previews/document-cache';
import { workerPort } from './worker-port';
import { errorMessage } from '../../domain/errors';
import type { WorksheetWindow } from '../../domain/previews/documents/office';
import { containsPath } from '../files/containment';
interface Request {
  id: string;
  method:
    | 'init'
    | 'configure'
    | 'query'
    | 'query-snapshot'
    | 'status'
    | 'update'
    | 'extract'
    | 'inspect'
    | 'drawing-geometry'
    | 'cancel'
    | 'close';
  args: unknown[];
}
let index: FileIndex | undefined;
let watcher: IndexWatcher | undefined;
let ocr: string | undefined;
const port = workerPort;
const extracted = new DocumentCache();
const controllers = new Map<string, AbortController>();
let config: ApplicationSettings['search'];
let configurationQueue: Promise<void> = Promise.resolve();
const watchFailures = new Set<string>();
const watchedStatus = (value: IndexStatus): IndexStatus => ({
  ...value,
  roots: value.roots.map((root) =>
    watchFailures.has(root.path) ? { ...root, status: 'offline', errors: root.errors + 1 } : root,
  ),
});
async function configureNow(value: ApplicationSettings['search'], rebuild = false) {
  // The same configuration again (every folder pick sends one): the index crawls only the roots it
  // could not read, and the watchers stay unless one of them failed.
  if (!rebuild && !watchFailures.size && JSON.stringify(value) === JSON.stringify(config)) {
    index!.configure(value);
    return;
  }
  const retired = watcher?.stop();
  watcher = undefined;
  watchFailures.clear();
  config = value;
  index!.configure(config, rebuild);
  await retired;
  if (value.paused || !value.roots.length) {
    watcher = undefined;
    return;
  }
  watcher = new IndexWatcher(
    value,
    async (file) => {
      extracted.invalidate(file);
      await index?.update(file);
    },
    (root) => {
      watchFailures.add(root);
      port.postMessage({ event: 'index', value: watchedStatus(index!.status()) });
    },
  );
}
function configure(value: ApplicationSettings['search'], rebuild = false): Promise<void> {
  const work = configurationQueue.catch(() => {}).then(() => configureNow(value, rebuild));
  configurationQueue = work.then(
    () => {},
    () => {},
  );
  return work;
}
port.on('message', async (event) => {
  const request = event.data as Request;
  try {
    let value: unknown;
    if (request.method === 'init') {
      ocr = request.args[1] as string;
      // A retried initialization keeps an index that already opened.
      if (!index) {
        let ready = false;
        index = await FileIndex.open(
          request.args[0] as string,
          (value) => {
            if (ready) port.postMessage({ event: 'index', value: watchedStatus(value) });
          },
          async (file) => extractDocument(file),
          { roots: [], contentRoots: [], exclusions: [], paused: false },
        );
        // Persisted index rows are private derived data. Before any query/status
        // is served, limit them to the roots authorized in this session.
        ready = true;
      }
      value = true;
    } else if (!index) throw new Error('File services are not ready.');
    else if (request.method === 'configure') {
      await configure(request.args[0] as ApplicationSettings['search'], request.args[1] === true);
      value = true;
    } else if (request.method === 'query') {
      const result = index.query(request.args[0] as IndexedQuery);
      value = { ...result, status: watchedStatus(result.status) };
    } else if (request.method === 'query-snapshot') {
      const query = request.args[0] as IndexedQuery;
      if (
        watchedStatus(index.status()).roots.some(
          (root) =>
            root.status === 'offline' && (!query.root || containsPath(root.path, query.root)),
        )
      )
        throw new Error(
          'A search root stopped updating. Rebuild the index before taking a selection snapshot.',
        );
      value = index.snapshot(query);
    } else if (request.method === 'status') value = watchedStatus(index.status());
    else if (request.method === 'update') {
      await index.update(request.args[0] as string, request.args[1] as boolean);
      value = true;
    } else if (request.method === 'inspect') {
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        value = await inspectFile(request.args[0] as string, {
          content: request.args[1] === true,
          ocr: request.args[2] === true ? ocr : undefined,
          signal: abort.signal,
        });
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'drawing-geometry') {
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        value = await readDrawingGeometry(
          request.args[0] as string,
          request.args[1] as DrawingGeometryOptions,
          abort.signal,
        );
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'extract') {
      const file = request.args[0] as string;
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        const document = await extracted.read(
          file,
          request.args[1] as number | undefined,
          abort.signal,
          request.args[3] as WorksheetWindow | undefined,
        );
        value = request.args[2] ? document : { ...document, chapters: undefined };
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'cancel') {
      controllers.get(request.args[0] as string)?.abort();
      value = true;
    } else if (request.method === 'close') {
      extracted.invalidate();
      for (const abort of controllers.values()) abort.abort();
      await configurationQueue;
      await watcher?.close();
      watcher = undefined;
      await index.close();
      value = true;
    } else throw new Error('Unknown background operation.');
    port.postMessage({ id: request.id, value });
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: errorMessage(error),
      code: (error as NodeJS.ErrnoException).code,
    });
  }
});
