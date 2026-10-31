import type { OperationJob } from '../../domain/contracts';
import type {
  CheckFinding,
  CheckNothing,
  CheckOpening,
  CheckResult,
  FabricationRequest,
} from '../../domain/fabrication/check';
import type {
  HandoffFile,
  HandoffNesting,
  HandoffNestings,
} from '../../domain/fabrication/handoff';
import type { ThicknessGroup } from '../../domain/fabrication/names';
import type { PartPlan } from '../../domain/fabrication/reconcile';
import type { RequirementUnit } from '../../domain/fabrication/requirements';
import type { ProjectLayout } from '../../domain/workspaces/project';
import type { EvidenceNavigation } from '../../domain/files/inspection';
import type { WorkspaceController } from '../workspace/context';
import type { PlayableTour } from '../workspace/tours/player';
import { chooseNestings, handoffOperation, nestingHold } from '../../domain/fabrication/handoff';
import { changesText } from '../../domain/fabrication/job-files';
import { listText } from '../../domain/fabrication/plan';
import { sourceVersion } from '../../domain/files/inspection';
import { errorMessage } from '../../domain/errors';
import { activeWorkspace, getState, updatePane } from '../state/store';
import { subscribe as subscribeState } from '../state/core';
import { preparedNestings } from '../layout/nesting/prepared';
import { nestWithoutPlane } from '../layout/nesting/headless';
import { playTour, subscribeTour, tourPlayback } from '../workspace/tour';
import { forgetJobContents } from './contents';
import { drawCheckPages } from './pages';

/**
 * A LASER JOB'S CHECK, in the window: its inventory, then the run (pages drawn here, the rest read
 * and sent by the desktop), the graded findings, the corrections saved on approval, the tour, the
 * cut sheets and the handoff. Each view belongs to its workspace and source folder. Closing a
 * view detaches it without cancelling its run. The desktop keeps the document; the window keeps
 * open views and a bounded cache of recently visited checks.
 */
export type CheckPhase =
  | 'opening'
  /** A kept check's job compared with what the check read. */
  | 'comparing'
  | 'ready'
  | 'drawing'
  | 'asking'
  | 'checked'
  | 'failed'
  /** Nothing to check here: no DXF part, or several jobs. */
  | 'empty';
export interface CheckSession {
  workspaceID: string;
  /** The plane it was opened from, which the cut sheets open beside. */
  paneID?: string;
  /** The check's view, separate from the source folder that owns its evidence. */
  viewPaneID?: string;
  paths: string[];
  phase: CheckPhase;
  opening?: CheckOpening;
  providerID?: string;
  progress?: string;
  /** When the step `progress` names began, by this window's clock, in milliseconds. */
  since?: number;
  error?: string;
  result?: CheckResult;
  /** Drawings that could not be drawn, a sentence each. */
  problems: string[];
  /** Each saved correction's operation, by finding ID. */
  corrections: Record<string, string>;
  /** The handoff's operation. */
  handoff?: string;
  handoffError?: string;
  /** What the export does before the operation, such as nesting a thickness, while it runs. */
  handoffProgress?: string;
  /** When the step `handoffProgress` names began, by this window's clock. */
  handoffSince?: number;
  /** Why there is nothing to check, in the `empty` phase. */
  nothing?: CheckNothing;
  /** When its result came, by this window's clock. */
  checked?: number;
  /** Shown again from the checks this window keeps. */
  kept?: boolean;
  /** What changed in the job since its result, in words: the result is out of date. */
  stale?: string;
  evidencePaneIDs?: string[];
  evidenceBefore?: ProjectLayout;
  evidenceTouchedIDs?: string[];
}

/** Finished checks kept after their panel closes, newest first. */
const keptLimit = 5;
let kept: CheckSession[] = [];
let session: CheckSession | null = null;
const sessions = new Map<string, CheckSession>();
const sessionKey = (id: string, workspaceID: string) => `${workspaceID}\0${id}`;
const drawing = new Map<string, AbortController>();
const reviewing = new Map<string, symbol>();
let openingGeneration = 0;
/** The nesting an export runs before its operation. */
let nesting: AbortController | null = null;
let nestingOwner: string | undefined;
/** An export is under way, from its first nesting until its operation is queued. */
let exporting = false;
/** Whether the panel shows only its title bar: the person's choice, for this window's session. */
let collapsed = false;
/**
 * The tour the panel started, while it plays: the panel stays down to its title bar, then comes
 * back as it was before, unless the person has opened or collapsed it since.
 */
