import type { FileEntry } from '../../../domain/contracts';
import { sourceVersion, type EvidenceNavigation } from '../../../domain/files/inspection';
import { errorMessage } from '../../../domain/errors';
import {
  fileName,
  isDefinitionFile,
  stopDwell,
  stopEvidence,
  stopNotice,
  stopState,
  stopSubject,
  type TourLookup,
  type TourStop,
  type TourStopState,
  type TourTiming,
} from '../../../domain/tours/tour';
import type { StageMotion, TourStage } from './stage';

/** A tour to play: one read from a file, or one made of the workspace's saved views. */
export interface PlayableTour {
  name: string;
  /** The folder that holds the tour file; its stops' paths are relative to it. */
  root?: string;
  /** The tour file, when it came from one. */
  file?: string;
  /** Every stop's dwell, unless a stop sets its own. */
  dwell?: number | null;
  stops: readonly TourStop[];
}
/** What a tour may do in the workspace: look files up, open them and list the saved views. */
export interface TourPorts {
  /** A stop's file at `path` under `root`, never through a link; `hash` reads its SHA-256. */
  lookup(root: string, path: string, hash: boolean): Promise<TourLookup>;
  /**
   * Opens or shows the file's plane at `evidence` and returns the plane's pane ID. No evidence
   * clears what an earlier stop marked in that plane.
   */
  open(entry: FileEntry, evidence: EvidenceNavigation | undefined): string | undefined;
  /** Clears what the last stop marked in its plane: the tour goes to a saved view instead. */
  leave(): void;
  views(): readonly string[];
  timing(): TourTiming;
  reducedMotion(): boolean;
}
export type TourStatus = 'travelling' | 'showing' | 'skipping' | 'ended';
export interface TourNotice {
  state: Exclude<TourStopState, 'ready'> | 'failed' | 'closed';
  text: string;
}
export interface TourPlayback {
  tour: PlayableTour;
  index: number;
  status: TourStatus;
  paused: boolean;
  /** What is not as recorded at this stop. */
  notice?: TourNotice;
  /** Stops skipped so far in this run, for the summary at the end. */
  skipped: number;
  /** Whether Next after the last stop starts again. */
  loop: boolean;
}
/** How long a missing stop's card shows before the tour moves on. */
export const skipDelay = 1800;
type Outcome = { state: TourStopState | 'failed'; text?: string };

/**
 * Plays a tour: each stop's file opened at its anchor and brought into view, then shown for its
 * dwell. Only the ports' `open` and the stage's travel touch the workspace; nothing runs. Paused,
 * nothing moves on by itself: no dwell or skip card runs out.
 */
