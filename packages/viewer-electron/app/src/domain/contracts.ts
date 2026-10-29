import type { PromptAnswer, PromptRequest, PromptHistoryEntry } from './command-line/prompt';
import type { ReviewState, GitReviewRequest, GitReviewReply } from './comparison/review';
import type { SessionRequest, SessionReply } from './agents/sessions';
import type { FlushResult } from './persistence/flush';
import type { BackupRequest, BackupReply } from './persistence/backup';
import type { DiffSource } from './comparison/diff';
import type { GitRequest, GitReply, GitSource } from './comparison/git';
import type { GitActionKind, GitActionRequest, GitActionReply } from './comparison/git-actions';
import type { LaunchRequest, ShellCommandStatus } from './workspaces/launch';
import type { ChatRequest, ChatReply, ChatDocument } from './models/chat';
import type { WorktreeReply, WorktreeRequest } from './comparison/worktrees';
import type { AgentTaskBundle, TaskWorkflowInput, TaskWorkflowReply } from './agents/task-workflow';
import type { TransformPlan } from './operations/transforms';
import type { OptimizationOutcome } from './operations/optimization-target';
import type { OptimizationRequest, OptimizationReply } from './operations/optimization-review';
import type { WorksheetDocumentRequest } from './previews/documents/office';
import type { ImageRenditionRequest } from './previews/images/rendered';
import type { PreviewDerivationKind } from './previews/derivations';
import type { OfficeLayoutMetadata, OfficeLayoutRequest } from './previews/documents/layout';
import type { PreviewHistory } from './previews/history';
import type { MediaRequest, MediaReply } from './media/documents';
import type { BrowserRequest, BrowserSnapshot } from './previews/browser';
import type {
  JournalFilter,
  JournalQuery,
  JournalPage,
  JournalExportPreview,
} from './journal/events';
import type { ProviderCheckRequest, ProviderCheckResult } from './models/provider-checks';
import type { SessionKeys } from './preferences/session-keys';
import type { WorkspaceOverrides } from './preferences/overrides';
import type { Tiling } from './workspaces/tiling';
import type { TextBuffer, TextBufferSummary, TextOpening, TextVersion } from './editing/documents';
import type { NoteRequest, NoteReply } from './editing/notes';
import type { SpeechRequest, SpeechReply, SpeechSessionEvent } from './speech/recognition';
import type { ReceiptRequest, ReceiptReply } from './automation/receipts';
import type { TaskArea } from './workspaces/tasks';
import type { EvidenceNavigation, SourceVersion, InspectionResult } from './files/inspection';
import type { WorkflowRequest, WorkflowReply } from './automation/workflows';
import type { WatchRule, WatchRuleRequest, WatchRuleReply } from './automation/watch-rules';
import type { RelationshipsRequest, RelationshipsReply } from './files/relationships';
import type {
  ProjectAssociation,
  ProjectLayout,
  JSONValue,
  ProjectRequest,
  ProjectReply,
} from './workspaces/project';
import type { LensReply, LensRequest } from './files/lenses';
import type { Collection, BasketItem, QuerySnapshot } from './workspaces/collections';
import type {
  SettingsSnapshot,
  IndexStatus,
  ActionPlan,
  IndexedQuery,
  SettingsPatch,
  IndexedResult,
  ActionRequest,
  ActionApproval,
  ActionContext,
  DocumentData,
} from './services';
import type {
  AgentProposal,
  AgentNavigation,
  CommandDescriptor,
  AgentWorkspaceSnapshot,
  ExecutionGrant,
} from './agents/requests';
import type {
  CapturedTarget,
  CustomAction,
  TerminalEvent,
  ExecutionTask,
  TerminalStart,
} from './automation/actions';
import type { FolderSizeTask, ApplicationChoices, NativeApplication } from './files/metadata';
import type { FileChange } from './files/changes';
import type { ComparisonRequest, ComparisonResult } from './comparison/folders';
import type { DuplicateRequest, DuplicateResult } from './comparison/duplicates';
import type { OperationPlanRequest, OperationPlanReply } from './operations/operation-plan';
import type { CheckpointRequest, CheckpointReply } from './operations/change-plan';
import type {
  AgentAccessRequest,
  AgentAccessState,
  AgentClientRequest,
  AgentClientReply,
  AgentAudit,
} from './agents/clients';
import type { ModelDataPermission, ModelDataLevel } from './models/permissions';
import type { FileInformation, FileInformationPatch } from './files/information';
import type { Volume } from './files/volumes';
import type { TrashSnapshot, TrashRestoreResult } from './files/trash';
import type {
  HtmlPreview,
  LocalServer,
  LocalServerAction,
  LocalServerDetail,
} from './previews/web';
import type { JobStatus } from './operations/jobs';
/** Serializable contracts shared by main, preload and renderer. */
export type FileKind = 'directory' | 'file' | 'symlink' | 'other';
export interface FileEntry {
  path: string;
  name: string;
  parent: string;
  extension: string;
  kind: FileKind;
  directory: boolean;
  size: number;
  modified: number;
  created: number;
  hidden: boolean;
  mime: string;
  identity: string;
  linkTarget?: string;
  error?: string;
}
export interface FolderListing {
  path: string;
  parent: string;
  entries: FileEntry[];
}
export type ViewMode = 'list' | 'grid' | 'columns' | 'gallery' | 'map';
export type SortKey = 'name' | 'modified' | 'created' | 'size' | 'kind' | 'extension';
export type ListColumn = SortKey | 'git';
export interface FolderPane {
  id: string;
  type: 'folder';
  path: string;
  mode: ViewMode;
  sort: SortKey;
  descending: boolean;
  showHidden: boolean;
  history: string[];
  historyIndex: number;
  sidebar?: PaneSidebar;
  /** Opened by Explode folder from that plane: Collapse closes it again. */
  exploded?: string;
  /** The folder plane it is paired with, as a commander's two panels: copies and
   * moves go there; each names the other. */
  pair?: string;
  /** The pair follows each other into subfolders and back up. */
  pairSync?: boolean;
}
export interface PaneSidebar {
  visible: boolean;
  width: number;
}
export interface NewRootFolderTarget {
  path?: string;
  paneID?: string;
  workspaceID?: string;
}
export interface PreviewPane {
  id: string;
  type: 'preview';
  path: string;
  /** Explicit Open another plane copies survive duplicate-preview recovery. */
  keepSeparate?: boolean;
  evidence?: EvidenceNavigation;
  /** Unsaved edits to the file, kept in the profile until saved or discarded. */
  bufferID?: string;
}
/**
 * A plane of unsaved text, kept in the profile until it is saved as a file or discarded.
 * `path` is the folder Save As starts in, so every plane has a real folder, as a collection's does.
 */
