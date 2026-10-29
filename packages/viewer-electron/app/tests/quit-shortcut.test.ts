import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUIT_AGAIN_MS, QuitShortcut } from '../src/desktop/windows/quit-shortcut';

function fixture({ warns = true, visible = true } = {}) {
  const host = {
    warns: vi.fn(() => warns),
    hint: vi.fn((_duration: number) => visible),
    quit: vi.fn(),
  };
  return { host, shortcut: new QuitShortcut(host) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('⌘Q twice to quit', () => {
  it('shows the hint on the first press and quits on a second within the moment', () => {
    const { host, shortcut } = fixture();
    shortcut.request(true);
    expect(host.hint).toHaveBeenCalledExactlyOnceWith(QUIT_AGAIN_MS);
    expect(host.quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(QUIT_AGAIN_MS - 1);
    shortcut.request(true);
    expect(host.quit).toHaveBeenCalledOnce();
    expect(host.hint).toHaveBeenCalledOnce();
  });

  it('shows the hint again once the moment has passed', () => {
    const { host, shortcut } = fixture();
    shortcut.request(true);
    vi.advanceTimersByTime(QUIT_AGAIN_MS);
    shortcut.request(true);
    expect(host.hint).toHaveBeenCalledTimes(2);
    expect(host.quit).not.toHaveBeenCalled();
  });

  it('shows the hint again once the moment has passed, though no timer ran meanwhile', () => {
    // A background app's timers can be held back: the moment is measured, not waited for.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['performance'] });
    const { host, shortcut } = fixture();
    shortcut.request(true);
    vi.advanceTimersByTime(QUIT_AGAIN_MS);
    shortcut.request(true);
    expect(host.hint).toHaveBeenCalledTimes(2);
    expect(host.quit).not.toHaveBeenCalled();
  });

  it('starts over after quitting, so a kept-open Viewer asks for two presses again', () => {
    const { host, shortcut } = fixture();
    shortcut.request(true);
    shortcut.request(true);
    shortcut.request(true);
    expect(host.quit).toHaveBeenCalledOnce();
    expect(host.hint).toHaveBeenCalledTimes(2);
  });

  it('quits at once when Quit is chosen from the menu, even after a first press', () => {
    const { host, shortcut } = fixture();
    shortcut.request(false);
    expect(host.quit).toHaveBeenCalledOnce();
    shortcut.request(true);
    shortcut.request(false);
    expect(host.quit).toHaveBeenCalledTimes(2);
    expect(host.hint).toHaveBeenCalledOnce();
  });

  it.each([
    ['the warning is off', { warns: false }],
    ['no Viewer window is visible', { visible: false }],
  ])('quits on the first press when %s', (_reason, options) => {
    const { host, shortcut } = fixture(options);
    shortcut.request(true);
    expect(host.quit).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(QUIT_AGAIN_MS);
    shortcut.request(true);
    expect(host.quit).toHaveBeenCalledTimes(2);
  });
});
