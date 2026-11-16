import type { FileChange } from './changes';
import { pathMapper } from './changes';
import type { FolderVisits } from './folder-visits';
import { remapFolderVisits } from './folder-visits';

export const folderHistoryBatchLimit = 64;
export const folderHistoryChangeLimit = 1024;

/** An old renderer retries from its updated state instead of blocking on unbounded replay. */
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

  apply(visits: FolderVisits, revision: number): FolderVisits {
    if (this.needsRefresh(revision)) {
      throw Object.assign(
        new Error('Folder history changed while saving. Retry with the current folders.'),
        {
          code: 'FOLDER_HISTORY_REFRESH',
        },
      );
    }
    for (const batch of this.batches)
      if (batch.revision > revision) visits = remapFolderVisits(visits, batch.map);
    return visits;
  }
}
