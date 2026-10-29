import { saveBeforeClose } from './save-before-close';
import type { SaveFailureChoice } from './save-before-close';

/** In order. Until Electron closes the windows, a declined or failed step returns to running. */
export type QuitPhase =
  | 'running'
  | 'confirming'
  | 'draining'
  | 'finishing-exports'
  | 'saving'
  | 'stopping-guests'
  | 'closing-windows'
  | 'disposing'
  | 'disposed';

/** The answer to Quit's question about file operations still in progress. */
export type QuitChoice = 'wait' | 'cancel-operations' | 'keep-open';

/** The steps whose failure asks Retry or Keep Open, as a failed save does. */
export type QuitRetryStep = 'draining' | 'stopping-guests';

/** What Quit uses of Electron's before-quit and will-quit events. */
export interface QuitEvent {
  preventDefault(): void;
}

/** The main process's part: Electron, the windows and the questions' wording stay there. */
export interface QuitHost {
  /** The file operations Quit would cancel. */
  pendingOperations(): number;
  confirm(pending: number): Promise<QuitChoice>;
  /** Resolves once no file operation is left; their questions are answered in a window. */
  drained(): Promise<void>;
  /** Resolves once no backup export is being written. */
  exports(): Promise<void>;
  /** Saves every window and store; false when the person keeps Viewer open. */
  save(): Promise<boolean>;
  stopGuests(): Promise<void>;
  /** Asks whether to run a failed step again; keep-open ends Quit. */
  failed(step: QuitRetryStep, error: unknown): Promise<SaveFailureChoice>;
  /** Stops Desktop's services; undefined before Desktop exists. */
  dispose(): Promise<void> | undefined;
  closeHotkey(): void;
  /** Asks Electron to quit, which emits before-quit again. */
  quit(): void;
  report(context: string, error: unknown): void;
}

/**
 * Quit keeps the bridge and services alive until every renderer has saved and Electron has closed
 * its windows. Cleanup belongs to will-quit.
 */
export class QuitSequence {
  private current: QuitPhase = 'running';

  constructor(private host: QuitHost) {}

  phase(): QuitPhase {
    return this.current;
  }

  /**
   * Windows, Settings and launches may open: waiting for file operations needs a window. Here a
   * window's own failed save asks; once Quit saves, Quit's save asks for every window.
   */
  accepting(): boolean {
    return (
      this.current === 'running' || this.current === 'confirming' || this.current === 'draining'
    );
  }

  /** Electron closes the windows: they close without saving and stay in the restored session. */
  closingWindows(): boolean {
    return (
      this.current === 'closing-windows' ||
      this.current === 'disposing' ||
      this.current === 'disposed'
    );
  }

  beforeQuit(event: QuitEvent): void {
    if (this.closingWindows()) return;
    event.preventDefault();
    if (this.current !== 'running') return;
    // Quit cancelled queued and running file operations without a word, so queued work was never
    // done. With some in progress it asks first.
    const pending = this.host.pendingOperations();
    if (pending) void this.confirm(pending);
    else void this.finish();
  }

  willQuit(event: QuitEvent): void {
    this.host.closeHotkey();
    if (this.current === 'disposed') return;
    if (this.current === 'disposing') {
      event.preventDefault();
      return;
    }
    // Something outside Quit ended the app before its save. The services stop all the same, as
    // they did before this sequence: throwing here would stop the app quitting.
    if (!this.closingWindows()) {
      this.host.report('Viewer quit without saving first', new Error(`At ${this.current}.`));
      this.current = 'closing-windows';
    }
    this.move(['closing-windows'], 'disposing');
    const disposal = this.host.dispose();
    if (!disposal) {
      this.move(['disposing'], 'disposed');
      return;
    }
    event.preventDefault();
    void disposal
      .catch((error) => this.host.report('Desktop shutdown failed', error))
      .finally(() => {
        this.move(['disposing'], 'disposed');
        this.host.quit();
      });
  }

  /** A command or the agent server finished: there is no window to save. */
  exitHeadless(): void {
    if (!this.closingWindows()) this.move(['running'], 'closing-windows');
  }

  private async confirm(pending: number): Promise<void> {
    this.move(['running'], 'confirming');
    try {
      const choice = await this.host.confirm(pending);
      if (choice === 'keep-open') {
        this.move(['confirming'], 'running');
        return;
      }
      if (choice === 'wait') {
        this.move(['confirming'], 'draining');
        if (!(await this.retried('draining', () => this.host.drained()))) {
          this.move(['draining'], 'running');
          return;
        }
      }
    } catch (error) {
      this.host.report('Quit confirmation failed', error);
      this.move(['confirming', 'draining'], 'running');
      return;
    }
    await this.finish();
  }

  private async finish(): Promise<void> {
    this.move(['running', 'confirming', 'draining'], 'finishing-exports');
    try {
      // a backup cut short by the process ending would look complete
      await this.host.exports();
      this.move(['finishing-exports'], 'saving');
      if (!(await this.host.save())) {
        this.move(['saving'], 'running');
        return;
      }
      this.move(['saving'], 'stopping-guests');
      // Offscreen guests must stop while their owning renderer is still alive.
      // Letting Electron close them with the app windows can leave Chromium's
      // shutdown waiting even after will-quit and service disposal finish.
      if (!(await this.retried('stopping-guests', () => this.host.stopGuests()))) {
        this.move(['stopping-guests'], 'running');
        return;
      }
      this.move(['stopping-guests'], 'closing-windows');
      this.host.quit();
    } catch (error) {
      this.host.report('Viewer could not finish quitting', error);
      if (!this.closingWindows())
        this.move(['finishing-exports', 'saving', 'stopping-guests'], 'running');
    }
  }

  /** The failed save's loop: each Retry runs the step again. */
  private retried(step: QuitRetryStep, run: () => Promise<void>): Promise<boolean> {
    return saveBeforeClose(run, (error) => this.host.failed(step, error));
  }

  /** Quit's order is fixed: a transition from any other phase is a defect. */
  private move(from: readonly QuitPhase[], to: QuitPhase): void {
    if (!from.includes(this.current))
      throw new Error(`Quit cannot move from ${this.current} to ${to}.`);
    this.current = to;
  }
}