let touring: {
  tour: PlayableTour;
  before: boolean;
  changed: boolean;
  stop: () => void;
  pin?: {
    workspace: WorkspaceController;
    workspaceID: string;
    paneID: string;
    before: boolean;
    applied: boolean;
  };
} | null = null;
const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}
/** While a check is open: the end of its watch on the window's workspaces. */
let watching: (() => void) | undefined;
function change(next: CheckSession | null): void {
  session = next;
  if (next?.opening) sessions.set(sessionKey(next.opening.id, next.workspaceID), next);
  pruneSessions();
  watchWorkspace();
  notify();
}
/** A check belongs to the workspace it was opened in, and closes when that workspace closes. */
function watchWorkspace(): void {
  if (!session && !sessions.size) {
    watching?.();
    watching = undefined;
    return;
  }
  watching ??= subscribeState(() => {
    pruneSessions();
    const open = session;
    if (open) {
      const owner = getState().saved.workspaces.find((space) => space.id === open.workspaceID);
      if (!owner || (open.viewPaneID && !owner.panes.some((pane) => pane.id === open.viewPaneID)))
        closeCheck();
    }
  });
}
function pruneSessions(): void {
  const workspaces = getState().saved.workspaces;
  const open = new Set(
    workspaces.flatMap((space) =>
      space.panes.flatMap((pane) =>
        pane.type === 'check' ? [sessionKey(pane.checkID, space.id)] : [],
      ),
    ),
  );
  const recent = [...sessions.entries()]
    .reverse()
    .filter(([, item]) => workspaces.some((space) => space.id === item.workspaceID))
    .slice(0, 20);
  const retained = new Set(recent.map(([key]) => key));
  for (const [key, item] of sessions) {
    if (item === session || open.has(key) || (item.opening && drawing.has(item.opening.id)))
      continue;
    if (!retained.has(key)) {
      sessions.delete(key);
      release(item);
    }
  }
}
/** Changes the check `expected` names, unless another has replaced it since; a correction saved
 * as its panel closed reaches the check kept. */
function update(expected: CheckSession, patch: Partial<CheckSession>): void {
  const id = expected.opening?.id;
  if (
    session &&
    (session === expected ||
      (id !== undefined &&
        session.opening?.id === id &&
        session.workspaceID === expected.workspaceID))
  )
    change({ ...session, ...patch });
  else if (id !== undefined) {
    const key = sessionKey(id, expected.workspaceID);
    sessions.set(key, { ...(sessions.get(key) ?? expected), ...patch });
    kept = kept.map((item) =>
      item.opening?.id === id && item.workspaceID === expected.workspaceID
        ? { ...item, ...patch }
        : item,
    );
    notify();
  }
}
export const checkSession = (id?: string, workspaceID = activeWorkspace().id) =>
  id ? (sessions.get(sessionKey(id, workspaceID)) ?? null) : session;
export function activateCheck(id: string): void {
  const found = sessions.get(sessionKey(id, activeWorkspace().id));
  if (found && found !== session && found.workspaceID === activeWorkspace().id) change(found);
}
export const checkCollapsed = () => collapsed;
function collapse(value: boolean): void {
  if (collapsed === value) return;
  collapsed = value;
  notify();
}
/** The person opens or collapses the panel from its title bar. */
export function toggleCheckPanel(): void {
  if (touring) touring.changed = true;
  collapse(!collapsed);
}
export function subscribeCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
async function ask(request: FabricationRequest) {
  return window.viewer.fabrication(request);
}
/** Desktop ownership is per window, shared by every view and in-flight preparation here. */
function release(check: CheckSession): void {
  const id = check.opening?.id;
  if (
    !id ||
    id === session?.opening?.id ||
    drawing.has(id) ||
    kept.some((item) => item.opening?.id === id) ||
    getState().saved.workspaces.some((space) =>
      space.panes.some((pane) => pane.type === 'check' && pane.checkID === id),
    )
  )
    return;
  void ask({ kind: 'close', id }).catch(() => {});
}

/** One job, however its folder or files were listed. */
const jobKey = (paths: readonly string[]) => [...paths].sort().join('\n');
/** The finished check this window keeps for a job, if it does. */
export const keptCheck = (paths: readonly string[]) =>
  kept.find((item) => jobKey(item.paths) === jobKey(paths));
