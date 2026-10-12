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
import { FolderSizes } from '../src/desktop/folder-sizes';
import { Search } from '../src/desktop/search';
import { Storage } from '../src/desktop/storage';
import { entry, list } from '../src/desktop/filesystem';
import { SettingsService } from '../src/desktop/settings';
import { FileIndex } from '../src/desktop/index-core';
import { ActionPlanner } from '../src/desktop/actions/planner';
import { extractDocument } from '../src/desktop/formats';
import type {
  SettingsPatch,
  IndexedQuery,
  ActionRequest,
  ActionApproval,
} from '../src/domain/services';
import type {
  ApiMethod,
  DesktopEvent,
  OperationRequest,
  SavedState,
  SearchRequest,
  Resource,
} from '../src/domain/contracts';

const fixture = await createFixtures();
const permissionScenario = process.env.VIEWER_TEST_SCENARIO === 'folder-access';
const restrictedFolder = path.join(fixture.files, 'Models');
let permissionGranted = false;
let pickerRequests = 0;
const clients = new Set<ServerResponse>();
const emit = (event: DesktopEvent) => {
  for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
};
const resources = new Resources();
const sizes = new FolderSizes((task) => emit({ type: 'folder-size', task }));
const watchers = new Watchers(emit);
const search = new Search((batch) => emit({ type: 'search', batch }));
const trash = path.join(fixture.root, 'trash');
await mkdir(trash);
const operations = new Operations(
  (file) => rename(file, path.join(trash, path.basename(file) + crypto.randomUUID())),
  (job) => emit({ type: 'job', job }),
  (progress) => emit({ type: 'job-progress', progress }),
);
const storage = new Storage(path.join(fixture.root, 'state.json'));
await storage.save(fixture.state);
const index = await FileIndex.open(
  path.join(fixture.root, 'files.sqlite'),
  (status) => emit({ type: 'index', status }),
  async (file) => (await extractDocument(file)).text,
);
let indexSettings = '';
const settings = new SettingsService(
  fixture.root,
  fixture.files,
  () => true,
  (snapshot) => {
    emit({ type: 'settings', snapshot });
    const next = JSON.stringify(snapshot.settings.search);
    if (next !== indexSettings) {
      indexSettings = next;
      index.configure(snapshot.settings.search);
    }
  },
);
await settings.load(fixture.state);
index.configure(settings.snapshot().settings.search);
const actions = new ActionPlanner(fixture.root, {
  recipes: () => settings.snapshot().settings.recipes,
  providers: () => [],
  extract: (file, signal) => extractDocument(scoped(file), { signal }),
  generate: async () => {
    throw new Error('External providers are disabled in the synthetic browser fixture.');
  },
  operations,
  emit: (plan) => emit({ type: 'action', plan }),
  changed: (changes) => {
    emit({ type: 'file-changes', changes });
    for (const change of changes) {
      void index.update(change.source, true);
      void index.update(change.destination);
    }
  },
});
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
            name: permissionScenario && name === 'Models' ? 'Volumes' : name,
            path: path.join(fixture.files, name),
          })),
        ],
        ...(await storage.load()),
        settings: settings.snapshot(),
        openPaths: [],
      };
    case 'openSettings':
      return;
    case 'agentReviewList':
    case 'agentGrants':
    case 'executionList':
      return [];
    case 'settingsGet':
      return settings.snapshot();
    case 'settingsPatch': {
      const patches = args[0] as SettingsPatch[];
      for (const patch of patches)
        if (
          [
            'settings.search',
            'settings.search.roots',
            'settings.search.contentRoots',
            'settings.agents.roots',
          ].includes(patch.path)
        ) {
          const value = patch.value as string[] | { roots: string[]; contentRoots: string[] };
          const paths = Array.isArray(value) ? value : [...value.roots, ...value.contentRoots];
          paths.forEach(scoped);
        }
      return settings.patch(patches, args[1] as number);
    }
    case 'indexStatus':
      return index.status();
    case 'indexedQuery': {
      const query = args[0] as IndexedQuery;
      if (query.root) scoped(query.root);
      return index.query(query);
    }
    case 'indexRebuild':
      return index.configure(settings.snapshot().settings.search);
    case 'actionStart': {
      const request = args[0] as ActionRequest;
      request.context.sources.forEach(scoped);
      return actions.start(request);
    }
    case 'actionGet':
      return actions.get(args[0] as string);
    case 'actionList':
      return actions.all();
    case 'actionApply': {
      const approval = args[0] as ActionApproval;
      approval.rows.forEach((row) => scoped(row.destination));
      return actions.apply(approval);
    }
    case 'actionCancel':
      return actions.cancel(args[0] as string);
    case 'actionUndo':
      return actions.undo(args[0] as string);
    case 'actionRecover':
      return actions.recovery(args[0] as string);
    case 'actionExportSummary':
      return actions.exportSummary(args[0] as string, scoped(args[1] as string));
    case 'document':
      return extractDocument(resources.documentSource(args[0] as string));
    case 'thumbnail':
      return '';
    case 'contextPublish':
      return;
    case 'providerModels':
      return [];
    case 'providerCredential':
    case 'agentToken':
      throw new Error('Credentials and agents are only available in the native app.');
    case 'applications':
      return { applications: [], supported: false };
    case 'chooseApplication':
      return null;
    case 'openWith':
      return;
    case 'folderSizeStart':
      return sizes.start((args[0] as string[]).map(scoped));
    case 'folderSizeGet':
      return sizes.get(args[0] as string);
    case 'folderSizeCancel':
      return sizes.cancel(args[0] as string);
    case 'chooseFolder':
      if (permissionScenario && args[0] === restrictedFolder) {
        // The first simulated native picker is cancelled; the second authorizes
        // only the generated folder. No real volume or native grant is touched.
        if (++pickerRequests === 1) return null;
        permissionGranted = true;
        return restrictedFolder;
      }
      return fixture.files;
    case 'list':
      if (permissionScenario && args[0] === restrictedFolder && !permissionGranted)
        throw Object.assign(new Error('Choose this folder to allow access.'), {
          code: 'FILE_ACCESS_REQUIRED',
        });
      return list(scoped(args[0] as string));
    case 'stat':
      if (permissionScenario && args[0] === restrictedFolder && !permissionGranted)
        throw Object.assign(new Error('Choose this folder to allow access.'), {
          code: 'FILE_ACCESS_REQUIRED',
        });
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
              response.end(
                JSON.stringify({
                  ok: false,
                  error: (error as Error).message,
                  code: (error as NodeJS.ErrnoException).code,
                }),
              );
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
  sizes.close();
  resources.clear();
  search.close();
  await actions.close();
  await Promise.all([watchers.close(), operations.close(), index.close(), settings.flush()]);
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