export interface ScratchPane {
  id: string;
  type: 'scratch';
  path: string;
  bufferID: string;
  /** A language id from the highlighting table. */
  language?: string;
  title?: string;
}
export interface NotePane {
  id: string;
  type: 'note';
  path: string;
  documentID: string;
  title: string;
}
export interface SearchPane {
  id: string;
  type: 'search';
  path: string;
  query: string;
  name: string;
  allLocations: boolean;
  recursive?: boolean;
  content?: boolean;
}
export interface TerminalPane {
  id: string;
  type: 'terminal';
  path: string;
  profileID: string;
  /** Stable logical task terminal; opening another view does not replay its prior input. */
  taskSessionID?: string;
  startOnOpen?: boolean;
  /** Display metadata only. Git jobs are never replayed from saved state. */
  gitAction?: GitActionKind;
}
export interface CollectionPane {
  id: string;
  type: 'collection';
  path: string;
  collectionID: string;
}
export interface DiffPane {
  id: string;
  type: 'diff';
  path: string;
  left: DiffSource;
  right: DiffSource;
  mode?: 'split' | 'unified' | 'slider' | 'onion' | 'side' | 'difference';
  bufferID?: string;
}
export interface GitChangesPane {
  id: string;
  type: 'git-changes';
  path: string;
  review?: ReviewState;
  /** Agent-created views wait for the person: Git status can execute clean filters. */
  activation?: 'manual';
}
export interface ChatPane {
  id: string;
  type: 'chat';
  path: string;
  conversationID: string;
  /** Read-only transcript from an authenticated local agent adapter. */
  externalSessionID?: string;
}
/** A local server's folder reference; listening sockets and logs remain runtime state. */
export interface BrowserPane {
  id: string;
  type: 'browser';
  path: string;
  url: string;
  title?: string;
  serverRuntimeID?: string;
  serverPath?: string;
}
export interface MediaPane {
  id: string;
  type: 'media';
  path: string;
  draftID: string;
}
export interface ServerPane {
  id: string;
  type: 'server';
  path: string;
  sourceIdentity?: string;
  runtimeID?: string;
}
export interface JournalPane {
  id: string;
  type: 'journal';
  path: string;
  filter: JournalFilter;
  savedFilters?: { id: string; name: string; filter: JournalFilter }[];
}
export interface TaskPane {
  id: string;
  type: 'task';
  path: string;
  areaID: string;
  title: string;
}
export interface ReceiptPane {
  id: string;
  type: 'receipt';
  path: string;
  receiptID: string;
}
export type Pane =
  | TaskPane
  | ReceiptPane
  | FolderPane
  | PreviewPane
  | SearchPane
  | TerminalPane
  | CollectionPane
  | ScratchPane
  | NotePane
  | DiffPane
  | GitChangesPane
  | ChatPane
  | ServerPane
  | BrowserPane
  | MediaPane
  | JournalPane;
