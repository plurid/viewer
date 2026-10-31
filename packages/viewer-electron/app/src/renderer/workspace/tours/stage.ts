import type { AnchorPose, PlanePose } from '../../../domain/tours/tour';
import type { WorkspaceController } from '../context';

/** How the camera holds a stop's plane: docked as a page, framed in the space, or a pose. */
export type StagePose = PlanePose | AnchorPose;
/**
 * Where the camera goes for a stop: the plane that shows its file, at the stop's pose, or a saved
 * view. Only the pose comes from the tour file; the plane is the one open now.
 */
export type StageDestination =
  { kind: 'plane'; paneID: string; pose?: StagePose } | { kind: 'view'; bookmark: string };
export interface StageMotion {
  /** A flight's duration, in ms. */
  duration: number;
  /** The person asked for less motion: jump, and keep the dwell. */
  reduced: boolean;
}
/**
 * How a travel ended: at rest at the destination; its plane closed, its view removed or the travel
 * aborted; or its plane, still open, never reached the space.
 */
export type StageArrival = 'arrived' | 'gone' | 'unplaced';
/**
 * Moves the camera to a stop and reports when it is at rest there. The player opens the stop's
 * file first; the stage only travels, so it never opens, edits or runs anything itself.
 *
 * `workspaceStage` works with any engine: opening a plane frames it, and the stage waits for that
 * to settle and docks or undocks it as its pose asks. `pluridStage` uses the engine's anchors
 * (Plurid 0.0.0-43): opening does not frame, and the stage's one anchored move takes the camera
 * to the plane.
 */
export interface TourStage {
  /** Whether the stage moves the camera to a plane itself, so opening its file must not frame. */
  readonly frames: boolean;
  travel(
    destination: StageDestination,
    motion: StageMotion,
    signal: AbortSignal,
  ): Promise<StageArrival>;
}
export type StageWorkspace = Pick<
  WorkspaceController,
  'goBookmark' | 'whenAtRest' | 'isDocked' | 'dock' | 'focusPane'
>;
/** How long a stage waits for the camera to come to rest before it goes on regardless. */
export const stageRestLimit = 6000;
/** How long a stage waits for a plane just opened to reach the engine's tree. */
export const stagePlaneLimit = 4000;

/** Resolves when `rest` settles or `signal` aborts, keeping no listener after. */
function settled(rest: Promise<unknown>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    void rest.then(done, done);
  });
}

/** The stage without the engine's anchors: `open` frames a plane (`focusPane`, `frameWorkspace`). */
export function workspaceStage(
  workspace: StageWorkspace,
  isOpen: (paneID: string) => boolean,
): TourStage {
  return {
    frames: false,
    async travel(destination, motion, signal) {
      if (signal.aborted) return 'gone';
      if (destination.kind === 'view') {
        let landed!: () => void;
        const flight = new Promise<void>((resolve) => (landed = resolve));
        const flown = workspace.goBookmark(destination.bookmark, {
          duration: motion.reduced ? 0 : motion.duration,
          onSettle: landed,
          onInterrupt: landed,
        });
        if (!flown) return 'gone';
        // a flight cut short may never settle: the camera at rest ends the wait as well
        await settled(Promise.race([flight, workspace.whenAtRest(signal)]), signal);
        return signal.aborted ? 'gone' : 'arrived';
      }
      const { paneID, pose } = destination;
      const there = () => !signal.aborted && isOpen(paneID);
      await workspace.whenAtRest(signal);
      if (!there()) return 'gone';
      const docked = workspace.isDocked();
      if (pose === 'dock' && !docked) {
        workspace.dock(paneID);
        await workspace.whenAtRest(signal);
      } else if (pose === 'frame' && docked) {
        // `dock` in a docked space reveals the space; the plane is then framed in it
        workspace.dock(paneID);
        await workspace.whenAtRest(signal);
        if (!there()) return 'gone';
        workspace.focusPane(paneID);
        await workspace.whenAtRest(signal);
      }
      return there() ? 'arrived' : 'gone';
    },
  };
}

