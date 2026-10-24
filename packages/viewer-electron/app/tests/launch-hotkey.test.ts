import { EventEmitter } from 'node:events';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseLaunch } from '../src/domain/launch';
import { HotkeyWindow, type WindowBounds } from '../src/desktop/hotkey-window';

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
  show = () => {
    this.visible = true;
  };
  hide = () => {
    this.visible = false;
    this.focused = false;
  };
  focus = () => {
    this.focused = true;
  };
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
