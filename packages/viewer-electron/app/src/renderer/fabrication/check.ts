import type { OperationJob } from '../../domain/contracts';
import type {
  CheckFinding,
  CheckNothing,
  CheckOpening,
  CheckResult,
  FabricationRequest,
} from '../../domain/fabrication/check';
import type { HandoffFile } from '../../domain/fabrication/handoff';
import type { PartPlan } from '../../domain/fabrication/reconcile';
import type { WorkspaceController } from '../workspace/context';
import { chooseNestings, handoffOperation } from '../../domain/fabrication/handoff';
import { changesText } from '../../domain/fabrication/job-files';
import { sourceVersion } from '../../domain/files/inspection';
import { parentPath } from '../../domain/workspaces/planes';
import { errorMessage } from '../../domain/errors';
import { activeWorkspace, getState } from '../state/store';
import { preparedNestings } from '../layout/nesting/prepared';
import { playTour } from '../workspace/tour';
import { forgetJobContents } from './contents';
import { drawCheckPages } from './pages';

/**
 * A LASER JOB'S CHECK, in the window: its inventory, then the run (pages drawn here, the rest read
 * and sent by the desktop), the graded findings, the corrections saved on approval, the tour, the
 * cut sheets and the handoff. One check is open at a time; the desktop keeps its record. A finished
 * check stays after its panel closes, the last five for this window's session, and reopening its
 * job shows it at once, or says what changed in the job since.
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
  /** Why there is nothing to check, in the `empty` phase. */
  nothing?: CheckNothing;
  /** When its result came, by this window's clock. */
  checked?: number;
  /** Shown again from the checks this window keeps. */
  kept?: boolean;
  /** What changed in the job since its result, in words: the result is out of date. */
  stale?: string;
}

/** Finished checks kept after their panel closes, newest first. */
const keptLimit = 5;
let kept: CheckSession[] = [];
let session: CheckSession | null = null;
let drawing: AbortController | null = null;
const listeners = new Set<() => void>();
function change(next: CheckSession | null): void {
  session = next;
  for (const listener of listeners) listener();
}
/** Changes the check `expected` names, unless another has replaced it since; a correction saved
 * as its panel closed reaches the check kept. */
function update(expected: CheckSession, patch: Partial<CheckSession>): void {
  const id = expected.opening?.id;
  if (session && (session === expected || (id !== undefined && session.opening?.id === id)))
    change({ ...session, ...patch });
  else if (id !== undefined)
    kept = kept.map((item) => (item.opening?.id === id ? { ...item, ...patch } : item));
}
export const checkSession = () => session;
export function subscribeCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
async function ask(request: FabricationRequest) {
  return window.viewer.fabrication(request);
}
/** Ends a check's record in the desktop, unless it is the one open. */
function release(check: CheckSession): void {
  const id = check.opening?.id;
  if (id && id !== session?.opening?.id) void ask({ kind: 'close', id }).catch(() => {});
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
): Promise<void> {
  closeCheck();
  const found = keptCheck(paths);
  if (found) {
    kept = kept.filter((item) => item !== found);
    if (await reopen(found, workspaceID, paneID)) return;
  }
  await listCheck(paths, workspaceID, paneID);
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
    void ask({ kind: 'close', id }).catch(() => {});
    return session !== comparing;
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
export function chooseCheckProvider(providerID: string): void {
  if (session) change({ ...session, providerID });
}

/** Draws the drawings' pages, then asks the desktop to send the job and check the answer. A job
 * changed since its result is listed again first, as it is now. */
export async function runCheck(): Promise<void> {
  const current = session;
  if (!current?.opening || !current.providerID || ['drawing', 'asking'].includes(current.phase))
    return;
  if (current.stale) {
    void ask({ kind: 'close', id: current.opening.id }).catch(() => {});
    const listed = await listCheck(
      current.paths,
      current.workspaceID,
      current.paneID,
      current.providerID,
    );
    if (listed && session === listed) await runCheck();
    return;
  }
  const { opening, providerID } = current;
  const provider = getState().settings.settings.providers.find((item) => item.id === providerID);
  drawing?.abort();
  const abort = new AbortController();
  drawing = abort;
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
    if (drawing === abort) drawing = null;
  }
}
export function cancelCheck(): void {
  drawing?.abort();
  const id = session?.opening?.id;
  if (id) void ask({ kind: 'cancel', id }).catch(() => {});
}
/** Closes the panel. A finished check is kept, so that a paid answer is not thrown away; one
 * without a result ends, and a run still going stops. */
export function closeCheck(): void {
  drawing?.abort();
  const current = session;
  change(null);
  if (!current?.opening) return;
  if (current.result) keep(current);
  else void ask({ kind: 'close', id: current.opening.id }).catch(() => {});
}

/** Saves a finding's reviewed correction through File operations, beside its DXF. */
export async function saveCorrection(finding: CheckFinding): Promise<void> {
  const current = session;
  const correction = finding.correction;
  if (!current || !correction || current.stale) return;
  const id = await window.viewer.operate({
    kind: 'convert',
    sources: [correction.source],
    destination: parentPath(correction.source),
    name: correction.name,
    transform: correction.plan,
    expectedSources: [{ path: correction.source, version: correction.version }],
  });
  update(current, { corrections: { ...current.corrections, [finding.finding.id]: id } });
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
export function prepareCutSheets(workspace: WorkspaceController): void {
  const current = session;
  if (!current?.result || current.stale) return;
  if (activeWorkspace().id !== current.workspaceID)
    throw new Error('This check belongs to another workspace. Check the job here again.');
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
export function playCheckTour(workspace: WorkspaceController): void {
  const tour = session?.result?.tour;
  if (!tour?.stops.length || session?.stale) return;
  playTour(workspace, { name: tour.name, root: tour.root, stops: tour.stops });
}

/** The nestings the handoff would save, and what keeps others out. */
export function handoffNestings(current: CheckSession, jobs: readonly OperationJob[]) {
  const { parts, copies } = cutSheets(current, jobs);
  return chooseNestings(
    preparedNestings(),
    parts.map((part) => part.cut),
    copies,
  );
}
/** Saves the handoff folder in the job's folder through File operations. */
export async function exportHandoff(): Promise<void> {
  const current = session;
  if (!current?.opening || !current.result || current.stale) return;
  const jobs = getState().jobs;
  const copies = correctedCopies(current, jobs);
  const corrected: HandoffFile[] = [];
  for (const file of copies.values())
    corrected.push({ path: file, version: sourceVersion(await window.viewer.stat(file)) });
  const files: HandoffFile[] = [
    ...current.opening.sources.map((source) => ({ path: source.path, version: source.version })),
    ...corrected,
  ];
  try {
    const id = await window.viewer.operate(
      handoffOperation({
        check: current.opening.id,
        folder: current.opening.folder,
        job: current.opening.job,
        files,
        nestings: handoffNestings(current, jobs).nestings,
      }),
    );
    update(current, { handoff: id, handoffError: undefined });
  } catch (error) {
    update(current, { handoffError: errorMessage(error) });
  }
}
