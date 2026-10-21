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
import { modelDataLabels, modelEndpoint } from '../domain/model-permissions';
import { macFiles } from './macos-files';
import { Thumbnails } from './thumbnails';
import { AppIcons } from './app-icons';
import { nativeAppIcon } from './native-app-icon';
import { ActionPlanner } from './actions/planner';
import { AgentBroker } from './agent-broker';
import { Comparisons } from './comparison';
import { Duplicates } from './duplicates';
import { OperationPlans } from './operation-plans';
import { sourceVersion } from '../domain/inspection';
import { sharedClientID, type AgentAccessRequest, type AgentClient } from '../domain/agent-clients';
import type { ActionContext, ApplicationSettings } from '../domain/services';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ApiMethod, ApiResult, DesktopEvent, FileEntry } from '../domain/contracts';
import { absolute, entry, list } from './filesystem';
import { spotlightTagged } from './spotlight';
import { nativeImageConverter } from './native-image-convert';
import { quickLookRender } from './quick-look-render';
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
import { AgentAccess } from './agent-access';
import { fileCoordination } from './file-coordination';
import { FileInformationService } from './file-information';
import { Projects } from './projects';
import { Lenses } from './lenses';
import { Checkpoints } from './checkpoints';
import { Workflows } from './workflows';
import { WatchRules } from './watch-rules';
import { Relationships } from './relationships';
import { boundedRename } from './rename-preview';
import { methodWindows, schemas, settingsEvents, type ApiHandlers } from './ipc-schemas';
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
  readonly lenses: Lenses;
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
  private appIcons = new AppIcons(nativeAppIcon);
  private diagnosticReports = new Map<number, number[]>();
  // HOME becomes the container in App Sandbox. Sidebar/default paths describe
  // the actual user's folders; knowing those paths does not confer access.
  private readonly home = process.mas ? os.userInfo().homedir : os.homedir();
  private readonly trash: Trash;
  private context?: ActionContext;
  private indexConfiguration = '';
  private openPaths: string[] = [];
  private agentCommands = new Map<
    string,
    { finish(error?: string): void; owner: number; command: string }
  >();
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
      /** Remembers the Settings window's category with its frame. */
      settingsCategory?(category: string): void;
      /** Records a renderer failure in the local diagnostic log. */
      diagnose?(detail: string): void;
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
        // put back from the Trash browser, it takes its Viewer Trash receipt, and its Undo, along
        void this.operations.trashRestored(source);
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
    this.resources = new Resources(access, (file) => quickLookRender(file));
    this.applications = new Applications(options.applications);
    this.settings = new SettingsService(
      dataPath,
      this.home,
      () => nativeTheme.shouldUseDarkColors,
      (snapshot) => {
        this.options.settingsChanged?.();
        // On the defaults, which stand in for an unreadable config.jsonc and its last valid copy,
        // the providers are not the person's: reconciling deleted every model-data approval
        // (2026-10-20). Approvals wait for a readable file.
        if (snapshot.config?.fallback !== 'defaults')
          void this.modelPermissions.reconcile().catch(() =>
            emit({
              type: 'service-error',
              service: 'models',
              message:
                'Model data access was stopped, but the permission change could not be saved. Try again in Settings → Models.',
            }),
          );
        emit({ type: 'settings', snapshot: { ...snapshot, credentials: this.credentials.ids() } });
        // config.jsonc narrows the approved access at once; it cannot widen it
        void this.agents.access
          .narrow()
          .then(() => this.configureAgents())
          .catch(() =>
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
    const confirmations = new ExecutionConfirmations(dataPath, (summary) =>
      confirmNatively(this.window, summary.title, summary.detail, 'Run'),
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
      (profile) => confirmations.requireTerminal(profile),
    );
    this.externalTerminals = new ExternalTerminals(
      path.join(dataPath, 'terminal-launches'),
      () => this.settings.snapshot().settings,
      options.applications,
      undefined,
      access,
      {
        profile: (profile) => confirmations.requireTerminal(profile),
        tmux: (executable, socket, env) => confirmations.requireTmux(executable, socket, env),
        application: (application) => confirmations.requireTerminalApplication(application),
      },
    );
    // launchers an earlier session wrote that Terminal never ran
    void this.externalTerminals.sweep(dataPath).catch(() => {});
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
      // a key saved before keys were tied to an endpoint is tied only once the person allows it
      (provider) =>
        confirmNatively(
          [...this.windows.values()].find(
            ({ window }) => !window.isDestroyed() && window.isFocused(),
          )?.window ?? this.window,
          `Send your saved ${provider.name} API key to ${modelEndpoint(provider)}?`,
          'This key was saved before Viewer tied each key to the address it was entered for. Allow it, and it is sent only to this address from now on; to use it elsewhere, enter it again in Settings → Models.',
          'Allow',
        ),
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
      void this.lenses.remap(changes).catch(() => {});
      for (const change of changes) {
        void this.files.update(change.source, true).catch(() => {});
        void this.files.update(change.destination).catch(() => {});
        // only what changed: every batch cleared every thumbnail, and stopped those being made
        // elsewhere (2026-10-20); the cache keys already carry each file's identity and date
        void this.thumbnails.clear(change.source);
        void this.thumbnails.clear(change.destination);
      }
      this.appIcons.clear();
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
    this.lenses = new Lenses(dataPath, access, {
      home: this.home,
      trash: async (file) => this.operations.start({ kind: 'trash', sources: [file] }),
      trashOwn: (file) =>
        process.platform === 'darwin'
          ? macFiles()
              .trash(file, fileCoordination.purpose())
              .then(() => {})
          : shell.trashItem(file),
      changed: (folder) => emit({ type: 'lens-changed', folder }),
    });
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
      async (command, target, contents) => {
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
              // a folder's contents are checked again as the move runs, not only at approval:
              // a nested edit while it waited in the queue moved the changed folder (2026-10-20)
              expectedContents: [...(contents ?? [])].map(([path, proof]) => ({ path, proof })),
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
        // nothing is requested while config.jsonc and its last valid copy cannot be read
        agentAccess: new AgentAccess(dataPath, () => {
          const snapshot = this.settings.snapshot();
          return snapshot.config?.fallback === 'defaults' ? undefined : snapshot.settings.agents;
        }),
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
          const allowed = methodWindows[name];
          if (role === 'settings' && allowed === 'viewer')
            throw new Error('This API is unavailable in Settings.');
          if (role !== 'settings' && allowed === 'settings')
            throw new Error('Manage credentials in Settings.');
          return {
            ok: true,
            value: await this.call(name, args, event.sender.id),
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
  private async configureIndex(
    config: ApplicationSettings['search'],
    rebuild = false,
  ): Promise<void> {
    // the defaults' one location, Home, would purge every other location's rows and text
    if (this.settings.snapshot().config?.fallback === 'defaults') return;
    const key = JSON.stringify(config);
    if (key === this.indexConfiguration) return;
    this.indexConfiguration = key;
    try {
      await this.files.configure(config, rebuild);
    } catch (error) {
      this.indexConfiguration = '';
      throw error;
    }
  }
  private async chooseFolder(senderID: number, defaultPath?: string): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.windows.get(senderID)!.window, {
      properties: ['openDirectory'],
      defaultPath,
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
  /**
   * Settings → Agents changes the approval itself (`AgentAccess`) and mirrors it into config.jsonc.
   * Turning agents on and allowing a folder config.jsonc asks for are confirmed here, natively; the
   * folder panel is the confirmation of a folder the person chooses. Turning off and removing apply
   * first, so a config.jsonc that cannot be saved never keeps agents on.
   */
  private async changeAgentAccess(request: AgentAccessRequest, senderID: number): Promise<void> {
    const access = this.agents.access;
    const window = this.windows.get(senderID)?.window;
    const agents = () => this.settings.snapshot().settings.agents;
    const mirror = (value: Partial<ApplicationSettings['agents']>) =>
      this.settings.patch(
        [{ path: 'settings.agents', value: { ...agents(), ...value } }],
        this.settings.snapshot().revision,
      );
    if (request.kind === 'state') return;
    if (request.kind === 'capabilities') {
      const current = await access.capabilities();
      const added = request.capabilities.filter((capability) => !current.includes(capability));
      if (
        added.length &&
        !(await confirmNatively(
          window,
          'Allow the shared agent connection more?',
          `Clients with Viewer’s agent token will also have: ${added.join(', ')}.`,
          'Allow',
        ))
      )
        return;
      await access.approve({ capabilities: request.capabilities });
      return;
    }
    if (request.kind === 'enable' && !request.enabled) {
      await access.approve({ enabled: false });
      if (agents().enabled) await mirror({ enabled: false });
    } else if (request.kind === 'remove-folder') {
      await access.approve({ remove: [request.root] });
      if (agents().roots.includes(request.root))
        await mirror({ roots: agents().roots.filter((root) => root !== request.root) });
    } else if (request.kind === 'enable') {
      const { roots } = await access.state();
      if (
        !(await confirmNatively(
          window,
          'Allow local agent clients to use Viewer?',
          (roots.length
            ? 'Clients with Viewer’s agent token can read and search these folders and propose changes for your review:\n\n' +
              roots.join('\n')
            : 'No folder is authorized yet: add one in Settings → Agents.') +
            '\n\nYou can turn this off at any time.',
          'Allow',
        ))
      )
        return;
      if (!agents().enabled) await mirror({ enabled: true });
      await access.approve({ enabled: true });
    } else if (request.kind === 'allow') {
      const { pending } = await access.state();
      const roots = request.roots.filter((root) => pending.roots.includes(root));
      if (!roots.length) return;
      if (
        !(await confirmNatively(
          window,
          `Allow agents to use ${roots.length === 1 ? 'this folder' : `these ${roots.length} folders`}?`,
          'config.jsonc asks for them. Clients with Viewer’s agent token can read and search them and propose changes for your review:\n\n' +
            roots.join('\n'),
          'Allow',
        ))
      )
        return;
      await access.approve({ add: roots });
    } else {
      const root = await this.chooseFolder(senderID);
      if (!root) return;
      await this.agents.checkFolders([root]);
      if (!agents().roots.includes(root)) await mirror({ roots: [...agents().roots, root] });
      await access.approve({ add: [root] });
    }
    await this.configureAgents();
  }
  /** Starts or stops the agent server for the access in effect when its turn comes: computed by
   * each caller, a settings change and an approval could land in either order (2026-10-20). */
  private configureAgents(): Promise<void> {
    const task = this.agentsConfiguration
      .catch(() => {})
      .then(async () => {
        const { enabled } = await this.agents.access.state();
        if (this.agentsEnabled === enabled) return;
        this.agentsEnabled = enabled;
        await (enabled ? this.agents.start() : this.agents.close());
      });
    this.agentsConfiguration = task.catch((error) => {
      this.agentsEnabled = undefined;
      throw error;
    });
    return this.agentsConfiguration;
  }
  /** The file operations Quit would cancel. */
  pendingOperations(): number {
    return this.operations.pendingCount();
  }
  /** Resolves once no file operation is left. */
  operationsDrained(): Promise<void> {
    return this.operations.drained();
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
      if (!window.isDestroyed() && (role === 'viewer' || settingsEvents.includes(event.type)))
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
      this.lenses.close(),
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
        command,
        finish: (error) => {
          clearTimeout(timer);
          this.agentCommands.delete(id);
          if (error) reject(new Error(error));
          else resolve();
        },
      });
      const action = this.settings
        .snapshot()
        .settings.customActions.find((item) => 'custom.' + item.id === command);
      this.emit({
        type: 'agent-command',
        id,
        command,
        target,
        navigation,
        // a second short of the wait below, so the window never starts what was reported failed
        deadline: Date.now() + 24000,
        ...(action ? { executor: action.executor } : {}),
      });
    });
  }
  /** One handler per IPC method; the `ApiHandlers` type makes a missing one a compile error. */
  private createHandlers(): ApiHandlers {
    return {
      compare: (args) => {
        const request = args[0];
        if (request.kind === 'cancel') {
          this.comparisons.cancel(request.id);
          return null;
        }
        return this.comparisons.run(request.id, request.left, request.right, request.hashes);
      },
      duplicates: (args) => {
        const request = args[0];
        if (request.kind === 'cancel') {
          this.duplicates.cancel(request.id);
          return null;
        }
        return this.duplicates.run(request.id, request.roots);
      },
      operationPlan: (args) => this.operationPlans.request(args[0]),
      checkpoints: async (args) => {
        const request = args[0];
        if (request.kind === 'list') return this.checkpoints.list();
        if (request.kind === 'estimate') return this.checkpoints.estimate(request.paths);
        if (request.kind === 'remove') {
          await this.checkpoints.remove(request.id);
          return null;
        }
        return this.checkpoints.restore(request.id, request.destination, this.operations);
      },
      inspect: (args) => this.files.inspect(args[0], args[1], args[2]),
      lens: async (args) => {
        const request = args[0];
        if (request.kind === 'list') return this.lenses.list(request.folder);
        if (request.kind === 'create')
          return this.lenses.create(request.folder, request.name, request.ops);
        if (request.kind === 'apply')
          return this.lenses.apply(request.folder, request.file, request.ops);
        if (request.kind === 'trash') return this.lenses.trash(request.folder, request.file);
        if (request.kind === 'share') return this.lenses.share(request.folder, request.file);
        await this.lenses.collapse(request.lens, request.groups);
        return null;
      },
      project: async (args, senderID) => {
        const request = args[0];
        if (request.kind === 'read') return this.projects.read(request.file);
        if (request.kind === 'save')
          return this.projects.save(request.file, request.revision, request.definition);
        const result = await dialog.showOpenDialog(this.windows.get(senderID)!.window, {
          title: request.mode === 'open' ? 'Open Project Folder' : 'Create Project in Folder',
          buttonLabel: request.mode === 'open' ? 'Open Project' : 'Choose Folder',
          properties: ['openDirectory'],
          defaultPath: request.defaultPath,
          securityScopedBookmarks: this.fileAccess.scoped,
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await this.fileAccess.remember(result.filePaths[0], true, result.bookmarks?.[0]);
        return path.join(result.filePaths[0], 'viewer.project.jsonc');
      },
      commandsPublish: (args) => {
        this.commandCatalog = {
          target: args[0],
          commands: args[1],
        };
        this.workspaceCatalog = args[2];
        return;
      },
      agentCommandResult: (args, senderID) => {
        const request = this.agentCommands.get(args[0]);
        if (!request || request.owner !== senderID)
          throw new Error('Action acknowledgement is no longer available.');
        request.finish(args[1]);
        return;
      },
      agentReviewList: () => this.agentRequests.list(),
      agentReview: (args) => this.agentRequests.review(args[0], args[1]),
      agentGrants: () => this.agentRequests.listGrants(),
      agentClients: async (args) => {
        const request = args[0];
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
      },
      agentAudit: (args) => this.agents.clients.history(args[0]),
      agentStop: (args) => this.agents.stop(args[0]),
      agentGrant: (args) => {
        return this.agentRequests.grant(args[0], args[1], args[2], args[3], args[4]);
      },
      configOpen: async () => {
        await this.settings.load();
        const error = await shell.openPath(this.settings.snapshot().config!.path);
        if (error) throw new Error(error);
        return;
      },
      configValidate: () => this.settings.reload(),
      configRestore: () => this.settings.restoreConfiguration(),
      configTransfer: async (args, senderID) => {
        if (args[0] === 'export') {
          const { canceled, filePath, bookmark } = await dialog.showSaveDialog({
            title: 'Export configuration',
            defaultPath: 'config.jsonc',
            securityScopedBookmarks: this.fileAccess.scoped,
          });
          if (!canceled && filePath) {
            await this.fileAccess.allowOnce(filePath, bookmark);
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
            await this.fileAccess.allowOnce(filePaths[0], bookmarks?.[0]);
            await this.fileAccess.require([filePaths[0]]);
            return this.settings.importConfiguration(filePaths[0], (changes) =>
              confirmNatively(
                this.windows.get(senderID)?.window,
                'Import this configuration?',
                'It changes ' +
                  changes.join('; ') +
                  '.\n\nThe current config.jsonc is kept beside it as config.jsonc.before-import-….',
                'Import',
              ),
            );
          }
        }
        return this.settings.snapshot();
      },
      terminalApplication: () => this.externalTerminals.application(),
      terminalExternal: async (args) => {
        await this.fileAccess.require([args[0]]);
        return this.externalTerminals.open(args[0], args[1]);
      },
      terminalStart: (args, senderID) => this.terminals.start(args[0], senderID),
      terminalWrite: (args, senderID) => this.terminals.write(args[0], args[1], senderID),
      terminalResize: (args, senderID) =>
        this.terminals.resize(args[0], args[1], args[2], senderID),
      terminalAck: (args, senderID) => this.terminals.ack(args[0], args[1], senderID),
      terminalClose: (args, senderID) => this.terminals.stop(args[0], senderID),
      customExecute: (args) => {
        // never on an agent's request: its approval was for a recipe or a command, not a program
        if ([...this.agentCommands.values()].some(({ command }) => command === 'custom.' + args[0]))
          throw new Error('Agents cannot run programs or shell scripts.');
        return this.executions.start(args[0], args[1]);
      },
      executionList: () => this.executions.list(),
      executionCancel: (args) => this.executions.cancel(args[0]),
      openSettings: () => this.options.openSettings(),
      settingsCategory: ([category]) => this.options.settingsCategory?.(category),
      settingsGet: async () => {
        await this.settings.load();
        await this.credentials.load();
        return this.settings.snapshot(this.credentials.ids());
      },
      fileAccessList: () => this.fileAccess.list(),
      fileAccessRevoke: async (args) => {
        const root = args[0];
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
      },
      volumesList: () => (process.platform === 'darwin' ? macFiles().volumes() : []),
      trashList: (args) => this.trash.list(args[0]),
      trashConfirmation: (args, senderID) =>
        this.trash.confirmation(this.windows.get(senderID)!.window, args[0]),
      trashPreview: (args) => this.trash.preview(args[0]),
      trashCopyPaths: (args) => this.trash.copyPaths(args[0]),
      trashRestore: async (args, senderID) => {
        const window = this.windows.get(senderID)!.window;
        // the folder is chosen before the operations queue is held: a panel left open blocked it
        const folder =
          args[1] === 'choose' ? await this.trash.chooseRestoreFolder(window) : undefined;
        if (args[1] === 'choose' && !folder) return { restored: 0, cancelled: true };
        return this.operations.exclusive(() =>
          this.trash.restore(window, args[0], folder ? { folder } : 'original'),
        );
      },
      trashAccess: (args, senderID) =>
        this.trash.requestAccess(this.windows.get(senderID)!.window, args[0]),
      volumeEject: async (args) => {
        const root = args[0];
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
      },
      settingsPatch: async (args, senderID) => {
        return {
          ...(await this.settings.patch(
            args[0],
            args[1],
            this.windows.get(senderID)?.role === 'settings' ? undefined : 'workspace',
          )),
          credentials: this.credentials.ids(),
        };
      },
      providerCredential: async (args) => {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((item) => item.id === args[0]);
        if (!args[1]) {
          if (provider) await this.modelPermissions.set(provider, null);
          this.emit({ type: 'model-permission', providerID: args[0] });
        } else if (!provider)
          // a key is tied to its provider's endpoint as it is saved: one without a provider was not
          throw new Error('Save the provider in Settings → Models before entering its key.');
        await this.credentials.set(
          args[0],
          args[1],
          provider ? providerBinding(provider) : undefined,
        );
        this.settings.announce();
        return;
      },
      providerModels: (args) => {
        const provider = this.settings
          .snapshot()
          .settings.providers.find((provider) => provider.id === args[0]);
        if (!provider) throw new Error('Provider is unavailable.');
        return this.providers.models(provider);
      },
      providerPermissionGet: ([id]) => this.modelPermissions.get(this.provider(id)),
      providerPermissionSet: async ([id, endpoint, level], senderID) => {
        const provider = this.provider(id);
        if (modelEndpoint(provider) !== modelEndpoint({ endpoint }))
          throw new Error(
            'The provider endpoint changed. Review its new address before allowing data access.',
          );
        // A renderer could store this approval by itself, and with it send document text to any
        // https host it had configured (2026-10-20): the person grants it here, natively.
        if (
          level &&
          !(await confirmNatively(
            this.windows.get(senderID)?.window,
            `Allow Viewer to send ${modelDataLabels[level]} to ${provider.name}?`,
            `Actions using this provider send your instructions and that data to:\n${modelEndpoint(provider)}\n\nYou can revoke this in Settings → Models.`,
            'Allow',
          ))
        )
          throw new Error('Model data access was not allowed.');
        await this.modelPermissions.set(provider, level);
        this.emit({ type: 'model-permission', providerID: provider.id });
      },
      providerPermissionAgents: async ([id, endpoint, allow], senderID) => {
        const provider = this.provider(id);
        if (modelEndpoint(provider) !== modelEndpoint({ endpoint }))
          throw new Error(
            'The provider endpoint changed. Review its new address before allowing data access.',
          );
        const permission = await this.modelPermissions.get(provider);
        if (
          allow &&
          permission &&
          !(await confirmNatively(
            this.windows.get(senderID)?.window,
            `Let actions agents start send ${modelDataLabels[permission.level]} to ${provider.name}?`,
            `An agent's request to run an action then sends your files' data to:\n${modelEndpoint(provider)}\n\nYou can turn this off in Settings → Models.`,
            'Allow',
          ))
        )
          throw new Error('Agent access to model data was not allowed.');
        await this.modelPermissions.allowAgents(provider, allow);
        this.emit({ type: 'model-permission', providerID: provider.id });
      },
      indexedQuery: (args) => this.files.query(args[0]),
      querySnapshot: (args) => this.files.snapshot(args[0]),
      watchRules: (args) => this.watchRules.request(args[0]),
      relationships: (args) => this.relationships.request(args[0]),
      workflow: async (args, senderID) => {
        const request = args[0];
        if (request.kind !== 'choose')
          return this.workflows.request(
            request.kind === 'start'
              ? { ...request, context: { ...request.context, actor: 'user', clientID: undefined } }
              : request,
          );
        const result = await dialog.showOpenDialog(this.windows.get(senderID)!.window, {
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
      },
      indexStatus: () => this.files.status(),
      indexRebuild: () => {
        this.indexConfiguration = '';
        return this.configureIndex(this.settings.snapshot().settings.search, true);
      },
      actionStart: (args) => {
        return this.actions.start({
          ...args[0],
          context: { ...args[0].context, actor: 'user' },
        });
      },
      actionGet: (args) => this.actions.get(args[0]),
      actionList: () => this.actions.all(),
      actionApply: (args) => this.actions.apply(args[0]),
      actionCancel: (args) => {
        this.actions.cancel(args[0]);
        return;
      },
      actionUndo: (args) => this.actions.undo(args[0]),
      actionRecover: (args) => this.actions.recovery(args[0]),
      actionExportSummary: (args) => this.actions.exportSummary(args[0], args[1]),
      agentToken: async () => {
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
      },
      contextPublish: (args) => {
        this.context = { ...args[0], actor: 'user' };
        return;
      },
      diagnosticReport: ([detail], senderID) => {
        // A window in an error loop cannot flood the log: 30 reports a minute each.
        const now = Date.now();
        const recent = (this.diagnosticReports.get(senderID) ?? []).filter(
          (at) => now - at < 60_000,
        );
        if (recent.length >= 30) return;
        this.diagnosticReports.set(senderID, [...recent, now]);
        this.options.diagnose?.(detail);
      },
      appIcon: async ([file, size]) => {
        await this.fileAccess.require([file]);
        const item = await entry(file);
        if (!item.directory || item.extension !== 'app')
          throw new Error('Icons are offered for applications only.');
        return this.appIcons.get(item.path, size, item.modified);
      },
      thumbnail: async (args) => {
        await this.fileAccess.require([args[0]]);
        const thumbnail = await this.thumbnails.get(args[0], args[1]);
        await this.fileAccess.require([args[0]]);
        return thumbnail;
      },
      document: async (args) => {
        const file = this.resources.documentSource(args[0]);
        const document = await this.files.extract(file, this.resources.signal(args[0]), true);
        this.resources.documentSource(args[0]);
        return document;
      },
      bootstrap: async () => {
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
        await this.configureAgents();
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
      },
      list: async (args) => {
        await this.fileAccess.require([args[0]]);
        return list(args[0]);
      },
      stat: async (args) => {
        await this.fileAccess.require([args[0]]);
        return entry(args[0]);
      },
      fileInformation: (args) => this.information.get(args[0]),
      fileInformationUpdate: (args) => this.information.update(args[0], args[1], args[2]),
      chooseFolder: (args, senderID) => this.chooseFolder(senderID, args[0]),
      agentAccess: async ([request], senderID) => {
        await this.changeAgentAccess(request, senderID);
        return this.agents.access.state();
      },
      reveal: async (args) => {
        await this.fileAccess.require([args[0]]);
        shell.showItemInFolder(args[0]);
        return;
      },
      connectServer: async (args) => {
        // Only file-sharing addresses: the system mounts them and asks for credentials.
        await shell.openExternal(serverAddress(args[0]));
        return;
      },
      taggedFiles: async (args) => {
        const [tag, roots] = args;
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
      },
      openExternal: async (args) => {
        await this.fileAccess.require([args[0]]);
        const error = await shell.openPath(args[0]);
        if (error) throw new Error(error);
        return;
      },
      nativeFilePanel: async (args) => {
        const files = args[1];
        await this.fileAccess.require(files);
        macFiles().filePanel(args[0], files);
        return;
      },
      folderSizeStart: (args) => this.files.sizeStart(args[0]),
      folderSizeGet: (args) => this.files.sizeGet(args[0]),
      folderSizeCancel: (args) => this.files.sizeCancel(args[0]),
      applications: async (args) => {
        await this.fileAccess.require(args[0]);
        return this.applications.list(args[0]);
      },
      openWith: async (args) => {
        await this.fileAccess.require(args[0]);
        return this.applications.open(args[0], args[1]);
      },
      chooseApplication: async () => {
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
      },
      watch: async (args) => {
        await this.fileAccess.require([args[0]]);
        await this.watchers.add(args[0], args[1]);
        try {
          await this.fileAccess.require([args[0]]);
        } catch (error) {
          await this.watchers.remove(args[1]);
          throw error;
        }
        return;
      },
      unwatch: (args) => this.watchers.remove(args[0]),
      search: async (args) => {
        await this.fileAccess.require([args[0].root]);
        return this.search.start(args[0]);
      },
      cancelSearch: (args) => this.search.cancel(args[0]),
      operate: (args) => this.operations.start(args[0]),
      jobs: async () => {
        await this.operations.load();
        return this.operations.all();
      },
      cancelJob: (args) => this.operations.cancel(args[0]),
      resolveCollision: (args) => this.operations.resolve(args[0], args[1], args[2]),
      undo: (args) => this.operations.undo(args[0]),
      redo: (args) => this.operations.redo(args[0]),
      resource: (args) => this.resources.grant(args[0]),
      read: (args) => this.resources.read(args[0], args[1]),
      release: (args) => this.resources.release(args[0]),
      archive: (args) => this.resources.archive(args[0]),
      archiveEntry: (args) => this.resources.archiveEntry(args[0], args[1]),
      imageRendition: (args) => this.resources.rendition(args[0]),
      printPDF: async (args) => {
        if (process.platform !== 'darwin') throw new Error('Printing PDFs requires macOS.');
        const file = await this.resources.printableFile(args[0]);
        macFiles().printPDF(file, args[1]);
        return;
      },
      save: (args) => {
        return this.storage.save({
          ...args[0],
          ui: this.settings.snapshot().ui,
          look: this.settings.snapshot().look,
          preferencesRevision: this.settings.snapshot().revision,
        } as Parameters<Storage['save']>[0]);
      },
      flushed: (args) => this.flushes.get(args[0])?.(),
      clipboardWrite: (args) => this.pasteboard.write(args[0], args[1]),
      clipboardRead: () => this.pasteboard.read(),
      fileDropPaths: (args) => this.pasteboard.dropped(args[0]),
      copyPaths: (args) => this.pasteboard.copyText(args[0]),
      fileDragStart: async (args, senderID) => {
        const paths = args[0];
        await this.fileAccess.require(paths);
        const window = this.windows.get(senderID)?.window;
        if (!window || window.isDestroyed()) throw new Error('The file view has closed.');
        const [first] = paths;
        if (!first) return;
        // Native file objects carry all selected paths to Finder and other apps.
        const icon = await app.getFileIcon(first, { size: 'normal' });
        window.webContents.startDrag({ file: first, files: paths, icon });
        return;
      },
      textEdit: (args, senderID) => {
        const command = args[0];
        this.windows.get(senderID)!.window.webContents[command]();
        return;
      },
    };
  }
  private provider(id: string) {
    const provider = this.settings.snapshot().settings.providers.find((item) => item.id === id);
    if (!provider) throw new Error('Provider is unavailable.');
    return provider;
  }
  private handlerTable?: ApiHandlers;
  /** Runs a method's handler with arguments its schema produced. */
  private call<K extends ApiMethod>(method: K, args: unknown, senderID: number): unknown {
    const handler: ApiHandlers[K] = (this.handlerTable ??= this.createHandlers())[method];
    return handler(schemas[method].parse(args) as Parameters<ApiHandlers[K]>[0], senderID);
  }
}
