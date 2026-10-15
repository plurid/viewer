import type { FileChange } from '../domain/changes';
import { AgentRequests } from './agent-requests';
import { agentCommandID } from '../domain/agent-safety';
import type { CapturedTarget } from '../domain/automation';
import type {
  AgentNavigation,
  AgentWorkspaceSnapshot,
  CommandDescriptor,
} from '../domain/agent-requests';
import { Executions } from './executions';
import { ExecutionConfirmations } from './execution-confirmations';
import { ProtectedPaths } from './protected-paths';
import { Terminals } from './terminals';
import { ExternalTerminals } from './terminal-launch';
import {
  app,
  nativeTheme,
  safeStorage,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
} from 'electron';
import type { AgentProposal } from '../domain/agent-requests';
import { FileServices } from './file-services';
import { Applications } from './applications';
import { SettingsService } from './settings';
import { Credentials, Providers, providerBinding } from './providers';
import { ModelPermissions } from './model-permissions';
import { modelEndpoint } from '../domain/model-permissions';
import { macFiles } from './macos-files';
import { Thumbnails } from './thumbnails';
import { ActionPlanner } from './actions/planner';
import { AgentBroker } from './agent-broker';
import { Comparisons } from './comparison';
import { Duplicates } from './duplicates';
import { OperationPlans } from './operation-plans';
import { sourceVersion } from '../domain/inspection';
import { sharedClientID, type AgentClient } from '../domain/agent-clients';
import type { ActionContext, ApplicationSettings } from '../domain/services';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ApiMethod, ApiResult, DesktopEvent, FileEntry } from '../domain/contracts';
import { absolute, entry, list } from './filesystem';
import { spotlightTagged } from './spotlight';
import { nativeImageConverter } from './native-image-convert';
import { Operations } from './operations';
import { Resources } from './resources';
import { Search } from './search';
import { Storage } from './storage';
import { Watchers } from './watchers';
import { Trash } from './trash';
import { applicationsPath } from './trash-locations';
import { trashLocation, trashName, type DesktopPlatform } from '../domain/trash';
import { FileAccess } from './file-access';
import { NativeSelections } from './native-selections';
import { Pasteboard } from './pasteboard';
import { confirmAgentProposal, confirmNatively } from './native-confirmation';
import { fileCoordination } from './file-coordination';
import { FileInformationService } from './file-information';
import { Projects } from './projects';
import { Checkpoints } from './checkpoints';
import { Workflows } from './workflows';
import { WatchRules } from './watch-rules';
import { Relationships } from './relationships';
import { boundedRename } from './rename-preview';
import { schemas, type ApiCall } from './ipc-schemas';
import { serverAddress } from '../domain/volumes';
import { errorMessage } from '../domain/errors';

