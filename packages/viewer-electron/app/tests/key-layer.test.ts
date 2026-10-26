// @vitest-environment jsdom
/**
 * The key layer in the window: ⌃B then a key runs its command; a terminal and a text
 * field keep ⌃B unless the keymap says otherwise; which-key shows the next keys after a moment;
 * plane hints label the planes in view and typing one chooses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { initialize, getState, receiveSettings } from '../src/renderer/state/store';
import { useKeySequences, showKeymapHelp } from '../src/renderer/keys/sequences';
import { WhichKey } from '../src/renderer/keys/WhichKey';
import { PlaneHints, startPlaneHints } from '../src/renderer/keys/PlaneHints';
import {
  hintLabels,
  nearestPlane,
  nextPlane,
  type VisiblePlane,
} from '../src/renderer/keys/planes';

const terminalWrite = vi.fn(async () => {});
beforeEach(() => {
  vi.useFakeTimers();
  terminalWrite.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), terminalWrite } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
const press = (target: Element, key: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};
const setup = () => {
  const invoke = vi.fn(async () => {});
  renderHook(() => useKeySequences(invoke));
  return invoke;
};

describe('a sequence in the window', () => {
  it('runs the command ⌃B and a key name', async () => {
    const invoke = setup();
    expect(press(document.body, 'b', { ctrlKey: true }).defaultPrevented).toBe(true);
    press(document.body, 'c');
    await act(async () => {});
    // a binding is a line, run once
    expect(invoke).toHaveBeenCalledWith(['new-terminal-plane'], 1);
  });
  it('leaves ⌃B to a terminal and a text field, unless told otherwise', async () => {
    const invoke = setup();
    const terminal = Object.assign(document.createElement('div'), { className: 'terminal-plane' });
    terminal.dataset.terminalId = 'shell';
    const input = document.createElement('textarea');
    terminal.append(input);
    const field = document.createElement('input');
    document.body.append(terminal, field);
    expect(press(input, 'b', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(field, 'b', { ctrlKey: true }).defaultPrevented).toBe(false);
    // the keymap lets the prefix into terminals: pressed twice, the shell receives ⌃B
    const snapshot = structuredClone(getState().settings);
    snapshot.revision++;
    snapshot.settings.keymap = { ...snapshot.settings.keymap, inTerminals: true };
    act(() => receiveSettings(snapshot));
    expect(press(input, 'b', { ctrlKey: true }).defaultPrevented).toBe(true);
    press(input, 'b', { ctrlKey: true });
    expect(terminalWrite).toHaveBeenCalledWith('shell', '\u0002');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('shows the next keys after a moment, with their commands', () => {
    setup();
    const view = render(
      createElement(WhichKey, {
        label: (id: string) => ({ label: `Label of ${id}`, available: true }),
      }),
    );
    press(document.body, 'b', { ctrlKey: true });
    expect(view.container.querySelector('.which-key')).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(view.container.textContent).toContain('Label of new-terminal-plane');
    expect(view.container.querySelector('.which-key-trail')?.textContent).toBe('⌃B');
    press(document.body, 'y');
    expect(view.container.textContent).toContain('Not bound');
    act(() => vi.advanceTimersByTime(1000));
    expect(view.container.querySelector('.which-key')).toBeNull();
  });
  it('lists every binding for ?', () => {
    setup();
    const view = render(createElement(WhichKey, { label: () => undefined }));
    act(() => showKeymapHelp());
    expect(view.container.querySelectorAll('.which-key-list li').length).toBe(
      Object.keys(getState().settings.settings.keymap.bindings).length,
    );
    press(document.body, 'x');
    expect(view.container.querySelector('.which-key')).toBeNull();
  });
});

const plane = (paneID: string, left: number, top: number): VisiblePlane => ({
  paneID,
  rect: { left, top, right: left + 100, bottom: top + 100, width: 100, height: 100 },
});
describe('planes on screen', () => {
  const planes = [plane('a', 0, 0), plane('b', 200, 0), plane('c', 0, 200), plane('d', 220, 190)];
  it('finds the plane in a direction, the one in line first', () => {
    expect(nearestPlane(planes, 'a', 'right')).toBe('b');
    expect(nearestPlane(planes, 'a', 'down')).toBe('c');
    expect(nearestPlane(planes, 'b', 'left')).toBe('a');
    expect(nearestPlane(planes, 'a', 'up')).toBeUndefined();
  });
  it('steps through them in reading order, wrapping', () => {
    expect(nextPlane(planes, 'a')).toBe('b');
    expect(nextPlane(planes, 'b')).toBe('c');
    expect(nextPlane(planes, 'd')).toBe('a');
  });
  it('labels them from the home row, then in pairs', () => {
    expect(hintLabels(3)).toEqual(['a', 's', 'd']);
    const many = hintLabels(30);
    expect(new Set(many).size).toBe(30);
    expect(many.every((label) => label.length === 2)).toBe(true);
  });
});

describe('plane hints', () => {
  it('label the planes in view and choose the one typed', () => {
    for (const [id, left] of [
      ['one', 10],
      ['two', 300],
    ] as const) {
      const element = document.createElement('div');
      element.dataset.pluridPlane = 'plane-' + id;
      element.getBoundingClientRect = () =>
        ({ left, top: 10, right: left + 200, bottom: 210, width: 200, height: 200 }) as DOMRect;
      const marker = document.createElement('div');
      marker.dataset.viewerPane = id;
      element.append(marker);
      document.body.append(element);
    }
    const choose = vi.fn();
    const view = render(createElement(PlaneHints));
    act(() => {
      expect(startPlaneHints(choose)).toBe(true);
    });
    expect(
      Array.from(view.container.querySelectorAll('.plane-hint')).map((hint) => hint.textContent),
    ).toEqual(['a', 's']);
    press(document.body, 's');
    expect(choose).toHaveBeenCalledWith('two');
    expect(view.container.querySelector('.plane-hint')).toBeNull();
  });
});

describe('a command that shows something', () => {
  it('stays shown once the sequence that ran it ends: ⌃B ?', async () => {
    const view = render(createElement(WhichKey, { label: () => undefined }));
    const invoke = vi.fn(async (lines: readonly string[]) => {
      if (lines[0] === 'keymap-help') showKeymapHelp();
    });
    renderHook(() => useKeySequences(invoke));
    press(document.body, 'b', { ctrlKey: true });
    press(document.body, '?', { shiftKey: true });
    await act(async () => {});
    expect(view.container.querySelectorAll('.which-key-list li').length).toBeGreaterThan(20);
  });
});

describe('another prefix', () => {
  it('starts a sequence with the chord set, ⌃Space or ⌃A, and not with ⌃B', async () => {
    const invoke = setup();
    for (const prefix of ['Ctrl+Space', 'Ctrl+A']) {
      const snapshot = structuredClone(getState().settings);
      snapshot.revision++;
      snapshot.settings.keymap = { ...snapshot.settings.keymap, prefix };
      act(() => receiveSettings(snapshot));
      expect(press(document.body, 'b', { ctrlKey: true }).defaultPrevented).toBe(false);
      press(document.body, prefix === 'Ctrl+A' ? 'a' : ' ', {
        ctrlKey: true,
        code: prefix === 'Ctrl+A' ? 'KeyA' : 'Space',
      });
      press(document.body, 'c');
      await act(async () => {});
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
