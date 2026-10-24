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
  getBounds = () => ({ ...this.bounds });
  setBounds = vi.fn((bounds: WindowBounds) => {
    this.bounds = { ...bounds };
  });
  setFullScreen = (fullscreen: boolean) => {
    this.fullscreen = fullscreen;
    if (!fullscreen) queueMicrotask(() => this.emit('leave-full-screen'));
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

function fixture(target: () => Promise<WindowPort | undefined>) {
  const shortcuts = {
    register: vi.fn((_shortcut: string, _callback: () => void) => true),
    unregister: vi.fn(),
  };
  const changed = vi.fn();
  const hotkey = new HotkeyWindow(
    shortcuts,
    target,
    () => ({ x: 0, y: 25, width: 1920, height: 1000 }),
    () => false,
    changed,
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
      await vi.waitFor(() => expect(window.listenerCount('leave-full-screen')).toBe(1));

      if (action === 'disable') hotkey.configure(false, 'Alt+Space');
      else if (action === 'close') hotkey.close();
      else hotkey.restore();
      await toggled;

      expect(window.bounds).toEqual(normal);
      expect(window.fullscreen).toBe(true);
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
    await hotkey.toggle();
    expect(window.bounds).toEqual(normal);
    expect(window.fullscreen).toBe(true);
    expect(window.visible).toBe(false);
    expect(hotkey.isDropped(window)).toBe(false);
    hotkey.close();
  });
});
