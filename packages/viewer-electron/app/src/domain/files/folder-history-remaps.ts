import type { FileChange } from './changes';
import { pathMapper } from './changes';
import type { FolderVisits } from './folder-visits';
import { remapFolderVisits } from './folder-visits';

export const folderHistoryBatchLimit = 64;
export const folderHistoryChangeLimit = 1024;

/** Recent renames have bounded replay; session anchors cover older remembered paths. */
export class FolderHistoryRemaps {
  private batches: { revision: number; size: number; map(path: string): string }[] = [];
  private floor = 0;

  add(changes: FileChange[], revision: number): void {
    if (changes.length > folderHistoryChangeLimit) {
      this.batches = [];
      this.floor = revision;
      return;
    }
    this.batches.push({ revision, size: changes.length, map: pathMapper(changes) });
    let size = this.batches.reduce((total, batch) => total + batch.size, 0);
    while (this.batches.length > folderHistoryBatchLimit || size > folderHistoryChangeLimit) {
      const removed = this.batches.shift()!;
      this.floor = removed.revision;
      size -= removed.size;
    }
  }

  needsRefresh(revision: number): boolean {
    return revision < this.floor;
  }

  path(path: string, revision: number): string {
    for (const batch of this.batches) if (batch.revision > revision) path = batch.map(path);
    return path;
  }

  apply(visits: FolderVisits, revision: number): FolderVisits {
    for (const batch of this.batches)
      if (batch.revision > revision) visits = remapFolderVisits(visits, batch.map);
    return visits;
  }
}
