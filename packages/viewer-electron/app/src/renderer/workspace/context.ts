import type { EvidenceNavigation } from '../../domain/inspection';
import type { ProjectLayout } from '../../domain/project';
import type { CapturedTarget } from '../../domain/automation';
import type { PlaneLayoutEdit, PlaneLayoutTarget } from '../../domain/plane-layout';
import { createContext, useContext } from 'react';
import type { FileEntry, NewRootFolderTarget } from '../../domain/contracts';
export interface WorkspaceController {
  openCollection(id: string): void;
  openEvidence(evidence: EvidenceNavigation, parentPaneID?: string): Promise<void>;
  captureLayout(): ProjectLayout;
  restoreLayout(layout: ProjectLayout): void;
  newTerminal(target: CapturedTarget, profileID?: string): void;
  rootID(paneID: string): string | undefined;
  parentPaneID(paneID: string): string | undefined;
  linkedPaneID(paneID: string, entry: Pick<FileEntry, 'path' | 'directory'>): string | undefined;
  existingPaneID(paneID: string, entry: Pick<FileEntry, 'path' | 'directory'>): string | undefined;
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
  splitFolder(target: { workspaceID: string; paneID: string; path: string }, axis: 'x' | 'y'): void;
  layoutPlane(target: PlaneLayoutTarget, edit: PlaneLayoutEdit): void;
  editPlane(target: PlaneLayoutTarget, mode: 'move' | 'resize'): void;
  open(
    entry: FileEntry,
    parentPaneID?: string,
    options?: {
      another?: boolean;
      link?: string;
      evidence?: EvidenceNavigation;
      /** A link followed: the plane also becomes the active one, taking the wheel and the keys. */
      activate?: boolean;
      /** A text file opens editing (Quick Preview's Edit, 2026-10-23). */
      edit?: boolean;
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
   * keys, as following a link does (2026-10-23). Plurid's selection is not changed. */
  focusPane(hostID: string, options?: { activate?: boolean; frame?: boolean }): void;
  frameAll(): void;
  /** The space's named views (2026-10-23): plurid's bookmarks, saved with the arrangement. */
  bookmarks(): { name: string; label: string }[];
  /** Saves the camera as a view; a name in use is replaced. */
  saveBookmark(name: string): void;
  /** Flies to a view; false when there is no view of that name. */
  goBookmark(name: string, options?: { duration?: number; onSettle?: () => void }): boolean;
  removeBookmark(name: string): void;
  /** Opens a folder plane's subfolders, `depth` levels deep, as linked planes: one undo step. */
  explode(hostID: string, depth: number): Promise<number>;
  /** Closes the planes Explode folder opened from a plane. */
  collapse(hostID: string): void;
  /** Lays the workspace's tiled planes out again in their layout (workspace/tiling.ts). */
  retile(): void;
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
