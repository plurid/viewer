import { createGitHandlers } from './ipc/git-handlers';
import { PersonalBackups } from './persistence/backup';
import { createEditingHandlers } from './ipc/editing-handlers';
import { createModelHandlers } from './ipc/model-handlers';
import { createWebHandlers } from './ipc/web-handlers';
import { sendEvent } from './ipc/events';
import { assetPath, processorFolder } from './native/assets';
import { settleAll } from '../domain/settle';
import { performanceMeter } from './diagnostics/performance';
import { WebPreviews } from './previews/web/service';
import { BrowserPlanes } from './browser/browser-planes';
import { Transforms } from './transforms/transforms';
import { OptimizationReviews } from './transforms/optimization-reviews';
import {
  imageProcess,
  imageInspectionProcess,
  svgPreviewProcess,
} from './transforms/image-process';
import { MediaDocuments } from './transforms/media-documents';
import { imageTransformSchema } from '../domain/operations/transforms';
import { answerPrompt } from './models/prompts';
import { namedLines } from '../domain/command-line/prompt';
import {
  emptySessionKeys,
  keepAliases,
  withSessionKeys,
  type SessionKeys,
} from '../domain/preferences/session-keys';
import type { FileChange } from '../domain/files/changes';
import { AgentRequests } from './agents/agent-requests';
import { agentCommandID } from '../domain/agents/safety';
import type { CapturedTarget, CustomAction } from '../domain/automation/actions';
import type {
  AgentNavigation,
  AgentWorkspaceSnapshot,
  CommandDescriptor,
} from '../domain/agents/requests';
import { Executions } from './actions/executions';
import { CommandReceipts } from './actions/receipts';
import { ExecutionConfirmations } from './actions/execution-confirmations';
import { ProtectedPaths } from './files/protected-paths';
import { Terminals } from './terminals/terminals';
import { ExternalTerminals } from './terminals/terminal-launch';
import {
  app,
  nativeTheme,
  safeStorage,
  dialog,
  ipcMain,
  shell,
  systemPreferences,
  type BrowserWindow,
} from 'electron';
import type { AgentProposal } from '../domain/agents/requests';
import { isFinalProposalStatus } from '../domain/agents/requests';
import { FileServices } from './files/file-services';
import { Applications } from './native/applications';
import { SettingsService } from './preferences/settings';
import { Credentials, Providers } from './models/providers';
import { ModelPermissions } from './models/model-permissions';
import { macFiles } from './native/macos-files';
import { guardTestTrash } from './native/test-removal-policy';
import { Thumbnails } from './previews/thumbnails';
import { AppIcons } from './native/app-icons';
import { nativeAppIcon } from './native/native-app-icon';
import { ActionPlanner } from './actions/planner';
import { AgentBroker } from './agents/agent-broker';
import { Comparisons } from './comparison/comparison';
import { Duplicates } from './comparison/duplicates';
import { OperationPlans } from './operations/operation-plans';
import { sameSourceVersion, sourceVersion } from '../domain/files/inspection';
import {
  sharedClientID,
  type AgentAccessRequest,
  type AgentClient,
} from '../domain/agents/clients';
import { newPlaneFolder, type ActionContext, type ApplicationSettings } from '../domain/services';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ApiMethod, ApiResult, DesktopEvent, FileEntry, Resource } from '../domain/contracts';
import { absolute, entry, list } from './files/filesystem';
import { isPackage } from '../domain/files/entries';
import { spotlightTagged } from './search/spotlight';
import { nativeImageConverter } from './native/native-image-convert';
import { imageDecoder } from './native/quick-look-render';
import { Operations } from './operations/operations';
import { TextFiles } from './editing/text-files';
import { TextBuffers } from './editing/text-buffers';
import { Notes } from './editing/notes';
import { GitReviews } from './comparison/review';
import { AgentSessions } from './agents/sessions';
import { Resources } from './previews/resources';
import { DerivedPreviews, rawDecoder } from './previews/derived';
import { officeDecoder } from './previews/office-renderer';
import { officeRuntimeName } from './previews/office-runtime-manifest';
import { videoDecoder } from './previews/video-rendition';
import { officeImageParts } from '../domain/previews/documents/office';
import { Search } from './search/search';
import { Storage } from './persistence/storage';
import { Watchers } from './files/watchers';
import { Trash } from './operations/trash';
import { applicationsPath } from './operations/trash-locations';
import { trashLocation, trashName, type DesktopPlatform } from '../domain/files/trash';
import { FileAccess } from './files/file-access';
import { NativeSelections } from './native/native-selections';
import { Pasteboard } from './native/pasteboard';
import { confirmAgentProposal, confirmNatively } from './native/native-confirmation';
import { AgentAccess } from './agents/agent-access';
import { fileCoordination } from './files/file-coordination';
import { FileInformationService } from './files/file-information';
import { Projects } from './workspaces/projects';
import { Lenses } from './workspaces/lenses';
import { Checkpoints } from './operations/checkpoints';
import { Workflows } from './automation/workflows';
import { WatchRules } from './automation/watch-rules';
import { Relationships } from './workspaces/relationships';
import { boundedRename } from './actions/rename-preview';
import { methodWindows, schemas, settingsEvents, type ApiHandlers } from './ipc/schemas';
import { serverAddress } from '../domain/files/volumes';
import { errorMessage } from '../domain/errors';
import { GitReader } from './comparison/git';
import { GitWorktrees } from './comparison/worktrees';
import { GitActions } from './comparison/git-actions';
import { bindGitTarget, validateGitTarget, type GitTargetWindow } from './comparison/git-target';
import { mergeChanged, WorkspaceSessions } from './windows/workspace-sessions';
import { ShellCommand } from './windows/shell-command';
import { SpeechModels } from './speech/models';
import { Speech } from './speech/service';
import { SpeechRuntime } from './speech/runtime';
import { SpeechProviders } from './speech/providers';
import { AgentTaskWorkflows } from './agents/task-workflow';
import { TaskRequests } from './workspaces/task-requests';
import { taskWorkflowReviewDetail } from '../domain/agents/task-workflow';
import { speechRuntimeName } from './speech/runtime-manifest';
import { AgentServiceTools } from './agents/service-tools';
import type { HotkeyStatus } from './windows/hotkey-window';
import type { LaunchRequest } from '../domain/workspaces/launch';
import { Chats } from './chat/service';
import { planLegacyProfileRestoration } from './preferences/profile-migration';
import { resolveWindowPreferences } from '../domain/preferences/presentation/resolver';
import { modelEndpoint } from '../domain/models/permissions';
import { WindowFlushRequests } from './windows/flush-requests';
import { JournalStore } from './journal/store';
import { JournalActivity } from './journal/activity';
import { createJournalHandlers } from './journal/handlers';

type WindowRole = 'viewer' | 'settings';

/** One renderer window, and what it has told the desktop. */
interface WindowRecord {
  window: BrowserWindow;
  originID: string;
  role: WindowRole;
  workspaceID?: string;
  ready?: boolean;
  paths: string[];
  launches: LaunchRequest[];
  catalog?: { target: CapturedTarget; commands: CommandDescriptor[] };
  workspaceCatalog?: AgentWorkspaceSnapshot;
  planeOwners?: Record<string, string>;
  context?: ActionContext;
}

