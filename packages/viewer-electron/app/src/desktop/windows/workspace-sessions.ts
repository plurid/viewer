import { maximumWorkspaces, mergeWorkspaceVisits } from '../../domain/workspaces/catalog';
import type { FolderVisitSave } from '../../domain/files/folder-visit-changes';
import type { FileChange } from '../../domain/files/changes';
import { pathMapper } from '../../domain/files/changes';
import type { FolderVisits } from '../../domain/files/folder-visits';
import { remapFolderVisits } from '../../domain/files/folder-visits';
import { FolderHistoryRemaps } from '../../domain/files/folder-history-remaps';
import {
  applyFolderVisitChanges,
  folderVisitChanges,
} from '../../domain/files/folder-visit-changes';
import { randomUUID } from 'node:crypto';
import { boundPreviewHistory } from '../../domain/previews/history';
import { CURRENT_STATE_VERSION, type SavedState, type Workspace } from '../../domain/contracts';
import { sameJSON } from '../../domain/json';

interface Session {
  workspaceID: string;
  baseline: SavedState;
  historyRevision: number;
  origins: Map<string, string>;
  historyKeys: FolderVisits;
}

/** The parts of a saved state shared between windows: what a merge can change for the sender. */
const shared = (state: SavedState) => ({
  workspaces: state.workspaces,
  favorites: state.favorites,
  recents: state.recents,
  visits: state.visits,
  lineHistory: state.lineHistory,
  workspaceVisits: state.workspaceVisits,
  openWindows: state.openWindows,
});
/** Whether the merged state holds anything the saving window did not send. */
export function mergeChanged(sent: SavedState, merged: SavedState): boolean {
  return !sameJSON(shared(sent), shared(merged));
}

/** Native windows own workspaces; a stale whole-window snapshot never replaces another owner. */
export class WorkspaceSessions {
  private current?: SavedState;
  private sessions = new Map<number, Session>();
  private reservations = new Map<number, string>();
  private writes: Promise<unknown> = Promise.resolve();
  private historyRevision = 0;
  private clearRevision = 0;
  private clearID?: string;
  private historyChanges = new FolderHistoryRemaps();
  private aliases: Record<string, string> = {};
  private historyFiles = new Set<string>();
  private aliasTargets: FolderVisits = {};

  get folderHistoryRevision(): number {
    return this.historyRevision;
  }

  folderHistory() {
    return {
      visits: structuredClone(this.current?.visits ?? {}),
      revision: this.historyRevision,
      clearRevision: this.clearRevision,
      ...(this.clearID ? { clearID: this.clearID } : {}),
      aliases: { ...this.aliases },
    };
  }

  normalizeFolderHistory(aliases: Record<string, string>, files: string[]): void {
    Object.assign(this.aliases, aliases);
    for (const path of Object.keys(aliases)) this.historyFiles.delete(path);
    for (const path of files) this.historyFiles.add(path);
    if (this.current?.visits) this.current.visits = this.normalizeHistory(this.current.visits);
    const keep = Object.keys(this.aliases).slice(-1000);
    this.aliases = Object.fromEntries(keep.map((key) => [key, this.aliases[key]!]));
    this.historyFiles = new Set([...this.historyFiles].slice(-500));
    this.aliasTargets = Object.fromEntries(
      Object.values(this.aliases).map((path) => [path, { count: 1, last: 0 }]),
    );
  }

  private normalizeHistory(visits: FolderVisits): FolderVisits {
    return remapFolderVisits(visits, (path) =>
      this.historyFiles.has(path) ? 'viewer://forgotten' : (this.aliases[path] ?? path),
    );
  }

  remapFolderHistory(changes: FileChange[]): void {
    this.historyChanges.add(changes, ++this.historyRevision);
    const targets = remapFolderVisits(this.aliasTargets, changes);
    if (targets !== this.aliasTargets) {
      const map = pathMapper(changes);
      this.aliases = Object.fromEntries(
        Object.entries(this.aliases).map(([old, path]) => [old, map(path)]),
      );
      this.aliasTargets = targets;
    }
    for (const session of this.sessions.values()) {
      const next = remapFolderVisits(session.historyKeys, changes);
      if (next === session.historyKeys) continue;
      const map = pathMapper(changes);
      for (const [original, path] of session.origins) session.origins.set(original, map(path));
      session.historyKeys = next;
    }
    if (this.current?.visits) this.current.visits = remapFolderVisits(this.current.visits, changes);
  }

