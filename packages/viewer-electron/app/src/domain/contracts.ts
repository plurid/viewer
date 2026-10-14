import type { EvidenceNavigation, SourceVersion, InspectionResult } from './inspection';
import type { WorkflowRequest, WorkflowReply } from './workflows';
import type { WatchRule, WatchRuleRequest, WatchRuleReply } from './watch-rules';
import type { RelationshipsRequest, RelationshipsReply } from './relationships';
import type {
  ProjectAssociation,
  ProjectLayout,
  JSONValue,
  ProjectRequest,
  ProjectReply,
} from './project';
import type { Collection, BasketItem, QuerySnapshot } from './collections';
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
} from './agent-requests';
import type { CapturedTarget, TerminalEvent, ExecutionTask, TerminalStart } from './automation';
import type { FolderSizeTask, ApplicationChoices, NativeApplication } from './metadata';
import type { FileChange } from './changes';
import type { ComparisonRequest, ComparisonResult } from './comparison';
import type { OperationPlanRequest, OperationPlanReply } from './operation-plan';
import type { CheckpointRequest, CheckpointReply } from './change-plan';
import type { AgentClientRequest, AgentClientReply, AgentAudit } from './agent-clients';
import type { ModelDataPermission, ModelDataLevel } from './model-permissions';
import type { FileInformation, FileInformationPatch } from './file-information';
import type { Volume } from './volumes';
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
export type ViewMode = 'list' | 'grid' | 'columns' | 'gallery';
export type SortKey = 'name' | 'modified' | 'created' | 'size' | 'kind' | 'extension';
export type ListColumn = SortKey;
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
  startOnOpen?: boolean;
}
export interface CollectionPane {
  id: string;
  type: 'collection';
  path: string;
  collectionID: string;
}
export type Pane = FolderPane | PreviewPane | SearchPane | TerminalPane | CollectionPane;
export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  roots: string[];
  activePane?: string;
  arrangement: Record<string, string>;
  project?: ProjectAssociation;
  layout?: ProjectLayout;
  /** Private remount generation for an explicit project reload. */
  epoch?: number;
  collections?: Collection[];
  basket?: BasketItem[];
}
export interface SavedState {
  version: 1 | 2 | 3 | 4;
  previewStates?: Record<string, Record<string, JSONValue>>;
  preferencesRevision?: number;
  workspaces: Workspace[];
  activeWorkspace: string;
  favorites: { name: string; path: string }[];
  recents: string[];
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
  space: {
    toolbar: boolean;
    minimap: boolean;
    viewcube: boolean;
    origin: boolean;
    planeHeaders: boolean;
    dragging: boolean;
    resizing: boolean;
    opening: 'face-on' | 'pair' | 'dock';
    headerControls: {
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
  | 'trash'
  | 'compress'
  | 'extract';
export interface OperationRequest {
  kind: OperationKind;
  sources: string[];
  destination?: string;
  name?: string;
  /** Source versions captured in a reviewed plan; checked again when queued work starts. */
  expectedSources?: { path: string; version: SourceVersion }[];
}
export type CollisionDecision = 'skip' | 'keep-both' | 'replace' | 'cancel';
export interface Collision {
  source: string;
  destination: string;
}
export interface OperationJob {
  id: string;
  revision: number;
  kind: OperationKind;
  status: 'queued' | 'running' | 'collision' | 'completed' | 'cancelled' | 'failed';
  sources: string[];
  destination?: string;
  current?: string;
  bytesDone: number;
  bytesTotal: number;
  itemsDone: number;
  itemsTotal: number;
  completed: { source: string; destination?: string }[];
  errors: { path: string; message: string }[];
  errorCount: number;
  collision?: Collision;
  undoable: boolean;
  recovery?: { source: string; destination?: string; staging?: string };
}
export interface OperationProgress {
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
  | { type: 'watch-rule'; rule: WatchRule }
  | { type: 'service-error'; service: string; message: string }
  | { type: 'agent-proposal'; proposal: AgentProposal }
  | {
      type: 'agent-command';
      id: string;
      command: string;
      target: CapturedTarget;
      navigation?: AgentNavigation;
    }
  | { type: 'terminal'; event: TerminalEvent }
  | { type: 'execution'; task: ExecutionTask }
  | { type: 'folder-size'; task: FolderSizeTask }
  | { type: 'settings'; snapshot: SettingsSnapshot }
  | { type: 'model-permission'; providerID: string }
  | { type: 'file-access'; path: string; resources?: string[] }
  | { type: 'index'; status: IndexStatus }
  | { type: 'action'; plan: ActionPlan }
  | { type: 'file-changes'; changes: FileChange[] }
  | { type: 'folder-changed'; path: string }
  | { type: 'watch-error'; path: string; message: string; code?: string }
  | { type: 'search'; batch: SearchBatch }
  | { type: 'job'; job: OperationJob }
  | { type: 'job-progress'; progress: OperationProgress }
  | { type: 'open'; paths: string[] }
  | { type: 'command'; command: string }
  | { type: 'flush'; token: string }
  | { type: 'flush-settings'; token: string };
export interface ViewerAPI {
  watchRules(request: WatchRuleRequest): Promise<WatchRuleReply>;
  relationships(request: RelationshipsRequest): Promise<RelationshipsReply>;
  workflow(request: WorkflowRequest): Promise<WorkflowReply>;
  querySnapshot(query: IndexedQuery): Promise<QuerySnapshot>;
  compare(request: ComparisonRequest): Promise<ComparisonResult | null>;
  operationPlan(request: OperationPlanRequest): Promise<OperationPlanReply>;
  checkpoints(request: CheckpointRequest): Promise<CheckpointReply>;
  inspect(file: string, content?: boolean, ocr?: boolean): Promise<InspectionResult>;
  project(request: ProjectRequest): Promise<ProjectReply>;
  commandsPublish(
    target: CapturedTarget,
    commands: CommandDescriptor[],
    workspaces?: AgentWorkspaceSnapshot,
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
  terminalApplication(): Promise<{ name: string; path: string; running: boolean }>;
  terminalExternal(cwd: string, tmux: boolean): Promise<void>;
  terminalStart(request: TerminalStart): Promise<void>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalAck(id: string, bytes: number): Promise<void>;
  terminalClose(id: string): Promise<void>;
  customExecute(actionID: string, target: CapturedTarget): Promise<string>;
  executionList(): Promise<ExecutionTask[]>;
  executionCancel(id: string): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  openSettings(): Promise<void>;
  settingsGet(): Promise<SettingsSnapshot>;
  settingsPatch(patches: SettingsPatch[], revision: number): Promise<SettingsSnapshot>;
  providerCredential(id: string, key: string): Promise<void>;
  providerModels(id: string): Promise<string[]>;
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
  document(id: string): Promise<DocumentData>;
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
  nativeFilePanel(kind: 'preview' | 'share', paths: string[]): Promise<void>;
  applications(paths: string[]): Promise<ApplicationChoices>;
  chooseApplication(): Promise<NativeApplication | null>;
  openWith(paths: string[], applicationID: string): Promise<void>;
  folderSizeStart(paths: string[]): Promise<FolderSizeTask>;
  folderSizeGet(id: string): Promise<FolderSizeTask>;
  folderSizeCancel(id: string): Promise<void>;
  watch(path: string, subscriber: string): Promise<void>;
  unwatch(subscriber: string): Promise<void>;
  search(request: SearchRequest): Promise<void>;
  cancelSearch(id: string): Promise<void>;
  operate(request: OperationRequest): Promise<string>;
  jobs(): Promise<OperationJob[]>;
  cancelJob(id: string): Promise<void>;
  resolveCollision(id: string, decision: CollisionDecision, applyAll: boolean): Promise<void>;
  undo(id: string): Promise<void>;
  resource(path: string): Promise<Resource>;
  read(id: string, limit?: number): Promise<ResourceRead>;
  release(id: string): Promise<void>;
  archive(id: string): Promise<ArchiveListing>;
  archiveEntry(id: string, name: string): Promise<Resource>;
  save(state: SavedState): Promise<void>;
  flushed(token: string): Promise<void>;
  clipboardWrite(paths: string[], cut: boolean): Promise<void>;
  copyPaths(paths: string[]): Promise<void>;
  clipboardRead(): Promise<{ paths: string[]; cut: boolean } | null>;
  fileDropPaths(files: File[]): Promise<string[]>;
  fileDragStart(paths: string[]): Promise<void>;
  volumesList(): Promise<Volume[]>;
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
