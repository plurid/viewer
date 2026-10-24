export type FullscreenPhase = 'idle' | 'entering' | 'exiting';
export type FullscreenEvent = 'enter-full-screen' | 'leave-full-screen';

export interface FullscreenWindow {
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  setFullScreen(fullscreen: boolean): void;
  once(event: FullscreenEvent | 'closed', listener: () => void): unknown;
  removeListener(event: FullscreenEvent | 'closed', listener: () => void): unknown;
}

/** Records application requests before Electron defers their native AppKit work. */
export class FullscreenTransitions<Window extends FullscreenWindow> {
  private requests = new Map<Window, { phase: FullscreenPhase; release: () => void }>();

  constructor(private nativePhase: (window: Window) => FullscreenPhase) {}

  phase(window: Window): FullscreenPhase {
    return this.requests.get(window)?.phase ?? this.nativePhase(window);
  }

  request(window: Window, fullscreen: boolean): void {
    if (window.isDestroyed()) return;
    const phase = this.phase(window);
    if (
      (phase === 'entering' && fullscreen) ||
      (phase === 'exiting' && !fullscreen) ||
      (phase === 'idle' && window.isFullScreen() === fullscreen)
    )
      return;
    this.requests.get(window)?.release();
    const event: FullscreenEvent = fullscreen ? 'enter-full-screen' : 'leave-full-screen';
    const release = () => {
      window.removeListener(event, release);
      window.removeListener('closed', release);
      this.requests.delete(window);
    };
    this.requests.set(window, { phase: fullscreen ? 'entering' : 'exiting', release });
    window.once(event, release);
    window.once('closed', release);
    try {
      window.setFullScreen(fullscreen);
    } catch (error) {
      release();
      throw error;
    }
  }

  close(): void {
    for (const request of this.requests.values()) request.release();
  }
}
