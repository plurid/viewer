import { entry } from './filesystem';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ApplicationSettings, IndexedQuery } from '../domain/services';
import { FileIndex } from './index-core';
import { extractDocument } from './formats';
import { workerPort } from './worker-port';
interface Request {
  id: string;
  method: 'init' | 'configure' | 'query' | 'status' | 'update' | 'extract' | 'cancel' | 'close';
  args: unknown[];
}
let index: FileIndex | undefined;
let watcher: FSWatcher | undefined;
let ocr: string | undefined;
const port = workerPort;
const extracted = new Map<string, Awaited<ReturnType<typeof extractDocument>>>();
const controllers = new Map<string, AbortController>();
let config: ApplicationSettings['search'];
let configurationQueue: Promise<void> = Promise.resolve();
async function configureNow(value: ApplicationSettings['search']) {
  config = value;
  index!.configure(config);
  await watcher?.close();
  if (value.paused || !value.roots.length) {
    watcher = undefined;
    return;
  }
  watcher = chokidar.watch(value.roots, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (file) =>
      value.exclusions.some((rule) =>
        rule.startsWith('/')
          ? file === rule || file.startsWith(rule + '/')
          : file.split('/').includes(rule),
      ),
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });
  watcher.on('all', (event, file) => {
    for (const key of extracted.keys()) if (key.startsWith(file + ':')) extracted.delete(key);
    void index?.update(file, event === 'unlink' || event === 'unlinkDir').catch(() => {});
  });
  watcher.on('error', () => port.postMessage({ event: 'index', value: index!.status() }));
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
          if (ready) port.postMessage({ event: 'index', value });
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
    } else if (request.method === 'query') value = index.query(request.args[0] as IndexedQuery);
    else if (request.method === 'status') value = index.status();
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