/** Keeps a finished check for this window's session; past five, the oldest ends. */
function keep(check: CheckSession): void {
  const key = jobKey(check.paths);
  const replaced = kept.filter(
    (item) => jobKey(item.paths) === key && item.opening?.id !== check.opening?.id,
  );
  kept = [check, ...kept.filter((item) => jobKey(item.paths) !== key)];
  for (const item of [...replaced, ...kept.splice(keptLimit)]) release(item);
}
/** Ends every check this window keeps. */
export function forgetChecks(): void {
  const items = kept;
  kept = [];
  for (const item of items) release(item);
  pruneSessions();
}
/** "22:14": when a check's result came. */
export const clockText = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Opens the check of a job folder or selection; a check already open ends. A job checked before
 * shows its result at once, with what changed in the job since. */
export async function openCheck(
  paths: readonly string[],
  workspaceID: string,
  paneID?: string,
  workspace?: WorkspaceController,
): Promise<void> {
  closeCheck();
  const generation = ++openingGeneration;
  const valid = () => generation === openingGeneration && activeWorkspace().id === workspaceID;
  if (workspace) {
    const saved = await ask({ kind: 'list', paths: [...paths] });
    if (!valid()) return;
    if (saved.kind === 'checks' && saved.checks[0]) {
      const restored = await loadCheck(saved.checks[0].id, workspaceID, paneID, undefined, valid);
      if (!valid()) return;
      if (restored) {
        const viewPaneID = await workspace.openCheckPlane(restored.opening!, paneID);
        update(restored, { viewPaneID });
        return;
      }
    }
  }
  const found = keptCheck(paths);
  if (found) {
    kept = kept.filter((item) => item !== found);
    if (await reopen(found, workspaceID, paneID)) {
      if (valid() && workspace && session?.opening) {
        const current = session;
        const viewPaneID = await workspace.openCheckPlane(current.opening!, paneID);
        update(current, { viewPaneID });
      }
      return;
    }
  }
  const current = await listCheck(paths, workspaceID, paneID);
  if (workspace && current?.opening && valid()) {
    const viewPaneID = await workspace.openCheckPlane(current.opening, paneID);
    update(current, { viewPaneID });
  }
}

/** Reopening a view only reads its saved result and checks source identities. */
export async function loadCheck(
  id: string,
  workspaceID: string,
  paneID?: string,
  viewPaneID?: string,
  stillCurrent: () => boolean = () => true,
  refresh = false,
): Promise<CheckSession | undefined> {
  const key = sessionKey(id, workspaceID);
  const cached = sessions.get(key);
  if (!refresh && viewPaneID && cached?.workspaceID === workspaceID) {
    if (!stillCurrent()) return;
    const current = { ...cached, viewPaneID, paneID: paneID ?? cached.paneID };
    sessions.set(key, current);
    notify();
    return current;
  }
  const reply = await ask({ kind: 'read', id });
  if (!stillCurrent()) return;
  if (reply.kind !== 'saved') throw new Error('The saved check is unavailable.');
  const found = sessions.get(key);
  // A local page-rendering step may precede the desktop run. Its existing request owns completion.
  const preparing = drawing.has(id) && found && ['drawing', 'asking'].includes(found.phase);
  const current: CheckSession = {
    workspaceID,
    paneID,
    viewPaneID,
    paths: found?.paths ?? reply.paths,
    opening: reply.opening,
    providerID: found?.providerID ?? reply.opening.providerID,
    phase: reply.result
      ? 'checked'
      : reply.status === 'ready'
        ? 'ready'
        : reply.status === 'running'
          ? 'asking'
          : 'failed',
    progress: reply.status === 'running' ? 'The check is running' : undefined,
    result: reply.result,
    error:
      reply.error ??
      (reply.status === 'interrupted'
        ? 'The previous run was interrupted. Run again when you are ready.'
        : undefined),
    problems: [],
    corrections: reply.corrections ?? {},
    handoff: reply.handoffs?.at(-1),
    checked: reply.updated,
    kept: !!reply.result,
    stale: reply.changes.length
      ? changesText(reply.changes, clockText(reply.updated))
      : reply.result
        ? reply.error
        : undefined,
    evidencePaneIDs: found?.evidencePaneIDs,
    evidenceBefore: found?.evidenceBefore,
    evidenceTouchedIDs: found?.evidenceTouchedIDs,
    ...(preparing
      ? {
          phase: found.phase,
          result: found.result,
          progress: found.progress,
          since: found.since,
          error: found.error,
          kept: found.kept,
          checked: found.checked,
        }
      : {}),
  };
  sessions.set(key, current);
  if (activeWorkspace().id === workspaceID && (!viewPaneID || getState().activePane === viewPaneID))
    change(current);
  else notify();
  return current;
}

