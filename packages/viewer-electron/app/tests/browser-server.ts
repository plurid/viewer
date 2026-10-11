import { createServer } from 'vite';
import { rename, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import rendererConfig from '../vite.renderer.config';
import { createFixtures } from './fixtures';
import { Resources } from '../src/desktop/resources';
import { Operations } from '../src/desktop/operations';
import { Watchers } from '../src/desktop/watchers';
import { Search } from '../src/desktop/search';
import { Storage } from '../src/desktop/storage';
import { entry, list } from '../src/desktop/filesystem';
import type {
  ApiMethod,
  DesktopEvent,
  OperationRequest,
  SavedState,
  SearchRequest,
  Resource,
} from '../src/domain/contracts';

const fixture = await createFixtures();
const clients = new Set<ServerResponse>();
const emit = (event: DesktopEvent) => {
  for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
};
const resources = new Resources();
const watchers = new Watchers(emit);
const search = new Search((batch) => emit({ type: 'search', batch }));
const trash = path.join(fixture.root, 'trash');
await mkdir(trash);
const operations = new Operations(
  (file) => rename(file, path.join(trash, path.basename(file) + crypto.randomUUID())),
  (job) => emit({ type: 'job', job }),
);
const storage = new Storage(path.join(fixture.root, 'state.json'));
await storage.save(fixture.state);
let clipboard: { paths: string[]; cut: boolean } | null = null;
const resourceURL = (value: Resource) => ({
  ...value,
  url: value.url.replace('viewer-resource://', 'http://127.0.0.1:4173/__test/resource/'),
});
function scoped(file: string): string {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(fixture.root + path.sep))
    throw new Error('Verification is limited to the synthetic fixture folder.');
  return resolved;
}
async function invoke(method: ApiMethod, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'bootstrap':
      return {
        home: fixture.files,
        platform: 'darwin',
        locations: [
          { name: 'Studio', path: fixture.files },
          ...['Models', 'Documents', 'Images', 'Data', 'Source', 'Transfers'].map((name) => ({
            name,
            path: path.join(fixture.files, name),
          })),
        ],
        ...(await storage.load()),
        openPaths: [],
      };
    case 'chooseFolder':
      return fixture.files;
    case 'list':
      return list(scoped(args[0] as string));
    case 'stat':
      return entry(scoped(args[0] as string));
    case 'watch':
      return watchers.add(scoped(args[0] as string), args[1] as string);
    case 'unwatch':
      return watchers.remove(args[0] as string);
    case 'search': {
      const request = args[0] as SearchRequest;
      return search.start({ ...request, root: scoped(request.root) });
    }
    case 'cancelSearch':
      return search.cancel(args[0] as string);
    case 'operate': {
      const request = args[0] as OperationRequest;
      request.sources.forEach(scoped);
      if (request.destination) scoped(request.destination);
      return operations.start(request);
    }
    case 'jobs':
      return operations.all();
    case 'cancelJob':
      return operations.cancel(args[0] as string);
    case 'resolveCollision':
      return operations.resolve(args[0] as string, args[1] as 'skip', args[2] as boolean);
    case 'undo':
      return operations.undo(args[0] as string);
    case 'resource':
      return resourceURL(await resources.grant(scoped(args[0] as string)));
    case 'read':
      return resources.read(args[0] as string, args[1] as number | undefined);
    case 'release':
      return resources.release(args[0] as string);
    case 'archive':
      return resources.archive(args[0] as string);
    case 'archiveEntry':
      return resourceURL(await resources.archiveEntry(args[0] as string, args[1] as string));
    case 'save':
      return storage.save(args[0] as SavedState);
    case 'flushed':
    case 'textEdit':
      return;
    case 'clipboardWrite':
      clipboard = { paths: args[0] as string[], cut: args[1] as boolean };
      return;
    case 'clipboardRead':
      return clipboard;
    case 'reveal':
    case 'openExternal':
      return;
  }
}
const server = await createServer({
  ...rendererConfig,
  configFile: false,
  server: { ...rendererConfig.server, host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [
    ...(rendererConfig.plugins || []),
    {
      name: 'viewer-fixture-bridge',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url || '/', 'http://127.0.0.1:4173');
          if (url.pathname === '/__test/events') {
            response.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            });
            response.write(': connected\n\n');
            clients.add(response);
            request.on('close', () => clients.delete(response));
            return;
          }
          if (url.pathname.startsWith('/__test/resource/')) {
            const relative = url.pathname.slice('/__test/resource/'.length);
            const result = await resources.response(
              new Request(`viewer-resource://${relative}`, {
                headers: request.headers as Record<string, string>,
              }),
            );
            response.writeHead(result.status, Object.fromEntries(result.headers));
            if (result.body)
              Readable.fromWeb(result.body as import('node:stream/web').ReadableStream).pipe(
                response,
              );
            else response.end();
            return;
          }
          if (url.pathname === '/__test/api' && request.method === 'POST') {
            response.setHeader('Content-Type', 'application/json');
            let text = '';
            for await (const chunk of request) {
              text += chunk;
              if (text.length > 8 * 1024 * 1024) {
                response.writeHead(413);
                response.end();
                return;
              }
            }
            try {
              const { method, args } = JSON.parse(text);
              response.end(JSON.stringify({ ok: true, value: await invoke(method, args) }));
            } catch (error) {
              response.end(JSON.stringify({ ok: false, error: (error as Error).message }));
            }
            return;
          }
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `Viewer synthetic workspace: http://127.0.0.1:4173/tests/browser.html\nFixtures: ${fixture.files}`,
);
async function close() {
  resources.clear();
  search.close();
  await Promise.all([watchers.close(), operations.close()]);
  for (const client of clients) client.end();
  await server.close();
  await rm(fixture.root, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', () => {
  void close();
});
process.on('SIGTERM', () => {
  void close();
});
