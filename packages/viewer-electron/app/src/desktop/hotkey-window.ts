export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DropWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  getBounds(): WindowBounds;
  setBounds(bounds: WindowBounds, animate?: boolean): void;
  setFullScreen(fullscreen: boolean): void;
  unmaximize(): void;
  maximize(): void;
  show(): void;
  hide(): void;
  focus(): void;
  once(event: 'leave-full-screen', listener: () => void): unknown;
  removeListener(event: 'leave-full-screen', listener: () => void): unknown;
}

export interface HotkeyStatus {
  registered: boolean;
  shortcut: string;
  problem?: string;
}

/** Temporary drop-down placement never becomes the window's ordinary saved frame. */
export class HotkeyWindow {
  private status: HotkeyStatus = { registered: false, shortcut: '' };
  private dropped?: {
    window: DropWindow;
    bounds: WindowBounds;
    maximized: boolean;
    fullscreen: boolean;
  };
  private toggling: Promise<void> = Promise.resolve();

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
  ) {}

  snapshot(): HotkeyStatus {
    return { ...this.status };
  }

  configure(enabled: boolean, shortcut: string): void {
    if (!enabled || !this.available) {
      if (this.status.registered) this.shortcuts.unregister(this.status.shortcut);
      this.status = { registered: false, shortcut };
      this.restore(true);
      this.changed(this.snapshot());
      return;
    }
    if (this.status.registered && this.status.shortcut === shortcut) return;
    let registered = false;
    try {
      registered = this.shortcuts.register(shortcut, () => {
        void this.toggle().catch((error) => {
          this.status = { ...this.status, problem: (error as Error).message };
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
      this.status = { registered: true, shortcut };
    }
    this.changed(this.snapshot());
  }

  isDropped(window: DropWindow): boolean {
    return this.dropped?.window === window;
  }

  restore(show = true): void {
    const dropped = this.dropped;
    if (!dropped || dropped.window.isDestroyed()) {
      this.dropped = undefined;
      return;
    }
    dropped.window.setBounds(dropped.bounds);
    if (dropped.maximized) dropped.window.maximize();
    if (dropped.fullscreen) dropped.window.setFullScreen(true);
    this.dropped = undefined;
    if (show) {
      dropped.window.show();
      dropped.window.focus();
    } else dropped.window.hide();
  }

  toggle(): Promise<void> {
    const work = this.toggling.catch(() => {}).then(() => this.performToggle());
    this.toggling = work;
    return work;
  }

  private leaveFullscreen(window: DropWindow): Promise<void> {
    if (!window.isFullScreen()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finished = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        window.removeListener('leave-full-screen', finished);
        reject(new Error('Wait for the fullscreen transition before opening Viewer again.'));
      }, 3000);
      window.once('leave-full-screen', finished);
      window.setFullScreen(false);
    });
  }

  private async performToggle(): Promise<void> {
    const window = await this.target();
    if (!window || window.isDestroyed()) return;
    if (this.dropped?.window === window && window.isVisible() && window.isFocused()) {
      this.restore(false);
      return;
    }
    this.restore(false);
    this.dropped = {
      window,
      bounds: window.getBounds(),
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
    };
    await this.leaveFullscreen(window);
    if (window.isDestroyed()) {
      this.dropped = undefined;
      return;
    }
    if (window.isMaximized()) window.unmaximize();
    const area = this.workArea();
    const width = Math.min(area.width, Math.max(760, Math.round(area.width * 0.9)));
    const height = Math.min(area.height, Math.max(540, Math.round(area.height * 0.65)));
    const bounds = { x: area.x + Math.round((area.width - width) / 2), y: area.y, width, height };
    const animate = this.animate();
    if (animate) window.setBounds({ ...bounds, y: area.y - height });
    window.show();
    window.setBounds(bounds, animate);
    window.focus();
  }

  close(): void {
    if (this.status.registered) this.shortcuts.unregister(this.status.shortcut);
    this.restore(false);
  }
}
