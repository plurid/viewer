import type { FileChange } from '../domain/changes';
import type { ComparisonRequest } from '../domain/comparison';
import type { FileInformationPatch } from '../domain/file-information';
import { AgentRequests } from './agent-requests';
import { agentCommandID } from '../domain/agent-safety';
import type { CapturedTarget, TerminalStart } from '../domain/automation';
import type {
  AgentNavigation,
  AgentWorkspaceSnapshot,
  CommandDescriptor,
  ExecutionGrant,
} from '../domain/agent-requests';
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
import { modelDataLevels, modelEndpoint, type ModelDataLevel } from '../domain/model-permissions';
import { macFiles } from './macos-files';
import { Thumbnails } from './thumbnails';
import { ActionPlanner } from './actions/planner';
import { AgentBroker } from './agent-broker';
import { Comparisons } from './comparison';
import { OperationPlans } from './operation-plans';
import { operationPlanRequestSchema, type OperationPlanRequest } from '../domain/operation-plan';
import { sourceVersionSchema } from '../domain/inspection';
import {
  agentClientInputSchema,
  type AgentClientRequest,
  type AgentClient,
} from '../domain/agent-clients';
import type {
  ActionContext,
  ActionRequest,
  ActionApproval,
  SettingsPatch,
  IndexedQuery,
  ApplicationSettings,
} from '../domain/services';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type {
  ApiMethod,
  ApiResult,
  DesktopEvent,
  SearchRequest,
  SavedState,
  TextEditCommand,
} from '../domain/contracts';
import { absolute, entry, list } from './filesystem';
import { Operations } from './operations';
import { Resources } from './resources';
import { Search } from './search';
import { Storage, stateSchema } from './storage';
import { Watchers } from './watchers';
import { FileAccess } from './file-access';
import { NativeSelections } from './native-selections';
import { fileCoordination } from './file-coordination';
import { FileInformationService, informationPatchSchema } from './file-information';
import { Projects } from './projects';
import { Checkpoints } from './checkpoints';
import { Workflows } from './workflows';
import { WatchRules } from './watch-rules';
import { watchRuleRequestSchema, type WatchRuleRequest } from '../domain/watch-rules';
import { Relationships } from './relationships';
import type { RelationshipsRequest } from '../domain/relationships';
import { workflowDefinitionSchema, type WorkflowRequest } from '../domain/workflows';
import { boundedRename } from './rename-preview';
import type { CheckpointRequest } from '../domain/change-plan';
import { projectDefinitionSchema, type ProjectRequest } from '../domain/project';

const localPath = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'));
const id = z.string().min(1).max(200);
const indexedQuerySchema = z
  .object({
    query: z.string().max(300),
    root: localPath.optional(),
    offset: z.number().int().min(0).max(1000000).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    showHidden: z.boolean().optional(),
    content: z.boolean().optional(),
    recursive: z.boolean().optional(),
  })
  .strict();