/** Shows a kept check again once the desktop says what changed in its job; false when the desktop
 * no longer holds it. */
async function reopen(
  found: CheckSession,
  workspaceID: string,
  paneID: string | undefined,
): Promise<boolean> {
  const comparing: CheckSession = { ...found, workspaceID, paneID, phase: 'comparing' };
  change(comparing);
  try {
    const reply = await ask({ kind: 'changes', id: found.opening!.id });
    if (reply.kind !== 'changes') throw new Error('The job could not be compared.');
    if (session === comparing)
      change({
        ...comparing,
        phase: 'checked',
        kept: true,
        stale: reply.changes.length
          ? changesText(reply.changes, clockText(found.checked ?? Date.now()))
          : undefined,
      });
    return true;
  } catch {
    // the desktop no longer holds it, or cannot list the job: it is listed afresh
    const id = found.opening!.id;
    kept = kept.filter((item) => item.opening?.id !== id);
    const replaced = session !== comparing;
    if (!replaced) change(null);
    release(found);
    return replaced;
  }
}

/** Lists a job afresh for checking: what will be sent, or why there is nothing to check. The
 * session once it is ready. */
async function listCheck(
  paths: readonly string[],
  workspaceID: string,
  paneID?: string,
  providerID?: string,
): Promise<CheckSession | undefined> {
  const opening: CheckSession = {
    workspaceID,
    ...(paneID ? { paneID } : {}),
    paths: [...paths],
    phase: 'opening',
    problems: [],
    corrections: {},
  };
  change(opening);
  try {
    const reply = await ask({ kind: 'open', paths: [...paths] });
    if (reply.kind === 'nothing') {
      // whatever offered the check counted otherwise: count again next time
      for (const path of paths) forgetJobContents(path);
      if (session === opening) change({ ...opening, phase: 'empty', nothing: reply });
      return undefined;
    }
    if (reply.kind !== 'opened') throw new Error('The job could not be listed.');
    if (session !== opening) {
      void ask({ kind: 'close', id: reply.id }).catch(() => {});
      return undefined;
    }
    const chosen = reply.providers.some((item) => item.id === providerID)
      ? providerID
      : reply.providerID;
    const ready: CheckSession = { ...opening, phase: 'ready', opening: reply, providerID: chosen };
    change(ready);
    return ready;
  } catch (error) {
    if (session === opening) change({ ...opening, phase: 'failed', error: errorMessage(error) });
    return undefined;
  }
}
export function chooseCheckProvider(providerID: string, current = session): void {
  if (current) update(current, { providerID });
}

/** Draws the drawings' pages, then asks the desktop to send the job and check the answer. A job
 * changed since its result is listed again first, as it is now. */
