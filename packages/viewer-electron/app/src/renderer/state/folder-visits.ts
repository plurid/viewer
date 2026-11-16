import type { FolderVisits } from '../../domain/files/folder-visits';
import { mergeFolderVisits, remapFolderVisits } from '../../domain/files/folder-visits';
import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
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
  private remappings: { revision: number; changes: FileChange[] }[] = [];

  reset(base: FolderVisits, revision = 0): void {
    this.base = base;
    this.inFlight = undefined;
    this.pendingClear = false;
    this.pendingRestored = {};
    this.revision = revision;
    this.remappings = [];
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
    this.remappings.push({ revision, changes });
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
    };
    this.pendingClear = false;
    this.pendingRestored = {};
    return save;
  }

  recentFolders(incoming: string[], current: string[], acknowledgement?: string): string[] {
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
  ): FolderVisits {
    for (const batch of this.remappings)
      if (batch.revision > revision) incoming = remapFolderVisits(incoming, batch.changes);
    const now = Date.now();
    const projected = this.inFlight
      ? applyFolderVisitChanges(this.base, this.inFlight.changes, now)
      : this.base;
    const pending = folderVisitChanges(projected, current, this.pendingClear, this.pendingRestored);
    if (acknowledgement === this.inFlight?.id) this.inFlight = undefined;
    if (!this.inFlight) this.remappings = [];
    this.base = incoming;
    const shared = this.inFlight
      ? applyFolderVisitChanges(incoming, this.inFlight.changes, now)
      : incoming;
    return applyFolderVisitChanges(shared, pending, now);
  }

  complete(
    id: string,
    incoming: FolderVisits,
    current: FolderVisits,
    revision = this.revision,
  ): FolderVisits {
    // The event can acknowledge the write before the IPC response reaches this window.
    return this.inFlight?.id === id ? this.receive(incoming, current, id, revision) : current;
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
    this.remappings = [];
  }
}

export const folderVisitSync = new FolderVisitSync();
