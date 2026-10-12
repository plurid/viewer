import { entry } from './filesystem';
import type { ApplicationSettings, IndexedQuery, IndexStatus } from '../domain/services';
import { FileIndex } from './index-core';
import { IndexWatcher } from './index-watch';
import { extractDocument } from './formats';
import { workerPort } from './worker-port';
interface Request {
  id: string;
  method: 'init' | 'configure' | 'query' | 'status' | 'update' | 'extract' | 'cancel' | 'close';
  args: unknown[];
}
let index: FileIndex | undefined;
let watcher: IndexWatcher | undefined;
let ocr: string | undefined;
const port = workerPort;
const extracted = new Map<string, Awaited<ReturnType<typeof extractDocument>>>();
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
async function configureNow(value: ApplicationSettings['search']) {
  const retired = watcher?.stop();
  watcher = undefined;
  watchFailures.clear();
  config = value;
  index!.configure(config);
  await retired;
  if (value.paused || !value.roots.length) {
    watcher = undefined;
    return;
  }
  watcher = new IndexWatcher(
    value,
    async (file) => {
      for (const key of extracted.keys())
        if (key.startsWith(file + ':') || key.startsWith(file.replace(/\/$/, '') + '/'))
          extracted.delete(key);
      await index?.update(file);
    },
    (root) => {
      watchFailures.add(root);
      port.postMessage({ event: 'index', value: watchedStatus(index!.status()) });
    },
  );
}
function configure(value: ApplicationSettings['search']): Promise<void> {
  const work = configurationQueue.catch(() => {}).then(() => configureNow(value));
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
      let ready = false;
      index = await FileIndex.open(
        request.args[0] as string,
        (value) => {
          if (ready) port.postMessage({ event: 'index', value: watchedStatus(value) });
        },
        async (file) => (await extractDocument(file)).text,
        { roots: [], contentRoots: [], exclusions: [], paused: false },
      );
      // Persisted index rows are private derived data. Before any query/status
      // is served, limit them to the roots authorized in this session.
      ready = true;
      value = true;
    } else if (!index) throw new Error('File services are not ready.');
    else if (request.method === 'configure') {
      await configure(request.args[0] as ApplicationSettings['search']);
      value = true;
    } else if (request.method === 'query') {
      const result = index.query(request.args[0] as IndexedQuery);
      value = { ...result, status: watchedStatus(result.status) };
    } else if (request.method === 'status') value = watchedStatus(index.status());
    else if (request.method === 'update') {
      await index.update(request.args[0] as string, request.args[1] as boolean);
      value = true;
    } else if (request.method === 'extract') {
      const file = request.args[0] as string;
      const info = await entry(file);
      const key = file + ':' + info.identity + ':' + info.modified;
      const abort = new AbortController();
      controllers.set(request.id, abort);
      try {
        const document =
          extracted.get(key) ||
          (await extractDocument(file, {
            ocr,
            pages: request.args[1] as number | undefined,
            signal: abort.signal,
          }));
        extracted.set(key, document);
        let size = [...extracted.values()].reduce(
          (n, value) => n + JSON.stringify(value).length,
          0,
        );
        for (const [key, value] of extracted) {
          if (extracted.size <= 8 && size <= 32000000) break;
          extracted.delete(key);
          size -= JSON.stringify(value).length;
        }
        value = request.args[2] ? document : { ...document, chapters: undefined };
      } finally {
        controllers.delete(request.id);
      }
    } else if (request.method === 'cancel') {
      controllers.get(request.args[0] as string)?.abort();
      value = true;
    } else if (request.method === 'close') {
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
      error: error instanceof Error ? error.message : String(error),
      code: (error as NodeJS.ErrnoException).code,
    });
  }
});