export async function runCheck(current = session): Promise<void> {
  if (!current?.opening || !current.providerID || ['drawing', 'asking'].includes(current.phase))
    return;
  if (current.stale) {
    const listed = await listCheck(
      current.paths,
      current.workspaceID,
      current.paneID,
      current.providerID,
    );
    if (listed && session === listed) {
      if (current.viewPaneID && listed.opening && activeWorkspace().id === current.workspaceID) {
        updatePane(current.viewPaneID, { checkID: listed.opening.id, title: listed.opening.job });
        update(listed, { viewPaneID: current.viewPaneID });
      }
      release(current);
      await runCheck();
    }
    return;
  }
  const { opening, providerID } = current;
  const provider = getState().settings.settings.providers.find((item) => item.id === providerID);
  if (nestingOwner === opening.id) nesting?.abort();
  drawing.get(opening.id)?.abort();
  const abort = new AbortController();
  drawing.set(opening.id, abort);
  const running: CheckSession = {
    ...current,
    phase: 'drawing',
    progress: 'Drawing the drawings’ pages',
    since: Date.now(),
    error: undefined,
    result: undefined,
    problems: [],
    corrections: {},
    handoff: undefined,
    handoffError: undefined,
    handoffProgress: undefined,
    handoffSince: undefined,
    checked: undefined,
    kept: undefined,
  };
  change(running);
  // The desktop says what it does while it runs: the model reading, then SAM outlining.
  const stop = window.viewer.onEvent((event) => {
    if (event.type === 'fabrication' && event.progress.id === opening.id)
      update(running, { progress: event.progress.text, since: Date.now() });
  });
  try {
    const { pages, problems } = await drawCheckPages(opening.sources, abort.signal, (progress) =>
      update(running, { progress }),
    );
    update(running, {
      phase: 'asking',
      problems,
      progress: `Preparing the job for ${provider?.name ?? 'the model'}${provider?.model ? ` (${provider.model})` : ''}`,
      since: Date.now(),
    });
    const reply = await ask({ kind: 'run', id: opening.id, providerID, pages });
    if (reply.kind !== 'result') throw new Error('The check did not answer.');
    update(running, {
      phase: 'checked',
      result: reply,
      checked: Date.now(),
      progress: undefined,
      since: undefined,
    });
  } catch (error) {
    update(running, {
      phase: 'failed',
      progress: undefined,
      since: undefined,
      error: abort.signal.aborted
        ? 'The check was cancelled. Nothing was graded.'
        : errorMessage(error),
    });
  } finally {
    stop();
    if (drawing.get(opening.id) === abort) drawing.delete(opening.id);
    release(running);
  }
}
export function cancelCheck(current = session): void {
  const id = current?.opening?.id;
  if (id) drawing.get(id)?.abort();
  if (id) void ask({ kind: 'cancel', id }).catch(() => {});
}
/** Detaches a view; only explicit Cancel stops a run or export. The desktop retains its document. */
export function closeCheck(current = session): void {
  openingGeneration++;
  if (current === session) change(null);
  if (!current?.opening) return;
  if (current.result) keep(current);
  else release(current);
}

/** Saves a finding's reviewed correction through File operations, beside its DXF. */
export async function saveCorrection(finding: CheckFinding, current = session): Promise<void> {
  const correction = finding.correction;
  if (!current || !correction || current.stale) return;
  const reply = await ask({
    kind: 'correct',
    id: current.opening!.id,
    finding: finding.finding.id,
  });
  if (reply.kind !== 'operation') throw new Error('The correction could not be started.');
  const id = reply.id;
  update(current, { corrections: { ...current.corrections, [finding.finding.id]: id } });
}

export async function confirmRequirement(
  current: CheckSession,
  key: string,
  value: number,
  unit: RequirementUnit,
): Promise<void> {
  if (!current.opening || current.stale)
    throw new Error('Check the current source before confirming its requirement.');
  const reply = await ask({ kind: 'confirm', id: current.opening.id, key, value, unit });
  if (reply.kind !== 'result') throw new Error('The requirement could not be confirmed.');
  update(current, { result: reply });
}

function evidenceFor(current: CheckSession, item?: CheckFinding): EvidenceNavigation[] {
  const result = current.result,
    opening = current.opening;
  if (!result || !opening) return [];
  const finding = item ?? result.findings.find((entry) => entry.correction) ?? result.findings[0];
  const refs = [
    ...new Set(
      [
        finding?.finding.drawing?.ref,
        finding?.finding.dxf?.ref,
        finding?.finding.photo?.ref,
        finding?.request?.ref,
      ].filter((ref): ref is string => !!ref),
    ),
  ];
  const sources = (
    refs.length
      ? refs.flatMap((ref) => {
          const source = opening.sources.find((item) => item.ref === ref);
          return source ? [source] : [];
        })
      : opening.sources.filter((source) => ['drawing', 'dxf', 'request'].includes(source.kind))
  ).slice(0, 4);
  // An order is useful context, but the selected drawing and part always lead the comparison.
  const request = opening.sources.find((source) => source.kind === 'request');
  if (request && sources.length < 4 && !sources.includes(request)) sources.push(request);
  return sources.map((source) => {
    const stop = result.tour.stops.find((stop) => {
      if (stop.target.kind !== 'file') return false;
      const file = `${result.tour.root.replace(/[\\/]$/, '')}/${stop.target.path}`.replace(
        /\\/g,
        '/',
      );
      return (
        file === source.path.replace(/\\/g, '/') &&
        (!finding || !stop.finding || stop.finding.id === finding.finding.id)
      );
    });
    const target = stop?.target.kind === 'file' ? stop.target : undefined;
    const quote =
      target?.quote ??
      (source.ref === finding?.finding.drawing?.ref ? finding.finding.drawing.quote : '') ??
      '';
    return {
      path: source.path,
      version: source.version,
      quote,
      anchor:
        target?.anchor ??
        (source.kind === 'drawing'
          ? { kind: 'pdf', page: finding?.finding.drawing?.page ?? 1 }
          : source.kind === 'dxf'
            ? { kind: 'dxf', entities: finding?.finding.dxf?.entities ?? [] }
            : source.kind === 'photo'
              ? { kind: 'image', x: 0, y: 0, width: 1, height: 1 }
              : { kind: 'text', line: 1, start: 0, end: quote.length }),
    };
  });
}

