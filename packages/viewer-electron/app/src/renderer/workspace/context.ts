import { createContext, useContext } from 'react';
import type { FileEntry, NewRootFolderTarget } from '../../domain/contracts';
export interface WorkspaceController {
  newTerminal(target: import('../../domain/automation').CapturedTarget, profileID?: string): void;
  rootID(paneID: string): string | undefined;
  newSearch(
    query: string,
    name: string,
    root?: string,
    recursive?: boolean,
    content?: boolean,
  ): void;
  newRootFolder(target?: NewRootFolderTarget): void;
  open(
    entry: FileEntry,
    parentPaneID?: string,
    options?: { another?: boolean; link?: string },
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
}
export const WorkspaceContext = createContext<WorkspaceController | null>(null);
export function useWorkspace(): WorkspaceController {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is missing.');
  return value;
}