  private remapHistory(visits: FolderVisits, revision: number, session?: Session): FolderVisits {
    if (session && this.historyChanges.needsRefresh(revision)) {
      return this.normalizeHistory(
        remapFolderVisits(visits, (path) => session.origins.get(path) ?? path),
      );
    }
    return this.normalizeHistory(this.historyChanges.apply(visits, revision));
  }

  seed(state: SavedState | null): void {
    if (!this.current && state) {
      this.current = structuredClone(state);
      this.current.windowProfiles ??= state.profile
        ? { [state.activeWorkspace]: state.profile }
        : {};
    }
  }

  seedFolderHistory(visits: FolderVisits): void {
    if (!this.sessions.size && this.current) this.current.visits = visits;
  }

  snapshot(): SavedState | undefined {
    return this.current && structuredClone(this.current);
  }

  /** Native appearance reads never copy plane trees, histories or private preview data. */
  presentation(workspaceID = this.current?.activeWorkspace): {
    workspace: Pick<Workspace, 'profileID' | 'overrides'>;
    profileID?: string;
  } {
    const workspace = this.current?.workspaces.find((item) => item.id === workspaceID);
    return {
      workspace: {
        profileID: workspace?.profileID,
        overrides: workspace?.overrides && structuredClone(workspace.overrides),
      },
      profileID: workspaceID ? this.current?.windowProfiles?.[workspaceID]?.id : undefined,
    };
  }

  owner(workspaceID: string): number | undefined {
    for (const [owner, session] of this.sessions)
      if (session.workspaceID === workspaceID) return owner;
    for (const [owner, reserved] of this.reservations) if (reserved === workspaceID) return owner;
    return undefined;
  }

  /** Reserve an attached native window before its renderer can finish bootstrap. */
  reserve(owner: number, workspaceID: string): void {
    if (!this.current?.workspaces.some((item) => item.id === workspaceID))
      throw new Error('This workspace is no longer available.');
    const existing = this.owner(workspaceID);
    if (existing !== undefined && existing !== owner)
      throw new Error('This workspace is opening in another window.');
    const previous = this.reservations.get(owner);
    if (this.sessions.has(owner) || (previous !== undefined && previous !== workspaceID))
      throw new Error('This window already owns a workspace.');
    this.reservations.set(owner, workspaceID);
  }