/** One explicit review assembles only its captured, versioned sources, then lays them out to read. */
export async function reviewEvidence(
  workspace: WorkspaceController,
  current: CheckSession,
  finding?: CheckFinding,
): Promise<void> {
  if (!current.opening || !current.result || current.stale) return;
  const owner = current.workspaceID;
  const key = sessionKey(current.opening.id, owner);
  const request = Symbol('evidence review');
  reviewing.set(key, request);
  const parent = current.paneID ?? current.viewPaneID;
  const root = parent && workspace.rootID(parent);
  const valid = () => {
    if (reviewing.get(key) !== request)
      throw new Error('A newer evidence review replaced this one.');
    if (
      activeWorkspace().id !== owner ||
      (parent &&
        (!activeWorkspace().panes.some((pane) => pane.id === parent) ||
          workspace.rootID(parent) !== root))
    )
      throw new Error(
        'The originating workspace or folder changed. Open the evidence there again.',
      );
  };
  valid();
  const changes = await ask({ kind: 'changes', id: current.opening.id });
  if (changes.kind !== 'changes') throw new Error('The evidence could not be checked.');
  if (changes.changes.length) {
    const stale = changesText(changes.changes, clockText(current.checked ?? Date.now()));
    update(current, { stale });
    throw new Error(stale);
  }
  const ids: string[] = [];
  for (const evidence of evidenceFor(current, finding)) {
    valid();
    ids.push(await workspace.openEvidence(evidence, parent, { frame: false }));
  }
  valid();
  if (ids.length < 2)
    throw new Error('This finding needs at least two available sources for a comparison.');
  await workspace.whenPanesReady(ids);
  valid();
  const captured = workspace.captureLayout();
  const latest = checkSession(current.opening.id, owner) ?? current;
  const before = latest.evidenceBefore;
  const evidenceBefore = before
    ? {
        ...before,
        placements: [
          ...before.placements,
          ...captured.placements.filter(
            (item) => !before.placements.some((previous) => previous.id === item.id),
          ),
        ],
      }
    : captured;
  if (current.viewPaneID && window.innerWidth < 1200)
    workspace.collapsePinnedPane(current.viewPaneID, true);
  await workspace.comparePanes(ids);
  valid();
  update(current, {
    evidencePaneIDs: ids,
    evidenceBefore,
    evidenceTouchedIDs: [...new Set([...(latest.evidenceTouchedIDs ?? []), ...ids])],
  });
}

export function stackEvidence(workspace: WorkspaceController, current: CheckSession): void {
  if (!current.evidencePaneIDs?.length) return;
  if (activeWorkspace().id !== current.workspaceID)
    throw new Error('Return to the check’s workspace to arrange its evidence.');
  if (!workspace.stackPanes(current.evidencePaneIDs))
    throw new Error('The evidence could not be stacked. Place any pinned evidence in space first.');
}

export function restoreEvidenceArrangement(
  workspace: WorkspaceController,
  current: CheckSession,
): void {
  if (!current.evidenceBefore || activeWorkspace().id !== current.workspaceID) return;
  workspace.restorePaneLayout(
    current.evidenceBefore,
    current.evidenceTouchedIDs ?? current.evidencePaneIDs ?? [],
  );
  update(current, {
    evidenceBefore: undefined,
    evidencePaneIDs: undefined,
    evidenceTouchedIDs: undefined,
  });
}
/** The corrected copies saved so far: each original's copy, by path. */
export function correctedCopies(
  current: CheckSession,
  jobs: readonly OperationJob[],
): Map<string, string> {
  const copies = new Map<string, string>();
  for (const finding of current.result?.findings ?? []) {
    const job = jobs.find((item) => item.id === current.corrections[finding.finding.id]);
    const made = job?.status === 'completed' ? job.completed[0]?.destination : undefined;
    if (finding.correction && made) copies.set(finding.correction.source, made);
  }
  return copies;
}

