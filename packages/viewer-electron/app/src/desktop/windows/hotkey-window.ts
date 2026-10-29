import {
  FullscreenTransitions,
  type FullscreenEvent,
  type FullscreenPhase,
  type FullscreenWindow,
} from './fullscreen-transition';
import { errorMessage } from '../../domain/errors';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DropWindow extends FullscreenWindow {
  isVisible(): boolean;
  isFocused(): boolean;
  isMaximized(): boolean;
  getNativeWindowHandle(): Buffer;
  getNormalBounds(): WindowBounds;
  setBounds(bounds: WindowBounds, animate?: boolean): void;
  unmaximize(): void;
  maximize(): void;
  show(): void;
  hide(): void;
  focus(): void;
}

export interface HotkeyStatus {
  registered: boolean;
  shortcut: string;
  problem?: string;
}

/** Temporary drop-down placement never becomes the window's ordinary saved frame. */
export class HotkeyWindow {
  private status: HotkeyStatus = { registered: false, shortcut: '' };
  /** Hiding a drop-down can focus another workspace; the next press still owns this one. */
  private targetWindow?: DropWindow;
  private dropped?: {
    window: DropWindow;
    bounds: WindowBounds;
    maximized: boolean;
    fullscreen: boolean;
  };
  private toggling: Promise<void> = Promise.resolve();
  private generation = 0;
  private binding?: object;
  private cancelTransition?: () => void;
  private closed = false;
  private fullscreen: FullscreenTransitions<DropWindow>;

  constructor(
    private shortcuts: {
      register(shortcut: string, callback: () => void): boolean;
      unregister(shortcut: string): void;
    },
    private target: () => Promise<DropWindow | undefined>,
    private workArea: () => WindowBounds,
    private animate: () => boolean,
    private changed: (status: HotkeyStatus) => void,
    private available = true,
    fullscreenPhase: (window: DropWindow) => FullscreenPhase = () => 'idle',
  ) {
    this.fullscreen = new FullscreenTransitions(fullscreenPhase);
  }

  /** App-origin fullscreen changes must record intent before Electron's deferred native call. */
  setFullScreen(window: DropWindow, fullscreen: boolean): void {
    if (this.closed) return;
    this.fullscreen.request(window, fullscreen);
  }

  snapshot(): HotkeyStatus {
    return { ...this.status };
  }

  configure(enabled: boolean, shortcut: string): void {
    if (this.closed) return;
    if (!enabled || !this.available) {
      if (this.status.registered) this.shortcuts.unregister(this.status.shortcut);
      this.binding = undefined;
      this.status = { registered: false, shortcut };
      this.restore(true);
      this.changed(this.snapshot());
      return;
    }
    if (this.status.registered && this.status.shortcut === shortcut) return;
    let registered = false;
    const binding = {};
    try {
      registered = this.shortcuts.register(shortcut, () => {
        if (this.binding !== binding || this.closed) return;
        const generation = this.generation;
        void this.toggle().catch((error) => {
          if (!this.current(generation)) return;
          this.status = { ...this.status, problem: errorMessage(error) };
          this.changed(this.snapshot());
        });
      });
    } catch {
      /* Invalid and occupied accelerators leave the previous binding available. */
    }
    if (!registered) {
      this.status = {
        ...this.status,
        problem: `${shortcut} could not be registered. Choose another shortcut.`,
      };
    } else {
      if (this.status.registered) this.shortcuts.unregister(this.status.shortcut);
      this.binding = binding;
      this.status = { registered: true, shortcut };
    }
    this.changed(this.snapshot());
  }

  isDropped(window: DropWindow): boolean {
    // Hidden drop-downs still own a temporary frame that must not be persisted.
    return this.dropped?.window === window;
  }

  restore(show = true): boolean {
    this.generation++;
    this.cancelTransition?.();
    const target = this.targetWindow;
    this.targetWindow = undefined;
    if (this.restoreFrame(show)) return true;
    if (!target || target.isDestroyed()) return false;
    if (show) {
      target.show();
      target.focus();
    } else target.hide();
    return true;
  }

