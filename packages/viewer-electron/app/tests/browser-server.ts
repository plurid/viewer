import type { ComparisonRequest } from '../src/domain/comparison';
import type { OperationPlanRequest } from '../src/domain/operation-plan';
import type { FileInformationPatch } from '../src/domain/file-information';
import type { AgentClientRequest } from '../src/domain/agent-clients';
import type { ReadableStream } from 'node:stream/web';
import { createServer } from 'vite';
import { rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
import { Projects } from '../src/desktop/projects';
import { Workflows } from '../src/desktop/workflows';
import { WatchRules } from '../src/desktop/watch-rules';
import type { WatchRuleRequest } from '../src/domain/watch-rules';
import { Relationships } from '../src/desktop/relationships';
import type { RelationshipsRequest } from '../src/domain/relationships';
import { inspectFile } from '../src/desktop/inspection';
import type { WorkflowRequest } from '../src/domain/workflows';
import { Checkpoints } from '../src/desktop/checkpoints';
import { AgentClients } from '../src/desktop/agent-clients';
import { Comparisons } from '../src/desktop/comparison';
import { OperationPlans } from '../src/desktop/operation-plans';
import type { CheckpointRequest } from '../src/domain/change-plan';
import type { ProjectRequest } from '../src/domain/project';
import { entry, list } from '../src/desktop/filesystem';
import { SettingsService } from '../src/desktop/settings';
import { FileInformationService } from '../src/desktop/file-information';
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

const fixturePort = Number(process.env.VIEWER_TEST_PORT ?? 4173);
if (!Number.isInteger(fixturePort) || fixturePort < 1024 || fixturePort > 65535)
  throw new Error('Choose a valid fixture port.');
const fixtureOrigin = 'http://127.0.0.1:' + fixturePort;
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
const information = new FileInformationService(
  async (paths) => {
    paths.forEach(scoped);
  },
  (file) => emit({ type: 'folder-changed', path: path.dirname(file) }),
);
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
const agentClients = new AgentClients(path.join(fixture.root, 'agents'), async (paths) => {
  paths.forEach(scoped);
});
const projects = new Projects(async (paths) => {
  paths.forEach(scoped);
});
const checkpoints = new Checkpoints(
  path.join(fixture.root, 'checkpoints'),
  async (paths) => {
    paths.forEach(scoped);
  },
  () => settings.snapshot().settings.checkpoints.budgetBytes,
);
const comparisons = new Comparisons(async (paths) => {
  paths.forEach(scoped);
});
const operationPlans = new OperationPlans(
  path.join(fixture.root, 'plans'),
  operations,
  checkpoints,
  async (paths) => {
    paths.forEach(scoped);
  },
);
await storage.save(fixture.state);
const index = await FileIndex.open(
  path.join(fixture.root, 'files.sqlite'),
  (status) => emit({ type: 'index', status }),
  async (file) => extractDocument(file),
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
  snapshot: async (title, sources, signal) => (await checkpoints.create(title, sources, signal)).id,
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
const workflows: Workflows = new Workflows(path.join(fixture.root, 'workflows'), {
  access: async (paths) => {
    paths.forEach(scoped);
  },
  files: {
    inspect: (file, content, ocr, signal) =>
      inspectFile(scoped(file), { content, signal, ...(ocr ? { ocr: '' } : {}) }),
  },
  comparisons,
  plans: operationPlans,
  operations,
  actions,
  authorizeRun: (run) => watchRules.authorize(run),
  recipeForRun: (run, id) => watchRules.recipeForRun(run, id),
});
const watchRules: WatchRules = new WatchRules(path.join(fixture.root, 'workflows'), {
  access: async (paths) => {
    paths.forEach(scoped);
  },
  workflows,
  recipes: () => settings.snapshot().settings.recipes,
  changed: (rule) => emit({ type: 'watch-rule', rule }),
});
const relationships = new Relationships(path.join(fixture.root, 'relationships'), {
  access: async (paths) => {
    paths.forEach(scoped);
  },
  operations: async () => {
    await operations.load();
    return operations.observedLinks();
  },
  recipes: () => actions.all(),
  workflows: async () => {
    const result = await workflows.request({ kind: 'list' });
    return Array.isArray(result) ? result : [];
  },
});
let clipboard: { paths: string[]; cut: boolean } | null = null;
const trashFixturePaths = new Map<string, string>();
const trashFixtureID = (file: string) => {
  const id = createHash('sha256').update(file).digest('hex');
  trashFixturePaths.set(id, file);
  return id;
};
const trashFixturePath = (id: string) => {
  const file = trashFixturePaths.get(id);
  if (!file) throw new Error('This fixture item is unavailable. Refresh Trash.');
  return scoped(file);
};
const resourceURL = (value: Resource) => ({
  ...value,
  url: value.url.replace('viewer-resource://', fixtureOrigin + '/__test/resource/'),
});
function scoped(file: string): string {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(fixture.root + path.sep))
    throw new Error('Verification is limited to the synthetic fixture folder.');
  return resolved;
}
async function invoke(method: ApiMethod, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'watchRules':
      return watchRules.request(args[0] as WatchRuleRequest);
    case 'relationships':
      return relationships.request(args[0] as RelationshipsRequest);
    case 'workflow': {
      const request = args[0] as WorkflowRequest;
      if (request.kind === 'choose') return path.join(fixture.files, 'viewer.workflow.jsonc');
      return workflows.request(request);
    }
    case 'querySnapshot': {
      const query = args[0] as IndexedQuery;
      if (query.root) scoped(query.root);
      return index.snapshot(query);
    }
    case 'compare': {
      const request = args[0] as ComparisonRequest;
      if (request.kind === 'cancel') {
        comparisons.cancel(request.id);
        return null;
      }
      return comparisons.run(
        request.id,
        scoped(request.left),
        scoped(request.right),
        request.hashes,
      );
    }
    case 'operationPlan':
      return operationPlans.request(args[0] as OperationPlanRequest);
    case 'checkpoints': {
      const request = args[0] as CheckpointRequest;
      if (request.kind === 'list') return checkpoints.list();
      if (request.kind === 'estimate') return checkpoints.estimate(request.paths.map(scoped));
      if (request.kind === 'remove') {
        await checkpoints.remove(request.id);
        return null;
      }
      return checkpoints.restore(request.id, scoped(request.destination), operations);
    }
    case 'inspect':
      return inspectFile(scoped(args[0] as string), { content: args[1] === true });
    case 'project': {
      const request = args[0] as ProjectRequest;
      if (request.kind === 'choose') return path.join(fixture.files, 'viewer.project.jsonc');
      if (request.kind === 'read') return projects.read(scoped(request.file));
      return projects.save(scoped(request.file), request.revision, request.definition);
    }
    case 'bootstrap':
      return {
        home: fixture.files,
        platform: 'darwin',
        locations: [
          { name: 'Studio', path: fixture.files },
          { name: 'Applications', path: path.join(fixture.files, 'Applications') },
          { name: 'Trash', path: 'viewer://trash' },
          ...['Models', 'Documents', 'Images', 'Data', 'Source', 'Transfers'].map((name) => ({
            name: permissionScenario && name === 'Models' ? 'Volumes' : name,
            path: path.join(fixture.files, name),
          })),
        ],
        ...(await storage.load()),
        settings: settings.snapshot(),
        openPaths: [],
      };
    case 'fileInformation':
      return information.get(scoped(args[0] as string));
    case 'fileInformationUpdate':
      return information.update(
        scoped(args[0] as string),
        args[1] as string,
        args[2] as FileInformationPatch,
      );
    case 'openSettings':
      return;
    case 'agentReviewList':
    case 'agentGrants':
    case 'executionList':
      return [];
    case 'agentClients': {
      const request = args[0] as AgentClientRequest;
      if (request.kind === 'list') return agentClients.list();
      if (request.kind === 'create') throw new Error('Connect agent clients in the desktop app.');
      return agentClients.update(
        request.id,
        request.revision,
        request.kind === 'update' ? request.client : undefined,
      );
    }
    case 'agentAudit':
      return agentClients.history(args[0] as string | undefined);
    case 'agentStop':
      return;
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
    case 'providerPermissionGet':
      return null;
    case 'trashList': {
      const folder = args[0] ? trashFixturePath(args[0] as string) : undefined;
      const entries = folder
        ? (await list(folder)).entries
        : await Promise.all(
            [
              path.join(fixture.files, 'Documents'),
              path.join(fixture.files, 'Documents/Project brief.pdf'),
              path.join(fixture.files, 'Documents/Project notes.md'),
            ].map(entry),
          );
      const item = (value: (typeof entries)[number]) => ({
        id: trashFixtureID(value.path),
        name: value.name,
        directory: value.directory,
        size: value.size,
        modified: value.modified,
        location: 'Home',
        originalPath: value.path,
        previewable: value.kind === 'file',
        symbolicLink: value.kind === 'symlink',
      });
      return {
        revision: 'fixture-read-only',
        truncated: false,
        canEmpty: false,
        locations: [{ id: 'home', name: 'Home', state: 'ready' }],
        ancestors: folder ? [item(await entry(folder))] : [],
        items: entries.map(item),
      };
    }
    case 'trashPreview':
      return resourceURL(await resources.grant(trashFixturePath(args[0] as string)));
    case 'trashCopyPaths':
      return (args[0] as string[]).map(trashFixturePath);
    case 'volumesList':
      return [
        {
          path: fixture.files,
          name: 'Test volume',
          total: 1000000000,
          available: 750000000,
          removable: false,
          ejectable: false,
          readOnly: false,
        },
      ];
    case 'fileAccessList':
      return [];
    case 'fileAccessRevoke':
    case 'volumeEject':
      throw new Error(
        'Native volume and permission changes are only available in the installed app.',
      );
    case 'providerPermissionSet':
      throw new Error('Model data permissions are only available in the native app.');
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
    case 'redo':
      return operations.redo(args[0] as string);
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
    case 'copyPaths':
      (args[0] as string[]).forEach(scoped);
      clipboard = null;
      return;
    case 'nativeFilePanel':
      throw new Error('macOS Quick Look and sharing are available in the installed Viewer app.');
    case 'reveal':
    case 'openExternal':
      return;
  }
}
const server = await createServer({
  ...rendererConfig,
  configFile: false,
  // Each preserved fixture keeps its own dependency build, including locally synced Plurid.
  cacheDir: path.join(fixture.root, 'vite-cache'),
  server: { ...rendererConfig.server, host: '127.0.0.1', port: fixturePort, strictPort: true },
  plugins: [
    ...(rendererConfig.plugins || []),
    {
      name: 'viewer-fixture-bridge',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url || '/', fixtureOrigin);
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
            if (result.body) Readable.fromWeb(result.body as ReadableStream).pipe(response);
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
  `Viewer synthetic workspace: ${fixtureOrigin}/tests/browser.html\nFixtures: ${fixture.files}`,
);
async function close() {
  sizes.close();
  resources.clear();
  search.close();
  await actions.close();
  await watchRules.close();
  await Promise.all([watchers.close(), operations.close(), index.close(), settings.flush()]);
  for (const client of clients) client.end();
  await server.close();
  console.log('Fixtures preserved:', fixture.root);
  process.exit(0);
}
process.on('SIGINT', () => {
  void close();
});
process.on('SIGTERM', () => {
  void close();
});
