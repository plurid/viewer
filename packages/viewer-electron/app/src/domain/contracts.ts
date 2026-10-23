import type { TextBuffer, TextBufferSummary, TextOpening, TextVersion } from './text-documents';
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
import type { LensReply, LensRequest } from './lenses';
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
import type {
  CapturedTarget,
  CustomAction,
  TerminalEvent,
  ExecutionTask,
  TerminalStart,
} from './automation';
import type { FolderSizeTask, ApplicationChoices, NativeApplication } from './metadata';
import type { FileChange } from './changes';
import type { ComparisonRequest, ComparisonResult } from './comparison';
import type { DuplicateRequest, DuplicateResult } from './duplicates';
import type { OperationPlanRequest, OperationPlanReply } from './operation-plan';
import type { CheckpointRequest, CheckpointReply } from './change-plan';
import type {
  AgentAccessRequest,
  AgentAccessState,
  AgentClientRequest,
  AgentClientReply,
  AgentAudit,
} from './agent-clients';
import type { ModelDataPermission, ModelDataLevel } from './model-permissions';
import type { FileInformation, FileInformationPatch } from './file-information';
import type { Volume } from './volumes';
import type { TrashSnapshot, TrashRestoreResult } from './trash';
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
  /** Unsaved edits to the file, kept in the profile until saved or discarded. */
  bufferID?: string;
}
/**
 * A plane of unsaved text (2026-10-23), kept in the profile until it is saved as a file or discarded.
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
export type Pane =
  FolderPane | PreviewPane | SearchPane | TerminalPane | CollectionPane | ScratchPane;
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
  /** This workspace's space colour, `#rrggbb`, over the general one (2026-10-23). */
  spaceColor?: string;
}
/** The saved state's format: 5 added scratch planes and a preview's unsaved edits (2026-10-23). */
export const CURRENT_STATE_VERSION = 5 as const;
export interface SavedState {
  version: 1 | 2 | 3 | 4 | typeof CURRENT_STATE_VERSION;
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
  /** Viewer's title bar (2026-10-23): hidden, it comes back while the pointer is at the window's top. */
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
    /** What the space shows behind the planes (2026-10-23): its colour, or what is behind the window. */
    backdrop: 'opaque' | 'blur' | 'clear';
    /** How much of the space's colour is drawn over what is behind, in percent. */
    backdropOpacity: number;
    /** The space's grid lines (2026-10-23). */
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
export type ImageConversion = 'rotate-left' | 'rotate-right' | 'jpeg' | 'png' | 'pdf';
export interface OperationRequest {
  kind: OperationKind;
  sources: string[];
  destination?: string;
  name?: string;
  /** Required for `convert`. */
  conversion?: ImageConversion;
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
export type CollisionDecision = 'skip' | 'keep-both' | 'replace' | 'cancel';
export interface Collision {
  source: string;
  destination: string;
  /** False when the existing item contains the source, or a new folder would replace it. */
  replaceable?: boolean;
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
  /** Set after Undo until another operation starts; Redo runs it again as a new job. */
  redoable?: boolean;
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
  /** Settings shows this setting: a command for a setting the workspace does not change itself. */
  | { type: 'settings-focus'; path: string }
  | { type: 'service-error'; service: string; message: string }
  | { type: 'agent-proposal'; proposal: AgentProposal }
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
  customExecute(actionID: string, target: CapturedTarget): Promise<string>;
  executionList(): Promise<ExecutionTask[]>;
  executionCancel(id: string): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  /** Opens Settings; with a setting's path, at that setting (2026-10-23). */
  openSettings(focus?: string): Promise<void>;
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
  /** Finder's icon for an application bundle, as a data URL. */
  appIcon(path: string, size: 'small' | 'large'): Promise<string>;
  /** Records a renderer failure in the local diagnostic log; nothing is sent anywhere. */
  diagnosticReport(detail: string): Promise<void>;
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
  /** Asks macOS to mount a network share; it shows its own sign-in. */
  connectServer(address: string): Promise<void>;
  /** Files under `roots` carrying a Finder tag, found through Spotlight. */
  taggedFiles(tag: string, roots: string[]): Promise<FileEntry[]>;
  nativeFilePanel(kind: 'preview' | 'share', paths: string[]): Promise<void>;
  applications(paths: string[]): Promise<ApplicationChoices>;
  chooseApplication(): Promise<NativeApplication | null>;
  /** A listed application's own icon, as a data URL (Open With rows, 2026-10-23). */
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
  operate(request: OperationRequest): Promise<string>;
  jobs(): Promise<OperationJob[]>;
  cancelJob(id: string): Promise<void>;
  resolveCollision(id: string, decision: CollisionDecision, applyAll: boolean): Promise<void>;
  undo(id: string): Promise<void>;
  /** Starts an undone operation again; resolves with the new job ID. */
  redo(id: string): Promise<string>;
  resource(path: string): Promise<Resource>;
  read(id: string, limit?: number): Promise<ResourceRead>;
  release(id: string): Promise<void>;
  archive(id: string): Promise<ArchiveListing>;
  archiveEntry(id: string, name: string): Promise<Resource>;
  /** A system-rendered image of a granted file Chromium cannot decode. */
  imageRendition(id: string): Promise<Resource>;
  /** Opens the system print sheet for a previewed PDF stored as a file. */
  printPDF(id: string, password?: string): Promise<void>;
  save(state: SavedState): Promise<void>;
  flushed(token: string): Promise<void>;
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
