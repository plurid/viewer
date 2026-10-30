import type { BrowserWindow, RenderProcessGoneDetails } from 'electron';
import { askNatively } from '../native/native-confirmation';

/** How a renderer stopped: its process ended, or it stopped answering past its grace. */
export type RendererStop = 'gone' | 'unresponsive';

/** The person's answer to a window that stopped working. */
export type StoppedWindowChoice = 'reload' | 'close';

/** Who the question names: a Viewer window, or a web page's own window. */
export type StoppedSubject = 'window' | 'page';

/** Chromium reports a renderer unresponsive after its own wait; a short pause beyond it is not yet
 * a stopped window. */
export const UNRESPONSIVE_GRACE_MS = 5_000;

/**
 * Where a watched renderer is. `hung` is unresponsive within its grace; `stopped` lost its
 * question (the dialog failed) and waits as it is; `reloading` and `closing` carry out an answer.
 */
export type WatchPhase =
  'running' | 'hung' | 'asking' | 'stopped' | 'reloading' | 'closing' | 'closed';

export interface RendererWatchHost {
  /** The window saves nothing more: its pending saves end, and Close and Quit go ahead without it. */
  stopped(stop: RendererStop): void;
  /** The renderer answers again: after an unresponsive spell, or once a reload has loaded. */
  resumed(): void;
  /** Reload or Close; undefined when the question is withdrawn. */
  ask(signal: AbortSignal): Promise<StoppedWindowChoice | undefined>;
  /** Whether the renderer process still runs. */
  alive(): boolean;
  /** Ends the renderer process, which then reports itself gone. */
  crash(): void;
  reload(): void;
  close(): void;
  report(error: unknown): void;
}

/**
 * One renderer's health. A crashed window, or one hung past its grace, asks Reload or Close; a
 * hung renderer is ended first, so neither waits on it.
 */
export class RendererWatch {
  private current: WatchPhase = 'running';
  private grace?: ReturnType<typeof setTimeout>;
  private question?: AbortController;
  /** The answer waiting for the renderer this watch ended to report itself gone. */
  private pending?: StoppedWindowChoice;

  constructor(
    private host: RendererWatchHost,
    private graceMs = UNRESPONSIVE_GRACE_MS,
  ) {}

  phase(): WatchPhase {
    return this.current;
  }

  gone(): void {
    if (this.current === 'closed') return;
    this.clearGrace();
    this.host.stopped('gone');
    const answer = this.pending;
    this.pending = undefined;
    if (answer) this.carryOut(answer);
    // the question shown for a hung renderer answers its crash too; a closing window just closes
    else if (this.current !== 'asking' && this.current !== 'closing') void this.ask();
  }

  unresponsive(): void {
    if (this.current !== 'running') return;
    this.current = 'hung';
    this.grace = setTimeout(() => {
      this.grace = undefined;
      if (this.current === 'hung') this.stall();
    }, this.graceMs);
  }

  /** The renderer did not answer a save in time: it is treated as hung past its grace. True when
   * the window now counts as stopped, so its saves no longer wait for it. */
  timedOut(): boolean {
    if (this.current === 'running' || this.current === 'hung') {
      this.clearGrace();
      this.stall();
      return true;
    }
    return this.current === 'asking' || this.current === 'stopped';
  }

  responsive(): void {
    if (this.current === 'hung') {
      this.clearGrace();
      this.current = 'running';
      return;
    }
    if ((this.current !== 'asking' && this.current !== 'stopped') || !this.host.alive()) return;
    // it answers again, as it was: the question is withdrawn
    this.question?.abort();
    this.question = undefined;
    this.current = 'running';
    this.host.resumed();
  }

  /** The page finished loading: after a reload, the window works again. */
  loaded(): void {
    if (this.current !== 'reloading' || this.pending) return;
    this.current = 'running';
    this.host.resumed();
  }

  closed(): void {
    this.current = 'closed';
    this.clearGrace();
    this.pending = undefined;
    this.question?.abort();
    this.question = undefined;
  }

  /** Quit closes every window: a hung renderer is ended first, so its window closes at once. */
  release(): void {
    if (!['hung', 'asking', 'stopped', 'reloading'].includes(this.current)) return;
    this.clearGrace();
    this.pending = undefined;
    this.question?.abort();
    this.question = undefined;
    this.current = 'closing';
    if (this.host.alive()) this.host.crash();
  }