  create(home: string, name = 'Workspace'): string {
    if ((this.current?.workspaces.length ?? 0) >= maximumWorkspaces)
      throw new Error(`The maximum of ${maximumWorkspaces} workspaces has been reached.`);
    const paneID = randomUUID();
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      panes: [
        {
          id: paneID,
          type: 'folder',
          path: home,
          mode: 'list',
          sort: 'name',
          descending: false,
          showHidden: false,
          history: [home],
          historyIndex: 0,
        },
      ],
      roots: [paneID],
      activePane: paneID,
      arrangement: {},
    };
    this.current = this.current
      ? { ...this.current, workspaces: [...this.current.workspaces, workspace] }
      : {
          version: CURRENT_STATE_VERSION,
          workspaces: [workspace],
          activeWorkspace: workspace.id,
          favorites: [],
          recents: [],
          look: 'dark',
        };
    return workspace.id;
  }

  open(owner: number, home: string, desired?: string): SavedState {
    if (!this.current) this.create(home);
    let workspaceID = desired ?? this.reservations.get(owner) ?? this.current!.activeWorkspace;
    if (this.owner(workspaceID) !== undefined && this.owner(workspaceID) !== owner)
      workspaceID =
        this.current!.workspaces.find((space) => this.owner(space.id) === undefined)?.id ??
        this.create(home);
    if (!this.current!.workspaces.some((space) => space.id === workspaceID))
      throw new Error('This workspace is no longer available.');
    this.current!.workspaceVisits = { ...this.current!.workspaceVisits, [workspaceID]: Date.now() };
    const snapshot = {
      ...structuredClone(this.current!),
      activeWorkspace: workspaceID,
      profile: this.current!.windowProfiles?.[workspaceID],
    };
    this.sessions.set(owner, {
      workspaceID,
      baseline: structuredClone(snapshot),
      historyRevision: this.historyRevision,
      origins: new Map(Object.keys(snapshot.visits ?? {}).map((path) => [path, path])),
      historyKeys: snapshot.visits ?? {},
    });
    this.reservations.delete(owner);
    this.current!.openWindows = [...this.sessions.values()].map((session) => session.workspaceID);
    return snapshot;
  }

  claim(owner: number, workspaceID: string): boolean {
    const currentOwner = this.owner(workspaceID);
    if (currentOwner !== undefined && currentOwner !== owner) return false;
    const session = this.sessions.get(owner);
    if (!session || !this.current?.workspaces.some((space) => space.id === workspaceID))
      return false;
    session.workspaceID = workspaceID;
    if (this.current.windowProfiles)
      delete this.current.windowProfiles[session.baseline.activeWorkspace];
    this.current.openWindows = [...this.sessions.values()].map((value) => value.workspaceID);
    return true;
  }

  focus(owner: number): void {
    const session = this.sessions.get(owner);
    if (session && this.current) {
      this.current.activeWorkspace = session.workspaceID;
      this.current.workspaceVisits = {
        ...this.current.workspaceVisits,
        [session.workspaceID]: Date.now(),
      };
    }
  }

  close(owner: number): void {
    this.reservations.delete(owner);
    this.sessions.delete(owner);
    if (this.current)
      this.current.openWindows = [...this.sessions.values()].map((session) => session.workspaceID);
  }

  /** Publish the merge only after its durable write succeeds. All window saves share this queue. */
  persist(
    owner: number,
    input: SavedState,
    write: (state: SavedState) => Promise<void>,
    visitSave?: FolderVisitSave,
  ): Promise<SavedState> {
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        const merged = this.merge(owner, input, visitSave);
        let revision = this.historyRevision;
        // A rename during the write must reach disk before this snapshot is acknowledged.
        for (;;) {
          await write(structuredClone(merged));
          if (revision === this.historyRevision) break;
          merged.visits = this.remapHistory(merged.visits ?? {}, revision);
          revision = this.historyRevision;
        }
        this.commit(owner, input, merged, visitSave);
        return structuredClone(merged);
      });
    this.writes = work;
    return work;
  }

  save(owner: number, input: SavedState, visitSave?: FolderVisitSave): SavedState {
    const merged = this.merge(owner, input, visitSave);
    this.commit(owner, input, merged, visitSave);
    return structuredClone(merged);
  }

  private commit(
    owner: number,
    input: SavedState,
    merged: SavedState,
    visitSave?: FolderVisitSave,
  ): void {
    const session = this.sessions.get(owner);
    if (!session) return;
    session.workspaceID = input.activeWorkspace;
    session.baseline = structuredClone(input);
    const revision = visitSave?.revision ?? session.historyRevision;
    session.origins = new Map(
      Object.keys(input.visits ?? {}).map((path) => {
        const mapped = this.historyChanges.needsRefresh(revision)
          ? (session.origins.get(path) ?? path)
          : this.historyChanges.path(path, revision);
        return [path, this.aliases[mapped] ?? mapped];
      }),
    );
    session.historyKeys = Object.fromEntries(
      [...session.origins.values()].map((path) => [path, { count: 1, last: 0 }]),
    );
    session.historyRevision = this.historyRevision;
    if (visitSave?.clear) {
      this.clearRevision++;
      this.clearID = visitSave.id;
      this.aliases = {};
      this.aliasTargets = {};
      this.historyFiles.clear();
    }
    this.current = merged;
  }

  private merge(owner: number, input: SavedState, visitSave?: FolderVisitSave): SavedState {
    const session = this.sessions.get(owner);
    if (!session || !this.current) throw new Error('This workspace window has closed.');
    const baseline = session.baseline;
    const staleHistory = !visitSave?.clear && (visitSave?.clearRevision ?? 0) < this.clearRevision;
    const previous = new Map(baseline.workspaces.map((space) => [space.id, space]));
    const next = new Map(this.current.workspaces.map((space) => [space.id, space]));
    const incoming = new Set(input.workspaces.map((space) => space.id));
    const activeOwner = this.owner(input.activeWorkspace);
    if (activeOwner !== undefined && activeOwner !== owner)
      throw new Error('This workspace is open in another window.');
    for (const space of input.workspaces) {
      const other = this.owner(space.id);
      if (other !== undefined && other !== owner) continue;
      if (!sameJSON(space, previous.get(space.id))) next.set(space.id, structuredClone(space));
    }
    for (const id of previous.keys()) {
      if (incoming.has(id)) continue;
      const other = this.owner(id);
      if (other !== undefined && other !== owner)
        throw new Error('Close the other window before deleting its workspace.');
      next.delete(id);
    }
    if (!next.has(input.activeWorkspace)) throw new Error('The active workspace is unavailable.');
    const merged = {
      ...this.current,
      version: CURRENT_STATE_VERSION,
      workspaces: [...next.values()],
    };
    if (merged.workspaces.length > maximumWorkspaces)
      throw new Error(`The maximum of ${maximumWorkspaces} workspaces has been reached.`);
    merged.workspaceVisits = mergeWorkspaceVisits(
      merged.workspaces,
      merged.workspaceVisits,
      input.workspaceVisits,
    );
    // Shared lists merge only this window's changes, retaining unrelated additions and removals.
    for (const key of ['favorites', 'recents', 'lineHistory'] as const) {
      if (key === 'recents' && staleHistory) continue;
      if (key === 'recents' && visitSave?.clear) {
        merged.recents = input.recents.slice(0, 50);
        continue;
      }
      if (sameJSON(input[key], baseline[key])) continue;
      const identity = (value: unknown) =>
        typeof value === 'string' ? value : (value as { path: string }).path;
      const old = new Set((baseline[key] ?? []).map(identity));
      const wanted = new Set((input[key] ?? []).map(identity));
      const removed = new Set([...old].filter((item) => !wanted.has(item)));
      const combined = [...(input[key] ?? []), ...(merged[key] ?? [])];
      const seen = new Set<string>();
      const values = combined.filter((value) => {
        const id = identity(value);
        if (removed.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const maximum = key === 'lineHistory' ? 200 : key === 'recents' ? 50 : 200;
      Object.assign(merged, { [key]: values.slice(0, maximum) });
    }
    if (!staleHistory)
      merged.visits = applyFolderVisitChanges(
        merged.visits ?? {},
        folderVisitChanges(
          this.remapHistory(
            visitSave?.base ?? baseline.visits ?? {},
            visitSave?.revision ?? session.historyRevision,
            session,
          ),
          this.remapHistory(
            input.visits ?? {},
            visitSave?.revision ?? session.historyRevision,
            session,
          ),
          visitSave?.clear,
          this.remapHistory(
            visitSave?.restored ?? {},
            visitSave?.revision ?? session.historyRevision,
            session,
          ),
        ),
        Date.now(),
      );
    const previewStates = { ...merged.previewStates };
    for (const [key, value] of Object.entries(input.previewStates ?? {})) {
      const workspace = key.slice(0, key.indexOf(':'));
      const other = this.owner(workspace);
      if (other === undefined || other === owner) previewStates[key] = value;
    }
    for (const key of Object.keys(baseline.previewStates ?? {})) {
      if (Object.hasOwn(input.previewStates ?? {}, key)) continue;
      const other = this.owner(key.slice(0, key.indexOf(':')));
      if (other === undefined || other === owner) delete previewStates[key];
    }
    merged.previewStates = previewStates;
    const previewHistory = { ...merged.previewHistory };
    for (const [workspace, entries] of Object.entries(input.previewHistory ?? {})) {
      if (sameJSON(entries, baseline.previewHistory?.[workspace])) continue;
      const other = this.owner(workspace);
      if (next.has(workspace) && (other === undefined || other === owner))
        previewHistory[workspace] = entries;
    }
    for (const workspace of Object.keys(previewHistory)) {
      if (!next.has(workspace)) delete previewHistory[workspace];
      else if (
        baseline.previewHistory?.[workspace] &&
        !input.previewHistory?.[workspace] &&
        (this.owner(workspace) === undefined || this.owner(workspace) === owner)
      )
        delete previewHistory[workspace];
    }
    merged.previewHistory = boundPreviewHistory(previewHistory);
    merged.activeWorkspace = input.activeWorkspace;
    merged.profile = input.profile;
    const profiles = { ...merged.windowProfiles };
    if (input.profile) profiles[input.activeWorkspace] = structuredClone(input.profile);
    else delete profiles[input.activeWorkspace];
    for (const id of Object.keys(profiles)) if (!next.has(id)) delete profiles[id];
    merged.windowProfiles = profiles;
    merged.openWindows = [...this.sessions.entries()].map(([id, value]) =>
      id === owner ? input.activeWorkspace : value.workspaceID,
    );
    return merged;
  }
}