/** Runtime kind catalog stays exhaustive as new plane records are added. */
export const paneTypes = {
  task: 'task',
  receipt: 'receipt',
  folder: 'folder',
  preview: 'preview',
  search: 'search',
  terminal: 'terminal',
  collection: 'collection',
  scratch: 'scratch',
  note: 'note',
  diff: 'diff',
  'git-changes': 'git-changes',
  chat: 'chat',
  server: 'server',
  browser: 'browser',
  media: 'media',
  journal: 'journal',
} as const satisfies { [Kind in Pane['type']]: Kind };
export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  roots: string[];
  /** Private task context persists independently of open views. Never exported in a project. */
  taskAreas?: TaskArea[];
  activePane?: string;
  arrangement: Record<string, string>;
  project?: ProjectAssociation;
  layout?: ProjectLayout;
  /** Private remount generation for an explicit project reload. */
  epoch?: number;
  collections?: Collection[];
  basket?: BasketItem[];
  /** This workspace's space colour, `#rrggbb`, over the general one. */
  spaceColor?: string;
  /** This workspace's own chrome and space settings over the general ones. */
  overrides?: WorkspaceOverrides;
  /** Presentation profile used when this workspace is entered. */
  profileID?: string;
  /** Planes tiled as tmux's panes: kept in their layout as the window resizes. */
  tiling?: Tiling;
}
/** Current saved-state format. Increment with a compatible migration and preserved input. */
export const CURRENT_STATE_VERSION = 11 as const;
export interface SavedState {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | typeof CURRENT_STATE_VERSION;
  previewStates?: Record<string, Record<string, JSONValue>>;
  /** Bounded, private file view positions, independent of disposable plane IDs. */
  previewHistory?: PreviewHistory;
  preferencesRevision?: number;
  workspaces: Workspace[];
  activeWorkspace: string;
  openWindows?: string[];
  favorites: { name: string; path: string }[];
  recents: string[];
  /** The profile applied, and the values it replaced, to leave it again. */
  profile?: { id: string; previous: Record<string, JSONValue> };
  /** Explicit presentation choices restored only in their owning workspace window. */
  windowProfiles?: Record<string, { id: string; previous: Record<string, JSONValue> }>;
  /** Folders' visits for `z` in the palette: how many, and the last. */
  visits?: Record<string, { count: number; last: number }>;
  /** Lines run from the command line, the latest first. */
  lineHistory?: string[];
  /** Requests and reviewed answers, retained privately without replaying a model request. */
  promptHistory?: PromptHistoryEntry[];
  look: 'dark' | 'light';
  ui?: UIPreferences;
}
export type SidebarSection = 'locations' | 'favorites' | 'recents';
export interface UIPreferences {
  version: 3;
  sidebar: {
    visible: boolean;
    inNewPlanes: boolean;
    width: number;
    order: SidebarSection[];
    collapsed: SidebarSection[];
    locations: string[];
    hidden: string[];
    labels: Record<string, string>;
  };
  /** Viewer's title bar: hidden, it comes back while the pointer is at the window's top. */
  titlebar: {
    visible: boolean;
  };
  space: {
    toolbar: boolean;
    minimap: boolean;
    viewcube: boolean;
    origin: boolean;
    planeHeaders: boolean;
    dragging: boolean;
    resizing: boolean;
    opening: 'face-on' | 'pair' | 'dock';
    /** What the space shows behind the planes: its colour, or what is behind the window. */
    backdrop: 'opaque' | 'blur' | 'clear';
    /** How much of the space's colour is drawn over what is behind, in percent. */
    backdropOpacity: number;
    /** The space's grid lines. */
    grid: boolean;
    /** The space's colour, `#rrggbb`; empty follows the appearance. A workspace may have its own. */
    color: string;
    headerControls: {
      parent: boolean;
      sidebar: boolean;
      back: boolean;
      forward: boolean;
      view: boolean;
      search: boolean;
      frame: boolean;
      dock: boolean;
      actions: boolean;
      close: boolean;
    };
  };
  list: {
    visible: Record<Exclude<ListColumn, 'name'>, boolean>;
    /** A zero name width fills the space left by the metadata columns. */
    widths: Record<ListColumn, number>;
    wrapNames: boolean;
    order?: ListColumn[];
  };
  recentCommands: string[];
}
export type TextEditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';
export interface Bootstrap {
  gitActionsAvailable?: boolean;
  launches?: LaunchRequest[];
  freshSession?: boolean;
  home: string;
  platform: 'darwin' | 'win32' | 'linux';
  locations: { name: string; path: string }[];
  state: SavedState | null;
  openPaths: string[];
  recovery?: string;
  settings?: SettingsSnapshot;
}
export type OperationKind =
  | 'copy'
  | 'move'
  | 'transfer'
  | 'duplicate'
  | 'alias'
  | 'rename'
  | 'mkdir'
  | 'mkfile'
  | 'trash'
  | 'compress'
  | 'extract'
  | 'convert'
  /** A text save over an existing file, its previous version moved to the Trash. */
  | 'rewrite';