/** What the cut sheets nest: each part, its corrected copy in its place, with the request's
 * quantity and thickness when it gives them. */
export function cutSheets(current: CheckSession, jobs: readonly OperationJob[]) {
  const copies = correctedCopies(current, jobs);
  const parts: (PartPlan & { cut: string })[] = (current.result?.parts ?? []).map((part) => ({
    ...part,
    cut: copies.get(part.path) ?? part.path,
  }));
  const quantities: Record<string, number> = {};
  const thicknesses: Record<string, number> = {};
  for (const part of parts) {
    if (part.quantity) quantities[part.cut] = part.quantity.sets;
    if (part.thickness) thicknesses[part.cut] = part.thickness.value;
  }
  return { parts, copies, quantities, thicknesses };
}
/** Opens the Nesting plane on the job's parts, with the quantities and thicknesses reconciled. */
export async function prepareCutSheets(
  workspace: WorkspaceController,
  current = session,
): Promise<void> {
  if (!current?.result || current.stale) return;
  if (activeWorkspace().id !== current.workspaceID)
    throw new Error('This check belongs to another workspace. Check the job here again.');
  const verified = await ask({ kind: 'validate', id: current.opening!.id });
  if (verified.kind !== 'result') throw new Error('The check could not be validated.');
  if (activeWorkspace().id !== current.workspaceID)
    throw new Error('The workspace changed. Open the cut sheets again.');
  current = { ...current, result: verified };
  const { parts, quantities, thicknesses } = cutSheets(current, getState().jobs);
  const paneID = activeWorkspace().panes.some((pane) => pane.id === current.paneID)
    ? current.paneID
    : undefined;
  workspace.openLayout(
    parts.map((part) => part.cut),
    paneID,
    'nesting',
    { quantities, thicknesses },
  );
}
/** Plays the check's tour with the panel down to its title bar, so the plane each stop shows is
 * in view; the panel comes back as it was when the tour ends or stops. */
export function playCheckTour(workspace: WorkspaceController, current = session): void {
  const tour = current?.result?.tour;
  if (
    !current ||
    !tour?.stops.length ||
    current.stale ||
    activeWorkspace().id !== current.workspaceID
  )
    return;
  const playable: PlayableTour = { name: tour.name, root: tour.root, stops: tour.stops };
  // played again before the last one ended: the panel comes back as it was before either
  const before = touring && !touring.changed ? touring.before : collapsed;
  restoreTourPin();
  touring?.stop();
  touring = null;
  collapse(true);
  playTour(workspace, playable);
  const paneID = current.viewPaneID;
  const pin = paneID ? workspace.planePinState(paneID) : undefined;
  touring = {
    tour: playable,
    before,
    changed: false,
    stop: subscribeTour(followTour),
    ...(paneID && pin?.pinned
      ? {
          pin: {
            workspace,
            workspaceID: current.workspaceID,
            paneID,
            before: pin.collapsed,
            applied: workspace.collapsePinnedPane(paneID, true),
          },
        }
      : {}),
  };
  followTour();
}
function restoreTourPin(): void {
  const pin = touring?.pin;
  if (!pin?.applied || activeWorkspace().id !== pin.workspaceID) return;
  const now = pin.workspace.planePinState(pin.paneID);
  // An expanded or placed panel is the person's newer choice.
  if (now.pinned && now.collapsed) pin.workspace.collapsePinnedPane(pin.paneID, pin.before);
  pin.applied = false;
}
/** Keeps the panel down while its tour plays and puts it back when the tour ends or stops; Play
 * again on the end card puts it down again. */
function followTour(): void {
  if (!touring) return;
  const playback = tourPlayback();
  const own = playback?.tour === touring.tour ? playback : undefined;
  if (!touring.changed) collapse(own && own.status !== 'ended' ? true : touring.before);
  if (!own || own.status === 'ended') restoreTourPin();
  else if (
    touring.pin &&
    !touring.pin.applied &&
    activeWorkspace().id === touring.pin.workspaceID
  ) {
    const pin = touring.pin;
    pin.before = pin.workspace.planePinState(pin.paneID).collapsed;
    pin.applied = pin.workspace.collapsePinnedPane(pin.paneID, true);
  }
  if (own) return;
  touring.stop();
  touring = null;
}

