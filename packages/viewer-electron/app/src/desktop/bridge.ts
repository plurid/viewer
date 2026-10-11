import {
  nativeTheme,
  safeStorage,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
} from 'electron';
import { FileServices } from './file-services';
import { Applications } from './applications';
import { SettingsService } from './settings';
import { Credentials, Providers } from './providers';
import { Thumbnails } from './thumbnails';
import { ActionPlanner } from './actions/planner';
import { AgentBroker } from './agent-broker';
import type {
  ActionContext,
  ActionRequest,
  ActionApproval,
  SettingsPatch,
  IndexedQuery,
} from '../domain/services';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ApiMethod, ApiResult, DesktopEvent } from '../domain/contracts';
import { absolute, entry, list } from './filesystem';
import { Operations } from './operations';
import { Resources } from './resources';
import { Search } from './search';
import { Storage, stateSchema } from './storage';
import { Watchers } from './watchers';

const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const id = z.string().min(1).max(200);
const contextSchema = z.object({
  workspaceID: id,
  rootID: id,
  paneID: id,
  sources: z.array(localPath).max(2000),
  actor: z.enum(['user', 'agent']),
  recursive: z.boolean().optional(),
});
const schemas = {
  openSettings: z.tuple([]),
  settingsGet: z.tuple([]),
  settingsPatch: z.tuple([
    z.array(z.object({ path: z.string().max(200), value: z.unknown() })).max(100),
    z.number().int().min(0),
  ]),
  providerCredential: z.tuple([id, z.string().max(10000)]),
  providerModels: z.tuple([id]),
  indexStatus: z.tuple([]),
  indexedQuery: z.tuple([
    z.object({
      query: z.string().max(300),
      root: localPath.optional(),
      offset: z.number().int().min(0).max(1000000).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      showHidden: z.boolean().optional(),
      content: z.boolean().optional(),
      recursive: z.boolean().optional(),
    }),
  ]),
  indexRebuild: z.tuple([]),
  actionStart: z.tuple([
    z.object({
      recipeID: id,
      context: contextSchema,
      instructions: z.string().max(12000).optional(),
      options: z
        .object({
          template: z.string().max(1000).optional(),
          prefix: z.string().max(1000).optional(),
          suffix: z.string().max(1000).optional(),
          find: z.string().max(1000).optional(),
          replace: z.string().max(1000).optional(),
          start: z.number().int().min(0).optional(),
        })
        .optional(),
    }),
  ]),
  actionGet: z.tuple([id]),
  actionList: z.tuple([]),
  actionCancel: z.tuple([id]),
  actionUndo: z.tuple([id]),
  actionRecover: z.tuple([id]),
  actionApply: z.tuple([
    z.object({
      id,
      revision: z.number().int().min(0),
      rows: z.array(z.object({ id, destination: localPath, approved: z.boolean() })).max(4000),
    }),
  ]),
  actionExportSummary: z.tuple([id, localPath]),
  agentToken: z.tuple([]),
  contextPublish: z.tuple([contextSchema]),
  thumbnail: z.tuple([localPath, z.number().int().min(128).max(512)]),
  document: z.tuple([id]),
  bootstrap: z.tuple([]),
  list: z.tuple([localPath]),
  stat: z.tuple([localPath]),
  chooseFolder: z.tuple([]),
  reveal: z.tuple([localPath]),
  openExternal: z.tuple([localPath]),
  applications: z.tuple([z.array(localPath).min(1).max(2000)]),
  chooseApplication: z.tuple([]),
  openWith: z.tuple([z.array(localPath).min(1).max(2000), id]),
  folderSizeStart: z.tuple([z.array(localPath).min(1).max(10000)]),
  folderSizeGet: z.tuple([id]),
  folderSizeCancel: z.tuple([id]),
  watch: z.tuple([localPath, id]),
  unwatch: z.tuple([id]),
  search: z.tuple([
    z.object({ id, root: localPath, query: z.string().min(1).max(300), showHidden: z.boolean() }),
  ]),
  cancelSearch: z.tuple([id]),
  operate: z.tuple([
    z.object({
      kind: z.enum(['copy', 'move', 'duplicate', 'rename', 'mkdir', 'trash']),
      sources: z.array(localPath).max(10000),
      destination: localPath.optional(),
      name: z.string().max(255).optional(),
    }),
  ]),
  jobs: z.tuple([]),
  cancelJob: z.tuple([id]),
  resolveCollision: z.tuple([id, z.enum(['skip', 'keep-both', 'replace', 'cancel']), z.boolean()]),
  undo: z.tuple([id]),
  resource: z.tuple([localPath]),
  read: z.tuple([id, z.number().int().positive().optional()]),
  release: z.tuple([id]),
  archive: z.tuple([id]),
  archiveEntry: z.tuple([id, z.string().max(65536)]),
  save: z.tuple([stateSchema]),
  flushed: z.tuple([id]),
  clipboardWrite: z.tuple([z.array(localPath).max(10000), z.boolean()]),
  clipboardRead: z.tuple([]),
  textEdit: z.tuple([z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])]),
} satisfies Record<ApiMethod, z.ZodType>;
export class Desktop {
  readonly resources = new Resources();
  readonly operations: Operations;
  readonly watchers: Watchers;
  readonly search: Search;
  readonly storage: Storage;
  private ready = false;
  private windows = new Map<number, { window: BrowserWindow; role: 'viewer' | 'settings' }>();
  private window?: BrowserWindow;
  private bootstrapped = false;
  readonly settings: SettingsService;
  readonly files: FileServices;
  readonly applications: Applications;
  readonly credentials: Credentials;
  readonly providers: Providers;
  readonly actions: ActionPlanner;
  readonly agents: AgentBroker;
  readonly thumbnails = new Thumbnails();
  private context?: ActionContext;
  private indexConfiguration = '';
  private openPaths: string[] = [];
  private flushes = new Map<string, () => void>();
  private fileClipboard: { paths: string[]; cut: boolean; text: string } | null = null;
  constructor(
    dataPath: string,
    private allowedURL: (url: string) => boolean,
    private options: {
      openSettings(): Promise<void>;
      worker: string;
      ocr: string;
      applications: string;
      settingsChanged?(): void;
    },
  ) {
    const emit = (event: DesktopEvent) => this.emit(event);
    this.applications = new Applications(options.applications);
    this.settings = new SettingsService(
      dataPath,
      os.homedir(),
      () => nativeTheme.shouldUseDarkColors,
      (snapshot) => {
        this.options.settingsChanged?.();
        emit({ type: 'settings', snapshot: { ...snapshot, credentials: this.credentials.ids() } });
        void this.configureIndex(snapshot.settings.search).catch(() =>
          emit({
            type: 'index',
            status: {
              roots: snapshot.settings.search.roots.map((path) => ({
                path,
                status: 'offline',
                count: 0,
                errors: 1,
              })),
              count: 0,
              running: false,
            },
          }),
        );
      },
    );
    this.credentials = new Credentials(
      dataPath,
      (value) => safeStorage.encryptStringAsync(value),
      async (value) => (await safeStorage.decryptStringAsync(value)).result,
    );
    this.providers = new Providers(this.credentials);
    this.files = new FileServices(
      dataPath,
      options.worker,
      options.ocr,
      (status) => emit({ type: 'index', status }),
      (task) => emit({ type: 'folder-size', task }),
    );
    const changed = (changes: import('../domain/changes').FileChange[]) => {
      emit({ type: 'file-changes', changes });
      for (const change of changes) {
        void this.files.update(change.source, true).catch(() => {});
        void this.files.update(change.destination).catch(() => {});
      }
      this.thumbnails.clear();
    };
    this.operations = new Operations(
      (file) => shell.trashItem(file),
      (job) => emit({ type: 'job', job }),
      (progress) => emit({ type: 'job-progress', progress }),
      changed,
    );
    this.actions = new ActionPlanner(dataPath, {
      recipes: () => this.settings.snapshot().settings.recipes,
      providers: () => this.settings.snapshot().settings.providers,
      extract: (file, signal) => this.files.extract(file, signal),
      generate: (...args) => this.providers.generate(...args),
      operations: this.operations,
      emit: (plan) => emit({ type: 'action', plan }),
      changed,
    });
    this.agents = new AgentBroker(
      dataPath,
      () => this.settings.snapshot().settings,
      () => (this.window && !this.window.isDestroyed() ? this.context : undefined),
      this.files,
      this.actions,
    );
    this.watchers = new Watchers(emit);
    this.search = new Search((batch) => emit({ type: 'search', batch }));
    this.storage = new Storage(path.join(dataPath, 'viewer-state-v1.json'));
    ipcMain.handle(
      'viewer:request',
      async (event, method: unknown, args: unknown): Promise<ApiResult<unknown>> => {
        try {
          if (
            !this.windows.has(event.sender.id) ||
            event.senderFrame !== event.sender.mainFrame ||
            !this.allowedURL(event.senderFrame.url)
          )
            throw new Error('Untrusted IPC sender.');
          if (typeof method !== 'string' || !Object.hasOwn(schemas, method))
            throw new Error('Unknown Viewer API method.');
          const name = method as ApiMethod;
          const role = this.windows.get(event.sender.id)!.role;
          const settingsMethods: ApiMethod[] = [
            'settingsGet',
            'settingsPatch',
            'providerCredential',
            'providerModels',
            'indexStatus',
            'indexRebuild',
            'chooseFolder',
            'agentToken',
            'textEdit',
            'flushed',
          ];
          if (role === 'settings' && !settingsMethods.includes(name))
            throw new Error('This API is unavailable in Settings.');
          if (role !== 'settings' && ['providerCredential', 'agentToken'].includes(name))
            throw new Error('Manage credentials in Settings.');
          return {
            ok: true,
            value: await this.invoke(name, schemas[name].parse(args) as unknown[], event.sender.id),
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: (error as NodeJS.ErrnoException).code || 'VIEWER_ERROR',
          };
        }
      },
    );
  }
  private async configureIndex(
    config: import('../domain/services').ApplicationSettings['search'],
  ): Promise<void> {
    const key = JSON.stringify(config);
    if (key === this.indexConfiguration) return;
    this.indexConfiguration = key;
    try {
      await this.files.configure(config);
    } catch (error) {
      this.indexConfiguration = '';
      throw error;
    }
  }
  attach(window: BrowserWindow, role: 'viewer' | 'settings'): void {
    const sender = window.webContents.id;
    this.windows.set(sender, { window, role });
    if (role === 'viewer') this.window = window;
    window.on('closed', () => {
      this.windows.delete(sender);
      if (this.window === window) {
        this.window = undefined;
        this.ready = false;
        this.context = undefined;
        this.resources.clear();
      }
    });
  }
  emit(event: DesktopEvent): void {
    for (const { window, role } of this.windows.values())
      if (
        !window.isDestroyed() &&
        (role === 'viewer' || ['settings', 'index'].includes(event.type))
      )
        window.webContents.send('viewer:event', event);
  }
  open(paths: string[]): void {
    const normalized = paths.map(absolute);
    if (this.ready) this.emit({ type: 'open', paths: normalized });
    else this.openPaths.push(...normalized);
  }
  async flushSettings(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) return;
    const token = randomUUID();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.flushes.delete(token);
        resolve();
      }, 5000);
      this.flushes.set(token, () => {
        clearTimeout(timer);
        this.flushes.delete(token);
        resolve();
      });
      window.webContents.send('viewer:event', { type: 'flush-settings', token });
    });
    await this.settings.flush();
  }
  async flush(): Promise<void> {
    await Promise.all(
      [...this.windows.values()]
        .filter((item) => item.role === 'settings')
        .map((item) => this.flushSettings(item.window)),
    );
    if (this.ready && this.window && !this.window.isDestroyed()) {
      const token = randomUUID();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.flushes.delete(token);
          resolve();
        }, 3000);
        this.flushes.set(token, () => {
          clearTimeout(timeout);
          this.flushes.delete(token);
          resolve();
        });
        this.emit({ type: 'flush', token });
      });
    }
    await Promise.all([this.storage.flush(), this.settings.flush()]);
  }
  async dispose(): Promise<void> {
    this.ready = false;
    ipcMain.removeHandler('viewer:request');
    this.search.close();
    this.resources.clear();
    await this.actions.close();
    await this.agents.close();
    await Promise.all([this.watchers.close(), this.operations.close(), this.files.close()]);
  }
  private async invoke(method: ApiMethod, args: unknown[], senderID?: number): Promise<unknown> {
    switch (method) {
      case 'openSettings':
        return this.options.openSettings();
      case 'settingsGet':
        await this.settings.load();
        await this.credentials.load();
        return this.settings.snapshot(this.credentials.ids());
      case 'settingsPatch':
        return {
          ...(await this.settings.patch(args[0] as SettingsPatch[], args[1] as number)),
          credentials: this.credentials.ids(),
        };
      case 'providerCredential':
        await this.credentials.set(args[0] as string, args[1] as string);
        this.settings.announce();
        return;
      case 'providerModels': {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((provider) => provider.id === args[0]);
        if (!provider) throw new Error('Provider is unavailable.');
        return this.providers.models(provider);
      }
      case 'indexedQuery':
        return this.files.query(args[0] as IndexedQuery);
      case 'indexStatus':
        return this.files.status();
      case 'indexRebuild':
        return this.files.configure(this.settings.snapshot().settings.search);
      case 'actionStart':
        return this.actions.start({
          ...(args[0] as ActionRequest),
          context: { ...(args[0] as ActionRequest).context, actor: 'user' },
        });
      case 'actionGet':
        return this.actions.get(args[0] as string);
      case 'actionList':
        return this.actions.all();
      case 'actionApply':
        return this.actions.apply(args[0] as ActionApproval);
      case 'actionCancel':
        this.actions.cancel(args[0] as string);
        return;
      case 'actionUndo':
        return this.actions.undo(args[0] as string);
      case 'actionRecover':
        return this.actions.recovery(args[0] as string);
      case 'actionExportSummary':
        return this.actions.exportSummary(args[0] as string, args[1] as string);
      case 'agentToken':
        await this.agents.start();
        return JSON.stringify(
          {
            mcpServers: {
              viewer: {
                command: process.execPath,
                args: ['--mcp'],
                env: {
                  VIEWER_AGENT_TOKEN: await this.agents.credential(),
                  ...(process.env.VIEWER_DATA_DIRECTORY
                    ? { VIEWER_DATA_DIRECTORY: process.env.VIEWER_DATA_DIRECTORY }
                    : {}),
                },
              },
            },
          },
          null,
          2,
        );
      case 'contextPublish':
        this.context = { ...(args[0] as ActionContext), actor: 'user' };
        return;
      case 'thumbnail':
        return this.thumbnails.get(args[0] as string, args[1] as number);
      case 'document': {
        const file = this.resources.documentSource(args[0] as string);
        const document = await this.files.extract(file, undefined, true);
        this.resources.documentSource(args[0] as string);
        return document;
      }
      case 'bootstrap': {
        const home = os.homedir();
        const stored = await this.storage.load();
        await this.settings.load(stored.state || undefined);
        await this.credentials.load();
        if (stored.state)
          stored.state = {
            ...stored.state,
            ui: this.settings.snapshot().ui,
            look: this.settings.snapshot().look,
            preferencesRevision: this.settings.snapshot().revision,
          };
        void this.configureIndex(this.settings.snapshot().settings.search).catch(() => {});
        await this.actions.load();
        this.options.settingsChanged?.();
        await this.agents.start();
        const paths = this.openPaths.splice(0);
        this.ready = true;
        const freshSession =
          !this.bootstrapped && !this.settings.snapshot().settings.browsing.restoreSession;
        this.bootstrapped = true;
        return {
          ...stored,
          home,
          freshSession,
          settings: this.settings.snapshot(this.credentials.ids()),
          platform: process.platform,
          locations: [
            { name: 'Home', path: home },
            ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'].map((name) => ({
              name,
              path: path.join(home, name),
            })),
            {
              name: process.platform === 'darwin' ? 'Volumes' : 'Computer',
              path: process.platform === 'darwin' ? '/Volumes' : path.parse(home).root,
            },
          ],
          openPaths: paths,
        };
      }
      case 'list':
        return list(args[0] as string);
      case 'stat':
        return entry(args[0] as string);
      case 'chooseFolder': {
        const result = await dialog.showOpenDialog(this.windows.get(senderID!)!.window, {
          properties: ['openDirectory'],
        });
        return result.canceled ? null : result.filePaths[0];
      }
      case 'reveal':
        shell.showItemInFolder(args[0] as string);
        return;
      case 'openExternal': {
        const error = await shell.openPath(args[0] as string);
        if (error) throw new Error(error);
        return;
      }
      case 'folderSizeStart':
        return this.files.sizeStart(args[0] as string[]);
      case 'folderSizeGet':
        return this.files.sizeGet(args[0] as string);
      case 'folderSizeCancel':
        return this.files.sizeCancel(args[0] as string);
      case 'applications':
        return this.applications.list(args[0] as string[]);
      case 'openWith':
        return this.applications.open(args[0] as string[], args[1] as string);
      case 'chooseApplication': {
        if (process.platform !== 'darwin')
          throw new Error('Application selection is not available on this platform yet.');
        const result = await dialog.showOpenDialog(this.window!, {
          title: 'Choose Application',
          defaultPath: '/Applications',
          properties: ['openFile'],
          filters: [{ name: 'Applications', extensions: ['app'] }],
        });
        return result.canceled ? null : this.applications.register(result.filePaths[0]);
      }
      case 'watch':
        return this.watchers.add(args[0] as string, args[1] as string);
      case 'unwatch':
        return this.watchers.remove(args[0] as string);
      case 'search':
        return this.search.start(args[0] as Parameters<Search['start']>[0]);
      case 'cancelSearch':
        return this.search.cancel(args[0] as string);
      case 'operate':
        return this.operations.start(args[0] as Parameters<Operations['start']>[0]);
      case 'jobs':
        return this.operations.all();
      case 'cancelJob':
        return this.operations.cancel(args[0] as string);
      case 'resolveCollision':
        return this.operations.resolve(
          args[0] as string,
          args[1] as Parameters<Operations['resolve']>[1],
          args[2] as boolean,
        );
      case 'undo':
        return this.operations.undo(args[0] as string);
      case 'resource':
        return this.resources.grant(args[0] as string);
      case 'read':
        return this.resources.read(args[0] as string, args[1] as number | undefined);
      case 'release':
        return this.resources.release(args[0] as string);
      case 'archive':
        return this.resources.archive(args[0] as string);
      case 'archiveEntry':
        return this.resources.archiveEntry(args[0] as string, args[1] as string);
      case 'save':
        return this.storage.save({
          ...(args[0] as import('../domain/contracts').SavedState),
          ui: this.settings.snapshot().ui,
          look: this.settings.snapshot().look,
          preferencesRevision: this.settings.snapshot().revision,
        } as Parameters<Storage['save']>[0]);
      case 'flushed':
        return this.flushes.get(args[0] as string)?.();
      case 'clipboardWrite': {
        const paths = args[0] as string[];
        const text = paths.join('\n');
        await clipboard.writeText(text);
        this.fileClipboard = { paths, cut: args[1] as boolean, text };
        return;
      }
      case 'clipboardRead': {
        const value = this.fileClipboard;
        return value && (await clipboard.readText()) === value.text
          ? { paths: value.paths, cut: value.cut }
          : null;
      }
      case 'textEdit': {
        const command = args[0] as import('../domain/contracts').TextEditCommand;
        this.windows.get(senderID!)!.window.webContents[command]();
        return;
      }
    }
  }
}
