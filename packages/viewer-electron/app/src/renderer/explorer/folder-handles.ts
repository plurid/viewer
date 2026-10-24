import type { FileEntry } from '../../domain/contracts';

/** What a folder plane lets a line do with its items (2026-10-24): `:select` and `:deselect`. */
export interface FolderHandle {
  path(): string;
  /** The items it shows, in their order. */
  entries(): readonly FileEntry[];
  selected(): readonly FileEntry[];
  /** These items selected, and no others. */
  select(entries: readonly FileEntry[]): void;
}
const handles = new Map<string, FolderHandle>();
/** Each folder plane's, while it is shown. */
export function registerFolderHandle(paneID: string, handle: FolderHandle): () => void {
  handles.set(paneID, handle);
  return () => {
    if (handles.get(paneID) === handle) handles.delete(paneID);
  };
}
export const folderHandle = (paneID: string | undefined) =>
  paneID ? handles.get(paneID) : undefined;