  private stall(): void {
    this.host.stopped('unresponsive');
    void this.ask();
  }

  private async ask(): Promise<void> {
    this.current = 'asking';
    const question = new AbortController();
    this.question = question;
    let answer: StoppedWindowChoice | undefined;
    try {
      answer = await this.host.ask(question.signal);
    } catch (error) {
      this.host.report(error);
      if (this.question === question) {
        this.question = undefined;
        this.current = 'stopped';
      }
      return;
    }
    if (this.question !== question || question.signal.aborted || this.current !== 'asking') return;
    this.question = undefined;
    if (!answer) {
      this.current = 'stopped';
      return;
    }
    this.current = answer === 'reload' ? 'reloading' : 'closing';
    if (!this.host.alive()) {
      this.carryOut(answer);
      return;
    }
    this.pending = answer;
    this.host.crash();
  }

  private carryOut(answer: StoppedWindowChoice): void {
    try {
      if (answer === 'reload') this.host.reload();
      else this.host.close();
    } catch (error) {
      this.host.report(error);
    }
  }

  private clearGrace(): void {
    clearTimeout(this.grace);
    this.grace = undefined;
  }
}

/** What a watched window does on stopping, besides asking. */
export interface WatchedWindow {
  stopped(stop: RendererStop): void;
  resumed(): void;
  /** Closes the window once its renderer has stopped; by default `close()`. */
  close?(): void;
  report(error: unknown): void;
}

/** Hidden verification runs show no dialogs; such a run names its answer at launch. */
let automaticAnswer: StoppedWindowChoice | undefined;
let automatic = false;
export function answerStoppedWindows(answer: StoppedWindowChoice | undefined): void {
  automatic = true;
  automaticAnswer = answer;
}

const questions: Record<StoppedSubject, string> = {
  window: 'This window stopped working.',
  page: 'This page stopped working.',
};
const details: Record<StoppedSubject, string> = {
  window: 'Reload it to go on from what it saved last, or close it.',
  page: 'Reload the page, or close its window.',
};

/** Reload or Close, as a sheet on the stopped window itself. */
export async function askStoppedWindow(
  window: BrowserWindow,
  subject: StoppedSubject,
  signal: AbortSignal,
): Promise<StoppedWindowChoice | undefined> {
  if (automatic) return automaticAnswer;
  const choice = await askNatively(window, {
    message: questions[subject],
    detail: details[subject],
    buttons: ['Reload', 'Close'],
    defaultId: 0,
    cancelId: 0,
    signal,
  });
  if (signal.aborted) return undefined;
  return choice === 1 ? 'close' : 'reload';
}

/** Watches the renderers of Viewer's own windows and of web page windows. */
export class RendererWatches {
  private watches = new Map<number, RendererWatch>();

  watch(window: BrowserWindow, subject: StoppedSubject, owner: WatchedWindow): RendererWatch {
    const contents = window.webContents;
    const id = contents.id;
    const watch = new RendererWatch({
      stopped: (stop) => owner.stopped(stop),
      resumed: () => owner.resumed(),
      ask: (signal) =>
        window.isDestroyed()
          ? Promise.resolve(undefined)
          : askStoppedWindow(window, subject, signal),
      alive: () => !contents.isDestroyed() && !contents.isCrashed(),
      crash: () => contents.forcefullyCrashRenderer(),
      reload: () => {
        if (!contents.isDestroyed()) contents.reload();
      },
      close: () => {
        if (window.isDestroyed()) return;
        if (owner.close) owner.close();
        else window.close();
      },
      report: (error) => owner.report(error),
    });
    this.watches.set(id, watch);
    contents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
      if (details.reason !== 'clean-exit') watch.gone();
    });
    contents.on('unresponsive', () => watch.unresponsive());
    contents.on('responsive', () => watch.responsive());
    contents.on('did-finish-load', () => watch.loaded());
    window.once('closed', () => {
      watch.closed();
      if (this.watches.get(id) === watch) this.watches.delete(id);
    });
    return watch;
  }

  /** A save the renderer `owner` did not answer in time; true when its window now counts as
   * stopped. */
  timedOut(owner: number): boolean {
    return !!this.watches.get(owner)?.timedOut();
  }

  /** Before Quit closes the windows. */
  releaseAll(): void {
    for (const watch of this.watches.values()) watch.release();
  }
}

/** One registry for the app: Quit releases every watched renderer, whoever made its window. */
export const rendererWatches = new RendererWatches();