export class TourPlayer {
  private state: TourPlayback;
  private step?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  /** The way the tour is going, so a stop looked up again on Resume goes on the same way. */
  private direction: 1 | -1 = 1;
  /** The plane showing this stop, once the stage reached it. */
  private pane?: string;
  /** Stops skipped in this run, and those skipped since the last one shown: by ID, so a stop
   * looked up again on Resume is not counted twice. */
  private skipped = new Set<string>();
  private skippedInRow = new Set<string>();
  constructor(
    private stage: TourStage,
    private ports: TourPorts,
    tour: PlayableTour,
    private changed: (playback: TourPlayback) => void,
  ) {
    this.state = {
      tour,
      index: 0,
      status: 'travelling',
      paused: false,
      skipped: 0,
      loop: ports.timing().loop,
    };
  }
  get playback(): TourPlayback {
    return this.state;
  }
  /** The plane the stop on screen is shown in, while it is shown. */
  get shownPane(): string | undefined {
    return this.state.status === 'showing' ? this.pane : undefined;
  }
  play(from = 0): void {
    this.state = { ...this.state, skipped: 0, paused: false };
    this.skipped.clear();
    this.skippedInRow.clear();
    void this.go(Math.max(0, Math.min(from, this.state.tour.stops.length - 1)), 1);
  }
  next(): void {
    if (this.state.status !== 'ended') this.advance(1);
  }
  previous(): void {
    if (this.state.status !== 'ended' && this.state.index > 0)
      void this.go(this.state.index - 1, -1);
  }
  /** Leaves the camera where the person takes it: no dwell or skip card runs out while paused. */
  pause(): void {
    if (this.state.status === 'ended' || this.state.paused) return;
    clearTimeout(this.timer);
    this.publish({ paused: true });
  }
  /** Brings the stop back into view, since the person may have moved away, then waits again. */
  resume(): void {
    if (this.state.status === 'ended' || !this.state.paused) return;
    this.state = { ...this.state, paused: false };
    void this.go(this.state.index, this.direction);
  }
  stop(): void {
    this.clear();
    if (this.state.status !== 'ended') this.publish({ status: 'ended', paused: false });
  }
  /** The plane showing this stop closed: say so, and go on once that has been read. */
  closed(paneID: string): void {
    if (this.shownPane !== paneID) return;
    this.pane = undefined;
    clearTimeout(this.timer);
    const stop = this.state.tour.stops[this.state.index];
    if (!stop) return;
    this.publish({ notice: { state: 'closed', text: `${stopSubject(stop)} was closed.` } });
    if (!this.state.paused) this.timer = setTimeout(() => this.advance(1), skipDelay);
  }
  private clear(): void {
    this.step?.abort();
    this.step = undefined;
    clearTimeout(this.timer);
  }
  private publish(change: Partial<TourPlayback>): void {
    this.state = { ...this.state, ...change };
    this.changed(this.state);
  }
  private advance(direction: 1 | -1): void {
    const { index, tour } = this.state;
    const next = index + direction;
    if (next < 0) void this.go(index + 1, 1);
    else if (next < tour.stops.length) void this.go(next, direction);
    else if (this.state.loop) void this.go(0, 1);
    else this.stop();
  }
  private async go(index: number, direction: 1 | -1): Promise<void> {
    this.clear();
    const step = new AbortController();
    this.step = step;
    this.direction = direction;
    this.pane = undefined;
    const stop = this.state.tour.stops[index];
    if (!stop) return this.stop();
    this.publish({ index, status: 'travelling', notice: undefined });
    let outcome: Outcome;
    try {
      outcome = await this.show(stop, step.signal);
    } catch (error) {
      outcome = {
        state: 'failed',
        text: `${stopSubject(stop)} could not open: ${errorMessage(error)}`,
      };
    }
    if (step.signal.aborted) return;
    if (outcome.state === 'missing' || outcome.state === 'failed') {
      this.pane = undefined;
      this.skipped.add(stop.id);
      this.skippedInRow.add(stop.id);
      const notice = { state: outcome.state, text: outcome.text ?? '' };
      if (this.skippedInRow.size >= this.state.tour.stops.length) {
        this.publish({ notice, skipped: this.skipped.size });
        return this.stop();
      }
      this.publish({ status: 'skipping', notice, skipped: this.skipped.size });
      // paused, the card stays until Resume, Next or Previous
      if (!this.state.paused) this.timer = setTimeout(() => this.advance(direction), skipDelay);
      return;
    }
    this.skippedInRow.clear();
    this.publish({
      status: 'showing',
      notice:
        outcome.state === 'changed' && outcome.text
          ? { state: 'changed', text: outcome.text }
          : undefined,
    });
    if (!this.state.paused) this.wait(stop);
  }
  private wait(stop: TourStop): void {
    const dwell = stopDwell(stop, this.state.tour.dwell, this.ports.timing());
    if (dwell !== null) this.timer = setTimeout(() => this.advance(1), dwell);
  }
  private async show(stop: TourStop, signal: AbortSignal): Promise<Outcome> {
    const timing = this.ports.timing();
    const motion: StageMotion = {
      duration: timing.duration,
      reduced: this.ports.reducedMotion(),
    };
    const { tour } = this.state;
    const target = stop.target;
    if (target.kind === 'view') {
      this.ports.leave();
      const state = stopState(stop, { views: this.ports.views() });
      if (state === 'ready' && (await this.stage.travel(target, motion, signal))) return { state };
      return { state: 'missing', text: stopNotice(stop, 'missing') };
    }
    if (!tour.root) return { state: 'missing', text: stopNotice(stop, 'missing') };
    const name = fileName(target.path);
    // opening one would play another tour or install a project: a tour only shows files
    if (isDefinitionFile(name))
      return {
        state: 'missing',
        text: `${target.path} is a tour or project file, which a tour never opens. Skipping this stop.`,
      };
    const folder = fileName(tour.root);
    const lookup = await this.ports.lookup(tour.root, target.path, !!target.version.sha256);
    if (signal.aborted) return { state: 'missing' };
    if (lookup.state !== 'found')
      return { state: 'missing', text: stopNotice(stop, lookup.state, folder) };
    const current = sourceVersion(lookup.entry);
    const state = stopState(stop, {
      file: { ...current, ...(lookup.sha256 ? { sha256: lookup.sha256 } : {}) },
    });
    const evidence =
      state === 'ready' ? stopEvidence(target, lookup.entry.path, current) : undefined;
    const paneID = this.ports.open(lookup.entry, evidence);
    if (!paneID)
      return {
        state: 'missing',
        text: `The space was not ready to show ${target.path}. Skipping this stop.`,
      };
    const destination = { kind: 'plane' as const, paneID, pose: stop.view?.pose };
    if (!(await this.stage.travel(destination, motion, signal)))
      return {
        state: 'missing',
        text: `${target.path} was closed before it was shown. Skipping this stop.`,
      };
    this.pane = paneID;
    return { state, text: stopNotice(stop, state, folder) };
  }
}