const workspaceSnapshotSchema = z.object({
  activeWorkspace: id,
  workspaces: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        roots: z.array(id).max(200),
        panes: z
          .array(
            z.object({
              id,
              type: z.enum(['folder', 'preview', 'search', 'terminal', 'collection']),
              path: localPath,
              mode: z.enum(['list', 'grid', 'columns', 'gallery']).optional(),
              allLocations: z.boolean().optional(),
            }),
          )
          .max(200),
      }),
    )
    .min(1)
    .max(30),
});
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
  watchRules: z.tuple([watchRuleRequestSchema]),
  relationships: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('read'), file: localPath, content: z.boolean() }).strict(),
      z
        .object({
          kind: z.literal('note'),
          from: localPath,
          to: localPath,
          note: z.string().trim().min(1).max(4000),
        })
        .strict(),
      z.object({ kind: z.literal('remove-note'), id: z.uuid() }).strict(),
    ]),
  ]),
  workflow: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('choose'),
          mode: z.enum(['open', 'create']),
          defaultPath: localPath.optional(),
        })
        .strict(),
      z.object({ kind: z.literal('read'), file: localPath }).strict(),
      z
        .object({
          kind: z.literal('save'),
          file: localPath,
          revision: z.string().max(100),
          definition: workflowDefinitionSchema,
        })
        .strict(),
      z.object({ kind: z.literal('list') }).strict(),
      z.object({ kind: z.literal('get'), id: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal('start'),
          file: localPath,
          revision: z.string().max(100),
          bindings: z.record(z.string().max(100), localPath),
          context: contextSchema,
        })
        .strict(),
      z.object({ kind: z.literal('resume'), id: z.uuid() }).strict(),
      z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
      z.object({ kind: z.literal('remove'), id: z.uuid() }).strict(),
    ]),
  ]),
  querySnapshot: z.tuple([indexedQuerySchema]),
  compare: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('run'),
          id: z.uuid(),
          left: localPath,
          right: localPath,
          hashes: z.boolean(),
        })
        .strict(),
      z.object({ kind: z.literal('cancel'), id: z.uuid() }).strict(),
    ]),
  ]),
  operationPlan: z.tuple([operationPlanRequestSchema]),
  checkpoints: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list') }).strict(),
      z
        .object({ kind: z.literal('estimate'), paths: z.array(localPath).min(1).max(2000) })
        .strict(),
      z.object({ kind: z.literal('remove'), id: z.uuid() }).strict(),
      z.object({ kind: z.literal('restore'), id: z.uuid(), destination: localPath }).strict(),
    ]),
  ]),
  inspect: z.tuple([localPath, z.boolean().optional(), z.boolean().optional()]),
  project: z.tuple([
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('choose'),
          mode: z.enum(['open', 'create']),
          defaultPath: localPath.optional(),
        })
        .strict(),
      z.object({ kind: z.literal('read'), file: localPath }).strict(),
      z
        .object({
          kind: z.literal('save'),
          file: localPath,
          revision: z.string().max(200),
          definition: projectDefinitionSchema,
        })
        .strict(),
    ]),
  ]),
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
    workspaceSnapshotSchema.optional(),
  ]),
  agentCommandResult: z.tuple([id, z.string().max(2000).optional()]),
  agentReviewList: z.tuple([]),
  agentReview: z.tuple([id, z.boolean()]),
  agentGrants: z.tuple([]),
  agentClients: z.tuple([
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('list') }).strict(),
      z.object({ kind: z.literal('create'), client: agentClientInputSchema }).strict(),
      z
        .object({
          kind: z.literal('update'),
          id: z.uuid(),
          revision: z.number().int().positive(),
          client: agentClientInputSchema,
        })
        .strict(),
      z
        .object({ kind: z.literal('revoke'), id: z.uuid(), revision: z.number().int().positive() })
        .strict(),
    ]),
  ]),
  agentAudit: z.tuple([id.optional()]),
  agentStop: z.tuple([id]),
  agentGrant: z.tuple([
    id,
    localPath,
    z.enum(['execute', 'terminal-read', 'terminal-write']),
    z.boolean(),
    id.optional(),
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
  indexedQuery: z.tuple([indexedQuerySchema]),
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
          padding: z.number().int().min(0).max(12).optional(),
          case: z.enum(['keep', 'lower', 'upper', 'title']).optional(),
          regex: z.boolean().optional(),
          ignoreCase: z.boolean().optional(),
          metadata: z.boolean().optional(),
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
      checkpoint: z.boolean().optional(),
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
  fileInformation: z.tuple([localPath]),
  fileInformationUpdate: z.tuple([localPath, z.string().min(1).max(200), informationPatchSchema]),
  chooseFolder: z.tuple([localPath.optional()]),
  reveal: z.tuple([localPath]),
  openExternal: z.tuple([localPath]),
  nativeFilePanel: z.tuple([z.enum(['preview', 'share']), z.array(localPath).min(1).max(100)]),
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
        'alias',
        'rename',
        'mkdir',
        'trash',
        'compress',
        'extract',
      ]),
      sources: z.array(localPath).max(10000),
      destination: localPath.optional(),
      name: z.string().max(255).optional(),
      expectedSources: z
        .array(z.object({ path: localPath, version: sourceVersionSchema }).strict())
        .max(10000)
        .optional(),
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
  private workspaceCatalog?: AgentWorkspaceSnapshot;
  readonly terminals: Terminals;
  readonly externalTerminals: ExternalTerminals;
  readonly executions: Executions;
  readonly resources: Resources;
  readonly fileAccess: FileAccess;
  readonly information: FileInformationService;
  readonly projects: Projects;
  readonly checkpoints: Checkpoints;
  readonly comparisons: Comparisons;
  readonly operationPlans: OperationPlans;
  readonly workflows: Workflows;
  readonly watchRules: WatchRules;
  readonly relationships: Relationships;
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
    this.projects = new Projects(access);
    this.comparisons = new Comparisons(access);
    this.checkpoints = new Checkpoints(
      path.join(dataPath, 'checkpoints'),
      access,
      () => this.settings.snapshot().settings.checkpoints.budgetBytes,
      fileCoordination,
      () => this.operations.all(),
    );
    this.information = new FileInformationService(access, (file) => {
      emit({ type: 'folder-changed', path: path.dirname(file) });
      void this.files.update(file).catch(() => {});
    });
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
    const changed = (changes: FileChange[]) => {
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
    this.operationPlans = new OperationPlans(dataPath, this.operations, this.checkpoints, access);
    this.actions = new ActionPlanner(dataPath, {
      access,
      recipes: () => this.settings.snapshot().settings.recipes,
      providers: () => this.settings.snapshot().settings.providers,
      extract: (file, signal) => this.files.extract(file, signal),
      generate: (...args) => this.providers.generate(...args),
      operations: this.operations,
      rename: (input, signal) =>
        boundedRename(
          path.join(path.dirname(options.worker), 'rename-worker.cjs'),
          input,
          signal,
          options.fileBackend,
        ),
      snapshot: async (title, sources, signal) =>
        (await this.checkpoints.create(title, sources, signal)).id,
      emit: (plan) => emit({ type: 'action', plan }),
      changed,
    });
    this.workflows = new Workflows(dataPath, {
      access,
      files: this.files,
      comparisons: this.comparisons,
      plans: this.operationPlans,
      operations: this.operations,
      actions: this.actions,
      authorizeRun: (run) => this.watchRules.authorize(run),
      recipeForRun: (run, id) => this.watchRules.recipeForRun(run, id),
    });
    this.watchRules = new WatchRules(dataPath, {
      access,
      workflows: this.workflows,
      recipes: () => this.settings.snapshot().settings.recipes,
      changed: (rule) => emit({ type: 'watch-rule', rule }),
    });
    this.relationships = new Relationships(dataPath, {
      access,
      operations: async () => {
        await this.operations.load();
        return this.operations.observedLinks();
      },
      recipes: () => this.actions.all(),
      workflows: async () => {
        const runs = await this.workflows.request({ kind: 'list' });
        return Array.isArray(runs) ? runs : [];
      },
    });
    this.agentRequests = new AgentRequests(
      dataPath,
      this.settings,
      (proposal) => emit({ type: 'agent-proposal', proposal }),
      async (command, target) => {
        const resolved = agentCommandID(command, this.settings.snapshot().settings.customActions);
        await this.sendAgentCommand(resolved, target);
      },
      {
        read: (id) => this.terminals.agentRead(id),
        write: (id, data) => this.terminals.agentWrite(id, data),
      },
      async (request, target) => {
        await this.agents.authorizeNavigation(request, target);
        await this.sendAgentCommand('workspace-navigation', target, request);
      },
      {
        actor: () => this.agents.clients.actor(),
        check: (proposal) => this.agents.authorizeProposal(proposal),
        run: (clientID, work) => this.agents.clients.context.run(clientID, work),
        executeAllowed: async () => {
          const client = await this.agents.clients.get();
          return !client || client.capabilities.includes('execute');
        },
        cancelExecution: (id) => this.executions.cancel(id),
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
        workspaceState: async () => this.workspaceCatalog,
        relationships: async (file, content) => {
          const result = await this.relationships.request({ kind: 'read', file, content });
          if (!result || !('relations' in result))
            throw new Error('The relationship result is unavailable.');
          return result;
        },
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
            'agentClients',
            'agentAudit',
            'agentStop',
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
            [
              'providerCredential',
              'agentToken',
              'agentClients',
              'agentAudit',
              'agentStop',
              'agentGrant',
              'fileAccessRevoke',
            ].includes(name)
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
  private async configureIndex(config: ApplicationSettings['search']): Promise<void> {
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
        this.workspaceCatalog = undefined;
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
    if (process.platform === 'darwin') macFiles().dismissFilePanels();
    this.settings.close();
    this.resources.clear();
    this.comparisons.close();
    await this.watchRules.close();
    await this.workflows.close();
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
      this.information.close(),
      this.projects.flush(),
      this.checkpoints.close(),
      this.operationPlans.close(),
      this.relationships.close(),
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
  private async sendAgentCommand(
    command: string,
    target: CapturedTarget,
    navigation?: AgentNavigation,
  ): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed())
      throw new Error('Open the workspace before running this action.');
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.agentCommands.delete(id);
        reject(new Error('The workspace did not finish this action. Request a fresh proposal.'));
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
      this.emit({ type: 'agent-command', id, command, target, navigation });
    });
  }
  private async invoke(method: ApiMethod, args: unknown[], senderID?: number): Promise<unknown> {
    switch (method) {
      case 'compare': {
        const request = args[0] as ComparisonRequest;
        if (request.kind === 'cancel') {
          this.comparisons.cancel(request.id);
          return null;
        }
        return this.comparisons.run(request.id, request.left, request.right, request.hashes);
      }
      case 'operationPlan':
        return this.operationPlans.request(args[0] as OperationPlanRequest);
      case 'checkpoints': {
        const request = args[0] as CheckpointRequest;
        if (request.kind === 'list') return this.checkpoints.list();
        if (request.kind === 'estimate') return this.checkpoints.estimate(request.paths);
        if (request.kind === 'remove') {
          await this.checkpoints.remove(request.id);
          return null;
        }
        return this.checkpoints.restore(request.id, request.destination, this.operations);
      }
      case 'inspect':
        return this.files.inspect(args[0] as string, args[1] as boolean, args[2] as boolean);
      case 'project': {
        const request = args[0] as ProjectRequest;
        if (request.kind === 'read') return this.projects.read(request.file);
        if (request.kind === 'save')
          return this.projects.save(request.file, request.revision, request.definition);
        const result = await dialog.showOpenDialog(this.windows.get(senderID!)!.window, {
          title: request.mode === 'open' ? 'Open Project Folder' : 'Create Project in Folder',
          buttonLabel: request.mode === 'open' ? 'Open Project' : 'Choose Folder',
          properties: ['openDirectory'],
          defaultPath: request.defaultPath,
          securityScopedBookmarks: this.fileAccess.scoped,
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await this.fileAccess.remember(result.filePaths[0], true, result.bookmarks?.[0]);
        return path.join(result.filePaths[0], 'viewer.project.jsonc');
      }
      case 'commandsPublish':
        this.commandCatalog = {
          target: args[0] as CapturedTarget,
          commands: args[1] as CommandDescriptor[],
        };
        this.workspaceCatalog = args[2] as AgentWorkspaceSnapshot | undefined;
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
      case 'agentClients': {
        const request = args[0] as AgentClientRequest;
        const reply = await this.agents.clientRequest(request);
        if (request.kind === 'create') {
          await this.agents.start();
          const created = reply as {
            client: AgentClient;
            token: string;
          };
          return {
            ...created,
            configuration: JSON.stringify(
              {
                mcpServers: {
                  viewer: {
                    command: process.execPath,
                    args: ['--mcp'],
                    env: {
                      VIEWER_AGENT_TOKEN: created.token,
                      ...(process.env.VIEWER_DATA_DIRECTORY
                        ? { VIEWER_DATA_DIRECTORY: process.env.VIEWER_DATA_DIRECTORY }
                        : {}),
                    },
                  },
                },
              },
              null,
              2,
            ),
          };
        }
        return reply;
      }
      case 'agentAudit':
        return this.agents.clients.history(args[0] as string | undefined);
      case 'agentStop':
        return this.agents.stop(args[0] as string);
      case 'agentGrant':
        return this.agentRequests.grant(
          args[0] as string,
          args[1] as string,
          args[2] as ExecutionGrant['capability'],
          args[3] as boolean,
          args[4] as string | undefined,
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
        return this.terminals.start(args[0] as TerminalStart, senderID!);
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
        return this.executions.start(args[0] as string, args[1] as CapturedTarget);
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
        if (process.platform === 'darwin') macFiles().dismissFilePanels();
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
            this.watchRules.revoke(root),
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
        await this.modelPermissions.set(provider, args[2] as ModelDataLevel | null);
        this.emit({ type: 'model-permission', providerID: provider.id });
        return;
      }
      case 'indexedQuery':
        return this.files.query(args[0] as IndexedQuery);
      case 'querySnapshot':
        return this.files.snapshot(args[0] as IndexedQuery);
      case 'watchRules':
        return this.watchRules.request(args[0] as WatchRuleRequest);
      case 'relationships':
        return this.relationships.request(args[0] as RelationshipsRequest);
      case 'workflow': {
        const request = args[0] as WorkflowRequest;
        if (request.kind !== 'choose')
          return this.workflows.request(
            request.kind === 'start'
              ? { ...request, context: { ...request.context, actor: 'user', clientID: undefined } }
              : request,
          );
        const result = await dialog.showOpenDialog(this.windows.get(senderID!)!.window, {
          title: request.mode === 'create' ? 'Create Workflow in Folder' : 'Open Workflow',
          buttonLabel: request.mode === 'create' ? 'Choose Folder' : 'Open Workflow',
          properties: request.mode === 'create' ? ['openDirectory'] : ['openFile'],
          defaultPath: request.defaultPath,
          securityScopedBookmarks: this.fileAccess.scoped,
          ...(request.mode === 'open'
            ? { filters: [{ name: 'Workflow JSONC', extensions: ['jsonc', 'json'] }] }
            : {}),
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await this.fileAccess.remember(
          result.filePaths[0],
          request.mode === 'create',
          result.bookmarks?.[0],
        );
        return request.mode === 'create'
          ? path.join(result.filePaths[0], 'viewer.workflow.jsonc')
          : result.filePaths[0];
      }
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
        await this.watchRules.start();
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
      case 'fileInformation':
        return this.information.get(args[0] as string);
      case 'fileInformationUpdate':
        return this.information.update(
          args[0] as string,
          args[1] as string,
          args[2] as FileInformationPatch,
        );
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
      case 'nativeFilePanel': {
        const files = args[1] as string[];
        await this.fileAccess.require(files);
        macFiles().filePanel(args[0] as string, files);
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
        await this.fileAccess.require([(args[0] as SearchRequest).root]);
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
          ...(args[0] as SavedState),
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
        const command = args[0] as TextEditCommand;
        this.windows.get(senderID!)!.window.webContents[command]();
        return;
      }
    }
  }
}
