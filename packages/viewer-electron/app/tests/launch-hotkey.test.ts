import { EventEmitter } from 'node:events';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseLaunch } from '../src/domain/workspaces/launch';
import { HotkeyWindow, type WindowBounds } from '../src/desktop/windows/hotkey-window';

class WindowPort extends EventEmitter {
  bounds = { x: 100, y: 120, width: 900, height: 650 };
  visible = true;
  focused = true;
  fullscreen = false;
  maximized = false;
  destroyed = false;
  isDestroyed = () => this.destroyed;
  isVisible = () => this.visible;
  isFocused = () => this.focused;
  isFullScreen = () => this.fullscreen;
  isMaximized = () => this.maximized;
  getNativeWindowHandle = () => Buffer.alloc(8);
  getBounds = () => ({ ...this.bounds });
  getNormalBounds = () => ({ ...this.bounds });
  setBounds = vi.fn((bounds: WindowBounds) => {
    this.bounds = { ...bounds };
  });
  setFullScreen = (fullscreen: boolean) => {
    this.fullscreen = fullscreen;
    queueMicrotask(() => this.emit(fullscreen ? 'enter-full-screen' : 'leave-full-screen'));
  };
  unmaximize = () => {
    this.maximized = false;
  };
  maximize = () => {
    this.maximized = true;
  };
  show = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
    this.focused = false;
  });
  focus = vi.fn(() => {
    this.focused = true;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fixture(
  target: () => Promise<WindowPort | undefined>,
  animate: () => boolean = () => false,
  fullscreenPhase: () => 'idle' | 'entering' | 'exiting' = () => 'idle',
) {
  const shortcuts = {
    register: vi.fn((_shortcut: string, _callback: () => void) => true),
    unregister: vi.fn(),
  };
  const changed = vi.fn();
  const hotkey = new HotkeyWindow(
    shortcuts,
    target,
    () => ({ x: 0, y: 25, width: 1920, height: 1000 }),
    animate,
    changed,
    true,
    fullscreenPhase,
  );
  hotkey.configure(true, 'Alt+Space');
  return { hotkey, shortcuts, changed };
}

describe('Viewer shell arguments', () => {
  const parse = (...args: string[]) => parseLaunch(args, '/caller', '/home/person', path.resolve);
  it('resolves paths in the invoking directory and preserves literal option-like names', () => {
    expect(
      parse('~/Documents', './two words', '--new-window', '--terminal', '--workspace', 'Research'),
    ).toEqual({
      paths: ['/home/person/Documents', '/caller/two words'],
      newWindow: true,
      terminal: true,
      workspace: 'Research',
    });
    expect(parse('--', '--file').paths).toEqual(['/caller/--file']);
    expect(() => parse('--workspace')).toThrow('needs a workspace');
    expect(() => parse('--unknown')).toThrow('Unknown');
  });
});

describe('global shortcut window', () => {
  it('tracks a fullscreen request before Electron starts its deferred native transition', async () => {
    const window = new WindowPort();
    const normal = window.getBounds();
    const request = vi.fn((fullscreen: boolean) => {
      if (!fullscreen) {
        window.fullscreen = false;
        queueMicrotask(() => window.emit('leave-full-screen'));
      }
    });
    window.setFullScreen = request;
    const { hotkey } = fixture(
      async () => window,
      () => true,
    );

    hotkey.setFullScreen(window, true);
    const toggled = hotkey.toggle();
    await vi.waitFor(() => expect(hotkey.isDropped(window)).toBe(true));
    try {
      expect(window.isFullScreen()).toBe(false);
      expect(window.setBounds).not.toHaveBeenCalled();
      expect(request.mock.calls).toEqual([[true]]);
      window.fullscreen = true;
      window.emit('enter-full-screen');
      await toggled;

      expect(request.mock.calls).toEqual([[true], [false]]);
      expect(window.fullscreen).toBe(false);
      expect(window.bounds.y).toBe(25);
      expect(window.setBounds.mock.calls.every(([bounds]) => bounds.y >= 25)).toBe(true);
      hotkey.restore();
      expect(window.bounds).toEqual(normal);
      expect(request.mock.calls).toEqual([[true], [false], [true]]);
    } finally {
      hotkey.close();
      await toggled;
    }
  });

  it('waits for native fullscreen entry before changing the frame', async () => {
    const window = new WindowPort();
    let phase: 'idle' | 'entering' = 'entering';
    const { hotkey } = fixture(
      async () => window,
      () => true,
      () => phase,
    );
    const toggled = hotkey.toggle();
    await vi.waitFor(() => expect(hotkey.isDropped(window)).toBe(true));

    try {
      expect(window.fullscreen).toBe(false);
      expect(window.setBounds).not.toHaveBeenCalled();
      expect(window.listenerCount('enter-full-screen')).toBe(1);
      window.fullscreen = true;
      phase = 'idle';
      window.emit('enter-full-screen');
      await toggled;

      expect(window.fullscreen).toBe(false);
      expect(window.bounds.y).toBe(25);
      expect(window.setBounds.mock.calls.every(([bounds]) => bounds.y >= 25)).toBe(true);
      hotkey.restore();
      expect(window.fullscreen).toBe(true);
    } finally {
      hotkey.close();
      await toggled;
    }
  });

  it('joins an existing fullscreen exit without requesting another transition', async () => {
    const window = new WindowPort();
    window.fullscreen = true;
    const request = vi.fn(window.setFullScreen);
    window.setFullScreen = request;
    let phase: 'idle' | 'exiting' = 'exiting';
    const { hotkey } = fixture(
      async () => window,
      undefined,
      () => phase,
    );
    const toggled = hotkey.toggle();
    await vi.waitFor(() => expect(hotkey.isDropped(window)).toBe(true));

    try {
      expect(window.setBounds).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      window.fullscreen = false;
      phase = 'idle';
      window.emit('leave-full-screen');
      await toggled;

      expect(window.bounds.y).toBe(25);
      hotkey.restore();
      expect(request).not.toHaveBeenCalled();
    } finally {
      hotkey.close();
      await toggled;
    }
  });

  it('allows green-button entry while dropped and exits it only on the next toggle', async () => {
    const window = new WindowPort();
    let phase: 'idle' | 'entering' = 'idle';
    const request = vi.fn(window.setFullScreen);
    window.setFullScreen = request;
    const { hotkey } = fixture(
      async () => window,
      undefined,
      () => phase,
    );
    await hotkey.toggle();
    const boundsCalls = window.setBounds.mock.calls.length;
    phase = 'entering';
    expect(request).not.toHaveBeenCalled();

    const toggled = hotkey.toggle();
    await vi.waitFor(() => expect(window.listenerCount('enter-full-screen')).toBe(1));
    try {
      expect(window.hide).not.toHaveBeenCalled();
      expect(window.setBounds).toHaveBeenCalledTimes(boundsCalls);
      window.fullscreen = true;
      phase = 'idle';
      window.emit('enter-full-screen');
      await toggled;

      expect(request.mock.calls).toEqual([[false]]);
      expect(window.visible).toBe(true);
      expect(window.bounds.y).toBe(25);
      await hotkey.toggle();
      expect(window.visible).toBe(false);
    } finally {
      hotkey.close();
      await toggled;
    }
  });

  it.each(['disable', 'close', 'restore'] as const)(
    'cancels a deferred fullscreen entry when asked to %s without a late exit',
    async (action) => {
      const window = new WindowPort();
      const request = vi.fn();
      window.setFullScreen = request;
      const { hotkey } = fixture(async () => window);
      hotkey.setFullScreen(window, true);
      const toggled = hotkey.toggle();
      await vi.waitFor(() => expect(hotkey.isDropped(window)).toBe(true));

      if (action === 'disable') hotkey.configure(false, 'Alt+Space');
      else if (action === 'close') hotkey.close();
      else hotkey.restore();
      await toggled;

      expect(hotkey.isDropped(window)).toBe(false);
      const boundsCalls = window.setBounds.mock.calls.length;
      window.fullscreen = true;
      window.emit('enter-full-screen');
      await Promise.resolve();
      expect(request.mock.calls).toEqual([[true]]);
      expect(window.setBounds).toHaveBeenCalledTimes(boundsCalls);
      expect(window.listenerCount('enter-full-screen')).toBe(0);
      expect(window.listenerCount('closed')).toBe(0);
      hotkey.close();
    },
  );

  it('releases a deferred transition when its window closes', async () => {
    const window = new WindowPort();
    window.setFullScreen = vi.fn();
    const { hotkey } = fixture(async () => window);
    hotkey.setFullScreen(window, true);
    const toggled = hotkey.toggle();
    await vi.waitFor(() => expect(hotkey.isDropped(window)).toBe(true));
    window.destroyed = true;
    window.emit('closed');
    await toggled;

    expect(hotkey.isDropped(window)).toBe(false);
    expect(window.setBounds).not.toHaveBeenCalled();
    expect(window.listenerCount('enter-full-screen')).toBe(0);
    expect(window.listenerCount('closed')).toBe(0);
    hotkey.close();
  });

  it('bounds a stalled native transition and releases its waiters', async () => {
    vi.useFakeTimers();
    const window = new WindowPort();
    window.fullscreen = true;
    window.setFullScreen = vi.fn();
    const { hotkey } = fixture(async () => window);
    try {
      const toggled = hotkey.toggle();
      const failed = expect(toggled).rejects.toThrow('Wait for the fullscreen transition');
      await vi.advanceTimersByTimeAsync(3000);
      await failed;

      expect(hotkey.isDropped(window)).toBe(false);
      expect(window.listenerCount('leave-full-screen')).toBe(0);
    } finally {
      hotkey.close();
      vi.useRealTimers();
    }
    expect(window.listenerCount('enter-full-screen')).toBe(0);
    expect(window.listenerCount('closed')).toBe(0);
  });

  it('keeps fullscreen restoration until explicit restore, without fullscreen requests on hide', async () => {
    const window = new WindowPort();
    const normal = window.getBounds();
    window.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    window.fullscreen = true;
    window.getNormalBounds = () => ({ ...normal });
    const setFullscreen = vi.fn(window.setFullScreen);
    window.setFullScreen = setFullscreen;
    const { hotkey } = fixture(async () => window);

    await hotkey.toggle();
    const dropdown = window.getBounds();
    await hotkey.toggle();

    expect(window.visible).toBe(false);
    expect(window.fullscreen).toBe(false);
    expect(window.bounds).toEqual(dropdown);
    expect(setFullscreen.mock.calls).toEqual([[false]]);

    await hotkey.toggle();
    expect(window.visible).toBe(true);
    expect(window.bounds).toEqual(dropdown);
    expect(setFullscreen.mock.calls).toEqual([[false]]);
    hotkey.restore();
    expect(window.bounds).toEqual(normal);
    expect(window.fullscreen).toBe(true);
    expect(setFullscreen.mock.calls).toEqual([[false], [true]]);
    hotkey.close();
  });

  it('keeps a fullscreen origin on screen throughout the Space handoff', async () => {
    const window = new WindowPort();
    window.fullscreen = true;
    const { hotkey } = fixture(
      async () => window,
      () => true,
    );

    await hotkey.toggle();

    expect(window.visible).toBe(true);
    expect(window.fullscreen).toBe(false);
    expect(window.setBounds.mock.calls.every(([bounds]) => bounds.y >= 25)).toBe(true);
    hotkey.close();
  });

  it('keeps the same drop-down when hiding it focuses a different workspace', async () => {
    const original = new WindowPort();
    const other = new WindowPort();
    let focused = original;
    const { hotkey } = fixture(async () => focused);

    await hotkey.toggle();
    await hotkey.toggle();
    focused = other;
    await hotkey.toggle();

    expect(original.visible).toBe(true);
    expect(hotkey.isDropped(original)).toBe(true);
    expect(other.setBounds).not.toHaveBeenCalled();
    hotkey.close();
  });

  it('recovers a hidden drop-down as an ordinary window and releases its target', async () => {
    const original = new WindowPort();
    const other = new WindowPort();
    const normal = original.getBounds();
    let focused = original;
    const { hotkey } = fixture(async () => focused);

    await hotkey.toggle();
    await hotkey.toggle();
    focused = other;
    hotkey.restore();

    expect(original.visible).toBe(true);
    expect(original.focused).toBe(true);
    expect(original.bounds).toEqual(normal);
    expect(hotkey.isDropped(original)).toBe(false);
    await hotkey.toggle();
    expect(hotkey.isDropped(other)).toBe(true);
    hotkey.close();
  });

  it.each(['disable', 'close', 'restore'] as const)(
    'cancels pending window selection and queued toggles when asked to %s',
    async (action) => {
      const window = new WindowPort();
      const selected = deferred<WindowPort>();
      const target = vi.fn(() => selected.promise);
      const { hotkey } = fixture(target);
      const first = hotkey.toggle();
      const second = hotkey.toggle();
      await vi.waitFor(() => expect(target).toHaveBeenCalledTimes(1));

      if (action === 'disable') hotkey.configure(false, 'Alt+Space');
      else if (action === 'close') hotkey.close();
      else hotkey.restore();
      selected.resolve(window);
      await Promise.all([first, second]);

      expect(target).toHaveBeenCalledTimes(1);
      expect(window.setBounds).not.toHaveBeenCalled();
      expect(window.show).not.toHaveBeenCalled();
      expect(window.focus).not.toHaveBeenCalled();
      expect(hotkey.isDropped(window)).toBe(false);
      hotkey.close();
    },
  );

  it.each(['disable', 'close', 'restore'] as const)(
    'cancels a pending fullscreen transition when asked to %s',
    async (action) => {
      const window = new WindowPort();
      const normal = window.getBounds();
      window.fullscreen = true;
      window.setFullScreen = vi.fn((fullscreen) => {
        window.fullscreen = fullscreen;
      });
      const { hotkey } = fixture(async () => window);
      const toggled = hotkey.toggle();
      await vi.waitFor(() => expect(window.listenerCount('leave-full-screen')).toBeGreaterThan(0));

      if (action === 'disable') hotkey.configure(false, 'Alt+Space');
      else if (action === 'close') hotkey.close();
      else hotkey.restore();
      await toggled;

      expect(window.bounds).toEqual(normal);
      expect(window.fullscreen).toBe(action !== 'close');
      expect(hotkey.isDropped(window)).toBe(false);
      expect(window.listenerCount('leave-full-screen')).toBe(0);
      const calls = window.setBounds.mock.calls.length;
      window.emit('leave-full-screen');
      expect(window.setBounds).toHaveBeenCalledTimes(calls);
      if (action === 'close') {
        expect(window.visible).toBe(false);
        expect(window.show).not.toHaveBeenCalled();
        expect(window.focus).not.toHaveBeenCalled();
      }
      hotkey.close();
    },
  );

  it('ignores callbacks from replaced bindings and keeps close terminal', async () => {
    const target = vi.fn(async () => new WindowPort());
    const { hotkey, shortcuts } = fixture(target);
    const oldCallback = shortcuts.register.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(oldCallback).toBeTypeOf('function');
    hotkey.configure(true, 'Alt+F1');
    oldCallback?.();
    await Promise.resolve();
    expect(target).not.toHaveBeenCalled();

    hotkey.close();
    const registrations = shortcuts.register.mock.calls.length;
    hotkey.configure(true, 'Alt+Space');
    await hotkey.toggle();
    expect(shortcuts.register).toHaveBeenCalledTimes(registrations);
    expect(target).not.toHaveBeenCalled();
    expect(hotkey.snapshot()).toMatchObject({ registered: false, shortcut: 'Alt+F1' });
  });

  it('registers only on opt-in, preserves a working shortcut on conflict, and restores the normal frame', async () => {
    const window = new WindowPort();
    const shortcuts = { register: vi.fn(() => true), unregister: vi.fn() };
    const hotkey = new HotkeyWindow(
      shortcuts,
      async () => window,
      () => ({ x: 0, y: 25, width: 1920, height: 1000 }),
      () => false,
      () => {},
    );
    hotkey.configure(false, 'Alt+Space');
    expect(shortcuts.register).not.toHaveBeenCalled();
    hotkey.configure(true, 'Alt+Space');
    shortcuts.register.mockReturnValue(false);
    hotkey.configure(true, 'Alt+F1');
    expect(hotkey.snapshot()).toMatchObject({ registered: true, shortcut: 'Alt+Space' });
    expect(hotkey.snapshot().problem).toContain('could not');
    const normal = window.getBounds();
    window.fullscreen = true;
    await hotkey.toggle();
    expect(window.bounds.y).toBe(25);
    expect(hotkey.isDropped(window)).toBe(true);
    expect(window.setBounds).toHaveBeenCalledTimes(1);
    const dropdown = window.getBounds();
    await hotkey.toggle();
    expect(window.bounds).toEqual(dropdown);
    expect(window.fullscreen).toBe(false);
    expect(window.visible).toBe(false);
    expect(hotkey.isDropped(window)).toBe(true);
    hotkey.restore();
    expect(window.bounds).toEqual(normal);
    expect(window.fullscreen).toBe(true);
    expect(window.visible).toBe(true);
    expect(hotkey.isDropped(window)).toBe(false);
    hotkey.close();
  });
});
