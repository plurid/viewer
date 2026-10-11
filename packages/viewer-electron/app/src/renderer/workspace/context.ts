import { createContext, useContext } from 'react';
import type { FileEntry } from '../../domain/contracts';
export interface WorkspaceController {
  open(entry: FileEntry, parentEngineID?: string): void;
  openPath(path: string): Promise<void>;
  focusPane(hostID: string): void;
  frameAll(): void;
  dock(hostID?: string): void;
  closePane(hostID: string): void;
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