/**
 * The nestings the handoff would save, what keeps others out, the thicknesses the export nests
 * first, grouped as the Layout plane groups the cut sheets, and why it cannot, when it cannot.
 */
export function handoffNestings(
  current: CheckSession,
  jobs: readonly OperationJob[],
  prepared: readonly HandoffNesting[] = preparedNestings(),
): HandoffNestings & { hold?: string } {
  const { parts, copies, thicknesses } = cutSheets(current, jobs);
  const chosen = chooseNestings(
    prepared,
    parts.map((part) => part.cut),
    copies,
    (file) => thicknesses[file],
  );
  const hold = chosen.missing.length ? nestingHold(parts, chosen.missing) : undefined;
  return hold ? { ...chosen, hold } : chosen;
}
/**
 * Saves the handoff folder in the job's folder through File operations. A thickness no Layout
 * plane has nested is nested first, as the plane starts it; when one cannot be, nothing is saved.
 */
export async function exportHandoff(current = session): Promise<void> {
  if (!current?.opening || !current.result || current.stale || exporting) return;
  exporting = true;
  try {
    const verified = await ask({ kind: 'validate', id: current.opening.id });
    if (verified.kind !== 'result') throw new Error('The check could not be validated.');
    current = { ...current, result: verified };
    await saveHandoff(current);
  } finally {
    exporting = false;
  }
}
async function saveHandoff(current: CheckSession): Promise<void> {
  if (!current.opening) return;
  const before = handoffNestings(current, getState().jobs);
  if (before.hold) return update(current, { handoffError: before.hold });
  if (before.missing.length && !(await nestMissing(current, before.missing))) return;
  const jobs = getState().jobs;
  const { nestings, missing } = handoffNestings(current, jobs);
  if (missing.length)
    return update(current, {
      handoffError: `${listText(missing.map((group) => group.label))} could not be nested. Nothing was exported.`,
    });
  const { opening } = current;
  try {
    const corrected: HandoffFile[] = [];
    for (const file of correctedCopies(current, jobs).values())
      corrected.push({ path: file, version: sourceVersion(await window.viewer.stat(file)) });
    const files: HandoffFile[] = [
      ...opening.sources.map((source) => ({ path: source.path, version: source.version })),
      ...corrected,
    ];
    const id = await window.viewer.operate(
      handoffOperation({
        check: opening.id,
        folder: opening.folder,
        job: opening.job,
        files,
        nestings,
      }),
    );
    update(current, { handoff: id, handoffError: undefined });
  } catch (error) {
    update(current, { handoffError: errorMessage(error) });
  }
}
/**
 * Nests each thickness `missing` names as the Layout plane starts it, saying which one and how
 * much while it runs; false, with why, when one cannot be nested or the person cancels.
 */
async function nestMissing(
  current: CheckSession,
  missing: readonly ThicknessGroup<string>[],
): Promise<boolean> {
  const { parts, quantities, thicknesses } = cutSheets(current, getState().jobs);
  nesting?.abort();
  const abort = new AbortController();
  nesting = abort;
  nestingOwner = current.opening?.id;
  const step = (text: string) =>
    update(current, { handoffProgress: text, handoffSince: Date.now() });
  update(current, { handoffError: undefined });
  step(`Nesting ${listText(missing.map((group) => group.label))}…`);
  try {
    await nestWithoutPlane(
      parts.map((part) => part.cut),
      { quantities, thicknesses },
      new Set(missing.map((group) => group.key)),
      abort.signal,
      step,
    );
    update(current, { handoffProgress: undefined, handoffSince: undefined });
    return true;
  } catch (error) {
    update(current, {
      handoffProgress: undefined,
      handoffSince: undefined,
      handoffError: abort.signal.aborted
        ? 'The nesting was cancelled. Nothing was exported.'
        : `${errorMessage(error)} Nothing was exported.`,
    });
    return false;
  } finally {
    if (nesting === abort) {
      nesting = null;
      nestingOwner = undefined;
    }
  }
}
/** Stops the nesting an export runs first; nothing is exported. */
export function cancelHandoff(current = session): void {
  if (nestingOwner === current?.opening?.id) nesting?.abort();
}