/** Image quick actions. Each creates a new file; sources are never changed. */
export const imageConversions = ['rotate-left', 'rotate-right', 'jpeg', 'png', 'pdf'] as const;
export type ImageConversion = (typeof imageConversions)[number];
export interface OperationRequest {
  kind: OperationKind;
  sources: string[];
  destination?: string;
  name?: string;
  /** Required for `convert`. */
  conversion?: ImageConversion;
  transform?: TransformPlan;
  /** Desktop-owned candidate capabilities; ordinary operation IPC cannot supply these. */
  preparedTransforms?: { path: string; id: string }[];
  /** The desktop pins a batch output folder so a later link/replacement cannot redirect it. */
  reviewedDestination?: { path: string; identity: string };
  /** Source versions captured in a reviewed plan; checked again when queued work starts. */
  expectedSources?: { path: string; version: SourceVersion }[];
  /** A reviewed folder's contents (`outputProof`), set by the desktop for an agent's approved Trash;
   * checked again inside the claim that moves the folder. */
  expectedContents?: { path: string; proof: string }[];
  /** A text save's content, recorded by hash and length only: the text itself is never journaled,
   * so a save is not offered for Redo. */
  textSHA256?: string;
  textBytes?: number;
}
/** The operations a renderer may start; a text save (`rewrite`) belongs to the editing service. */
export const rendererOperationKinds = [
  'copy',
  'move',
  'transfer',
  'duplicate',
  'alias',
  'rename',
  'mkdir',
  'mkfile',
  'trash',
  'compress',
  'extract',
  'convert',
] as const satisfies readonly OperationKind[];
export type RendererOperationKind = (typeof rendererOperationKinds)[number];
/** What `operate` accepts from a renderer: the desktop supplies the reviewed and prepared fields. */
export type RendererOperationRequest = Pick<
  OperationRequest,
  'sources' | 'destination' | 'name' | 'conversion' | 'transform' | 'expectedSources'
