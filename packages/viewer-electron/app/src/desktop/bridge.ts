import { AgentRequests } from './agent-requests';
import type { CapturedTarget } from '../domain/automation';
import type { CommandDescriptor } from '../domain/agent-requests';
import { Executions } from './executions';
import { Terminals } from './terminals';
import { ExternalTerminals } from './terminal-launch';
import {
  app,
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
import { ModelPermissions } from './model-permissions';
import { modelDataLevels, modelEndpoint } from '../domain/model-permissions';
import { macFiles } from './macos-files';
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
import { FileAccess } from './file-access';
import { NativeSelections } from './native-selections';
import { fileCoordination } from './file-coordination';

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
const targetSchema = z.object({
  workspaceID: id,
  rootID: id,
  paneID: id,
  directory: localPath,
  panePath: localPath.optional(),
  selection: z
    .array(
      z.object({
        path: localPath,
        name: z.string().max(32768),
        parent: localPath,
        extension: z.string().max(100),
        kind: z.enum(['directory', 'file', 'symlink', 'other']),
        directory: z.boolean(),
        size: z.number(),
        modified: z.number(),
        created: z.number(),
        hidden: z.boolean(),
        mime: z.string().max(100),
        identity: z.string().max(300),
        linkTarget: z.string().optional(),
        error: z.string().optional(),
      }),
    )
    .max(2000),
});
const schemas = {
  commandsPublish: z.tuple([
    targetSchema,
    z
      .array(
        z.object({
          id,
          label: z.string().max(500),
          group: z.string().max(100),
          aliases: z.array(z.string().max(200)).max(100),
          shortcut: z.string().max(80).optional(),
        }),
      )
      .max(1000),
  ]),
  agentCommandResult: z.tuple([id, z.string().max(2000).optional()]),
  agentReviewList: z.tuple([]),
  agentReview: z.tuple([id, z.boolean()]),
  agentGrants: z.tuple([]),
  agentGrant: z.tuple([
    id,
    localPath,
    z.enum(['execute', 'terminal-read', 'terminal-write']),
    z.boolean(),
  ]),
  configOpen: z.tuple([]),
  configValidate: z.tuple([]),
  configTransfer: z.tuple([z.enum(['import', 'export'])]),
  terminalApplication: z.tuple([]),
  terminalExternal: z.tuple([localPath, z.boolean()]),
  terminalStart: z.tuple([
    z.object({
      id,
      workspaceID: id,
      rootID: id,
      cwd: localPath,
      profileID: id,
      cols: z.number().int().min(2).max(1000),
      rows: z.number().int().min(1).max(500),
    }),
  ]),
  terminalWrite: z.tuple([id, z.string().max(65536)]),
  terminalResize: z.tuple([
    id,
    z.number().int().min(2).max(1000),
    z.number().int().min(1).max(500),
  ]),
  terminalAck: z.tuple([
    id,
    z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 * 1024),
  ]),
  terminalClose: z.tuple([id]),
  customExecute: z.tuple([
    id,
    z.object({
      workspaceID: id,
      rootID: id,
      paneID: id,
      directory: localPath,
      selection: z
        .array(
          z.object({
            path: localPath,
            name: z.string(),
            parent: localPath,
            extension: z.string(),
            kind: z.enum(['directory', 'file', 'symlink', 'other']),
            directory: z.boolean(),
            size: z.number(),
            modified: z.number(),
            created: z.number(),
            hidden: z.boolean(),
            mime: z.string(),
            identity: z.string(),
            linkTarget: z.string().optional(),
            error: z.string().optional(),
          }),
        )
        .max(2000),
    }),
  ]),
  executionList: z.tuple([]),
  executionCancel: z.tuple([id]),
  openSettings: z.tuple([]),
  settingsGet: z.tuple([]),
  settingsPatch: z.tuple([
    z
      .array(
        z.object({
          path: z.string().max(200),
          value: z.unknown(),
          keys: z.array(z.string().max(32768)).max(10).optional(),
        }),
      )
      .max(100),
    z.number().int().min(0),
  ]),
  providerCredential: z.tuple([id, z.string().max(10000)]),
  providerModels: z.tuple([id]),
  providerPermissionGet: z.tuple([id]),
  providerPermissionSet: z.tuple([id, z.url().max(4000), z.enum(modelDataLevels).nullable()]),
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
  chooseFolder: z.tuple([localPath.optional()]),
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
      kind: z.enum([
        'copy',
        'move',
        'transfer',
        'duplicate',
        'rename',
        'mkdir',
        'trash',
        'compress',
        'extract',
      ]),
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
  copyPaths: z.tuple([z.array(localPath).min(1).max(10000)]),
  clipboardRead: z.tuple([]),
  fileDropPaths: z.tuple([z.array(localPath).max(10000)]),
  fileDragStart: z.tuple([z.array(localPath).min(1).max(10000)]),
  volumesList: z.tuple([]),
  volumeEject: z.tuple([localPath]),
  fileAccessList: z.tuple([]),
  fileAccessRevoke: z.tuple([localPath]),
  textEdit: z.tuple([z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])]),
} satisfies Record<ApiMethod, z.ZodType>;
export class Desktop {
  private nativeSelections = new NativeSelections((source) =>
    macFiles().clipboardVersion(source === 'drag'),
  );
  readonly agentRequests: AgentRequests;
  private commandCatalog?: { target: CapturedTarget; commands: CommandDescriptor[] };
  readonly terminals: Terminals;
  readonly externalTerminals: ExternalTerminals;
  readonly executions: Executions;
  readonly resources: Resources;
  readonly fileAccess: FileAccess;
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
  readonly modelPermissions: ModelPermissions;
  readonly actions: ActionPlanner;
  readonly agents: AgentBroker;
  readonly thumbnails = new Thumbnails();
  // HOME becomes the container in App Sandbox. Sidebar/default paths describe
  // the actual user's folders; knowing those paths does not confer access.
  private readonly home = process.mas ? os.userInfo().homedir : os.homedir();
  private context?: ActionContext;
  private indexConfiguration = '';
  private openPaths: string[] = [];
  private agentCommands = new Map<string, { finish(error?: string): void; owner: number }>();
  private agentsEnabled?: boolean;
  private agentsConfiguration: Promise<void> = Promise.resolve();
  private flushes = new Map<string, () => void>();
  private flushing?: Promise<void>;
  private disposal?: Promise<void>;
  private fileClipboard: {
    paths: string[];
    cut: boolean;
    text: string;
    changeCount?: number;
  } | null = null;
  constructor(
    dataPath: string,
    private allowedURL: (url: string) => boolean,
    private options: {
      openSettings(): Promise<void>;
      worker: string;
      terminalWorker: string;
      ocr: string;
      applications: string;
      fileBackend?: 'process' | 'thread';
      settingsChanged?(): void;
    },
  ) {
    const emit = (event: DesktopEvent) => this.emit(event);
    this.fileAccess = new FileAccess(
      dataPath,
      process.mas
        ? {
            start: (bookmark) => {
              const stop = app.startAccessingSecurityScopedResource(bookmark);
              return () => stop();
            },
          }
        : undefined,
    );
    const access = (files: readonly string[]) => this.fileAccess.require(files);
    this.resources = new Resources(access);
    this.applications = new Applications(options.applications);
    this.settings = new SettingsService(
      dataPath,
      this.home,
      () => nativeTheme.shouldUseDarkColors,
      (snapshot) => {
        this.options.settingsChanged?.();
        void this.modelPermissions.reconcile().catch(() =>
          emit({
            type: 'service-error',
            service: 'models',
            message:
              'Model data access was stopped, but the permission change could not be saved. Try again in Settings → Models.',
          }),
        );
        emit({ type: 'settings', snapshot: { ...snapshot, credentials: this.credentials.ids() } });
        void this.configureAgents(snapshot.settings.agents.enabled).catch(() =>
          emit({
            type: 'service-error',
            service: 'agents',
            message: 'Agent server could not start. Check Settings → Agents.',
          }),
        );
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
    this.terminals = new Terminals(
      options.terminalWorker,
      () => this.settings.snapshot().settings,
      (owner, event) => {
        const window = this.windows.get(owner)?.window;
        if (window && !window.isDestroyed())
          window.webContents.send('viewer:event', { type: 'terminal', event });
      },
      access,
    );
    this.externalTerminals = new ExternalTerminals(
      path.join(dataPath, 'terminal-launches'),
      () => this.settings.snapshot().settings,
      options.applications,
      undefined,
      access,
    );
    this.executions = new Executions(
      () => this.settings.snapshot().settings,
      (task) => {
        emit({ type: 'execution', task });
        this.agentRequests?.execution(task);
      },
      access,
    );
    this.credentials = new Credentials(
      dataPath,
      (value) => safeStorage.encryptStringAsync(value),
      async (value) => (await safeStorage.decryptStringAsync(value)).result,
    );
    this.modelPermissions = new ModelPermissions(
      dataPath,
      () => this.settings.snapshot().settings.providers,
    );
    this.providers = new Providers(this.credentials, fetch, this.modelPermissions);
    this.files = new FileServices(
      dataPath,
      options.worker,
      options.ocr,
      (status) => emit({ type: 'index', status }),
      (task) => emit({ type: 'folder-size', task }),
      { backend: process.mas ? 'thread' : options.fileBackend, access },
    );
    const changed = (changes: import('../domain/changes').FileChange[]) => {
      emit({ type: 'file-changes', changes });
      void this.settings.remapFolders(changes).catch(() => this.settings.announce());
      for (const change of changes) {
        void this.files.update(change.source, true).catch(() => {});
        void this.files.update(change.destination).catch(() => {});
      }
      this.thumbnails.clear();
    };
    this.operations = new Operations(
      (file) =>
        process.platform === 'darwin'
          ? macFiles().trash(file, fileCoordination.purpose())
          : shell.trashItem(file),
      (job) => emit({ type: 'job', job }),
      (progress) => emit({ type: 'job-progress', progress }),
      changed,
      access,
      dataPath,
      (receipt, work) => this.fileAccess.withReceipt(receipt, work),
    );
    this.actions = new ActionPlanner(dataPath, {
      access,
      recipes: () => this.settings.snapshot().settings.recipes,
      providers: () => this.settings.snapshot().settings.providers,
      extract: (file, signal) => this.files.extract(file, signal),
      generate: (...args) => this.providers.generate(...args),
      operations: this.operations,
      emit: (plan) => emit({ type: 'action', plan }),
      changed,
    });
    this.agentRequests = new AgentRequests(
      dataPath,
      this.settings,
      (proposal) => emit({ type: 'agent-proposal', proposal }),
      async (command, target) => {
        const action = this.settings
          .snapshot()
          .settings.customActions.find((action) => 'custom.' + action.id === command);
        if (action && (action.executor.kind === 'executable' || action.executor.kind === 'shell'))
          return { taskID: await this.executions.start(action.id, target) };
        else {
          const window = this.window;
          if (!window || window.isDestroyed())
            throw new Error('Open the workspace before running this action.');
          await new Promise<void>((resolve, reject) => {
            const id = randomUUID();
            const timer = setTimeout(() => {
              this.agentCommands.delete(id);
              reject(
                new Error('The workspace did not finish this action. Request a fresh proposal.'),
              );
            }, 25000);
            timer.unref();
            this.agentCommands.set(id, {
              owner: window.webContents.id,
              finish: (error) => {
                clearTimeout(timer);
                this.agentCommands.delete(id);
                if (error) reject(new Error(error));
                else resolve();
              },
            });
            emit({ type: 'agent-command', id, command, target });
          });
        }
      },
      {
        read: (id) => this.terminals.agentRead(id),
        write: (id, data) => this.terminals.agentWrite(id, data),
      },
    );
    this.agents = new AgentBroker(
      dataPath,
      () => this.settings.snapshot().settings,
      () => (this.window && !this.window.isDestroyed() ? this.context : undefined),
      this.files,
      this.actions,
      {
        catalog: () => this.commandCatalog,
        requests: this.agentRequests,
        config: this.settings,
        access,
      },
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
            'configOpen',
            'configValidate',
            'configTransfer',
            'terminalApplication',
            'agentGrants',
            'agentGrant',
            'settingsGet',
            'settingsPatch',
            'providerCredential',
            'providerModels',
            'providerPermissionGet',
            'providerPermissionSet',
            'fileAccessList',
            'fileAccessRevoke',
            'indexStatus',
            'indexRebuild',
            'chooseFolder',
            'agentToken',
            'textEdit',
            'flushed',
          ];
          if (role === 'settings' && !settingsMethods.includes(name))
            throw new Error('This API is unavailable in Settings.');
          if (
            role !== 'settings' &&
            ['providerCredential', 'agentToken', 'agentGrant', 'fileAccessRevoke'].includes(name)
          )
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
  private configureAgents(enabled: boolean): Promise<void> {
    if (this.agentsEnabled === enabled) return this.agentsConfiguration;
    this.agentsEnabled = enabled;
    const task = this.agentsConfiguration
      .catch(() => {})
      .then(() => (enabled ? this.agents.start() : this.agents.close()));
    this.agentsConfiguration = task.catch((error) => {
      if (this.agentsEnabled === enabled) this.agentsEnabled = undefined;
      throw error;
    });
    return this.agentsConfiguration;
  }
  attach(window: BrowserWindow, role: 'viewer' | 'settings'): void {
    const sender = window.webContents.id;
    this.windows.set(sender, { window, role });
    if (role === 'viewer') this.window = window;
    window.on('closed', () => {
      this.terminals.stopOwner(sender);
      for (const request of this.agentCommands.values())
        if (request.owner === sender)
          request.finish('The workspace closed before completing the action.');
      this.windows.delete(sender);
      if (this.window === window) {
        this.window = undefined;
        this.ready = false;
        this.context = undefined;
        this.commandCatalog = undefined;
        this.resources.clear();
      }
    });
  }
  emit(event: DesktopEvent): void {
    for (const { window, role } of this.windows.values())
      if (
        !window.isDestroyed() &&
        (role === 'viewer' || ['settings', 'index', 'service-error'].includes(event.type))
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
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushWindows().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  private async flushWindows(): Promise<void> {
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
  dispose(): Promise<void> {
    return (this.disposal ??= this.disposeServices());
  }
  private async disposeServices(): Promise<void> {
    this.ready = false;
    this.settings.close();
    this.resources.clear();
    // Cancel the read-only worker before waiting for planners that may be
    // awaiting extraction. File mutations still drain through their journal.
    const results = await Promise.allSettled([
      this.terminals.close(),
      this.externalTerminals.close(),
      this.files.close(),
      this.actions.close(),
      this.agentsConfiguration.catch(() => {}).then(() => this.agents.close()),
      this.watchers.close(),
      this.operations.close(),
      this.modelPermissions.close(),
      this.search.close(),
      this.executions.close(),
      this.resources.close(),
      this.thumbnails.close(),
      fileCoordination.quiesce(),
    ]);
    await this.fileAccess.close();
    for (const request of this.agentCommands.values())
      request.finish('The application closed before completing the action.');
    ipcMain.removeHandler('viewer:request');
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length) throw new AggregateError(errors, 'Desktop services failed to stop.');
  }
  private async invoke(method: ApiMethod, args: unknown[], senderID?: number): Promise<unknown> {
    switch (method) {
      case 'commandsPublish':
        this.commandCatalog = {
          target: args[0] as CapturedTarget,
          commands: args[1] as CommandDescriptor[],
        };
        return;
      case 'agentCommandResult': {
        const request = this.agentCommands.get(args[0] as string);
        if (!request || request.owner !== senderID)
          throw new Error('Action acknowledgement is no longer available.');
        request.finish(args[1] as string | undefined);
        return;
      }
      case 'agentReviewList':
        return this.agentRequests.list();
      case 'agentReview':
        return this.agentRequests.review(args[0] as string, args[1] as boolean);
      case 'agentGrants':
        return this.agentRequests.listGrants();
      case 'agentGrant':
        return this.agentRequests.grant(
          args[0] as string,
          args[1] as string,
          args[2] as import('../domain/agent-requests').ExecutionGrant['capability'],
          args[3] as boolean,
        );
      case 'configOpen': {
        await this.settings.load();
        const error = await shell.openPath(this.settings.snapshot().config!.path);
        if (error) throw new Error(error);
        return;
      }
      case 'configValidate':
        return this.settings.reload();
      case 'configTransfer': {
        if (args[0] === 'export') {
          const { canceled, filePath, bookmark } = await dialog.showSaveDialog({
            title: 'Export configuration',
            defaultPath: 'config.jsonc',
            securityScopedBookmarks: this.fileAccess.scoped,
          });
          if (!canceled && filePath) {
            await this.fileAccess.remember(filePath, false, bookmark);
            await this.fileAccess.require([filePath]);
            await this.settings.exportConfiguration(filePath);
          }
        } else {
          const { canceled, filePaths, bookmarks } = await dialog.showOpenDialog({
            title: 'Import configuration',
            properties: ['openFile'],
            filters: [{ name: 'Configuration', extensions: ['jsonc', 'json'] }],
            securityScopedBookmarks: this.fileAccess.scoped,
          });
          if (!canceled && filePaths[0]) {
            await this.fileAccess.remember(filePaths[0], false, bookmarks?.[0]);
            await this.fileAccess.require([filePaths[0]]);
            return this.settings.importConfiguration(filePaths[0]);
          }
        }
        return this.settings.snapshot();
      }
      case 'terminalApplication':
        return this.externalTerminals.application();
      case 'terminalExternal':
        await this.fileAccess.require([args[0] as string]);
        return this.externalTerminals.open(args[0] as string, args[1] as boolean);
      case 'terminalStart':
        return this.terminals.start(
          args[0] as import('../domain/automation').TerminalStart,
          senderID!,
        );
      case 'terminalWrite':
        return this.terminals.write(args[0] as string, args[1] as string, senderID!);
      case 'terminalResize':
        return this.terminals.resize(
          args[0] as string,
          args[1] as number,
          args[2] as number,
          senderID!,
        );
      case 'terminalAck':
        return this.terminals.ack(args[0] as string, args[1] as number, senderID!);
      case 'terminalClose':
        return this.terminals.stop(args[0] as string, senderID!);
      case 'customExecute':
        return this.executions.start(
          args[0] as string,
          args[1] as import('../domain/automation').CapturedTarget,
        );
      case 'executionList':
        return this.executions.list();
      case 'executionCancel':
        return this.executions.cancel(args[0] as string);
      case 'openSettings':
        return this.options.openSettings();
      case 'settingsGet':
        await this.settings.load();
        await this.credentials.load();
        return this.settings.snapshot(this.credentials.ids());
      case 'fileAccessList':
        return this.fileAccess.list();
      case 'fileAccessRevoke': {
        const root = args[0] as string;
        if (this.fileAccess.scoped) this.nativeSelections.revoke(root);
        let resources: string[] = [];
        this.emit({ type: 'file-access', path: root });
        await this.fileAccess.revoke(root, async () => {
          resources = await this.resources.affected(root);
          this.emit({ type: 'file-access', path: root, resources });
          await Promise.all([
            fileCoordination.quiesce(root),
            this.resources.quiesce(root),
            this.thumbnails.quiesce(root),
            this.watchers.revoke(root),
            this.search.quiesce(),
            this.actions.quiesce(root),
            this.operations.quiesce(root),
            this.executions.quiesce(root),
            this.terminals.quiesce(root),
            this.externalTerminals.quiesce(),
          ]);
          await this.files.reset();
          this.indexConfiguration = '';
          await this.configureIndex(this.settings.snapshot().settings.search);
        });
        this.emit({ type: 'file-access', path: root, resources });
        return;
      }
      case 'volumesList':
        return process.platform === 'darwin' ? macFiles().volumes() : [];
      case 'volumeEject': {
        const root = args[0] as string;
        const volume = (await macFiles().volumes()).find((volume) => volume.path === root);
        if (!volume?.ejectable || root === '/') throw new Error('Choose an ejectable volume.');
        let resources: string[] = [];
        try {
          await this.fileAccess.withBlocked(root, async () => {
            this.emit({ type: 'file-access', path: root });
            resources = await this.resources.affected(root);
            this.emit({ type: 'file-access', path: root, resources });
            const previews = this.resources.quiesce(root);
            const thumbnails = this.thumbnails.quiesce(root);
            const coordinated = fileCoordination.quiesce(root);
            await this.actions.quiesce(root);
            await this.operations.quiesce(root);
            await this.executions.quiesce(root);
            await this.terminals.quiesce(root);
            await this.externalTerminals.quiesce();
            await this.watchers.revoke(root);
            await this.search.quiesce();
            await this.files.reset();
            await Promise.all([previews, thumbnails, coordinated]);
            await macFiles().eject(root);
          });
        } finally {
          this.indexConfiguration = '';
          await this.configureIndex(this.settings.snapshot().settings.search);
          this.emit({ type: 'file-access', path: root, resources });
        }
        return;
      }
      case 'settingsPatch':
        return {
          ...(await this.settings.patch(args[0] as SettingsPatch[], args[1] as number)),
          credentials: this.credentials.ids(),
        };
      case 'providerCredential':
        if (!args[1]) {
          const provider = this.settings
            .snapshot()
            .settings.providers.find((item) => item.id === args[0]);
          if (provider) await this.modelPermissions.set(provider, null);
          this.emit({ type: 'model-permission', providerID: args[0] as string });
        }
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
      case 'providerPermissionGet':
      case 'providerPermissionSet': {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((item) => item.id === args[0]);
        if (!provider) throw new Error('Provider is unavailable.');
        if (method === 'providerPermissionGet') return this.modelPermissions.get(provider);
        if (modelEndpoint(provider) !== modelEndpoint({ endpoint: args[1] as string }))
          throw new Error(
            'The provider endpoint changed. Review its new address before allowing data access.',
          );
        await this.modelPermissions.set(
          provider,
          args[2] as import('../domain/model-permissions').ModelDataLevel | null,
        );
        this.emit({ type: 'model-permission', providerID: provider.id });
        return;
      }
      case 'indexedQuery':
        return this.files.query(args[0] as IndexedQuery);
      case 'indexStatus':
        return this.files.status();
      case 'indexRebuild':
        this.indexConfiguration = '';
        return this.configureIndex(this.settings.snapshot().settings.search);
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
      case 'thumbnail': {
        await this.fileAccess.require([args[0] as string]);
        const thumbnail = await this.thumbnails.get(args[0] as string, args[1] as number);
        await this.fileAccess.require([args[0] as string]);
        return thumbnail;
      }
      case 'document': {
        const file = this.resources.documentSource(args[0] as string);
        const document = await this.files.extract(file, undefined, true);
        this.resources.documentSource(args[0] as string);
        return document;
      }
      case 'bootstrap': {
        const home = this.home;
        await this.fileAccess.load();
        const stored = await this.storage.load();
        await this.settings.load(stored.state || undefined);
        if (stored.state) {
          const spaces = [...stored.state.workspaces].sort(
            (a, b) =>
              Number(a.id === stored.state!.activeWorkspace) -
              Number(b.id === stored.state!.activeWorkspace),
          );
          await this.settings.seedFolders(
            spaces.flatMap((space) =>
              [...space.panes].sort(
                (a, b) => Number(a.id === space.activePane) - Number(b.id === space.activePane),
              ),
            ),
          );
        }
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
        await this.configureAgents(this.settings.snapshot().settings.agents.enabled);
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
        await this.fileAccess.require([args[0] as string]);
        return list(args[0] as string);
      case 'stat':
        await this.fileAccess.require([args[0] as string]);
        return entry(args[0] as string);
      case 'chooseFolder': {
        const result = await dialog.showOpenDialog(this.windows.get(senderID!)!.window, {
          properties: ['openDirectory'],
          defaultPath: args[0] as string | undefined,
          securityScopedBookmarks: this.fileAccess.scoped,
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await this.fileAccess.remember(result.filePaths[0], true, result.bookmarks?.[0]);
        await this.fileAccess.require([result.filePaths[0]]);
        // Granting a configured index root can unblock its watcher/indexer.
        this.indexConfiguration = '';
        void this.configureIndex(this.settings.snapshot().settings.search).catch(() => {});
        this.emit({ type: 'folder-changed', path: result.filePaths[0] });
        return result.filePaths[0];
      }
      case 'reveal':
        await this.fileAccess.require([args[0] as string]);
        shell.showItemInFolder(args[0] as string);
        return;
      case 'openExternal': {
        await this.fileAccess.require([args[0] as string]);
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
        await this.fileAccess.require(args[0] as string[]);
        return this.applications.list(args[0] as string[]);
      case 'openWith':
        await this.fileAccess.require(args[0] as string[]);
        return this.applications.open(args[0] as string[], args[1] as string);
      case 'chooseApplication': {
        if (process.platform !== 'darwin')
          throw new Error('Application selection is not available on this platform yet.');
        const result = await dialog.showOpenDialog(this.window!, {
          title: 'Choose Application',
          defaultPath: '/Applications',
          properties: ['openFile'],
          filters: [{ name: 'Applications', extensions: ['app'] }],
          securityScopedBookmarks: this.fileAccess.scoped,
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await this.fileAccess.remember(result.filePaths[0], true, result.bookmarks?.[0]);
        await this.fileAccess.require([result.filePaths[0]]);
        return this.applications.register(result.filePaths[0]);
      }
      case 'watch': {
        await this.fileAccess.require([args[0] as string]);
        await this.watchers.add(args[0] as string, args[1] as string);
        try {
          await this.fileAccess.require([args[0] as string]);
        } catch (error) {
          await this.watchers.remove(args[1] as string);
          throw error;
        }
        return;
      }
      case 'unwatch':
        return this.watchers.remove(args[0] as string);
      case 'search':
        await this.fileAccess.require([
          (args[0] as import('../domain/contracts').SearchRequest).root,
        ]);
        return this.search.start(args[0] as Parameters<Search['start']>[0]);
      case 'cancelSearch':
        return this.search.cancel(args[0] as string);
      case 'operate':
        return this.operations.start(args[0] as Parameters<Operations['start']>[0]);
      case 'jobs':
        await this.operations.load();
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
        await this.fileAccess.require(paths);
        const text = paths.join('\n');
        if (process.platform === 'darwin') {
          const changeCount = macFiles().clipboardWrite(paths);
          this.fileClipboard = { paths, cut: args[1] as boolean, text, changeCount };
        } else {
          await clipboard.writeText(text);
          this.fileClipboard = { paths, cut: args[1] as boolean, text };
        }
        return;
      }
      case 'clipboardRead': {
        const value = this.fileClipboard;
        if (process.platform === 'darwin') {
          const native = macFiles().clipboardRead();
          const selection = this.nativeSelections.capture('clipboard', native.changeCount);
          if (!native.files.length) return null;
          // Only bookmarks obtained from the native pasteboard can confer access.
          const incoming: { path: string; directory: boolean; bookmark: string }[] = [];
          for (const file of native.files) {
            try {
              await this.fileAccess.require([file.path]);
            } catch (error) {
              if (
                (error as NodeJS.ErrnoException).code !== 'FILE_ACCESS_REQUIRED' ||
                !file.bookmark
              )
                throw error;
              incoming.push({
                path: file.path,
                directory: file.directory,
                bookmark: file.bookmark,
              });
            }
          }
          this.nativeSelections.assertImport(
            incoming.map((file) => file.path),
            selection,
          );
          await this.fileAccess.receiveNative(incoming);
          await this.fileAccess.require(native.files.map((file) => file.path));
          return {
            paths: native.files.map((file) => file.path),
            cut: value?.changeCount === native.changeCount && !!value.cut,
          };
        }
        return value && (await clipboard.readText()) === value.text
          ? { paths: value.paths, cut: value.cut }
          : null;
      }
      case 'fileDropPaths': {
        const paths = args[0] as string[];
        if (process.platform === 'darwin' && this.fileAccess.scoped) {
          const native = macFiles().clipboardRead(true);
          const files = native.files;
          const selection = this.nativeSelections.capture('drag', native.changeCount);
          const requested = new Set(paths);
          const incoming: { path: string; directory: boolean; bookmark: string }[] = [];
          for (const file of files)
            if (requested.has(file.path) && file.bookmark) {
              try {
                await this.fileAccess.require([file.path]);
              } catch (error) {
                if ((error as { code?: string }).code !== 'FILE_ACCESS_REQUIRED') throw error;
                incoming.push({
                  path: file.path,
                  directory: file.directory,
                  bookmark: file.bookmark,
                });
              }
            }
          this.nativeSelections.assertImport(
            incoming.map((file) => file.path),
            selection,
          );
          await this.fileAccess.receiveNative(incoming);
        }
        await this.fileAccess.require(paths);
        return paths;
      }
      case 'fileDragStart': {
        const paths = args[0] as string[];
        await this.fileAccess.require(paths);
        const window = this.windows.get(senderID!)?.window;
        if (!window || window.isDestroyed()) throw new Error('The file view has closed.');
        // Native file objects carry all selected paths to Finder and other apps.
        const icon = await app.getFileIcon(paths[0], { size: 'normal' });
        window.webContents.startDrag({ file: paths[0], files: paths, icon });
        return;
      }
      case 'copyPaths': {
        await clipboard.writeText((args[0] as string[]).join('\n'));
        // Plain-text paths must not retain a previous cut/copy file operation.
        this.fileClipboard = null;
        return;
      }
      case 'textEdit': {
        const command = args[0] as import('../domain/contracts').TextEditCommand;
        this.windows.get(senderID!)!.window.webContents[command]();
        return;
      }
    }
  }
}