/** The camera moves a tour needs: as much of Plurid's application handle (0.0.0-43) as it uses. */
export interface AnchorCamera {
  camera: {
    /** Moves to a plane by its path at a pose; `ok: false` when it is absent or hidden. */
    anchor(
      anchor: { path: string; pose?: StagePose },
      options?: { animate?: boolean; duration?: number },
    ): { ok: boolean };
  };
  bookmarks: { go(name: string, options?: { animate?: boolean; duration?: number }): void };
  whenAtRest(options?: { timeout?: number; frames?: number }): Promise<boolean>;
  /** Tells of every change to the engine's state, its tree among them. */
  store: { subscribe(listener: () => void): () => void };
}
/** Whether the engine has the anchors and rest a `pluridStage` uses: Plurid 0.0.0-43 and later. */
export function hasAnchorCamera(api: unknown): api is AnchorCamera {
  const handle = api as Partial<AnchorCamera> | null | undefined;
  return (
    typeof handle?.camera?.anchor === 'function' &&
    typeof handle.whenAtRest === 'function' &&
    typeof handle.bookmarks?.go === 'function' &&
    typeof handle.store?.subscribe === 'function'
  );
}
/** The panes a `pluridStage` shows: which are open, and the engine route of each one's plane. */
export interface StagePanes {
  isOpen(paneID: string): boolean;
  /** The route of the plane showing the pane, undefined while the engine's tree does not hold it. */
  routeOf(paneID: string): string | undefined;
}
/** How a wait for a plane just opened ends: in the engine's tree, or why it is not. */
type Placement = 'placed' | Exclude<StageArrival, 'arrived'>;
/** The route of the plane showing a pane while the pane is open. */
const openRoute = (panes: StagePanes, paneID: string) =>
  panes.isOpen(paneID) ? panes.routeOf(paneID) : undefined;
/**
 * Waits for the engine's tree to hold the pane's plane. A file a stop opens as a new root reaches
 * the tree only when the workspace surface next renders its roots, after the player has opened it;
 * the engine's store tells of that change, with or without frames.
 */
function placed(
  handle: AnchorCamera,
  panes: StagePanes,
  paneID: string,
  signal: AbortSignal,
): Promise<Placement> {
  return new Promise((resolve) => {
    const finish = (placement: Placement) => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', aborted);
      resolve(placement);
    };
    const aborted = () => finish('gone');
    const check = () => {
      if (!panes.isOpen(paneID)) finish('gone');
      else if (panes.routeOf(paneID)) finish('placed');
    };
    const timer = setTimeout(() => finish('unplaced'), stagePlaneLimit);
    signal.addEventListener('abort', aborted, { once: true });
    const unsubscribe = handle.store.subscribe(check);
    check();
  });
}
/**
 * The stage on the engine's anchors: one exclusive move to the plane at the stop's pose, which the
 * engine computes from the plane as it is now, then the engine's rest. A plane just opened is
 * waited for, and its first measure and the roots' relayout settle before the move, so the pose is
 * computed from where the plane stays. The tour file's own plane path and occurrence are never
 * used: they name planes of the session that recorded it.
 */
export function pluridStage(handle: AnchorCamera, panes: StagePanes): TourStage {
  const rest = (signal: AbortSignal) =>
    settled(handle.whenAtRest({ timeout: stageRestLimit }), signal);
  return {
    frames: true,
    async travel(destination, motion, signal) {
      if (signal.aborted) return 'gone';
      const options = { animate: !motion.reduced, duration: motion.reduced ? 0 : motion.duration };
      if (destination.kind === 'view') {
        handle.bookmarks.go(destination.bookmark, options);
        await rest(signal);
        return signal.aborted ? 'gone' : 'arrived';
      }
      const { paneID } = destination;
      if (!openRoute(panes, paneID)) {
        const placement = await placed(handle, panes, paneID, signal);
        if (placement !== 'placed') return placement;
        await rest(signal);
      }
      const path = openRoute(panes, paneID);
      if (signal.aborted || !path) return 'gone';
      const anchor = { path, pose: destination.pose ?? 'frame' };
      if (!handle.camera.anchor(anchor, options).ok) return 'gone';
      await rest(signal);
      return !signal.aborted && openRoute(panes, paneID) ? 'arrived' : 'gone';
    },
  };
}