export class Desktop {
  readonly journal: JournalStore;
  private readonly activity: JournalActivity;
  readonly chats: Chats;
  readonly agentSessions: AgentSessions;
  private shellCommand: ShellCommand;
  readonly speechModels: SpeechModels;
  readonly speech: Speech;
  readonly workspaceSessions = new WorkspaceSessions();
  readonly git: GitReader;
  readonly worktrees: GitWorktrees;
  readonly gitReviews: GitReviews;
  private readonly gitActions: GitActions;
  private gitResources = new Set<string>();
  private nativeSelections = new NativeSelections((source) =>
    macFiles().clipboardVersion(source === 'drag'),
  );
  private pasteboard: Pasteboard;
  /** `:bind` and `:alias` of this session: in memory only, until quit. */
  private sessionKeys: SessionKeys = emptySessionKeys;
  /** Prompts being answered, to cancel. */
  private prompts = new Map<string, AbortController>();
  readonly agentRequests: AgentRequests;
  private commandCatalog?: { target: CapturedTarget; commands: CommandDescriptor[] };
  private workspaceCatalog?: AgentWorkspaceSnapshot;
  readonly terminals: Terminals;
  readonly externalTerminals: ExternalTerminals;
  readonly executions: Executions;
  readonly receipts: CommandReceipts;
  readonly resources: Resources;
  readonly webPreviews: WebPreviews;
  readonly transforms: Transforms;
  readonly optimizationReviews: OptimizationReviews;
  readonly mediaDocuments: MediaDocuments;
  readonly backups: PersonalBackups;
  readonly browsers = new BrowserPlanes((owner) => this.windows.get(owner)?.window);
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
  readonly texts: TextFiles;
  readonly buffers: TextBuffers;
  readonly notes: Notes;
  readonly watchers: Watchers;
  readonly search: Search;
  readonly storage: Storage;
  private ready = false;
  private windows = new Map<number, WindowRecord>();
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
  readonly agentTaskWorkflows: AgentTaskWorkflows;
  readonly personTaskWorkflows: AgentTaskWorkflows;
  readonly taskRequests: TaskRequests;
  readonly thumbnails: Thumbnails;
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
  private pendingCommandDraft?: CustomAction;
  private agentsConfiguration: Promise<void> = Promise.resolve();
  private readonly flushes = new WindowFlushRequests();
  private flushing?: Promise<void>;
  private disposal?: Promise<void>;
  /** Saved state read early for the window's settings, handed to the first bootstrap unread again:
   * reading it moves a damaged file aside, and a second read would lose that notice. */
  private storedEarly?: ReturnType<Storage['load']>;
  private settingsPrepared?: Promise<void>;
  /** Settings loaded as bootstrap loads them (seeded from saved state on a first configuration), so
   * the window is made with its backdrop (backdrop.ts). */
  prepareSettings(): Promise<void> {
    return (this.settingsPrepared ??= (async () => {
      this.storedEarly = this.storage.load();
      const stored = await this.storedEarly;
      await this.settings.load(stored.state || undefined);
      if (stored.state) {
        const snapshot = this.settings.snapshot();
        const restoration = planLegacyProfileRestoration(stored.state, snapshot);
        try {
          if (restoration.patches.length)
            await this.settings.patch(restoration.patches, snapshot.revision, 'workspace');
          stored.state = restoration.state;
        } catch (error) {
          restoration.warnings.push(
            'Earlier profile preferences were retained because their restoration could not be saved.',
          );
          this.options.diagnose?.(String(error));
        }
        if (restoration.warnings.length)
          stored.recovery = [stored.recovery, ...restoration.warnings].filter(Boolean).join('\n');
      }
      this.workspaceSessions.seed(stored.state);
    })());
  }
  /** Native chrome uses the same canonical preferences and local overlay as its renderer. */
  windowPreferences(workspaceID?: string) {
    const snapshot = this.settings.snapshot();
    const presentation = this.workspaceSessions.presentation(workspaceID);
    return resolveWindowPreferences({
      settings: snapshot.settings,
      ui: snapshot.ui,
      systemLook: snapshot.systemLook ?? snapshot.look,
      ...presentation,
    });
  }
  workspaceForWindow(window: BrowserWindow): string | undefined {
    return this.windows.get(window.webContents.id)?.workspaceID;
  }
  speechMicrophoneAllowed(owner: number): boolean {
    const window = this.windows.get(owner)?.window;
    return (
      !!window &&
      !window.isDestroyed() &&
      this.allowedURL(window.webContents.getURL()) &&
      this.speech.allowsMicrophone(owner)
    );
  }
  /** A new window starts from general preferences, without another window's profile overlay. */
  createWorkspace(): string {
    return this.workspaceSessions.create(this.initialFolder());
  }
  private initialFolder(): string {
    return newPlaneFolder(this.settings.snapshot().settings.browsing, this.home, undefined, true);
  }
  constructor(
    dataPath: string,
    private allowedURL: (url: string) => boolean,
    private options: {
      openSettings(focus?: string): Promise<void>;
      newWindow?(workspaceID?: string): Promise<void>;
      workspaceChanged?(window: BrowserWindow, workspaceID: string): void;
      quitting?(): boolean;
      hotkeyStatus?(): HotkeyStatus;
      restoreWindow?(): void;
      worker: string;
      terminalWorker: string;
      ocr: string;
      applications: string;
      fileBackend?: 'process' | 'thread';
      shellCommandHome?: string;
      settingsChanged?(): void;
      /** Remembers the Settings window's category with its frame. */
      settingsCategory?(category: string): void;
      /** Records a renderer failure in the local diagnostic log. */
      diagnose?(detail: string): void;
    },
  ) {
    this.journal = new JournalStore(path.join(dataPath, 'journal'), () =>
      this.emit({ type: 'journal-changed' }),
    );
    this.activity = new JournalActivity(this.journal);
    this.gitReviews = new GitReviews({
      available: () => !process.mas,
      owner: (owner) =>
        this.gitWindow(owner)?.alive ? this.gitWindow(owner)?.originID : undefined,
      access: (paths) => this.fileAccess.require(paths),
      validate: (owner, target) =>
        validateGitTarget(target, this.gitWindow(owner), undefined, ['folder', 'git-changes']),
      changed: (root) => {
        this.git.invalidate();
        this.emit({ type: 'folder-changed', path: root });
      },
    });
    this.worktrees = new GitWorktrees({
      available: () => !process.mas,
      access: (paths) => this.fileAccess.require(paths),
      validateTarget: (owner, target) => validateGitTarget(target, this.gitWindow(owner)),
      owner: (owner) => {
        const record = this.windows.get(owner);
        return record?.role === 'viewer' && !record.window.isDestroyed()
          ? record.originID
          : undefined;
      },
    });
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
    this.git = new GitReader(
      () => !process.mas && this.settings.snapshot().settings.git.enabled,
      access,
    );
    this.shellCommand = new ShellCommand(
      options.shellCommandHome ?? this.home,
      process.execPath,
      (reviewed) => this.operations.trashReviewedFile(reviewed),
      (file) =>
        confirmNatively(
          [...this.windows.values()].find((item) => item.role === 'settings')?.window,
          'Uninstall the viewer shell command?',
          `Move this exact script to the Trash:\n${file}\n\nNo folder or shell startup file is changed.`,
          'Move to Trash',
        ),
      !process.mas && process.platform === 'darwin',
    );
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
    const raw = rawDecoder(assetPath(`viewer-raw-v3-darwin-${process.arch}`, 'viewer-raw'));
    const video = videoDecoder(assetPath(processorFolder));
    const derived = new DerivedPreviews(access, (source, mode, signal) =>
      mode === 'video' ? video(source, mode, signal) : raw(source, mode, signal),
    );
    const images = new DerivedPreviews(
      access,
      imageDecoder(
        assetPath('viewer-image-preview'),
        assetPath(processorFolder, 'ffmpeg'),
        (bytes, size, signal) =>
          svgPreviewProcess(
            path.join(path.dirname(options.worker), 'image-worker.cjs'),
            assetPath(processorFolder),
            bytes,
            size,
            signal,
            options.fileBackend,
          ),
      ),
      64 * 1024 * 1024,
      // thumbnails and small renditions: a few helper processes at once
      3,
    );
    this.thumbnails = new Thumbnails(derived, images);
    const office = new DerivedPreviews(access, officeDecoder(assetPath(officeRuntimeName)));
    this.resources = new Resources(access, undefined, 12000, derived, images, office);
    this.webPreviews = new WebPreviews(access, (owner, servers) => {
      const target = this.windows.get(owner)?.window;
      if (target && !target.isDestroyed())
        sendEvent(target.webContents, { type: 'local-servers', servers });
    });
    this.applications = new Applications(options.applications);
    this.settings = new SettingsService(
      dataPath,
      this.home,
      () => nativeTheme.shouldUseDarkColors,
      (snapshot) => {
        if (!snapshot.settings.git.enabled) {
          this.git.invalidate();
          for (const id of this.gitResources) this.resources.release(id);
          this.gitResources.clear();
        }
        this.options.settingsChanged?.();
        // On the defaults, which stand in for an unreadable config.jsonc and its last valid copy,
        // the providers are not the person's: reconciling deleted every model-data approval
        //. Approvals wait for a readable file.
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
        void this.reconfigureIndex();
      },
    );
    const confirmations = new ExecutionConfirmations(dataPath, (summary) =>
      confirmNatively(this.window, summary.title, summary.detail, 'Run'),
    );
    this.terminals = new Terminals(
      options.terminalWorker,
      () => this.settings.snapshot().settings,
      (owner, event) => {
        this.activity.terminal(event);
        const window = this.windows.get(owner)?.window;
        if (window && !window.isDestroyed())
          sendEvent(window.webContents, { type: 'terminal', event });
      },
      access,
      (profile) => confirmations.requireTerminal(profile),
    );
    this.gitActions = new GitActions({
      direct: !process.mas,
      access,
      validateTarget: (owner, target) => validateGitTarget(target, this.gitWindow(owner)),
      launch: (program, owner) => this.terminals.startGit(program, owner),
    });
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
    this.receipts = new CommandReceipts(dataPath, (id) => emit({ type: 'receipt-changed', id }));
    this.executions = new Executions(
      () => this.settings.snapshot().settings,
      (task, owner) => {
        if (task.command)
          void this.receipts.record(task).catch((error) => this.options.diagnose?.(String(error)));
        if (owner === undefined) emit({ type: 'execution', task });
        else {
          const window = this.windows.get(owner)?.window;
          if (window && !window.isDestroyed())
            sendEvent(window.webContents, { type: 'execution', task });
        }
        this.agentRequests?.execution(task);
      },
      access,
      (action) => confirmations.require(action),
      (profile) => confirmations.requireTerminal(profile),
      (owner, target) => validateGitTarget(target, this.gitWindow(owner)),
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
        // elsewhere; the cache keys already carry each file's identity and date
        void this.thumbnails.clear(change.source);
        void this.thumbnails.clear(change.destination);
        this.appIcons.forget(change.source);
        this.appIcons.forget(change.destination);
      }
    };
    const fallbackTrash = guardTestTrash((file: string) => shell.trashItem(file));
    const processorRoot = assetPath(processorFolder);
    this.transforms = new Transforms(
      processorRoot,
      access,
      (bytes, plan, signal) =>
        imageProcess(
          path.join(path.dirname(options.worker), 'image-worker.cjs'),
          processorRoot,
          bytes,
          plan,
          signal,
          options.fileBackend,
        ),
      (bytes, signal) =>
        imageInspectionProcess(
          path.join(path.dirname(options.worker), 'image-worker.cjs'),
          processorRoot,
          bytes,
          signal,
          options.fileBackend,
        ),
    );
    this.optimizationReviews = new OptimizationReviews(
      path.join(dataPath, 'optimization-candidates'),
      this.transforms,
      this.resources,
      access,
      (request) => this.operations.start(request),
      (file) =>
        process.platform === 'darwin'
          ? macFiles().trash(file, fileCoordination.purpose())
          : fallbackTrash(file),
      (message) => options.diagnose?.(message),
    );
    this.operations = new Operations(
      (file, expected) =>
        process.platform === 'darwin'
          ? macFiles().trash(file, fileCoordination.purpose(), expected)
          : fallbackTrash(file),
      (job) => {
        emit({ type: 'job', job });
        this.optimizationReviews.jobChanged(job);
        this.agentRequests?.operation(job);
      },
      (progress) => emit({ type: 'job-progress', progress }),
      changed,
      access,
      dataPath,
      (receipt, work) => this.fileAccess.withReceipt(receipt, work),
      (message) => emit({ type: 'service-error', service: 'operations', message }),
      new ProtectedPaths(this.home),
      {
        convert: (conversion, sources, output, signal) => {
          if (
            conversion === 'pdf' ||
            sources.some((source) => /\.(?:bmp|heic|heif)$/i.test(source))
          )
            return nativeImageConverter.convert(conversion, sources, output, signal);
          const rotate = conversion === 'rotate-left' || conversion === 'rotate-right';
          const plan = imageTransformSchema.parse({
            kind: 'image',
            format: conversion === 'jpeg' || (rotate && /\.jpe?g$/i.test(output)) ? 'jpeg' : 'png',
            rotate: conversion === 'rotate-left' ? 270 : conversion === 'rotate-right' ? 90 : 0,
          });
          return this.transforms.execute(plan, sources, output, signal, () => {}).then(() => {});
        },
      },
      this.optimizationReviews,
    );
    this.mediaDocuments = new MediaDocuments(
      dataPath,
      this.transforms,
      this.operations,
      this.resources,
      access,
      async (owner, media) => {
        const result = await dialog.showOpenDialog(this.requireWindow(owner), {
          title: media === 'audio' ? 'Choose audio' : 'Add media',
          properties: ['openFile', 'multiSelections'],
          securityScopedBookmarks: this.fileAccess.scoped,
          filters: [
            {
              name: 'Media',
              extensions:
                media === 'audio'
                  ? ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aif', 'aiff', 'caf', 'mp4', 'mov']
                  : ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'wav', 'm4a', 'flac'],
            },
          ],
        });
        if (result.canceled) return [];
        if (result.filePaths.length > 16) throw new Error('Choose at most 16 media files.');
        for (const [index, file] of result.filePaths.entries())
          await this.fileAccess.remember(file, false, result.bookmarks?.[index]);
        return result.filePaths;
      },
    );
    this.texts = new TextFiles(this.operations, access);
    this.buffers = new TextBuffers(dataPath, async (reviewed) => {
      if (process.platform === 'darwin')
        await macFiles().trash(reviewed.path, fileCoordination.purpose(), reviewed);
      else await fallbackTrash(reviewed.path);
    });
    this.notes = new Notes(
      dataPath,
      (id, revision) => emit({ type: 'note-changed', id, revision }),
      fallbackTrash,
    );
    this.lenses = new Lenses(dataPath, access, {
      home: this.home,
      trash: async (file) => this.operations.start({ kind: 'trash', sources: [file] }),
      trashOwn: (file) =>
        process.platform === 'darwin'
          ? macFiles()
              .trash(file, fileCoordination.purpose())
              .then(() => {})
          : fallbackTrash(file),
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
      authorizeRun: async (run) => {
        await this.watchRules.authorize(run);
        if (run.context.actor === 'agent') await this.agents.authorizeWorkflow(run);
      },
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
    const speechRuntime = new SpeechRuntime(assetPath(speechRuntimeName()));
    const speechChanged = () => this.emit({ type: 'speech-changed' });
    this.speechModels = new SpeechModels(
      dataPath,
      undefined,
      undefined,
      () => speechRuntime.status(),
      speechChanged,
    );
    const speechProviders = new SpeechProviders(
      dataPath,
      new Credentials(
        path.join(dataPath, 'speech-private'),
        (value) => safeStorage.encryptStringAsync(value),
        async (value) => (await safeStorage.decryptStringAsync(value)).result,
      ),
      {
        changed: speechChanged,
        invalidated: (id) => this.speech?.invalidateProvider(id),
        confirm: async (provider) => {
          const window = [...this.windows.values()].find(
            (item) =>
              item.role === 'settings' && !item.window.isDestroyed() && item.window.isFocused(),
          )?.window;
          if (!window) throw new Error('Review audio access in the focused Settings window.');
          return confirmNatively(
            window,
            `Allow recordings to ${provider.name}?`,
            `Recordings up to 60 seconds will be sent to ${provider.endpoint} using ${provider.model}, when you finish recording or release the shortcut. No file names or document contents are attached. Audio access is separate from microphone permission. You can revoke it in Settings → Speech.`,
            'Allow recordings',
          );
        },
      },
    );
    this.speech = new Speech(
      dataPath,
      this.speechModels,
      speechRuntime,
      {
        settings: (owner) => this.windows.get(owner)?.role === 'settings',
        human: (owner) =>
          this.windows.has(owner) &&
          ![...this.agentCommands.values()].some((item) => item.owner === owner),
        foreground: (owner) => !!this.windows.get(owner)?.window.isFocused(),
        microphone: () =>
          process.platform === 'darwin'
            ? systemPreferences.getMediaAccessStatus('microphone')
            : 'unknown',
        requestMicrophone: async () =>
          process.platform !== 'darwin' || systemPreferences.askForMediaAccess('microphone'),
        chooseModel: async (owner) => {
          const window = this.windows.get(owner)?.window;
          if (!window) throw new Error('The speech settings window closed.');
          const result = await dialog.showOpenDialog(window, {
            title: 'Import a verified Whisper model',
            properties: ['openFile'],
            filters: [{ name: 'Whisper model', extensions: ['bin'] }],
            securityScopedBookmarks: this.fileAccess.scoped,
          });
          const file = result.filePaths[0];
          if (result.canceled || !file) return;
          await this.fileAccess.allowOnce(file, result.bookmarks?.[0]);
          await this.fileAccess.require([file]);
          return file;
        },
        event: (owner, event) => {
          const window = this.windows.get(owner)?.window;
          if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
            sendEvent(window.webContents, { type: 'speech', event });
        },
        changed: speechChanged,
      },
      speechProviders,
    );
    const taskWorkflows = (authorize: (file: string) => Promise<unknown>, person = false) =>
      new AgentTaskWorkflows({
        available: () => !process.mas,
        requireWorkspaceScope: !person,
        authorize,
        workspaceState: (owner) =>
          person && owner !== undefined
            ? this.windows.get(owner)?.workspaceCatalog
            : this.workspaceCatalog,
        window: (workspaceID, fallbackOwner) => {
          const owner =
            this.workspaceSessions.owner(workspaceID) ??
            fallbackOwner ??
            this.window?.webContents.id;
          const record = owner === undefined ? undefined : this.windows.get(owner);
          return record?.role === 'viewer' && !record.window.isDestroyed()
            ? { id: record.window.webContents.id, originID: record.originID }
            : undefined;
        },
        note: async (directory) => {
          const result = await this.notes.request({ kind: 'create', format: 'note', directory });
          if (result.kind !== 'document') throw new Error('The task note could not be created.');
          return result.document;
        },
        flush: async (owner) => {
          const window = this.windows.get(owner)?.window;
          if (!window || window.isDestroyed())
            throw new Error('The selected workspace window closed.');
          // Save the person's existing drafts before agent dispatch blocks private-note IPC.
          await this.flushes.request(owner, 'flush', (token) =>
            sendEvent(window.webContents, { type: 'flush', token }),
          );
        },
        present: (bundle, owner) => this.dispatchAgentEvent(owner, { type: 'agent-task', bundle }),
        profile: () => this.settings.snapshot().settings.terminals.profileID,
      });
    this.agentTaskWorkflows = taskWorkflows((file) => this.agents.authorize(file));
    const authorizePersonTask = async (file: string) => {
      await this.fileAccess.require([file]);
      return file;
    };
    this.personTaskWorkflows = taskWorkflows(authorizePersonTask, true);
    this.taskRequests = new TaskRequests({
      tasks: this.personTaskWorkflows,
      authorize: authorizePersonTask,
      person: (owner) => {
        const record = this.windows.get(owner);
        if (
          !record ||
          record.role !== 'viewer' ||
          record.window.isDestroyed() ||
          !record.workspaceID ||
          !record.workspaceCatalog ||
          [...this.agentCommands.values()].some((item) => item.owner === owner)
        )
          return;
        return {
          originID: record.originID,
          workspaceID: record.workspaceID,
          state: record.workspaceCatalog,
        };
      },
      confirm: (setup, owner) =>
        confirmNatively(
          this.windows.get(owner)?.window,
          'Create this branch task?',
          taskWorkflowReviewDetail(setup),
          'Create task',
        ),
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
              // a nested edit while it waited in the queue moved the changed folder
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
        actor: () => this.chats?.actor() ?? this.agents.clients.actor(),
        check: (proposal) =>
          proposal.clientID?.startsWith('chat:')
            ? this.chats.authorizeProposal(proposal)
            : this.agents.authorizeProposal(proposal),
        run: (clientID, work) =>
          clientID.startsWith('chat:')
            ? this.chats.context.run(clientID, work)
            : this.agents.clients.context.run(clientID, work),
        cancelExecution: (id) => this.executions.cancel(id),
        cancelOperation: (id) => this.operations.cancel(id),
        cancelSpeech: (id) => this.speechModels.cancel(id),
        cancelTaskWorkflow: (id) => this.agentTaskWorkflows.cancel(id),
        operation: (id) => this.operations.all().find((job) => job.id === id),
      },
      (proposal) =>
        confirmAgentProposal(
          proposal.taskSetup
            ? this.windowForWorkspace(proposal.taskSetup.workspaceID)
            : proposal.target
              ? this.windowForWorkspace(proposal.target.workspaceID)
              : this.window,
          proposal,
        ),
      async (proposal) => ({
        operationID: this.operations.start({
          kind: 'convert',
          sources: proposal.target!.selection.map((file) => file.path),
          destination: proposal.transform!.destination,
          name: proposal.transform!.name,
          transform: proposal.transform!.plan,
          expectedSources: proposal.target!.selection.map((file) => ({
            path: file.path,
            version: sourceVersion(file),
          })),
        }),
      }),
      (setup, operationID) => this.speechModels.request(setup, operationID),
      (setup, progress) => this.agentTaskWorkflows.execute(setup, progress),
    );
    this.agentSessions = new AgentSessions(dataPath, (id) => emit({ type: 'agent-session', id }));
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
        authorizeTask: (setup) => this.agentTaskWorkflows.authorize(setup),
        // nothing is requested while config.jsonc and its last valid copy cannot be read
        agentAccess: new AgentAccess(dataPath, () => {
          const snapshot = this.settings.snapshot();
          return snapshot.config?.fallback === 'defaults'
            ? undefined
            : { ...snapshot.settings.agents, revision: snapshot.revision };
        }),
        sessions: this.agentSessions,
        services: new AgentServiceTools({
          git: this.git,
          workflows: this.workflows,
          speech: this.speechModels,
          proposals: this.agentRequests,
          tasks: this.agentTaskWorkflows,
          settings: () => this.settings.snapshot().settings,
          generate: (...args) => this.providers.generate(...args),
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
    this.chats = new Chats(dataPath, {
      settings: () => this.settings.snapshot().settings,
      access,
      inspect: (file, signal) => this.files.inspect(file, true, false, signal),
      generate: (...args) => this.providers.generate(...args),
      permit: (provider, signal, work) =>
        this.modelPermissions.run(provider, 'excerpts', signal, work, 'user'),
      command: (id, target, title) => this.agentRequests.command(id, target, title),
      configuration: (patches, target) => this.agentRequests.configuration(patches, target),
      rename: async (title, intents) => {
        const result = await this.operationPlans.request({ kind: 'prepare', title, intents });
        if (Array.isArray(result)) throw new Error('The change review could not be prepared.');
        return result;
      },
      valid: (owner, target) => {
        const record = this.windows.get(owner);
        const space = record?.workspaceCatalog?.workspaces.find(
          (space) => space.id === target.workspaceID,
        );
        const pane = space?.panes.find((pane) => pane.id === target.paneID);
        return (
          this.workspaceSessions.owner(target.workspaceID) === owner &&
          !!record &&
          (!target.originID || record.originID === target.originID) &&
          !record.window.isDestroyed() &&
          !!pane &&
          (!target.panePath || pane.path === target.panePath)
        );
      },
      changed: (owner, document) => {
        this.activity.chat(document);
        const window = this.windows.get(owner)?.window;
        if (window && !window.isDestroyed())
          sendEvent(window.webContents, { type: 'chat', document });
      },
      aliases: () =>
        namedLines(this.settings.snapshot().settings.customActions, this.sessionKeys.aliases),
    });
    this.search = new Search(
      (batch) => emit({ type: 'search', batch }),
      undefined,
      undefined,
      (file) => this.fileAccess.require([file]),
      () => [...this.settings.snapshot().settings.search.exclusions, dataPath],
    );
    this.storage = new Storage(path.join(dataPath, 'viewer-state-v1.json'));
    this.backups = new PersonalBackups(dataPath, {
      flush: async () => {
        // Snapshot editors without cancelling an active conversation or its process ownership.
        await Promise.all(
          [...this.windows.values()]
            .filter((item) => item.ready && item.role === 'viewer')
            .map(({ window }) =>
              this.flushes.request(window.webContents.id, 'flush', (token) =>
                sendEvent(window.webContents, { type: 'flush', token }),
              ),
            ),
        );
        await Promise.all([
          this.storage.flush(),
          this.settings.flush(),
          this.buffers.flush(),
          this.notes.flush(),
          this.chats.flush(),
          this.receipts.flush(),
        ]);
      },
      state: async () => (await this.storage.load()).state,
      settings: () => ({ ...this.settings.snapshot(), credentials: this.credentials.ids() }),
      textVersion: async (file) => {
        const result = await this.texts.open(file);
        return result.editable ? result.document.version : undefined;
      },
      imported: () => this.receipts.refreshDocuments(),
      apply: async (patches) => ({
        ...(await this.settings.patch(patches, this.settings.snapshot().revision)),
        credentials: this.credentials.ids(),
      }),
      choose: async (owner, kind) => {
        if (kind === 'folder') return this.chooseFolder(owner);
        const window = this.windows.get(owner)?.window;
        if (!window || window.isDestroyed()) throw new Error('The backup window closed.');
        if (kind === 'export') {
          const result = await dialog.showSaveDialog(window, {
            title: 'Save personal backup',
            defaultPath: 'Viewer-' + new Date().toISOString().slice(0, 10) + '.viewer-backup.json',
            securityScopedBookmarks: this.fileAccess.scoped,
          });
          if (result.canceled || !result.filePath) return null;
          await this.fileAccess.allowOnce(result.filePath, result.bookmark);
          await this.fileAccess.require([result.filePath]);
          return result.filePath;
        }
        const result = await dialog.showOpenDialog(window, {
          title: 'Open personal backup',
          properties: ['openFile'],
          filters: [{ name: 'Viewer backup', extensions: ['json'] }],
          securityScopedBookmarks: this.fileAccess.scoped,
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await this.fileAccess.allowOnce(result.filePaths[0], result.bookmarks?.[0]);
        await this.fileAccess.require([result.filePaths[0]]);
        return result.filePaths[0];
      },
    });
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
          const role = this.requireRecord(event.sender.id).role;
          const allowed = methodWindows[name];
          if (role === 'settings' && allowed === 'viewer')
            throw new Error('This API is unavailable in Settings.');
          if (role !== 'settings' && allowed === 'settings')
            throw new Error('Manage credentials in Settings.');
          return {
            ok: true,
            value: await performanceMeter.measure(name, args, async () =>
              this.call(name, args, event.sender.id),
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
  /** The record of a window that is still open: an await can outlive the window that asked. */
  private requireRecord(owner: number): WindowRecord {
    const record = this.windows.get(owner);
    if (!record || record.window.isDestroyed())
      throw new Error('The window closed before Viewer could finish.');
    return record;
  }
  private requireWindow(owner: number): BrowserWindow {
    return this.requireRecord(owner).window;
  }
  /**
   * Stops everything that holds work, handles or watchers under `root`, before its access is
   * revoked or its volume ejected. One list serves both, so neither can miss a service.
   */
  private async quiesceRoot(root: string): Promise<void> {
    this.mediaDocuments.invalidate(root);
    this.taskRequests.close();
    await settleAll([
      fileCoordination.quiesce(root),
      this.resources.quiesce(root),
      this.webPreviews.quiesce(root),
      this.transforms.quiesce(root),
      this.optimizationReviews.invalidate(root),
      this.thumbnails.quiesce(root),
      this.watchers.revoke(root),
      this.watchRules.revoke(root),
      this.search.quiesce(),
      this.actions.quiesce(root),
      this.operations.quiesce(root),
      this.executions.quiesce(root),
      this.gitActions.quiesce(root),
      this.worktrees.quiesce(root),
      this.agentTaskWorkflows.quiesce(),
      this.personTaskWorkflows.quiesce(),
      this.gitReviews.quiesce(root),
      this.terminals.quiesce(root),
      this.externalTerminals.quiesce(),
    ]);
  }
  /**
   * Reconfigures the index from the current settings. A failure shows the locations offline
   * and goes to the diagnostic log, rather than failing whatever changed them.
   */
  private async reconfigureIndex(): Promise<void> {
    const search = this.settings.snapshot().settings.search;
    try {
      await this.configureIndex(search);
    } catch (error) {
      this.options.diagnose?.(`Index configuration failed: ${errorMessage(error)}`);
      this.emit({
        type: 'index',
        status: {
          roots: search.roots.map((path) => ({ path, status: 'offline', count: 0, errors: 1 })),
          count: 0,
          running: false,
        },
      });
    }
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
      await this.search.quiesce();
      await this.files.configure(config, rebuild);
    } catch (error) {
      this.indexConfiguration = '';
      throw error;
    }
  }
  private async chooseFolder(senderID: number, defaultPath?: string): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.requireWindow(senderID), {
      properties: ['openDirectory'],
      defaultPath,
      securityScopedBookmarks: this.fileAccess.scoped,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await this.fileAccess.remember(result.filePaths[0], true, result.bookmarks?.[0]);
    await this.fileAccess.require([result.filePaths[0]]);
    // Granting a configured index root can unblock its watcher/indexer.
    this.indexConfiguration = '';
    void this.reconfigureIndex();
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
      const change = { capabilities: request.capabilities };
      const review = added.length ? await access.captureReview(change) : undefined;
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
      await access.approve(change, review);
      await this.configureAgents();
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
      const { roots, capabilities } = await access.state();
      const change = {
        enabled: true,
        capabilities: capabilities.length
          ? capabilities
          : (['metadata', 'navigation', 'propose'] as const),
      };
      const review = await access.captureReview(change);
      if (
        !(await confirmNatively(
          window,
          'Allow local agent clients to use Viewer?',
          (roots.length
            ? 'Clients with Viewer’s agent token can read and search these folders and propose changes for your review:\n\n' +
              roots.join('\n')
            : 'No folder is authorized yet: add one in Settings → Agents.') +
            `\n\nShared capabilities: ${change.capabilities.join(', ')}.\n\nYou can turn this off at any time.`,
          'Allow',
        ))
      )
        return;
      await access.approve(change, review);
      if (!agents().enabled) await mirror({ enabled: true });
    } else if (request.kind === 'allow') {
      const { pending } = await access.state();
      const roots = request.roots.filter((root) => pending.roots.includes(root));
      if (!roots.length) return;
      const change = { add: roots };
      const review = await access.captureReview(change);
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
      await access.approve(change, review);
    } else {
      const root = await this.chooseFolder(senderID);
      if (!root) return;
      await this.agents.checkFolders([root]);
      const change = { add: [root] };
      const review = await access.captureReview(change);
      await access.approve(change, review);
      if (!agents().roots.includes(root)) await mirror({ roots: [...agents().roots, root] });
    }
    await this.configureAgents();
  }
  /** Starts or stops the agent server for the access in effect when its turn comes: computed by
   * each caller, a settings change and an approval could land in either order. */
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
  attach(window: BrowserWindow, role: WindowRole, workspaceID?: string): void {
    const sender = window.webContents.id;
    if (role === 'viewer' && workspaceID) this.workspaceSessions.reserve(sender, workspaceID);
    this.windows.set(sender, {
      window,
      originID: randomUUID(),
      role,
      workspaceID,
      paths: [],
      launches: [],
    });
    if (role === 'viewer') this.window = window;
    window.on('focus', () => {
      if (role === 'viewer') this.selectWindow(sender);
    });
    window.on('blur', () => {
      if (this.speech.allowsMicrophone(sender)) this.speech.stopRecording(sender);
    });
    window.webContents.on('render-process-gone', () => this.speech.stopOwner(sender));
    window.webContents.on('did-start-navigation', () => this.speech.stopOwner(sender));
    const stopTaskOwner = () => {
      this.taskRequests.stopOwner(sender);
      this.personTaskWorkflows.stopOwner(sender);
    };
    window.webContents.on('render-process-gone', stopTaskOwner);
    window.webContents.on('did-start-navigation', stopTaskOwner);
    window.on('closed', () => {
      this.speech.stopOwner(sender);
      this.backups.stopOwner(sender);
      this.browsers.stopOwner(sender);
      this.mediaDocuments.stopOwner(sender);
      void this.optimizationReviews
        .stopOwner(sender)
        .catch((error) => this.options.diagnose?.(String(error)));
      this.flushes.disconnected(sender);
      this.chats.retain(sender, new Set());
      this.gitActions.stopOwner(sender);
      this.worktrees.stopOwner(sender);
      this.agentTaskWorkflows.stopOwner(sender);
      this.taskRequests.stopOwner(sender);
      this.personTaskWorkflows.stopOwner(sender);
      this.gitReviews.stopOwner(sender);
      this.terminals.stopOwner(sender);
      this.executions.stopOwner(sender);
      void this.webPreviews
        .stopOwner(sender)
        .catch((error) => this.options.diagnose?.(String(error)));
      for (const request of this.agentCommands.values())
        if (request.owner === sender)
          request.finish('The workspace closed before completing the action.');
      this.windows.delete(sender);
      if (!this.options.quitting?.()) {
        this.workspaceSessions.close(sender);
        const state = this.workspaceSessions.snapshot();
        if (state)
          void this.storage
            .save({
              ...state,
              ui: this.settings.snapshot().ui,
              look: this.settings.snapshot().look,
              preferencesRevision: this.settings.snapshot().revision,
            })
            .catch((error) => this.options.diagnose?.(String(error)));
      }
      if (this.window === window) {
        this.window = undefined;
        this.ready = false;
        this.context = undefined;
        this.commandCatalog = undefined;
        this.workspaceCatalog = undefined;
        const remaining = [...this.windows.entries()].find(([, value]) => value.role === 'viewer');
        if (remaining) this.selectWindow(remaining[0]);
        else void this.resources.clear();
      }
    });
  }
  private selectWindow(sender: number): void {
    const record = this.windows.get(sender);
    if (!record || record.role !== 'viewer') return;
    this.window = record.window;
    this.ready = !!record.ready;
    this.commandCatalog = record.catalog;
    this.workspaceCatalog = record.workspaceCatalog;
    this.context = record.context;
    this.workspaceSessions.focus(sender);
  }
  private assignWorkspace(sender: number, workspaceID: string): void {
    const record = this.windows.get(sender);
    if (!record || record.role !== 'viewer' || record.workspaceID === workspaceID) return;
    record.workspaceID = workspaceID;
    this.options.workspaceChanged?.(record.window, workspaceID);
  }

  openIn(sender: number, paths: string[]): void {
    const record = this.windows.get(sender);
    if (!record || record.role !== 'viewer') return;
    if (record.ready) sendEvent(record.window.webContents, { type: 'open', paths });
    else record.paths.push(...paths);
  }
  launchIn(sender: number, request: LaunchRequest): void {
    const record = this.windows.get(sender);
    if (!record || record.role !== 'viewer') throw new Error('The target window closed.');
    if (record.ready) sendEvent(record.window.webContents, { type: 'launch', request });
    else record.launches.push(request);
  }

  windowForWorkspace(id: string): BrowserWindow | undefined {
    const owner = this.workspaceSessions.owner(id);
    return owner === undefined ? undefined : this.windows.get(owner)?.window;
  }
  /** Sends an event to every window that takes it, except the window `except`. */
  emit(event: DesktopEvent, except?: number): void {
    if (event.type === 'job') this.activity.job(event.job);
    for (const [id, { window, role }] of this.windows)
      if (
        id !== except &&
        !window.isDestroyed() &&
        (role === 'viewer' || settingsEvents.includes(event.type))
      )
        sendEvent(window.webContents, event);
  }
  open(paths: string[]): void {
    const normalized = paths.map(absolute);
    if (this.window) this.openIn(this.window.webContents.id, normalized);
    else this.openPaths.push(...normalized);
  }
  async flushSettings(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) return;
    await this.flushes.request(window.webContents.id, 'flush-settings', (token) => {
      sendEvent(window.webContents, { type: 'flush-settings', token });
    });
    await this.settings.flush();
  }

  async flushWindow(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) throw new Error('The window closed before its changes were saved.');
    const owner = window.webContents.id;
    const record = this.windows.get(owner);
    if (!record || record.role !== 'viewer')
      throw new Error('The workspace window is unavailable.');
    await this.chats.stopOwner(owner);
    if (record.ready)
      await this.flushes.request(owner, 'flush', (token) => {
        sendEvent(window.webContents, { type: 'flush', token });
      });
    await Promise.all([
      this.storage.flush(),
      this.settings.flush(),
      this.buffers.flush(),
      this.notes.flush(),
      this.chats.flush(),
    ]);
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
    await Promise.all(
      [...this.windows.values()]
        .filter((item) => item.role === 'viewer' && item.ready)
        .map(({ window }) => this.flushWindow(window)),
    );
    await Promise.all([this.storage.flush(), this.settings.flush(), this.buffers.flush()]);
  }
  dispose(): Promise<void> {
    return (this.disposal ??= this.disposeServices());
  }
  private async disposeServices(): Promise<void> {
    await this.chats.close();
    await this.agentSessions.flush();
    await this.gitActions.close();
    await this.gitReviews.close();
    this.git.close();
    this.worktrees.close();
    this.agentTaskWorkflows.close();
    this.taskRequests.close();
    this.personTaskWorkflows.close();
    this.ready = false;
    this.trash.close();
    if (process.platform === 'darwin') macFiles().dismissFilePanels();
    this.settings.close();
    await this.resources.clear();
    this.comparisons.close();
    this.duplicates.close();
    await this.watchRules.close();
    // Agent cancellation lists workflows and proposals. Keep their owners available
    // until the transport and any queued configuration change have stopped.
    const agentShutdown = await Promise.allSettled([
      this.agentsConfiguration.catch(() => {}).then(() => this.agents.close()),
    ]);
    await this.workflows.close();
    // Cancel the read-only worker before waiting for planners that may be
    // awaiting extraction. File mutations still drain through their journal.
    const results = await Promise.allSettled([
      this.terminals.close(),
      this.externalTerminals.close(),
      this.files.close(),
      this.actions.close(),
      this.watchers.close(),
      this.operations.close(),
      this.buffers.close(),
      this.notes.close(),
      this.modelPermissions.close(),
      this.speechModels.close(),
      this.speech.close(),
      this.search.close(),
      this.executions.close(),
      this.resources.close(),
      this.appIcons.close(),
      this.webPreviews.close(),
      Promise.resolve(this.browsers.closeAll()),
      (this.mediaDocuments.invalidate(), this.transforms.quiesce()),
      this.optimizationReviews.invalidate(),
      this.thumbnails.close(),
      this.information.close(),
      this.projects.flush(),
      this.lenses.close(),
      this.checkpoints.close(),
      this.operationPlans.close(),
      this.relationships.close(),
      fileCoordination.quiesce(),
    ]);
    await this.receipts.flush();
    await this.fileAccess.close();
    await this.journal.close();
    for (const request of this.agentCommands.values())
      request.finish('The application closed before completing the action.');
    ipcMain.removeHandler('viewer:request');
    const errors = [...agentShutdown, ...results].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length) throw new AggregateError(errors, 'Desktop services failed to stop.');
  }
  private gitWindow(owner: number): GitTargetWindow | undefined {
    const record = this.windows.get(owner);
    if (!record || record.role !== 'viewer') return;
    const current = record.catalog?.target.workspaceID === record.workspaceID;
    return {
      originID: record.originID,
      workspaceID: record.workspaceID,
      alive:
        !record.window.isDestroyed() &&
        !!record.workspaceID &&
        this.workspaceSessions.owner(record.workspaceID) === owner,
      workspaces: current ? record.workspaceCatalog : undefined,
      owners: current ? record.planeOwners : undefined,
    };
  }
  private audited = new Set<string>();
  /** Each reviewed agent request leaves one durable record of its outcome. */
  private auditProposal(proposal: AgentProposal): void {
    const status = proposal.status;
    if (!isFinalProposalStatus(status)) return;
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
      .audit('review:' + proposal.kind, status, detail, proposal.clientID ?? sharedClientID)
      .catch((error) =>
        this.options.diagnose?.(`An agent review record was not saved: ${errorMessage(error)}`),
      );
  }
  private async sendAgentCommand(
    command: string,
    target: CapturedTarget,
    navigation?: AgentNavigation,
  ): Promise<void> {
    const owner = this.workspaceSessions.owner(target.workspaceID);
    const record = owner === undefined ? undefined : this.windows.get(owner);
    const window = record?.window;
    if (target.originID && record?.originID !== target.originID)
      throw new Error('The originating window closed. Request a new proposal.');
    if (!window || window.isDestroyed())
      throw new Error('Open the workspace before running this action.');
    const action = this.settings
      .snapshot()
      .settings.customActions.find((item) => 'custom.' + item.id === command);
    await this.dispatchAgentEvent(window.webContents.id, {
      type: 'agent-command',
      command,
      target,
      navigation,
      ...(action ? { executor: action.executor } : {}),
    });
  }
  private async dispatchAgentEvent(
    owner: number,
    payload:
      | Omit<Extract<DesktopEvent, { type: 'agent-command' }>, 'id' | 'deadline'>
      | Omit<Extract<DesktopEvent, { type: 'agent-task' }>, 'id' | 'deadline'>,
  ): Promise<void> {
    const window = this.windows.get(owner)?.window;
    if (!window || window.isDestroyed()) throw new Error('The workspace window closed.');
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
        command: payload.type === 'agent-command' ? payload.command : 'task-workflow',
        finish: (error) => {
          clearTimeout(timer);
          this.agentCommands.delete(id);
          if (error) reject(new Error(error));
          else resolve();
        },
      });
      sendEvent(window.webContents, {
        ...payload,
        id,
        // a second short of the wait below, so the window never starts what was reported failed
        deadline: Date.now() + 24000,
      });
    });
  }
  /** One handler per IPC method; the `ApiHandlers` type makes a missing one a compile error. */
  private createHandlers(): ApiHandlers {
    return {
      speech: ([request], owner) => this.speech.request(request, owner),
      createTask: ([input], owner) => this.taskRequests.create(input, owner),
      ...createGitHandlers({
        reader: this.git,
        worktrees: this.worktrees,
        reviews: this.gitReviews,
        actions: this.gitActions,
        resources: this.resources,
        activity: this.activity,
        window: (owner) => this.gitWindow(owner),
        isAgent: (owner) =>
          [...this.agentCommands.values()].some((pending) => pending.owner === owner),
        retainResource: (id) => {
          this.gitResources.add(id);
        },
      }),
      receipts: ([request]) => this.receipts.request(request),
      notes: async ([request], owner) => {
        if ([...this.agentCommands.values()].some((item) => item.owner === owner))
          throw new Error('Notes are private to the person.');
        if (request.kind !== 'trash') return this.notes.request(request);
        let trashed = false;
        try {
          const results = await Promise.allSettled(
            [...this.windows.values()]
              .filter((item) => item.role === 'viewer' && item.ready)
              .map(({ window }) =>
                this.flushes.request(window.webContents.id, `note-trash:${request.id}`, (token) =>
                  sendEvent(window.webContents, {
                    type: 'prepare-note-trash',
                    id: request.id,
                    token,
                  }),
                ),
              ),
          );
          const failure = results.find((result) => result.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
          const reply = await this.notes.request(request);
          trashed = reply.kind === 'trashed';
          return reply;
        } finally {
          this.emit({ type: 'note-trash-finished', id: request.id, trashed });
        }
      },
      ...createJournalHandlers({
        store: this.journal,
        allowHuman: (owner) => {
          if ([...this.agentCommands.values()].some((item) => item.owner === owner))
            throw new Error('Journal access is available only to the person.');
        },
        chooseExport: async (owner) => {
          const window = this.windows.get(owner)?.window;
          if (!window || window.isDestroyed()) throw new Error('The export window closed.');
          const result = await dialog.showSaveDialog(window, {
            title: 'Export Journal',
            defaultPath: `viewer-journal-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [{ name: 'Journal JSON', extensions: ['json'] }],
            securityScopedBookmarks: this.fileAccess.scoped,
          });
          if (result.canceled || !result.filePath) return;
          await this.fileAccess.allowOnce(result.filePath, result.bookmark);
          await this.fileAccess.require([result.filePath]);
          return result.filePath;
        },
        confirmClear: (owner, file) =>
          confirmNatively(
            this.windows.get(owner)?.window,
            'Move Journal history to the Trash?',
            `Move this exact file, including all recorded events, to the OS Trash:\n${file}\n\nA new empty Journal will be created. Operation receipts, consent records and other logs are kept.`,
            'Move to Trash',
          ),
        trash: (reviewed) => this.operations.trashReviewedFile(reviewed),
      }),
      ...createWebHandlers({
        activity: this.activity,
        previews: this.webPreviews,
        resources: this.resources,
        openURL: (url) => shell.openExternal(url),
        copyURL: (url) => this.pasteboard.copyText([url]),
      }),
      browser: ([request], owner) => this.browsers.request(owner, request),
      media: ([request], owner) => this.mediaDocuments.request(request, owner),
      optimization: ([request], owner) => this.optimizationReviews.request(request, owner),
      imageInspect: async ([file]) => {
        const before = sourceVersion(await entry(file));
        const value = await this.transforms.inspectImage(file);
        if (!sameSourceVersion(before, sourceVersion(await entry(file))))
          throw new Error('The image changed while being read. Try again.');
        const preview = await this.resources.grantBytes(
          file,
          'image-preview.png',
          Buffer.from(value.preview),
        );
        return { width: value.width, height: value.height, alpha: value.alpha, preview };
      },
      pdfInspect: async ([file]) => {
        await this.fileAccess.require([file]);
        const version = sourceVersion(await entry(file));
        const value = await this.transforms.pdfInspect(file);
        if (!sameSourceVersion(version, sourceVersion(await entry(file))))
          throw new Error('The PDF changed while being read. Inspect it again.');
        return { ...value, version };
      },
      choosePDFs: async (_args, owner) => {
        const window = this.windows.get(owner)?.window;
        if (!window || window.isDestroyed()) throw new Error('The PDF tools window closed.');
        const result = await dialog.showOpenDialog(window, {
          title: 'Add PDFs',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
          securityScopedBookmarks: this.fileAccess.scoped,
        });
        if (result.canceled) return [];
        if (result.filePaths.length > 16) throw new Error('Choose at most 16 PDFs.');
        for (const [index, file] of result.filePaths.entries())
          await this.fileAccess.remember(file, false, result.bookmarks?.[index]);
        return result.filePaths;
      },
      chat: ([request], sender) => {
        const work = () => this.chats.request(request, sender, this.windows.get(sender)?.catalog);
        return request.kind === 'send' ? this.activity.send(request.id, work) : work();
      },
      shellCommand: ([action], sender) => {
        if (action === 'uninstall' && this.windows.get(sender)?.role !== 'settings')
          throw new Error('Uninstall the Viewer CLI from Settings → Navigation.');
        return this.shellCommand[action]();
      },
      hotkeyStatus: () => this.options.hotkeyStatus?.() ?? { registered: false, shortcut: '' },
      restoreWindow: () => this.options.restoreWindow?.(),
      workspaceClaim: ([workspaceID], sender) => {
        const owner = this.workspaceSessions.owner(workspaceID);
        if (owner !== undefined && owner !== sender) {
          const target = this.windows.get(owner)?.window;
          if (target && !target.isDestroyed()) {
            target.show();
            target.focus();
          }
          return false;
        }
        const claimed = this.workspaceSessions.claim(sender, workspaceID);
        if (claimed) this.assignWorkspace(sender, workspaceID);
        return claimed;
      },
      newWindow: async () => {
        if (!this.options.newWindow) throw new Error('New windows are unavailable.');
        await this.options.newWindow(this.createWorkspace());
      },
      agentSessions: ([request], owner) => {
        if ([...this.agentCommands.values()].some((pending) => pending.owner === owner))
          throw new Error('Saved agent transcripts are available only to the person.');
        return this.agentSessions.request(request);
      },
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
        const result = await dialog.showOpenDialog(this.requireWindow(senderID), {
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
      commandsPublish: (args, sender) => {
        const record = this.requireRecord(sender);
        record.catalog = {
          target: { ...args[0], originID: record.originID },
          commands: args[1],
        };
        record.workspaceCatalog = args[2];
        record.planeOwners = args[3];
        record.ready = true;
        for (const request of record.launches.splice(0))
          sendEvent(record.window.webContents, { type: 'launch', request });
        if (this.window?.webContents.id === sender) this.selectWindow(sender);
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
      backup: ([request], owner) => this.backups.request(request, owner),
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
      terminalClose: (args, senderID) => {
        this.gitActions.stop(args[0], senderID);
        this.terminals.stop(args[0], senderID);
        this.activity.cancelGit(args[0], this.windows.get(senderID)?.originID);
      },
      customExecute: async (args, owner) => {
        // never on an agent's request: its approval was for a recipe or a command, not a program
        if ([...this.agentCommands.values()].some((pending) => pending.owner === owner))
          throw new Error('Agents cannot run programs or shell scripts.');
        return this.executions.start(args[0], args[1], args[2], owner);
      },
      runCommand: async ([script, input], owner) => {
        if ([...this.agentCommands.values()].some((request) => request.owner === owner))
          throw new Error('Agents cannot run shell commands.');
        const target = await bindGitTarget(input, this.gitWindow(owner));
        return this.executions.startManual(script, target, owner);
      },
      commandDraft: async ([request], owner) => {
        const role = this.windows.get(owner)?.role;
        if (request) {
          if (role !== 'viewer') throw new Error('Create a command draft from a workspace window.');
          const settings = this.settings.snapshot().settings;
          const profile = settings.terminals.profiles.find(
            (item) => item.id === settings.terminals.profileID,
          );
          this.pendingCommandDraft = {
            id: randomUUID(),
            name: request.name,
            aliases: [],
            icon: 'terminal',
            shortcut: '',
            order: settings.customActions.length,
            pinned: false,
            when: { target: 'any', extensions: [], min: 0, max: 2000 },
            executor: {
              kind: 'shell',
              executable: profile?.executable || process.env.SHELL || '/bin/sh',
              script: request.script,
              perItem: false,
            },
          };
          await this.options.openSettings('settings.customActions');
          return;
        }
        if (role !== 'settings') throw new Error('Review command drafts in Settings.');
        const draft = this.pendingCommandDraft;
        this.pendingCommandDraft = undefined;
        return draft;
      },
      executionList: (_args, owner) => this.executions.list(owner),
      executionCancel: (args, owner) => this.executions.cancel(args[0], owner),
      openSettings: ([focus]) => this.options.openSettings(focus),
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
          await this.quiesceRoot(root);
          await this.files.reset();
          this.indexConfiguration = '';
          await this.reconfigureIndex();
        });
        this.emit({ type: 'file-access', path: root, resources });
        return;
      },
      volumesList: () => (process.platform === 'darwin' ? macFiles().volumes() : []),
      trashList: (args) => this.trash.list(args[0]),
      trashConfirmation: (args, senderID) =>
        this.trash.confirmation(this.requireWindow(senderID), args[0]),
      trashPreview: (args) => this.trash.preview(args[0]),
      trashCopyPaths: (args) => this.trash.copyPaths(args[0]),
      trashRestore: async (args, senderID) => {
        // the folder is chosen before the operations queue is held: a panel left open blocked it
        const folder =
          args[1] === 'choose'
            ? await this.trash.chooseRestoreFolder(this.requireWindow(senderID))
            : undefined;
        if (args[1] === 'choose' && !folder) return { restored: 0, cancelled: true };
        return this.operations.exclusive(() =>
          this.trash.restore(
            this.requireWindow(senderID),
            args[0],
            folder ? { folder } : 'original',
          ),
        );
      },
      trashAccess: (args, senderID) =>
        this.trash.requestAccess(this.requireWindow(senderID), args[0]),
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
            await this.quiesceRoot(root);
            await this.files.reset();
            await macFiles().eject(root);
          });
        } finally {
          this.indexConfiguration = '';
          await this.reconfigureIndex();
          this.emit({ type: 'file-access', path: root, resources });
        }
        return;
      },
      // `>` in the palette: a request in words answered with a line to review
      promptLine: async (args) => {
        const request = args[0];
        const controller = new AbortController();
        this.prompts.get(request.id)?.abort();
        this.prompts.set(request.id, controller);
        try {
          return await answerPrompt(
            request,
            this.settings.snapshot().settings,
            (...generate) => this.providers.generate(...generate),
            controller.signal,
            namedLines(this.settings.snapshot().settings.customActions, this.sessionKeys.aliases),
          );
        } finally {
          if (this.prompts.get(request.id) === controller) this.prompts.delete(request.id);
        }
      },
      promptCancel: (args) => {
        this.prompts.get(args[0])?.abort();
      },
      sessionKeys: () => this.sessionKeys,
      sessionKeysSet: (args) => {
        this.sessionKeys = args[0];
        this.emit({ type: 'session-keys', session: this.sessionKeys });
        return this.sessionKeys;
      },
      // Keep, from Settings: the session's bindings written into the keymap, then forgotten
      sessionKeysKeep: async () => {
        const current = this.settings.snapshot();
        const snapshot = await this.settings.patch(
          [
            {
              path: 'settings.keymap',
              value: withSessionKeys(current.settings.keymap, this.sessionKeys),
            },
            {
              path: 'settings.customActions',
              value: keepAliases(current.settings.customActions, this.sessionKeys),
            },
          ],
          current.revision,
        );
        this.sessionKeys = emptySessionKeys;
        this.emit({ type: 'session-keys', session: this.sessionKeys });
        return { ...snapshot, credentials: this.credentials.ids() };
      },
      sessionKeysDiscard: () => {
        this.sessionKeys = emptySessionKeys;
        this.emit({ type: 'session-keys', session: this.sessionKeys });
        return this.sessionKeys;
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
      ...createModelHandlers({
        settings: this.settings,
        credentials: this.credentials,
        providers: this.providers,
        modelPermissions: this.modelPermissions,
        window: (sender) => this.windows.get(sender)?.window,
        emit: (event) => this.emit(event),
      }),
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
        const result = await dialog.showOpenDialog(this.requireWindow(senderID), {
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
      contextPublish: (args, sender) => {
        const context: ActionContext = { ...args[0], actor: 'user' };
        this.requireRecord(sender).context = context;
        if (this.window?.webContents.id === sender) this.context = context;
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
        if (!isPackage(item))
          throw new Error('Icons are offered for applications and other bundles only.');
        const icon = await this.appIcons.get(item.path, size, item.modified);
        await this.fileAccess.require([file]);
        return icon;
      },
      thumbnail: async (args) => {
        await this.fileAccess.require([args[0]]);
        const thumbnail = await this.thumbnails.get(args[0], args[1]);
        await this.fileAccess.require([args[0]]);
        return thumbnail;
      },
      document: async (args) => {
        const request = args[1];
        if (request) {
          const { requestID, ...worksheet } = request;
          return this.resources.documentRead(args[0], requestID, (file, signal) =>
            this.files.extract(file, signal, true, worksheet),
          );
        }
        const file = this.resources.documentSource(args[0]);
        const document = await this.files.extract(file, this.resources.signal(args[0]), true);
        this.resources.documentSource(args[0]);
        return document;
      },
      cancelDocument: async ([id, requestID]) => this.resources.cancelDocument(id, requestID),
      officeImage: async ([id, part, requestID]) => {
        let child: Resource | undefined;
        try {
          return await this.resources.documentRead(id, requestID, async (file, signal) => {
            if (path.extname(file).toLowerCase() !== '.docx')
              throw new Error('Embedded document images require a DOCX file.');
            const document = await this.files.extract(file, signal, true);
            if (!officeImageParts(document.office).includes(part))
              throw new Error('This image is not a supported embedded document relationship.');
            const resource = await this.resources.archiveEntry(id, part);
            child = resource;
            signal.throwIfAborted();
            if (
              !['png', 'jpg', 'jpeg'].includes(resource.entry.extension) ||
              !resource.dimensions ||
              resource.entry.size > 8 * 1024 * 1024 ||
              resource.dimensions.width * resource.dimensions.height > 64000000
            )
              throw new Error('The embedded image exceeds the supported PNG/JPEG preview bounds.');
            return resource;
          });
        } catch (error) {
          if (child) this.resources.release(child.id);
          throw error;
        }
      },
      bootstrap: async (_args, sender) => {
        performanceMeter.mark('bootstrap:start');
        const home = this.home;
        await this.fileAccess.load();
        const early = this.storedEarly;
        this.storedEarly = undefined;
        const stored = await (early ?? this.storage.load());
        performanceMeter.mark('bootstrap:state');
        await this.settings.load(stored.state || undefined);
        this.settingsPrepared ??= Promise.resolve();
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
        performanceMeter.mark('bootstrap:settings');
        this.workspaceSessions.seed(stored.state);
        stored.state = this.workspaceSessions.open(
          sender,
          this.initialFolder(),
          this.windows.get(sender)?.workspaceID,
        );
        this.assignWorkspace(sender, stored.state.activeWorkspace);
        if (stored.state)
          stored.state = {
            ...stored.state,
            ui: this.settings.snapshot().ui,
            look: this.settings.snapshot().look,
            preferencesRevision: this.settings.snapshot().revision,
          };
        void this.reconfigureIndex();
        await this.actions.load();
        await this.watchRules.start();
        this.options.settingsChanged?.();
        await this.configureAgents();
        performanceMeter.mark('bootstrap:services');
        const record = this.requireRecord(sender);
        const paths = [...record.paths.splice(0), ...this.openPaths.splice(0)];
        const launches = record.launches.splice(0);
        if (this.window?.webContents.id === sender) this.selectWindow(sender);
        const freshSession =
          !this.bootstrapped && !this.settings.snapshot().settings.browsing.restoreSession;
        this.bootstrapped = true;
        performanceMeter.mark('bootstrap:done');
        return {
          ...stored,
          launches,
          home,
          freshSession,
          gitActionsAvailable: !process.mas,
          settings: this.settings.snapshot(this.credentials.ids()),
          platform: process.platform as DesktopPlatform,
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
      // the path comes from Launch Services' own listing, never from the renderer
      windowButtons: ([visible], senderID) => {
        // a hidden title bar takes the window buttons with it; they come back with it
        if (process.platform === 'darwin')
          this.windows.get(senderID)?.window.setWindowButtonVisibility(visible);
      },
      applicationIcon: async ([id]) => {
        const item = await entry(this.applications.location(id));
        return this.appIcons.get(item.path, 'small', item.modified);
      },
      chooseApplication: async (_args, senderID) => {
        if (process.platform !== 'darwin')
          throw new Error('Application selection is not available on this platform yet.');
        const result = await dialog.showOpenDialog(this.requireWindow(senderID), {
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
      resource: (args) => this.resources.grant(args[0], args[1]),
      read: (args) => this.resources.read(args[0], args[1]),
      release: async (args) => {
        this.gitResources.delete(args[0]);
        this.resources.release(args[0]);
        await this.webPreviews.releaseResource(args[0]);
      },
      archive: (args) => this.resources.archive(args[0]),
      archiveEntry: (args) => this.resources.archiveEntry(args[0], args[1]),
      imageRendition: (args) => this.resources.rendition(args[0], args[1]),
      videoRendition: ([id, requestID]) => this.resources.videoRendition(id, requestID),
      officeLayout: ([id, request]) => this.resources.officeLayout(id, request),
      printPDF: async (args) => {
        if (process.platform !== 'darwin') throw new Error('Printing PDFs requires macOS.');
        const file = await this.resources.printableFile(args[0]);
        macFiles().printPDF(file, args[1]);
        return;
      },
      save: async (args, sender) => {
        this.chats.retain(
          sender,
          new Set(
            args[0].workspaces.flatMap((space) =>
              space.panes.flatMap((pane) => (pane.type === 'chat' ? [pane.conversationID] : [])),
            ),
          ),
        );
        const active = args[0].workspaces.find((space) => space.id === args[0].activeWorkspace);
        const state = await this.activity.at(
          { workspaceID: args[0].activeWorkspace, planeID: active?.activePane },
          () =>
            this.activity.run('workspace', 'save', () =>
              this.workspaceSessions.persist(sender, args[0], (state) =>
                this.storage.save({
                  ...state,
                  ui: this.settings.snapshot().ui,
                  look: this.settings.snapshot().look,
                  preferencesRevision: this.settings.snapshot().revision,
                } as Parameters<Storage['save']>[0]),
              ),
            ),
        );
        // the saving window already holds what it sent; it hears back only what the merge changed
        this.emit({ type: 'workspaces', state }, mergeChanged(args[0], state) ? undefined : sender);
        this.assignWorkspace(sender, args[0].activeWorkspace);
        this.options.settingsChanged?.();
      },
      flushed: (args, sender) => {
        this.flushes.acknowledge(args[0], sender, args[1] ?? { ok: true });
      },
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
      ...createEditingHandlers({
        home: this.home,
        resources: this.resources,
        fileAccess: this.fileAccess,
        texts: this.texts,
        buffers: this.buffers,
        window: (sender) => this.windows.get(sender)?.window,
        emit: (event) => this.emit(event),
      }),
    };
  }
  private handlerTable?: ApiHandlers;
  /** Runs a method's handler with arguments its schema produced. */
  private call<K extends ApiMethod>(method: K, args: unknown, senderID: number): unknown {
    const handler: ApiHandlers[K] = (this.handlerTable ??= this.createHandlers())[method];
    const parsed = schemas[method].parse(args) as Parameters<ApiHandlers[K]>[0];
    const record = this.windows.get(senderID);
    const target = record?.catalog?.target;
    const workspaceID = record?.workspaceID;
    const planeID =
      target && target.workspaceID === workspaceID && target.paneID !== 'none'
        ? target.paneID
        : undefined;
    return this.activity.within({ windowID: record?.originID, workspaceID, planeID }, () =>
      handler(parsed, senderID),
    );
  }
}