  private restoreFrame(show: boolean): boolean {
    const dropped = this.dropped;
    if (!dropped || dropped.window.isDestroyed()) {
      this.dropped = undefined;
      return false;
    }
    dropped.window.setBounds(dropped.bounds);
    if (dropped.maximized) dropped.window.maximize();
    this.dropped = undefined;
    if (show) {
      dropped.window.show();
      dropped.window.focus();
      if (dropped.fullscreen) this.setFullScreen(dropped.window, true);
    } else dropped.window.hide();
    return true;
  }

  toggle(): Promise<void> {
    const generation = this.generation;
    const work = this.toggling
      .catch(() => {})
      .then(async () => {
        if (this.current(generation)) await this.performToggle(generation);
      });
    this.toggling = work;
    return work;
  }

  private current(generation: number): boolean {
    return generation === this.generation && this.status.registered && !this.closed;
  }

  private waitForFullscreen(
    window: DropWindow,
    event: FullscreenEvent,
    request?: () => void,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timeout);
        window.removeListener(event, finished);
        window.removeListener('closed', cancelled);
        if (this.cancelTransition === cancelled) this.cancelTransition = undefined;
      };
      const finished = () => {
        clean();
        resolve(true);
      };
      const cancelled = () => {
        clean();
        resolve(false);
      };
      const timeout = setTimeout(() => {
        clean();
        reject(new Error('Wait for the fullscreen transition before opening Viewer again.'));
      }, 3000);
      this.cancelTransition = cancelled;
      window.once(event, finished);
      window.once('closed', cancelled);
      try {
        request?.();
      } catch (error) {
        clean();
        reject(error);
      }
    });
  }

  private async leaveFullscreen(window: DropWindow, generation: number): Promise<boolean> {
    const phase = this.fullscreen.phase(window);
    if (phase === 'entering') {
      const completed = await this.waitForFullscreen(window, 'enter-full-screen');
      if (!completed || !this.current(generation) || window.isDestroyed()) return false;
    } else if (phase === 'exiting') return this.waitForFullscreen(window, 'leave-full-screen');
    if (!window.isFullScreen()) return true;
    return this.waitForFullscreen(window, 'leave-full-screen', () => {
      this.setFullScreen(window, false);
    });
  }

  private async performToggle(generation: number): Promise<void> {
    const window =
      this.targetWindow && !this.targetWindow.isDestroyed()
        ? this.targetWindow
        : await this.target();
    if (!this.current(generation) || !window || window.isDestroyed()) return;
    this.targetWindow = window;
    const phase = this.fullscreen.phase(window);
    const fullscreenTransition = phase !== 'idle' || window.isFullScreen();
    if (
      this.dropped?.window === window &&
      window.isVisible() &&
      window.isFocused() &&
      !fullscreenTransition
    ) {
      // A toggle only hides the temporary placement. Re-entering fullscreen on a hidden
      // macOS window starts a Space transition that cannot complete normally.
      window.hide();
      return;
    }
    if (this.dropped?.window !== window) {
      this.restoreFrame(false);
      this.dropped = {
        window,
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized(),
        fullscreen: phase === 'entering' || (phase === 'idle' && window.isFullScreen()),
      };
    }
    try {
      const completed = await this.leaveFullscreen(window, generation);
      if (!this.current(generation)) return;
      if (window.isDestroyed()) {
        this.dropped = undefined;
        this.targetWindow = undefined;
        return;
      }
      if (!completed) return;
    } catch (error) {
      if (this.current(generation)) this.restoreFrame(true);
      throw error;
    }
    if (window.isMaximized()) window.unmaximize();
    const area = this.workArea();
    const width = Math.min(area.width, Math.max(760, Math.round(area.width * 0.9)));
    const height = Math.min(area.height, Math.max(540, Math.round(area.height * 0.65)));
    const bounds = { x: area.x + Math.round((area.width - width) / 2), y: area.y, width, height };
    // Native fullscreen already animates the Space handoff. Starting a second animation
    // above the display can strand the visible window outside that handoff.
    const animate = !fullscreenTransition && !this.dropped?.fullscreen && this.animate();
    if (animate) window.setBounds({ ...bounds, y: area.y - height });
    window.show();
    window.setBounds(bounds, animate);
    window.focus();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.status.registered) this.shortcuts.unregister(this.status.shortcut);
    this.binding = undefined;
    this.status = { registered: false, shortcut: this.status.shortcut };
    this.restore(false);
    this.fullscreen.close();
    this.changed(this.snapshot());
  }
}
