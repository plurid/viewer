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
    },
  ): Promise<void>;
  focusPane(hostID: string): void;
  frameAll(): void;
  dock(hostID?: string): void;
  closePane(hostID: string): void;
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
