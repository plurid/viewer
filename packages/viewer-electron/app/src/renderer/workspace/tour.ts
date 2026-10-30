import type { WorkspaceController } from './context';
import type { EvidenceNavigation } from '../../domain/files/inspection';
import type { TourDocument, TourStop, TourTiming } from '../../domain/tours/tour';
import { isDefinitionFile, tourFileName } from '../../domain/tours/tour';
import { normalizedPanePath } from '../../domain/workspaces/planes';
import { activeWorkspace, getState, subscribe } from '../state/core';
import { updatePane } from '../state/panes';
import { effectiveWindowSettings } from '../state/effective-ui';
import { TourPlayer, type PlayableTour, type TourPlayback, type TourPorts } from './tours/player';
import type { TourStage } from './tours/stage';
import { overlayOpen } from '../ui/modal';

/**
 * TOURS: stops shown in turn, each flown to and held for a while. A tour file's stops open files
 * at a place in them; "Tour the views" makes one of the space's saved views. One player runs at a
 * time, in the workspace it started in. Escape stops it, ← and → step, Space pauses; a click or
 * scroll in the space pauses it, and Resume brings the stop back into view.
 */
let player: TourPlayer | null = null;
let playback: TourPlayback | null = null;
/** The running tour's hold on the window: what it watches, and where focus was when it began. */
let session: { release: () => void; focus: Element | null } | null = null;
/** The tour file opened or saved last in this window: what Present plays. */
let opened: { tour: PlayableTour; document: TourDocument } | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The running or just finished tour, for the tour bar. */
export const tourPlayback = (): TourPlayback | null => playback;
export const tourActive = () => !!playback && playback.status !== 'ended';
/** Outlines draw once the camera is at rest at their stop; with no tour flying, at once. */
export const tourAtRest = () => playback?.status !== 'travelling';
/** The tour file opened or saved last, as read: for editing its stops. */
export const openedTour = () => opened?.document;
export const tourControls = {
  next: () => player?.next(),
  previous: () => player?.previous(),
  pause: () => player?.pause(),
  resume: () => player?.resume(),
  toggle: () => (playback?.paused ? player?.resume() : player?.pause()),
  restart: () => player?.play(0),
};

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
/** Space presses these; the tour leaves it to them. */
const pressable = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]',
  );
const inSpace = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('.workspace-surface');
const keys = (event: KeyboardEvent) => {
  // A dialog, the palette or a menu keeps its own keys, Escape first.
  if (
    !playback ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    editable(event.target) ||
    overlayOpen()
  )
    return;
  if (event.key === 'Escape') stopTour();
  // The end card has only Close: every other key belongs to the window again.
  else if (playback.status === 'ended') return;
  // Paused, the person is working in a plane: its own keys are theirs again.
  else if (playback.paused && inSpace(event.target)) return;
  else if (event.key === 'ArrowRight') tourControls.next();
  else if (event.key === 'ArrowLeft') tourControls.previous();
  else if (event.key === ' ' && !pressable(event.target)) tourControls.toggle();
  else return;
  event.preventDefault();
  event.stopPropagation();
};
const takeOver = (event: Event) => {
  if (tourActive() && inSpace(event.target)) tourControls.pause();
};
function listen(on: boolean): void {
  if (on) {
    window.addEventListener('keydown', keys, true);
    window.addEventListener('pointerdown', takeOver, true);
    window.addEventListener('wheel', takeOver, { capture: true, passive: true });
  } else {
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('pointerdown', takeOver, true);
    window.removeEventListener('wheel', takeOver, true);
  }
}
/** Gives focus back to where it was when the tour began, unless the person has moved it. */
function returnFocus(target: Element | null | undefined): void {
  if (!(target instanceof HTMLElement) || !target.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('.tour-bar')) return;
  target.focus({ preventScroll: true });
}

