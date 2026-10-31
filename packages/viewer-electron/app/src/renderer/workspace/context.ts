import type { EvidenceNavigation } from '../../domain/files/inspection';
import type { ProjectLayout } from '../../domain/workspaces/project';
import type { CapturedTarget } from '../../domain/automation/actions';
import type { GitActionIntent } from '../../domain/comparison/git-actions';
import type { PlaneLayoutEdit, PlaneLayoutTarget } from '../../domain/workspaces/plane-layout';
import { createContext, useContext } from 'react';
import type { DiffSource } from '../../domain/comparison/diff';
import type { FileEntry, NewRootFolderTarget } from '../../domain/contracts';
import type { Tiling } from '../../domain/workspaces/tiling';
import type { JournalFilter } from '../../domain/journal/events';
import type { WorktreeSelection } from '../../domain/comparison/worktrees';
import type { NoteKind } from '../../domain/editing/notes';
import type { AgentTaskBundle } from '../../domain/agents/task-workflow';
import type { LayoutMode, LayoutOpening } from '../../domain/layout/modes';
import type { TourStage } from './tours/stage';
/** What decides which plane an item opens in (`itemPlaneType`). */
type PlaneItem = Pick<FileEntry, 'path' | 'directory' | 'extension'>;
export interface WorkspaceController {
  installTaskArea(bundle: AgentTaskBundle): Promise<void>;
  newTaskArea(target: CapturedTarget, name: string): Promise<string>;
  setupTaskArea(id: string): Promise<void>;
  openTaskArea(id: string): void;
  refreshTaskArea(id: string): Promise<void>;
  openTaskMember(areaID: string, memberID: string): Promise<string>;
  addTaskTool(
    areaID: string,
    kind:
      'folder' | 'note' | 'checklist' | 'terminal' | 'chat' | 'git-changes' | 'browser' | 'server',
    url?: string,
  ): Promise<string>;
  attachTaskPlane(areaID: string, paneID: string): void;
  arrangeTaskArea(areaID: string): void;
  runTaskCommand(areaID: string): Promise<void>;
  openReceipt(id: string, directory?: string): void;
  openJournal(filter: JournalFilter): void;
  /** The workspace's Overview plane, opened or brought forward. */
  openOverview(): void;
  /** With `send`, the draft goes to the model at once when its permission already allows it. */
  newChat(paths: string[], draft?: string, send?: boolean): Promise<void>;
  openChat(id: string): Promise<void>;
  openAgentSession(id: string, parentPaneID?: string): Promise<string>;
  openDiff(left: DiffSource, right: DiffSource, parentPaneID?: string): void;
  openGitDiff(file: string, parentPaneID?: string): Promise<void>;
  openGitChanges(path: string, parentPaneID?: string): void;
  openWorktree(
    target: CapturedTarget,
    selection: WorktreeSelection,
    another?: boolean,
  ): Promise<string>;
  /** Plays the tour opened last, else the saved views. */
  present(): void;
  openCollection(id: string): void;
  openEvidence(
    evidence: EvidenceNavigation,
    parentPaneID?: string,
    options?: { frame?: boolean },
  ): Promise<string>;
  openCheckPlane(
    check: { id: string; folder: string; job: string },
    parentPaneID?: string,
  ): Promise<string>;
  pinPane(id: string, options?: { width?: number; height?: number }): boolean;
  placePane(id: string): Promise<'placed' | 'interrupted' | 'refused'>;
  planePinState(id: string): { pinnable: boolean; pinned: boolean; collapsed: boolean };
  collapsePinnedPane(id: string, collapsed: boolean): boolean;
  selectedPaneIDs(): string[];
  stackPanes(ids: readonly string[]): string | undefined;
  unstackPanes(reference: string | readonly string[]): boolean;
  planeStacks(): { id: string; panes: string[] }[];
  comparePanes(ids: readonly string[]): Promise<void>;
  whenPanesReady(ids: readonly string[]): Promise<void>;
  restorePaneLayout(layout: ProjectLayout, ids: readonly string[]): void;
  captureLayout(): ProjectLayout;
  restoreLayout(layout: ProjectLayout): void;
  newTerminal(target: CapturedTarget, profileID?: string): void;
  newGitAction(target: CapturedTarget, action: GitActionIntent): Promise<void>;
  /** Serve one captured folder in a linked, explicitly started plane. */
  newServer(target: CapturedTarget): Promise<void>;
  openServer(runtimeID: string): void;
  openBrowser(url: string, parentID?: string, serverRuntimeID?: string): void;
  openMedia(
    paths: string[],
    parentID?: string,
    fresh?: boolean,
    preset?: 'extract-audio',
  ): Promise<void>;
  /** A Layout plane for the files, opened or brought forward; `mode` overrides its suggestion. */
  openLayout(paths: string[], parentID?: string, mode?: LayoutMode, opening?: LayoutOpening): void;
  rootID(paneID: string): string | undefined;
  parentPaneID(paneID: string): string | undefined;
  linkedPaneID(paneID: string, entry: PlaneItem): string | undefined;
  existingPaneID(paneID: string, entry: PlaneItem): string | undefined;
  subscribeLinks(listener: () => void): () => void;
  newSearch(
    query: string,
    name: string,
    root?: string,
    recursive?: boolean,
    content?: boolean,
  ): void;
  newRootFolder(target?: NewRootFolderTarget): void;
  /** A new scratch plane of unsaved text, framed and active. */
  newScratch(): void;
  newNote(kind: NoteKind, directory?: string, parentID?: string): Promise<void>;
  openNote(id: string): Promise<void>;
  splitFolder(
    target: { workspaceID: string; paneID: string; path: string },
    axis: 'x' | 'y',
    destination?: string,
  ): void;
  layoutPlane(target: PlaneLayoutTarget, edit: PlaneLayoutEdit): void;
  editPlane(target: PlaneLayoutTarget, mode: 'move' | 'resize'): void;
  open(
    entry: FileEntry,
    parentPaneID?: string,
    options?: {
      another?: boolean;
      link?: string;
      /** Where a preview opens. Given as `undefined`, a preview already open loses its last one. */
      evidence?: EvidenceNavigation;
      /** A link followed: the plane also becomes the active one, taking the wheel and the keys. */
      activate?: boolean;
      /** `false` leaves the camera where it is: a tour's stage moves it to the plane itself. */
      frame?: boolean;
      /** A text file opens editing (Quick Preview's Edit). */
      edit?: boolean;
      /** A document package opens as the folder it is (Show Package Contents). */
      browse?: boolean;
    },
  ): void;
  openPath(
    path: string,
    target?: {
      paneID?: string;
      workspaceID?: string;
      linked?: boolean;
      another?: boolean;
      link?: string;
      /** Known folder destinations may request a native access grant. */
      directory?: boolean;
      /** A link followed: the plane it opens or shows becomes the active one. */
      activate?: boolean;
      /** A text file opens editing. */
      edit?: boolean;
    },
  ): Promise<void>;
  /** Shows a plane and makes it Viewer's active pane; `activate` also gives it the wheel and the
   * keys, as following a link does. Plurid's selection is not changed. */
  focusPane(hostID: string, options?: { activate?: boolean; frame?: boolean }): void;
  frameAll(): void;
  /** The space's named views: plurid's bookmarks, saved with the arrangement. */
  bookmarks(): { name: string; label: string }[];
  /** Saves the camera as a view; a name in use is replaced. */
  saveBookmark(name: string): void;
  /** Flies to a view; false when there is no view of that name. */
  goBookmark(
    name: string,
    options?: { duration?: number; onSettle?: () => void; onInterrupt?: () => void },
  ): boolean;
  removeBookmark(name: string): void;
  /** Opens a folder plane's subfolders, `depth` levels deep, as linked planes: one undo step. */
  explode(hostID: string, depth: number): Promise<number>;
  /** Closes the planes Explode folder opened from a plane. */
  collapse(hostID: string): void;
  /** Lays the workspace's tiled planes out again in their layout (workspace/tiling.ts). */
  retile(previous?: Tiling): void;
  renameBookmark(from: string, to: string): void;
  dock(hostID?: string): void;
  closePane(hostID: string): void;
  /** A plane and every plane under it: what closing it closes. */
  subtree(hostID: string): string[];
  consolidatePreviews(): void;
  arrange(axis: 'x' | 'y'): void;
  undo(): void;
  redo(): void;
  /** Engine facts the window needs, without its handle or plane IDs. */
  arrangementHistory(): { canUndo: boolean; canRedo: boolean };
  isDocked(): boolean;
  hasRepeatedPreviews(): boolean;
  transformTool(): SpatialTool;
  setTransformTool(tool: SpatialTool): void;
  /** Selects a plane before the engine handles a drag of its title. */
  selectForDrag(hostID: string): void;
  /** Resolves once the camera is at rest: no framing waiting for layout and no motion. */
  whenAtRest(signal?: AbortSignal): Promise<void>;
  /** What moves the camera through a tour: the engine's anchors when it has them, else framing. */
  tourStage(): TourStage;
  /** Engine state changes: arrangement, camera, docking and transform mode. */
  subscribeEngine(listener: () => void): () => void;
}
export type SpatialTool = 'rotate' | 'scale' | 'translate' | null;
export const WorkspaceContext = createContext<WorkspaceController | null>(null);
export function useWorkspace(): WorkspaceController {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is missing.');
  return value;
}
