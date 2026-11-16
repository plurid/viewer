import type { FolderVisits } from '../../domain/files/folder-visits';
import {
  mergeFolderVisits,
  remapFolderVisits,
  sameFolderVisits,
} from '../../domain/files/folder-visits';
import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
import { FolderHistoryRemaps } from '../../domain/files/folder-history-remaps';
import type { FolderVisitChanges, FolderVisitSave } from '../../domain/files/folder-visit-changes';
import {
  applyFolderVisitChanges,
  folderVisitChanges,
} from '../../domain/files/folder-visit-changes';

/** Keep unsaved navigation across peer broadcasts, without replaying our acknowledged visits. */
export class FolderVisitSync {
  private base: FolderVisits = {};
  private inFlight?: { id: string; changes: FolderVisitChanges; recents: readonly string[] };
  private pendingClear = false;
  private pendingRestored: FolderVisits = {};
  private revision = 0;
  private clearRevision = 0;
  private remappings = new FolderHistoryRemaps();

  reset(base: FolderVisits, revision = 0, clearRevision = 0): void {
    this.base = base;
    this.inFlight = undefined;
    this.pendingClear = false;
    this.pendingRestored = {};
    this.revision = revision;
    this.clearRevision = clearRevision;
    this.remappings = new FolderHistoryRemaps();
  }

  remap(changes: FileChange[], revision = this.revision + 1): void {
    this.base = remapFolderVisits(this.base, changes);
    this.pendingRestored = remapFolderVisits(this.pendingRestored, changes);
    this.revision = revision;
    if (!this.inFlight) return;
    const map = pathMapper(changes);
    const pending = this.inFlight.changes;
    pending.added = remapFolderVisits(pending.added, changes);
    pending.restored = remapFolderVisits(pending.restored, changes);
    pending.removed = pending.removed.map(map);
    // A reply can describe the paths from before a rename that arrived during its write.
    this.remappings.add(changes, revision);
  }

  clear(): void {
    this.pendingClear = true;
    this.pendingRestored = {};
  }

  restore(visits: FolderVisits): void {
    this.pendingRestored = mergeFolderVisits(this.pendingRestored, visits, Date.now());
  }

  get clearing(): boolean {
    return this.pendingClear || !!this.inFlight?.changes.clear;
  }

  begin(current: FolderVisits, recents: readonly string[] = []): FolderVisitSave {
    const id = crypto.randomUUID();
    this.inFlight = {
      id,
      changes: folderVisitChanges(this.base, current, this.pendingClear, this.pendingRestored),
      recents,
    };
    const save = {
      id,
      base: this.base,
      clear: this.pendingClear,
      revision: this.revision,
      restored: this.pendingRestored,
      clearRevision: this.clearRevision,
    };
    this.pendingClear = false;
    this.pendingRestored = {};
    return save;
  }

  recentFolders(
    incoming: string[],
    current: string[],
    acknowledgement?: string,
    clearRevision = this.clearRevision,
  ): string[] {
    if (clearRevision < this.clearRevision) return current;
    if (this.clearing) return current;
    const sent = this.inFlight;
    if (
      !sent ||
      acknowledgement !== sent.id ||
      JSON.stringify(sent.recents) === JSON.stringify(current)
    )
      return incoming;
    // A save response must not overwrite navigation that happened while its write was pending.
    const removed = new Set(sent.recents.filter((path) => !current.includes(path)));
    return [...new Set([...current, ...incoming])]
      .filter((path) => !removed.has(path))
      .slice(0, 50);
  }

  receive(
    incoming: FolderVisits,
    current: FolderVisits,
    acknowledgement?: string,
    revision = this.revision,
    clearRevision = this.clearRevision,
  ): FolderVisits {
    if (clearRevision < this.clearRevision) return current;
    if (clearRevision > this.clearRevision && !this.clearing) {
      this.base = incoming;
      this.inFlight = undefined;
      this.pendingRestored = {};
      this.clearRevision = clearRevision;
      this.remappings = new FolderHistoryRemaps();
      return incoming;
    }
    this.clearRevision = clearRevision;
    if (this.remappings.needsRefresh(revision)) return current;
    incoming = this.remappings.apply(incoming, revision);
    const now = Date.now();
    const projected = this.inFlight
      ? applyFolderVisitChanges(this.base, this.inFlight.changes, now)
      : this.base;
    const pending = folderVisitChanges(projected, current, this.pendingClear, this.pendingRestored);
    if (acknowledgement === this.inFlight?.id) this.inFlight = undefined;
    if (!this.inFlight) this.remappings = new FolderHistoryRemaps();
    this.base = incoming;
    const shared = this.inFlight
      ? applyFolderVisitChanges(incoming, this.inFlight.changes, now)
      : incoming;
    const result = applyFolderVisitChanges(shared, pending, now);
    return sameFolderVisits(result, current) ? current : result;
  }

  complete(
    id: string,
    incoming: FolderVisits,
    current: FolderVisits,
    revision = this.revision,
    clearRevision = this.clearRevision,
  ): FolderVisits {
    // The event can acknowledge the write before the IPC response reaches this window.
    return this.inFlight?.id === id
      ? this.receive(incoming, current, id, revision, clearRevision)
      : current;
  }

  failed(id: string): void {
    if (this.inFlight?.id !== id) return;
    if (!this.pendingClear)
      this.pendingRestored = mergeFolderVisits(
        this.inFlight.changes.restored,
        this.pendingRestored,
        Date.now(),
      );
    this.pendingClear ||= this.inFlight.changes.clear;
    this.inFlight = undefined;
    this.remappings = new FolderHistoryRemaps();
  }

  needsRefresh(revision: number): boolean {
    return this.remappings.needsRefresh(revision);
  }
}

export const folderVisitSync = new FolderVisitSync();
