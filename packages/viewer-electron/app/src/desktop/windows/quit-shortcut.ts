/** How long a first ⌘Q waits for the second. */
export const QUIT_AGAIN_MS = 2500;

export interface QuitShortcutHost {
  /** Warn before quitting with ⌘Q, `settings.quit.warnShortcut`. */
  warns(): boolean;
  /** Shows "Press ⌘Q again to quit" in the focused Viewer window; false with none visible. */
  hint(duration: number): boolean;
  quit(): void;
}

/**
 * ⌘Q quits on a second press within a moment, as Chrome's does, and holding it counts. Choosing
 * Quit in the menu, the Dock, logging out and every other Quit go straight to Electron.
 */
export class QuitShortcut {
  /** Until when a second ⌘Q quits. A deadline, not a timer: a timer held back while Viewer sits
   * in the background would leave the next single press quitting. */
  private until = -Infinity;

  constructor(private host: QuitShortcutHost) {}

  /** The Quit menu item ran, from its key equivalent or a click. */
  request(byShortcut: boolean): void {
    const now = performance.now();
    if (byShortcut && now >= this.until && this.host.warns() && this.host.hint(QUIT_AGAIN_MS)) {
      this.until = now + QUIT_AGAIN_MS;
      return;
    }
    this.until = -Infinity;
    this.host.quit();
  }
}