export class Desktop {
  private nativeSelections = new NativeSelections((source) =>
    macFiles().clipboardVersion(source === 'drag'),
  );
  private pasteboard: Pasteboard;
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
  readonly duplicates: Duplicates;
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
  private readonly trash: Trash;
  private context?: ActionContext;
  private indexConfiguration = '';
  private openPaths: string[] = [];
  private agentCommands = new Map<string, { finish(error?: string): void; owner: number }>();
  private agentsEnabled?: boolean;
  private agentsConfiguration: Promise<void> = Promise.resolve();
  private flushes = new Map<string, () => void>();
  private flushing?: Promise<void>;
  private disposal?: Promise<void>;
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
    this.pasteboard = new Pasteboard(this.fileAccess, this.nativeSelections);
    this.trash = new Trash(this.home, this.fileAccess, {
      origins: () => this.operations.trashOrigins(),
      preview: (file) => this.resources.grant(file),
      release: (id) => this.resources.release(id),
      changed: (source, destination) => {
        emit({ type: 'folder-changed', path: path.dirname(source) });
        emit({ type: 'folder-changed', path: path.dirname(destination) });
        void this.resources.clear(source);
      },
    });
    const access = (files: readonly string[]) => this.fileAccess.require(files);
    this.projects = new Projects(access);
    this.comparisons = new Comparisons(access);
    this.duplicates = new Duplicates(access);
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
    const confirmations = new ExecutionConfirmations(dataPath, (summary) =>
      confirmNatively(this.window, summary.title, summary.detail, 'Run'),
    );
    this.executions = new Executions(
      () => this.settings.snapshot().settings,
      (task) => {
        emit({ type: 'execution', task });
        this.agentRequests?.execution(task);
      },
      access,
      (action) => confirmations.require(action),
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
      (job) => {
        emit({ type: 'job', job });
        this.agentRequests?.operation(job);
      },
      (progress) => emit({ type: 'job-progress', progress }),
      changed,
      access,
      dataPath,
      (receipt, work) => this.fileAccess.withReceipt(receipt, work),
      (message) => emit({ type: 'service-error', service: 'operations', message }),
      new ProtectedPaths(this.home),
      nativeImageConverter,
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
      (proposal) => {
        emit({ type: 'agent-proposal', proposal });
        this.auditProposal(proposal);
      },
      async (command, target) => {
        const resolved = agentCommandID(command, this.settings.snapshot().settings.customActions);
        if (resolved === 'trash') {
          return {
            operationID: this.operations.start({
              kind: 'trash',
              sources: target.selection.map((file) => file.path),
              expectedSources: target.selection.map((file) => ({
                path: file.path,
                version: sourceVersion(file),
              })),
            }),
          };
        }
        await this.sendAgentCommand(resolved, target);
      },
      { read: (id) => this.terminals.agentRead(id) },
      async (request, target) => {
        await this.agents.authorizeNavigation(request, target);
        await this.sendAgentCommand('workspace-navigation', target, request);
      },
      {
        actor: () => this.agents.clients.actor(),
        check: (proposal) => this.agents.authorizeProposal(proposal),
        run: (clientID, work) => this.agents.clients.context.run(clientID, work),
        cancelExecution: (id) => this.executions.cancel(id),
        cancelOperation: (id) => this.operations.cancel(id),
        operation: (id) => this.operations.all().find((job) => job.id === id),
      },
      (proposal) => confirmAgentProposal(this.window, proposal),
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
            // The schema for `name` produced these arguments, so the pair is an ApiCall.
            value: await this.invoke(
              { method: name, args: schemas[name].parse(args) } as ApiCall,
              event.sender.id,
            ),
          };
        } catch (error) {
          return {
            ok: false,
            error: errorMessage(error),
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
    this.trash.close();
    if (process.platform === 'darwin') macFiles().dismissFilePanels();
    this.settings.close();
    this.resources.clear();
    this.comparisons.close();
    this.duplicates.close();
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
  private audited = new Set<string>();
  /** Each reviewed agent request leaves one durable record of its outcome. */
  private auditProposal(proposal: AgentProposal): void {
    if (!['completed', 'failed', 'rejected', 'cancelled'].includes(proposal.status)) return;
    if (this.audited.has(proposal.id)) return;
    this.audited.add(proposal.id);
    if (this.audited.size > 2000) this.audited.delete(this.audited.values().next().value!);
    const files = proposal.target?.selection.map((file) => file.path) ?? [];
    const detail = [
      proposal.title,
      files.length ? `${files.length} items: ${files.slice(0, 5).join(', ')}` : '',
      proposal.error ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    void this.agents.clients
      .audit(
        'review:' + proposal.kind,
        proposal.status as 'completed' | 'failed' | 'rejected' | 'cancelled',
        detail,
        proposal.clientID ?? sharedClientID,
      )
      .catch(() => {});
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
        // The window may still run it later; say so rather than implying it did not happen.
        reject(
          new Error(
            'The workspace did not confirm this action within 25 seconds. It may still finish: check the affected files before requesting it again.',
          ),
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
      this.emit({ type: 'agent-command', id, command, target, navigation });
    });
  }
  private async invoke(call: ApiCall, senderID?: number): Promise<unknown> {
    switch (call.method) {
      case 'compare': {
        const request = call.args[0];
        if (request.kind === 'cancel') {
          this.comparisons.cancel(request.id);
          return null;
        }
        return this.comparisons.run(request.id, request.left, request.right, request.hashes);
      }
      case 'duplicates': {
        const request = call.args[0];
        if (request.kind === 'cancel') {
          this.duplicates.cancel(request.id);
          return null;
        }
        return this.duplicates.run(request.id, request.roots);
      }
      case 'operationPlan':
        return this.operationPlans.request(call.args[0]);
      case 'checkpoints': {
        const request = call.args[0];
        if (request.kind === 'list') return this.checkpoints.list();
        if (request.kind === 'estimate') return this.checkpoints.estimate(request.paths);
        if (request.kind === 'remove') {
          await this.checkpoints.remove(request.id);
          return null;
        }
        return this.checkpoints.restore(request.id, request.destination, this.operations);
      }
      case 'inspect':
        return this.files.inspect(call.args[0], call.args[1], call.args[2]);
      case 'project': {
        const request = call.args[0];
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
          target: call.args[0],
          commands: call.args[1],
        };
        this.workspaceCatalog = call.args[2];
        return;
      case 'agentCommandResult': {
        const request = this.agentCommands.get(call.args[0]);
        if (!request || request.owner !== senderID)
          throw new Error('Action acknowledgement is no longer available.');
        request.finish(call.args[1]);
        return;
      }
      case 'agentReviewList':
        return this.agentRequests.list();
      case 'agentReview':
        return this.agentRequests.review(call.args[0], call.args[1]);
      case 'agentGrants':
        return this.agentRequests.listGrants();
      case 'agentClients': {
        const request = call.args[0];
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
        return this.agents.clients.history(call.args[0]);
      case 'agentStop':
        return this.agents.stop(call.args[0]);
      case 'agentGrant':
        return this.agentRequests.grant(
          call.args[0],
          call.args[1],
          call.args[2],
          call.args[3],
          call.args[4],
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
        if (call.args[0] === 'export') {
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
        await this.fileAccess.require([call.args[0]]);
        return this.externalTerminals.open(call.args[0], call.args[1]);
      case 'terminalStart':
        return this.terminals.start(call.args[0], senderID!);
      case 'terminalWrite':
        return this.terminals.write(call.args[0], call.args[1], senderID!);
      case 'terminalResize':
        return this.terminals.resize(call.args[0], call.args[1], call.args[2], senderID!);
      case 'terminalAck':
        return this.terminals.ack(call.args[0], call.args[1], senderID!);
      case 'terminalClose':
        return this.terminals.stop(call.args[0], senderID!);
      case 'customExecute':
        return this.executions.start(call.args[0], call.args[1]);
      case 'executionList':
        return this.executions.list();
      case 'executionCancel':
        return this.executions.cancel(call.args[0]);
      case 'openSettings':
        return this.options.openSettings();
      case 'settingsGet':
        await this.settings.load();
        await this.credentials.load();
        return this.settings.snapshot(this.credentials.ids());
      case 'fileAccessList':
        return this.fileAccess.list();
      case 'fileAccessRevoke': {
        const root = call.args[0];
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
      case 'trashList':
        return this.trash.list(call.args[0]);
      case 'trashConfirmation':
        return this.trash.confirmation(this.windows.get(senderID!)!.window, call.args[0]);
      case 'trashPreview':
        return this.trash.preview(call.args[0]);
      case 'trashCopyPaths':
        return this.trash.copyPaths(call.args[0]);
      case 'trashRestore':
        return this.operations.exclusive(() =>
          this.trash.restore(this.windows.get(senderID!)!.window, call.args[0], call.args[1]),
        );
      case 'trashAccess':
        return this.trash.requestAccess(this.windows.get(senderID!)!.window, call.args[0]);
      case 'volumeEject': {
        const root = call.args[0];
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
          ...(await this.settings.patch(call.args[0], call.args[1])),
          credentials: this.credentials.ids(),
        };
      case 'providerCredential': {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((item) => item.id === call.args[0]);
        if (!call.args[1]) {
          if (provider) await this.modelPermissions.set(provider, null);
          this.emit({ type: 'model-permission', providerID: call.args[0] });
        }
        await this.credentials.set(
          call.args[0],
          call.args[1],
          provider ? providerBinding(provider) : undefined,
        );
        this.settings.announce();
        return;
      }
      case 'providerModels': {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((provider) => provider.id === call.args[0]);
        if (!provider) throw new Error('Provider is unavailable.');
        return this.providers.models(provider);
      }
      case 'providerPermissionGet':
      case 'providerPermissionSet': {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((item) => item.id === call.args[0]);
        if (!provider) throw new Error('Provider is unavailable.');
        if (call.method === 'providerPermissionGet') return this.modelPermissions.get(provider);
        if (modelEndpoint(provider) !== modelEndpoint({ endpoint: call.args[1] }))
          throw new Error(
            'The provider endpoint changed. Review its new address before allowing data access.',
          );
        await this.modelPermissions.set(provider, call.args[2]);
        this.emit({ type: 'model-permission', providerID: provider.id });
        return;
      }
      case 'indexedQuery':
        return this.files.query(call.args[0]);
      case 'querySnapshot':
        return this.files.snapshot(call.args[0]);
      case 'watchRules':
        return this.watchRules.request(call.args[0]);
      case 'relationships':
        return this.relationships.request(call.args[0]);
      case 'workflow': {
        const request = call.args[0];
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
          ...call.args[0],
          context: { ...call.args[0].context, actor: 'user' },
        });
      case 'actionGet':
        return this.actions.get(call.args[0]);
      case 'actionList':
        return this.actions.all();
      case 'actionApply':
        return this.actions.apply(call.args[0]);
      case 'actionCancel':
        this.actions.cancel(call.args[0]);
        return;
      case 'actionUndo':
        return this.actions.undo(call.args[0]);
      case 'actionRecover':
        return this.actions.recovery(call.args[0]);
      case 'actionExportSummary':
        return this.actions.exportSummary(call.args[0], call.args[1]);
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
        this.context = { ...call.args[0], actor: 'user' };
        return;
      case 'thumbnail': {
        await this.fileAccess.require([call.args[0]]);
        const thumbnail = await this.thumbnails.get(call.args[0], call.args[1]);
        await this.fileAccess.require([call.args[0]]);
        return thumbnail;
      }
      case 'document': {
        const file = this.resources.documentSource(call.args[0]);
        const document = await this.files.extract(file, this.resources.signal(call.args[0]), true);
        this.resources.documentSource(call.args[0]);
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
              name: 'Applications',
              path: applicationsPath(
                process.platform as DesktopPlatform,
                home,
                process.env.ProgramFiles,
              ),
            },
            {
              name: process.platform === 'darwin' ? 'Volumes' : 'Computer',
              path: process.platform === 'darwin' ? '/Volumes' : path.parse(home).root,
            },
            { name: trashName(process.platform as DesktopPlatform), path: trashLocation },
          ],
          openPaths: paths,
        };
      }
      case 'list':
        await this.fileAccess.require([call.args[0]]);
        return list(call.args[0]);
      case 'stat':
        await this.fileAccess.require([call.args[0]]);
        return entry(call.args[0]);
      case 'fileInformation':
        return this.information.get(call.args[0]);
      case 'fileInformationUpdate':
        return this.information.update(call.args[0], call.args[1], call.args[2]);
      case 'chooseFolder': {
        const result = await dialog.showOpenDialog(this.windows.get(senderID!)!.window, {
          properties: ['openDirectory'],
          defaultPath: call.args[0],
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
        await this.fileAccess.require([call.args[0]]);
        shell.showItemInFolder(call.args[0]);
        return;
      case 'connectServer':
        // Only file-sharing addresses: the system mounts them and asks for credentials.
        await shell.openExternal(serverAddress(call.args[0]));
        return;
      case 'taggedFiles': {
        const [tag, roots] = call.args;
        await this.fileAccess.require(roots);
        const found = new Set<string>();
        for (const root of roots)
          for (const file of await spotlightTagged(absolute(root), tag)) {
            if (found.size >= 10000) break;
            found.add(file);
          }
        // Spotlight can lag behind the disk; only current, accessible items are returned.
        const entries: FileEntry[] = [];
        for (const file of found)
          try {
            await this.fileAccess.require([file]);
            entries.push(await entry(file));
          } catch {
            // Gone, or outside granted folders.
          }
        return entries;
      }
      case 'openExternal': {
        await this.fileAccess.require([call.args[0]]);
        const error = await shell.openPath(call.args[0]);
        if (error) throw new Error(error);
        return;
      }
      case 'nativeFilePanel': {
        const files = call.args[1];
        await this.fileAccess.require(files);
        macFiles().filePanel(call.args[0], files);
        return;
      }
      case 'folderSizeStart':
        return this.files.sizeStart(call.args[0]);
      case 'folderSizeGet':
        return this.files.sizeGet(call.args[0]);
      case 'folderSizeCancel':
        return this.files.sizeCancel(call.args[0]);
      case 'applications':
        await this.fileAccess.require(call.args[0]);
        return this.applications.list(call.args[0]);
      case 'openWith':
        await this.fileAccess.require(call.args[0]);
        return this.applications.open(call.args[0], call.args[1]);
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
        await this.fileAccess.require([call.args[0]]);
        await this.watchers.add(call.args[0], call.args[1]);
        try {
          await this.fileAccess.require([call.args[0]]);
        } catch (error) {
          await this.watchers.remove(call.args[1]);
          throw error;
        }
        return;
      }
      case 'unwatch':
        return this.watchers.remove(call.args[0]);
      case 'search':
        await this.fileAccess.require([call.args[0].root]);
        return this.search.start(call.args[0]);
      case 'cancelSearch':
        return this.search.cancel(call.args[0]);
      case 'operate':
        return this.operations.start(call.args[0]);
      case 'jobs':
        await this.operations.load();
        return this.operations.all();
      case 'cancelJob':
        return this.operations.cancel(call.args[0]);
      case 'resolveCollision':
        return this.operations.resolve(call.args[0], call.args[1], call.args[2]);
      case 'undo':
        return this.operations.undo(call.args[0]);
      case 'redo':
        return this.operations.redo(call.args[0]);
      case 'resource':
        return this.resources.grant(call.args[0]);
      case 'read':
        return this.resources.read(call.args[0], call.args[1]);
      case 'release':
        return this.resources.release(call.args[0]);
      case 'archive':
        return this.resources.archive(call.args[0]);
      case 'archiveEntry':
        return this.resources.archiveEntry(call.args[0], call.args[1]);
      case 'save':
        return this.storage.save({
          ...call.args[0],
          ui: this.settings.snapshot().ui,
          look: this.settings.snapshot().look,
          preferencesRevision: this.settings.snapshot().revision,
        } as Parameters<Storage['save']>[0]);
      case 'flushed':
        return this.flushes.get(call.args[0])?.();
      case 'clipboardWrite':
        return this.pasteboard.write(call.args[0], call.args[1]);
      case 'clipboardRead':
        return this.pasteboard.read();
      case 'fileDropPaths':
        return this.pasteboard.dropped(call.args[0]);
      case 'copyPaths':
        return this.pasteboard.copyText(call.args[0]);
      case 'fileDragStart': {
        const paths = call.args[0];
        await this.fileAccess.require(paths);
        const window = this.windows.get(senderID!)?.window;
        if (!window || window.isDestroyed()) throw new Error('The file view has closed.');
        // Native file objects carry all selected paths to Finder and other apps.
        const icon = await app.getFileIcon(paths[0], { size: 'normal' });
        window.webContents.startDrag({ file: paths[0], files: paths, icon });
        return;
      }
      case 'textEdit': {
        const command = call.args[0];
        this.windows.get(senderID!)!.window.webContents[command]();
        return;
      }
    }
  }
}
