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
}
export type Pane = FolderPane | PreviewPane | SearchPane | TerminalPane;
export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  roots: string[];
  activePane?: string;
  arrangement: Record<string, string>;
}
export interface SavedState {
  version: 1 | 2 | 3;
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
  settings?: import('./services').SettingsSnapshot;
}
export type OperationKind = 'copy' | 'move' | 'duplicate' | 'rename' | 'mkdir' | 'trash';
export interface OperationRequest {
  kind: OperationKind;
  sources: string[];
  destination?: string;
  name?: string;
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
  | { type: 'service-error'; service: string; message: string }
  | { type: 'agent-proposal'; proposal: import('./agent-requests').AgentProposal }
  | {
      type: 'agent-command';
      id: string;
      command: string;
      target: import('./automation').CapturedTarget;
    }
  | { type: 'terminal'; event: import('./automation').TerminalEvent }
  | { type: 'execution'; task: import('./automation').ExecutionTask }
  | { type: 'folder-size'; task: import('./metadata').FolderSizeTask }
  | { type: 'settings'; snapshot: import('./services').SettingsSnapshot }
  | { type: 'index'; status: import('./services').IndexStatus }
  | { type: 'action'; plan: import('./services').ActionPlan }
  | { type: 'file-changes'; changes: import('./changes').FileChange[] }
  | { type: 'folder-changed'; path: string }
  | { type: 'watch-error'; path: string; message: string }
  | { type: 'search'; batch: SearchBatch }
  | { type: 'job'; job: OperationJob }
  | { type: 'job-progress'; progress: OperationProgress }
  | { type: 'open'; paths: string[] }
  | { type: 'command'; command: string }
  | { type: 'flush'; token: string }
  | { type: 'flush-settings'; token: string };
export interface ViewerAPI {
  commandsPublish(
    target: import('./automation').CapturedTarget,
    commands: import('./agent-requests').CommandDescriptor[],
  ): Promise<void>;
  agentCommandResult(id: string, error?: string): Promise<void>;
  agentReviewList(): Promise<import('./agent-requests').AgentProposal[]>;
  agentReview(id: string, approve: boolean): Promise<void>;
  agentGrants(): Promise<import('./agent-requests').ExecutionGrant[]>;
  agentGrant(
    actionID: string,
    root: string,
    capability: import('./agent-requests').ExecutionGrant['capability'],
    allow: boolean,
  ): Promise<void>;
  configOpen(): Promise<void>;
  configValidate(): Promise<import('./services').SettingsSnapshot>;
  configTransfer(kind: 'import' | 'export'): Promise<import('./services').SettingsSnapshot>;
  terminalApplication(): Promise<{ name: string; path: string; running: boolean }>;
  terminalExternal(cwd: string, tmux: boolean): Promise<void>;
  terminalStart(request: import('./automation').TerminalStart): Promise<void>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalAck(id: string, bytes: number): Promise<void>;
  terminalClose(id: string): Promise<void>;
  customExecute(actionID: string, target: import('./automation').CapturedTarget): Promise<string>;
  executionList(): Promise<import('./automation').ExecutionTask[]>;
  executionCancel(id: string): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  openSettings(): Promise<void>;
  settingsGet(): Promise<import('./services').SettingsSnapshot>;
  settingsPatch(
    patches: import('./services').SettingsPatch[],
    revision: number,
  ): Promise<import('./services').SettingsSnapshot>;
  providerCredential(id: string, key: string): Promise<void>;
  providerModels(id: string): Promise<string[]>;
  indexStatus(): Promise<import('./services').IndexStatus>;
  indexedQuery(
    query: import('./services').IndexedQuery,
  ): Promise<import('./services').IndexedResult>;
  indexRebuild(): Promise<void>;
  actionStart(request: import('./services').ActionRequest): Promise<string>;
  actionGet(id: string): Promise<import('./services').ActionPlan>;
  actionList(): Promise<import('./services').ActionPlan[]>;
  actionApply(approval: import('./services').ActionApproval): Promise<void>;
  actionCancel(id: string): Promise<void>;
  actionUndo(id: string): Promise<void>;
  actionRecover(id: string): Promise<void>;
  actionExportSummary(id: string, destination: string): Promise<void>;
  agentToken(): Promise<string>;
  contextPublish(context: import('./services').ActionContext): Promise<void>;
  thumbnail(path: string, size: number): Promise<string>;
  document(id: string): Promise<import('./services').DocumentData>;
  list(path: string): Promise<FolderListing>;
  stat(path: string): Promise<FileEntry>;
  chooseFolder(): Promise<string | null>;
  reveal(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
  applications(paths: string[]): Promise<import('./metadata').ApplicationChoices>;
  chooseApplication(): Promise<import('./metadata').NativeApplication | null>;
  openWith(paths: string[], applicationID: string): Promise<void>;
  folderSizeStart(paths: string[]): Promise<import('./metadata').FolderSizeTask>;
  folderSizeGet(id: string): Promise<import('./metadata').FolderSizeTask>;
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
  clipboardRead(): Promise<{ paths: string[]; cut: boolean } | null>;
  textEdit(command: TextEditCommand): Promise<void>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
export type ApiMethod = Exclude<keyof ViewerAPI, 'onEvent'>;
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string };

declare global {
  interface Window {
    viewer: ViewerAPI;
  }
}
