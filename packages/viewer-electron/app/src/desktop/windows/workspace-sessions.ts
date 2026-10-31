import { maximumWorkspaces, mergeWorkspaceVisits } from '../../domain/workspaces/catalog';
import { randomUUID } from 'node:crypto';
import { boundPreviewHistory } from '../../domain/previews/history';
import { CURRENT_STATE_VERSION, type SavedState, type Workspace } from '../../domain/contracts';
import { sameJSON } from '../../domain/json';

interface Session {
  workspaceID: string;
  baseline: SavedState;
}

/** The parts of a saved state shared between windows: what a merge can change for the sender. */
const shared = (state: SavedState) => ({
  workspaces: state.workspaces,
  favorites: state.favorites,
  recents: state.recents,
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

  seed(state: SavedState | null): void {
    if (!this.current && state) {
      this.current = structuredClone(state);
      this.current.windowProfiles ??= state.profile
        ? { [state.activeWorkspace]: state.profile }
        : {};
    }
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
    this.sessions.set(owner, { workspaceID, baseline: structuredClone(snapshot) });
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
  ): Promise<SavedState> {
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        const merged = this.merge(owner, input);
        await write(structuredClone(merged));
        this.commit(owner, input, merged);
        return structuredClone(merged);
      });
    this.writes = work;
    return work;
  }

  save(owner: number, input: SavedState): SavedState {
    const merged = this.merge(owner, input);
    this.commit(owner, input, merged);
    return structuredClone(merged);
  }

  private commit(owner: number, input: SavedState, merged: SavedState): void {
    const session = this.sessions.get(owner);
    if (!session) return;
    session.workspaceID = input.activeWorkspace;
    session.baseline = structuredClone(input);
    this.current = merged;
  }

  private merge(owner: number, input: SavedState): SavedState {
    const session = this.sessions.get(owner);
    if (!session || !this.current) throw new Error('This workspace window has closed.');
    const baseline = session.baseline;
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
    const visits = { ...merged.visits };
    for (const [path, visit] of Object.entries(input.visits ?? {})) {
      const previous = baseline.visits?.[path];
      if (sameJSON(previous, visit)) continue;
      visits[path] = {
        count: (visits[path]?.count ?? 0) + Math.max(0, visit.count - (previous?.count ?? 0)),
        last: Math.max(visits[path]?.last ?? 0, visit.last),
      };
    }
    merged.visits = visits;
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