> & { kind: RendererOperationKind };
export type CollisionDecision = 'skip' | 'keep-both' | 'replace' | 'cancel';
export interface Collision {
  source: string;
  destination: string;
  /** False when the existing item contains the source, or a new folder would replace it. */
  replaceable?: boolean;
}
export interface OperationJob {
  progress?: number;
  detail?: string;
  id: string;
  revision: number;
  kind: OperationKind;
  status: JobStatus;
  sources: string[];
  destination?: string;
  current?: string;
  bytesDone: number;
  bytesTotal: number;
  itemsDone: number;
  itemsTotal: number;
  completed: {
    source: string;
    destination?: string;
    inputBytes?: number;
    outputBytes?: number;
    optimized?: boolean;
    targetSize?: OptimizationOutcome;
  }[];
  errors: { path: string; message: string }[];
  errorCount: number;
  collision?: Collision;
  undoable: boolean;
  /** Set after Undo until another operation starts; Redo runs it again as a new job. */
  redoable?: boolean;
  recovery?: { source: string; destination?: string; staging?: string };
}
export interface OperationProgress {
  progress?: number;
  detail?: string;
  id: string;
  revision: number;
  current?: string;
  bytesDone: number;
  bytesTotal: number;
  itemsDone: number;
  itemsTotal: number;
  errorCount: number;
}
export interface SearchRequest {
  id: string;
  root: string;
  query: string;
  showHidden: boolean;
}
export interface SearchBatch {
  id: string;
  entries: FileEntry[];
  done: boolean;
  visited: number;
  errors: number;
  truncated: boolean;
}
export interface Resource {
  office?: OfficeLayoutMetadata;
  derivation?: { kind: PreviewDerivationKind; decoder: string };
  dimensions?: { width: number; height: number };
  id: string;
  url: string;
  entry: FileEntry;
}
export interface ResourceRead {
  text: string;
  truncated: boolean;
  binary: boolean;
}
export interface ArchiveEntry {
  name: string;
  size: number;
  directory: boolean;
  previewable: boolean;
}
export interface ArchiveListing {
  entries: ArchiveEntry[];
  truncated: boolean;
}
export type DesktopEvent =
  | { type: 'speech-changed' }
  | { type: 'speech'; event: SpeechSessionEvent }
  | { type: 'prepare-note-trash'; id: string; token: string }
  | { type: 'note-trash-finished'; id: string; trashed: boolean }
  | { type: 'note-changed'; id: string; revision: number }
  | { type: 'receipt-changed'; id: string }
  | { type: 'browser'; browser: BrowserSnapshot }
  | { type: 'journal-changed' }
  | { type: 'local-servers'; servers: LocalServer[] }
  | { type: 'chat'; document: ChatDocument }
  | { type: 'agent-session'; id: string }
  | { type: 'launch'; request: LaunchRequest }
  | { type: 'workspaces'; state: SavedState }
  | { type: 'watch-rule'; rule: WatchRule }
  /** Settings shows this setting: a command for a setting the workspace does not change itself. */
  | { type: 'settings-focus'; path: string }
  | { type: 'service-error'; service: string; message: string }
  | { type: 'agent-proposal'; proposal: AgentProposal }
  | { type: 'agent-task'; id: string; bundle: AgentTaskBundle; deadline: number }
  | {
      type: 'agent-command';
      id: string;
      command: string;
      target: CapturedTarget;
      navigation?: AgentNavigation;
      /** Epoch milliseconds: main stops waiting just after. */
      deadline: number;
      /** A custom action's executor as it was reviewed. */
      executor?: CustomAction['executor'];
    }
  | { type: 'terminal'; event: TerminalEvent }
  | { type: 'execution'; task: ExecutionTask }
  | { type: 'folder-size'; task: FolderSizeTask }
  | { type: 'settings'; snapshot: SettingsSnapshot }
  | { type: 'session-keys'; session: SessionKeys }
  | { type: 'model-permission'; providerID: string }
  | { type: 'file-access'; path: string; resources?: string[] }
  | { type: 'index'; status: IndexStatus }
  | { type: 'action'; plan: ActionPlan }
  | { type: 'file-changes'; changes: FileChange[] }
  | { type: 'folder-changed'; path: string }
  | { type: 'lens-changed'; folder: string }
  | { type: 'watch-error'; path: string; message: string; code?: string }
  | { type: 'search'; batch: SearchBatch }
  | { type: 'job'; job: OperationJob }
  | { type: 'job-progress'; progress: OperationProgress }
  | { type: 'open'; paths: string[] }
  | { type: 'command'; command: string }
  | { type: 'flush'; token: string }
  | { type: 'flush-settings'; token: string };
