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
export type SortKey = 'name' | 'modified' | 'size' | 'kind';
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
export type Pane = FolderPane | PreviewPane;
export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  roots: string[];
  activePane?: string;
  arrangement: Record<string, string>;
}
export interface SavedState {
  version: 1;
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
  };
  recentCommands: string[];
}
export type TextEditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';
export interface Bootstrap {
  home: string;
  platform: 'darwin' | 'win32' | 'linux';
  locations: { name: string; path: string }[];
  state: SavedState | null;
  openPaths: string[];
  recovery?: string;
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
  | { type: 'folder-changed'; path: string }
  | { type: 'watch-error'; path: string; message: string }
  | { type: 'search'; batch: SearchBatch }
  | { type: 'job'; job: OperationJob }
  | { type: 'job-progress'; progress: OperationProgress }
  | { type: 'open'; paths: string[] }
  | { type: 'command'; command: string }
  | { type: 'flush'; token: string };
export interface ViewerAPI {
  bootstrap(): Promise<Bootstrap>;
  list(path: string): Promise<FolderListing>;
  stat(path: string): Promise<FileEntry>;
  chooseFolder(): Promise<string | null>;
  reveal(path: string): Promise<void>;
  openExternal(path: string): Promise<void>;
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