/** Ends the tour and puts its bar away. */
export function stopTour(): void {
  player?.stop();
  player = null;
  const ended = session;
  session = null;
  ended?.release();
  if (!playback) return;
  playback = null;
  listen(false);
  notify();
  returnFocus(ended?.focus);
}
/** Clears what a stop marked in a plane, unless something else has marked it since. */
function unmark(marked: { paneID: string; evidence: EvidenceNavigation }): void {
  const pane = activeWorkspace().panes.find((item) => item.id === marked.paneID);
  if (pane?.type === 'preview' && pane.evidence === marked.evidence)
    updatePane(marked.paneID, { evidence: undefined });
}
function ports(workspace: WorkspaceController, timing: TourTiming, stage: TourStage): TourPorts {
  // the plane the last stop marked, and what it marked
  let marked: { paneID: string; evidence: EvidenceNavigation } | undefined;
  return {
    lookup: (root, path, hash) => window.viewer.tour({ kind: 'stat', root, path, hash }),
    open(entry, evidence) {
      if (isDefinitionFile(entry.name)) return;
      // the key is given even when empty: a plane already open loses the last stop's mark
      workspace.open(entry, undefined, { evidence, frame: !stage.frames });
      const platform = getState().bootstrap.platform;
      const pane = activeWorkspace().panes.find((item) => item.id === getState().activePane);
      const paneID =
        pane && normalizedPanePath(pane.path, platform) === normalizedPanePath(entry.path, platform)
          ? pane.id
          : undefined;
      // leaving a plane takes the stop's outline or highlight with it
      if (marked && marked.paneID !== paneID) unmark(marked);
      marked = paneID && evidence ? { paneID, evidence } : undefined;
      return paneID;
    },
    leave() {
      if (marked) unmark(marked);
      marked = undefined;
    },
    views: () => workspace.bookmarks().map((view) => view.name),
    timing: () => timing,
    reducedMotion: () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
/**
 * Stops the tour when its workspace is no longer the window's (deleted, restored over, or a
 * project installed), and tells the player when the plane showing its stop closes.
 */
function watch(own: TourPlayer, workspaceID: string): () => void {
  return subscribe(() => {
    if (player !== own) return;
    const space = activeWorkspace();
    if (space.id !== workspaceID) return stopTour();
    const pane = own.shownPane;
    if (pane && !space.panes.some((item) => item.id === pane)) own.closed(pane);
  });
}
/** Plays a tour from its first stop, replacing any tour that runs. */
export function playTour(
  workspace: WorkspaceController,
  tour: PlayableTour,
  timing: TourTiming = effectiveWindowSettings(getState()).tour,
  from = 0,
): void {
  const focus = session?.focus ?? document.activeElement;
  stopTour();
  const stage = workspace.tourStage();
  const own: TourPlayer = new TourPlayer(stage, ports(workspace, timing, stage), tour, (next) => {
    if (player !== own) return;
    playback = next;
    notify();
  });
  player = own;
  playback = own.playback;
  session = { release: watch(own, activeWorkspace().id), focus };
  // after the key or click that started it, so that one does not pause or stop it
  setTimeout(() => {
    if (player === own) listen(true);
  }, 0);
  notify();
  own.play(from);
}
/** The saved views as a tour, each shown for the Tour setting's time. */
export function viewsTour(workspace: WorkspaceController, timing: TourTiming): PlayableTour {
  const views = workspace.bookmarks();
  if (!views.length) throw new Error('Save a view first: ⌃⌥⌘1–9, or Save view… in the palette.');
  return {
    name: 'Saved views',
    dwell: timing.dwell,
    stops: views.map((view, index): TourStop => ({
      id: `view-${index + 1}`,
      caption: view.label,
      source: 'recorded',
      target: { kind: 'view', bookmark: view.name },
    })),
  };
}
/** TOUR THE VIEWS: the space's saved views in turn. */
export function startTour(workspace: WorkspaceController, timing: TourTiming): void {
  playTour(workspace, viewsTour(workspace, timing), timing);
}
export function playableTour(document: TourDocument): PlayableTour {
  return {
    name: document.definition.name || tourFileName(document.file),
    root: document.root,
    file: document.file,
    dwell: document.definition.dwell,
    stops: document.definition.stops,
  };
}
/** Opening a tour file plays it. Reading it never runs anything; its stops only open files. */
export async function openTourFile(workspace: WorkspaceController, file: string): Promise<void> {
  const workspaceID = activeWorkspace().id;
  const document = await window.viewer.tour({ kind: 'read', file });
  if (activeWorkspace().id !== workspaceID)
    throw new Error(
      `The workspace changed while the tour “${tourFileName(file)}” opened. Open it again.`,
    );
  rememberTour(document);
  playTour(workspace, playableTour(document));
}
/** Keeps a tour opened or just saved as the one Present plays. */
export function rememberTour(document: TourDocument): void {
  opened = { tour: playableTour(document), document };
}
/** PRESENT: the tour opened last, else the saved views. False when there is neither. */
export function presentTour(workspace: WorkspaceController, timing: TourTiming): boolean {
  if (opened) playTour(workspace, opened.tour, timing);
  else if (workspace.bookmarks().length) startTour(workspace, timing);
  else return false;
  return true;
}