export interface ViewerAPI {
  speech(request: SpeechRequest): Promise<SpeechReply>;
  createTask(input: TaskWorkflowInput): Promise<TaskWorkflowReply>;
  optimization(request: OptimizationRequest): Promise<OptimizationReply>;
  notes(request: NoteRequest): Promise<NoteReply>;
  agentSessions(request: SessionRequest): Promise<SessionReply>;
  receipts(request: ReceiptRequest): Promise<ReceiptReply>;
  pdfInspect(file: string): Promise<{ pages: number; version: SourceVersion }>;
  choosePDFs(): Promise<string[]>;
  imageInspect(
    file: string,
  ): Promise<{ width: number; height: number; alpha: boolean; preview: Resource }>;
  media(request: MediaRequest): Promise<MediaReply>;
  browser(request: BrowserRequest): Promise<BrowserSnapshot | void>;
  journalQuery(query: JournalQuery): Promise<JournalPage>;
  journalExportPreview(query: JournalQuery): Promise<JournalExportPreview>;
  journalExport(id: string): Promise<boolean>;
  journalClear(): Promise<boolean>;
  htmlPreview(resourceID: string): Promise<HtmlPreview>;
  htmlPreviewClose(id: string): Promise<void>;
  localServerStart(root: string, paneID: string, sourceIdentity?: string): Promise<LocalServer>;
  localServers(): Promise<LocalServer[]>;
  localServerInspect(id: string): Promise<LocalServerDetail>;
  localServerAction(id: string, action: LocalServerAction): Promise<void>;
  chat(request: ChatRequest): Promise<ChatReply>;
  shellCommand(action: 'status' | 'install' | 'uninstall'): Promise<ShellCommandStatus>;
  hotkeyStatus(): Promise<{ registered: boolean; shortcut: string; problem?: string }>;
  restoreWindow(): Promise<void>;
  workspaceClaim(id: string): Promise<boolean>;
  newWindow(): Promise<void>;
  git(request: GitRequest): Promise<GitReply>;
  gitWorktrees(request: WorktreeRequest): Promise<WorktreeReply>;
  gitReview(request: GitReviewRequest): Promise<GitReviewReply>;
  gitResource(source: GitSource): Promise<Resource>;
  gitAction(request: GitActionRequest): Promise<GitActionReply>;
  watchRules(request: WatchRuleRequest): Promise<WatchRuleReply>;
  relationships(request: RelationshipsRequest): Promise<RelationshipsReply>;
  workflow(request: WorkflowRequest): Promise<WorkflowReply>;
  querySnapshot(query: IndexedQuery): Promise<QuerySnapshot>;
  compare(request: ComparisonRequest): Promise<ComparisonResult | null>;
  /** Reports identical files; it never removes anything. */
  duplicates(request: DuplicateRequest): Promise<DuplicateResult | null>;
  operationPlan(request: OperationPlanRequest): Promise<OperationPlanReply>;
  checkpoints(request: CheckpointRequest): Promise<CheckpointReply>;
  inspect(file: string, content?: boolean, ocr?: boolean): Promise<InspectionResult>;
  project(request: ProjectRequest): Promise<ProjectReply>;
  /** Folder lenses: groups and places for a folder's items, which never move them. */
  lens(request: LensRequest): Promise<LensReply>;
  commandsPublish(
    target: CapturedTarget,
    commands: CommandDescriptor[],
    workspaces?: AgentWorkspaceSnapshot,
    /** Private active-workspace ownership; not part of agent discovery. */
    planeOwners?: Record<string, string>,
  ): Promise<void>;
  agentCommandResult(id: string, error?: string): Promise<void>;
  agentReviewList(): Promise<AgentProposal[]>;
  agentReview(id: string, approve: boolean): Promise<void>;
  agentGrants(): Promise<ExecutionGrant[]>;
  agentClients(request: AgentClientRequest): Promise<AgentClientReply>;
  agentAudit(clientID?: string): Promise<AgentAudit[]>;
  agentStop(clientID: string): Promise<void>;
  agentGrant(
    actionID: string,
    root: string,
    capability: ExecutionGrant['capability'],
    allow: boolean,
    clientID?: string,
  ): Promise<void>;
  configOpen(): Promise<void>;
  configValidate(): Promise<SettingsSnapshot>;
  configTransfer(kind: 'import' | 'export'): Promise<SettingsSnapshot>;
  backup(request: BackupRequest): Promise<BackupReply>;
  /** Writes a removed config.jsonc back from the settings in effect. */
  configRestore(): Promise<SettingsSnapshot>;
  /** Lets actions agents start send a provider's approved data too, or no longer; Settings only. */
  providerPermissionAgents(id: string, endpoint: string, allow: boolean): Promise<void>;
  /** Remembers the Settings window's category, privately. */
  settingsCategory(category: string): Promise<void>;
  /** The shared agent connection's approved access; Settings only. */
  agentAccess(request: AgentAccessRequest): Promise<AgentAccessState>;
  terminalApplication(): Promise<{ name: string; path: string; running: boolean }>;
  terminalExternal(cwd: string, tmux: boolean): Promise<void>;
  terminalStart(request: TerminalStart): Promise<void>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalAck(id: string, bytes: number): Promise<void>;
  terminalClose(id: string): Promise<void>;
  customExecute(
    actionID: string,
    target: CapturedTarget,
    values?: Record<string, string>,
  ): Promise<string>;
  runCommand(script: string, target: CapturedTarget): Promise<string>;
  commandDraft(request?: { script: string; name: string }): Promise<CustomAction | undefined>;
  executionList(): Promise<ExecutionTask[]>;
  executionCancel(id: string): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  /** Opens Settings; with a setting's path, at that setting. */
  openSettings(focus?: string): Promise<void>;
  settingsGet(): Promise<SettingsSnapshot>;
  settingsPatch(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot>;
  /** `>` in the palette: a request in words, answered with a line to review. */
  promptLine(request: PromptRequest): Promise<PromptAnswer>;
  promptCancel(id: string): Promise<void>;
  /** `:bind` and `:alias` of this session: kept in memory until quit. */
  sessionKeys(): Promise<SessionKeys>;
  sessionKeysSet(session: SessionKeys): Promise<SessionKeys>;
  /** Writes the session's bindings into config.jsonc, from Settings only. */
  sessionKeysKeep(): Promise<SettingsSnapshot>;
  sessionKeysDiscard(): Promise<SessionKeys>;
  providerCredential(id: string, key: string): Promise<void>;
  providerModels(id: string): Promise<string[]>;
  providerCheck(request: ProviderCheckRequest): Promise<ProviderCheckResult>;
  providerPermissionGet(id: string): Promise<ModelDataPermission | null>;
  providerPermissionSet(id: string, endpoint: string, level: ModelDataLevel | null): Promise<void>;
  indexStatus(): Promise<IndexStatus>;
  indexedQuery(query: IndexedQuery): Promise<IndexedResult>;
  indexRebuild(): Promise<void>;
  actionStart(request: ActionRequest): Promise<string>;
  actionGet(id: string): Promise<ActionPlan>;
  actionList(): Promise<ActionPlan[]>;
  actionApply(approval: ActionApproval): Promise<void>;
  actionCancel(id: string): Promise<void>;
  actionUndo(id: string): Promise<void>;
  actionRecover(id: string): Promise<void>;
  actionExportSummary(id: string, destination: string): Promise<void>;
  agentToken(): Promise<string>;
  contextPublish(context: ActionContext): Promise<void>;
  thumbnail(path: string, size: number): Promise<string>;
  /** Finder's icon for an application bundle, as a data URL. */
  appIcon(path: string, size: 'small' | 'large'): Promise<string>;
  /** Records a renderer failure in the local diagnostic log; nothing is sent anywhere. */
  diagnosticReport(detail: string): Promise<void>;
  document(id: string, request?: WorksheetDocumentRequest): Promise<DocumentData>;
  cancelDocument(id: string, requestID: string): Promise<void>;
  list(path: string): Promise<FolderListing>;
  stat(path: string): Promise<FileEntry>;
  fileInformation(path: string): Promise<FileInformation>;
  fileInformationUpdate(
    path: string,
    revision: string,
    patch: FileInformationPatch,
  ): Promise<FileInformation>;
  chooseFolder(defaultPath?: string): Promise<string | null>;
  reveal(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
  /** Asks macOS to mount a network share; it shows its own sign-in. */
  connectServer(address: string): Promise<void>;
  /** Files under `roots` carrying a Finder tag, found through Spotlight. */
  taggedFiles(tag: string, roots: string[]): Promise<FileEntry[]>;
  nativeFilePanel(kind: 'preview' | 'share', paths: string[]): Promise<void>;
  applications(paths: string[]): Promise<ApplicationChoices>;
  chooseApplication(): Promise<NativeApplication | null>;
  /** A listed application's own icon, as a data URL (Open With rows). */
  applicationIcon(id: string): Promise<string>;
  /** Shows or hides the window's close, minimise and zoom buttons, with a hidden title bar. */
  windowButtons(visible: boolean): Promise<void>;
  openWith(paths: string[], applicationID: string): Promise<void>;
  folderSizeStart(paths: string[]): Promise<FolderSizeTask>;
  folderSizeGet(id: string): Promise<FolderSizeTask>;
  folderSizeCancel(id: string): Promise<void>;
  watch(path: string, subscriber: string): Promise<void>;
  unwatch(subscriber: string): Promise<void>;
  search(request: SearchRequest): Promise<void>;
  cancelSearch(id: string): Promise<void>;
  operate(request: RendererOperationRequest): Promise<string>;
  jobs(): Promise<OperationJob[]>;
  cancelJob(id: string): Promise<void>;
  resolveCollision(id: string, decision: CollisionDecision, applyAll: boolean): Promise<void>;
  undo(id: string): Promise<void>;
  /** Starts an undone operation again; resolves with the new job ID. */
  redo(id: string): Promise<string>;
  resource(path: string, requestID?: string): Promise<Resource>;
  read(id: string, limit?: number): Promise<ResourceRead>;
  release(id: string): Promise<void>;
  archive(id: string): Promise<ArchiveListing>;
  archiveEntry(id: string, name: string): Promise<Resource>;
  /** A system-rendered image of a granted file Chromium cannot decode. */
  imageRendition(id: string, request?: ImageRenditionRequest): Promise<Resource>;
  videoRendition(id: string, requestID: string): Promise<Resource>;
  officeLayout(id: string, request: OfficeLayoutRequest): Promise<Resource>;
  officeImage(id: string, part: string, requestID: string): Promise<Resource>;
  /** Opens the system print sheet for a previewed PDF stored as a file. */
  printPDF(id: string, password?: string): Promise<void>;
  save(state: SavedState): Promise<void>;
  flushed(token: string, result?: FlushResult): Promise<void>;
  clipboardWrite(paths: string[], cut: boolean): Promise<void>;
  copyPaths(paths: string[]): Promise<void>;
  clipboardRead(): Promise<{ paths: string[]; cut: boolean } | null>;
  fileDropPaths(files: File[]): Promise<string[]>;
  fileDragStart(paths: string[]): Promise<void>;
  volumesList(): Promise<Volume[]>;
  trashList(folderID?: string): Promise<TrashSnapshot>;
  /** Presents native confirmation only. There is no empty/approve endpoint. */
  trashConfirmation(revision: string): Promise<void>;
  trashPreview(itemID: string): Promise<Resource>;
  trashCopyPaths(itemIDs: string[]): Promise<void>;
  trashRestore(itemIDs: string[], destination: 'original' | 'choose'): Promise<TrashRestoreResult>;
  trashAccess(locationID: string): Promise<void>;
  volumeEject(path: string): Promise<void>;
  fileAccessList(): Promise<
    {
      path: string;
      directory: boolean;
      status: 'active' | 'saved' | 'revoking' | 'unavailable';
      session?: boolean;
    }[]
  >;
  fileAccessRevoke(path: string): Promise<void>;
  textEdit(command: TextEditCommand): Promise<void>;
  /** Opens a previewed text file for editing where it is, or says why it cannot be. */
  textOpen(resourceID: string): Promise<TextOpening>;
  /** Saves edited text over the version that was read; resolves with the new version. */
  textSave(
    file: string,
    text: string,
    expected: TextVersion,
    session: string,
    bom: boolean,
  ): Promise<TextVersion>;
  /** Asks where to save text as a file, starting on the Desktop; null when cancelled. */
  textSaveAs(
    text: string,
    name: string,
    session: string,
  ): Promise<{ file: string; version: TextVersion } | null>;
  /** An editor closed: its saves are no longer its own to overwrite. */
  textEditEnd(session: string): Promise<void>;
  /** Asks natively what to do with unsaved text: before closing it, or before Revert to Saved. */
  textPrompt(kind: 'close' | 'revert', name: string): Promise<'save' | 'discard' | 'cancel'>;
  /** Unsaved text kept in the profile, without the text, and what could not be read. */
  bufferList(): Promise<{ buffers: TextBufferSummary[]; problems: string[] }>;
  bufferRead(id: string): Promise<TextBuffer | null>;
  bufferWrite(buffer: TextBuffer): Promise<void>;
  /** Removes unsaved text the person chose to discard. */
  bufferDiscard(id: string): Promise<void>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
export type ApiMethod = Exclude<keyof ViewerAPI, 'onEvent'>;
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string };

declare global {
  interface Window {
    viewer: ViewerAPI;
    viewerNative?: ViewerAPI;
  }
}
