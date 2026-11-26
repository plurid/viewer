// @vitest-environment jsdom
/**
 * Press to set a key: every shortcut, the prefix, the leader and a binding's keys are
 * recorded by pressing them. Escape keeps the key; Backspace clears it.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { KeyCapture } from '../src/renderer/ui/settings/KeyCapture';
import { canonicalKey, keyGlyphs, keyName, validKeymapKey } from '../src/domain/preferences/keymap';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';
import {
  accelerator,
  matchesShortcut,
  shortcutGlyphs,
  shortcutLabel,
  shortcutOwner,
} from '../src/domain/preferences/shortcuts';
import { defaultSettings } from '../src/domain/services';
import { keyCommand, windowKeyCommand } from '../src/renderer/explorer/input';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { useKeySequences } from '../src/renderer/keys/sequences';
import { receiveSessionKeys } from '../src/renderer/keys/session';
import { emptySessionKeys } from '../src/domain/preferences/session-keys';
import { getState, initialize, receiveSettings } from '../src/renderer/state/store';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
const capture = (props: Partial<Parameters<typeof KeyCapture>[0]> = {}) => {
  const onChange = vi.fn();
  // as Settings has it: inside a row's label, which passes a click on to its button
  const view = render(
    createElement(
      'label',
      { className: 'settings-row' },
      createElement('span', null, 'Prefix'),
      createElement(KeyCapture, {
        label: 'Prefix',
        kind: 'shortcut',
        value: 'Ctrl+B',
        onChange,
        ...props,
      }),
    ),
  );
  return { view, onChange, button: view.getByRole('button', { name: 'Prefix' }) };
};

it('listens after one click, even inside a settings row, and takes the chord pressed', () => {
  const { button, onChange } = capture();
  expect(button.textContent).toBe('⌃B');
  fireEvent.click(button);
  expect(button.textContent).toBe('Press keys…');
  press('a');
  expect(onChange).not.toHaveBeenCalled();
  press('a', { ctrlKey: true, code: 'KeyA' });
  expect(onChange).toHaveBeenLastCalledWith('Ctrl+A');
  fireEvent.click(button);
  press('z', { metaKey: true, shiftKey: true, code: 'KeyZ' });
  expect(onChange).toHaveBeenLastCalledWith('Shift+Cmd+Z');
});
it('says which command has the chord already, and keeps the key', () => {
  const { button, onChange, view } = capture({
    owner: (value) => (value === 'Cmd+K' ? 'Palette' : undefined),
  });
  fireEvent.click(button);
  press('k', { metaKey: true, code: 'KeyK' });
  expect(onChange).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toBe('Used by Palette');
});
it('keeps the key on Escape and clears it on Backspace', () => {
  const { button, onChange } = capture();
  fireEvent.click(button);
  press('Escape');
  expect(onChange).not.toHaveBeenCalled();
  expect(button.textContent).toBe('⌃B');
  fireEvent.click(button);
  press('Backspace');
  expect(onChange).toHaveBeenLastCalledWith('');
});
it('takes any key as the leader', () => {
  const { button, onChange } = capture({ kind: 'leader', value: '' });
  expect(button.textContent).toBe('Off');
  fireEvent.click(button);
  press(' ');
  expect(onChange).toHaveBeenLastCalledWith('Space');
});
it('records a binding’s keys in turn, ending with Enter or a pause', () => {
  vi.useFakeTimers();
  const { button, onChange } = capture({ kind: 'sequence', value: 'b s' });
  // case matters in bindings: E is not e
  expect(button.textContent).toBe('b s');
  fireEvent.click(button);
  press('g');
  press('d');
  expect(button.textContent).toBe('g d…');
  press('Enter');
  expect(onChange).toHaveBeenLastCalledWith('g d');
  fireEvent.click(button);
  press('%', { shiftKey: true, code: 'Digit5' });
  act(() => vi.advanceTimersByTime(1300));
  expect(onChange).toHaveBeenLastCalledWith('%');
});

it('shows modifiers in the Mac’s order', () => {
  expect(keyGlyphs('Shift+Cmd+Z')).toBe('⇧⌘Z');
  expect(keyGlyphs('Cmd+Alt+Shift+Z')).toBe('⌥⇧⌘Z');
  expect(keyGlyphs('Ctrl+Cmd+N')).toBe('⌃⌘N');
});
it('finds what has a shortcut already, and names commands in words', () => {
  const settings = defaultSettings('/fixtures');
  expect(shortcutOwner(settings, 'Cmd+K', 'go-to')).toBe('Commands…');
  expect(shortcutOwner(settings, 'Cmd+K', 'palette')).toBeUndefined();
  expect(shortcutOwner(settings, 'Ctrl+B', 'palette')).toBe('Prefix key');
  expect(shortcutOwner(settings, 'Ctrl+Cmd+Y', 'palette')).toBeUndefined();
  expect(shortcutLabel('undo-file')).toBe('Undo');
  expect(shortcutLabel('toggle-hidden')).toBe('Show or Hide Hidden Files');
  expect(shortcutLabel('bookmark.3')).toBe('Go to View 3');
  expect(shortcutLabel('bookmark.save.3')).toBe('Save View as 3');
});

it.each([
  { key: '-', code: 'Slash', metaKey: true },
  { key: 'q', code: 'KeyA', ctrlKey: true },
])('dispatches the unshifted character recorded on another layout', (init) => {
  const { button, onChange } = capture();
  fireEvent.click(button);
  const event = new KeyboardEvent('keydown', init);
  act(() => {
    window.dispatchEvent(event);
  });
  expect(matchesShortcut(onChange.mock.lastCall![0], event)).toBe(true);
});

it.each([
  ['+', 'BracketRight', 'Plus'],
  ['ß', 'Minus', 'ß'],
  ['ı', 'KeyI', 'ı'],
  ['İ', 'KeyI', 'İ'],
])('round-trips the recorded Command shortcut for %s through Settings', (key, code, native) => {
  const { button, onChange } = capture();
  fireEvent.click(button);
  const event = new KeyboardEvent('keydown', { key, code, metaKey: true });
  act(() => {
    window.dispatchEvent(event);
  });
  const chord = onChange.mock.lastCall![0];
  const settings = defaultSettings('/fixtures');
  settings.shortcuts = { palette: chord };
  expect(settingsSchema.parse(settings).shortcuts.palette).toBe('Cmd+' + key);
  expect(matchesShortcut(chord, event)).toBe(true);
  expect(shortcutGlyphs(chord)).toBe('⌘' + key);
  expect(keyGlyphs(chord)).toBe('⌘' + key);
  expect(accelerator(chord)).toBe('Command+' + native);
});

it('keeps listening after a shortcut the settings schema cannot store', () => {
  const { button, onChange, view } = capture();
  fireEvent.click(button);
  press('Dead', { metaKey: true, code: 'Quote' });
  expect(onChange).not.toHaveBeenCalled();
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(view.getByRole('alert').textContent).toContain('shortcut');
  press('+', { metaKey: true, code: 'BracketRight' });
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Cmd++');
});

it.each(['+', 'ß', 'İ'])('keeps %s as a single key when recording a no-prefix binding', (key) => {
  const { button, onChange } = capture({ kind: 'sequence', value: '' });
  fireEvent.click(button);
  press(key, { metaKey: true });
  press('Enter');
  const chord = onChange.mock.lastCall![0];
  expect(validKeymapKey(chord)).toBe(true);
  expect(canonicalKey(chord)).toBe(keyName(new KeyboardEvent('keydown', { key, metaKey: true })));
  expect(chord).toBe('Cmd+' + key);
});

function record(settings: ReturnType<typeof defaultSettings>, id: string, event: KeyboardEvent) {
  const { button, onChange, view } = capture({
    owner: (chord) => shortcutOwner(settings, chord, id),
  });
  fireEvent.click(button);
  act(() => {
    window.dispatchEvent(event);
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  const chord = onChange.mock.lastCall![0];
  settings.shortcuts[id] = chord;
  view.unmount();
  return chord;
}

const plusKey = (code: string, shiftKey = true) =>
  new KeyboardEvent('keydown', {
    key: '+',
    code,
    location: code === 'NumpadAdd' ? 3 : 0,
    shiftKey,
    metaKey: true,
  });

it.each([
  ['palette', 'focus-mode'],
  ['focus-mode', 'palette'],
])('dispatches main and keypad plus after assigning %s then %s', (first, second) => {
  const keypad = plusKey('NumpadAdd');
  const main = plusKey('Equal');
  for (const keypadFirst of [true, false]) {
    const settings = defaultSettings('/fixtures');
    const [plus, equals] = keypadFirst ? [first, second] : [second, first];
    expect(record(settings, first, keypadFirst ? keypad : main)).toBe(
      keypadFirst ? 'Shift+Cmd++' : 'Shift+Cmd+=',
    );
    expect(record(settings, second, keypadFirst ? main : keypad)).toBe(
      keypadFirst ? 'Shift+Cmd+=' : 'Shift+Cmd++',
    );
    const saved = settingsSchema.parse(settings);
    expect(keyCommand(keypad, saved)).toBe(plus);
    expect(keyCommand(main, saved)).toBe(equals);
  }
});

it('keeps a single saved shifted plus usable on both keyboards', () => {
  const settings = defaultSettings('/fixtures');
  expect(record(settings, 'palette', plusKey('NumpadAdd'))).toBe('Shift+Cmd++');
  const saved = settingsSchema.parse(settings);
  expect(keyCommand(plusKey('NumpadAdd'), saved)).toBe('palette');
  expect(keyCommand(plusKey('Equal'), saved)).toBe('palette');
});

it.each([
  ['+', 'BracketRight', 'preview.zoom-in'],
  ['=', 'Equal', 'preview.zoom-in'],
  ['-', 'Minus', 'preview.zoom-out'],
])('keeps the saved Command-%s owner in folders and zoomable previews', (key, code, zoomID) => {
  const settings = defaultSettings('/fixtures');
  const event = new KeyboardEvent('keydown', { key, code, metaKey: true });
  expect(record(settings, 'focus-mode', event)).toBe('Cmd+' + key);
  const saved = settingsSchema.parse(settings);
  const registry = new CommandRegistry();
  registry.register('preview:picture', {
    context: () => ({
      scope: 'preview',
      paneID: 'picture',
      workspaceID: 'space',
      jobs: [],
      selection: [],
      clipboard: null,
    }),
    definitions: () => [
      { id: zoomID, label: 'Zoom', group: 'Preview', when: () => true, run: vi.fn() },
    ],
  });
  const route = (paneID: string, prefs: typeof saved) =>
    windowKeyCommand(event, prefs, (ids) => registry.list({ ids, paneID })[0]);

  expect(route('folder', saved)).toBe('focus-mode');
  expect(route('picture', saved)).toBe('focus-mode');
  const free = defaultSettings('/fixtures');
  expect(route('folder', free)).toBeUndefined();
  expect(route('picture', free)).toMatchObject({ id: zoomID });
});

it('gives Option-C to Copy Path and preserves a saved Option-Ç on a key with no other owner', () => {
  const settings = defaultSettings('/fixtures');
  settings.shortcuts = { palette: 'Alt+Cmd+Ç' };
  const saved = settingsSchema.parse(settings);
  const key = (code: string) =>
    new KeyboardEvent('keydown', {
      key: 'ç',
      code,
      altKey: true,
      metaKey: true,
    });
  expect(keyCommand(key('KeyC'), saved)).toBe('copy-path');
  expect(keyCommand(key('IntlBackslash'), saved)).toBe('palette');
});

it.each([
  ['saved', 'NumpadAdd', false, 'Equal'],
  ['saved', 'NumpadAdd', true, 'Equal'],
  ['session', 'NumpadAdd', false, 'Equal'],
  ['session', 'NumpadAdd', true, 'Equal'],
  ['saved', 'Equal', true, 'NumpadAdd'],
  ['session', 'Equal', true, 'NumpadAdd'],
] as const)(
  'routes a %s No Prefix binding on %s (Shift %s) beside a shortcut on %s',
  async (source, bindingCode, shifted, shortcutCode) => {
    Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
    initialize({
      home: '/fixtures',
      platform: 'darwin',
      state: null,
      locations: [],
      openPaths: [],
    });
    const snapshot = structuredClone(getState().settings);
    const { button, onChange, view } = capture({ kind: 'sequence', value: '' });
    fireEvent.click(button);
    act(() => {
      window.dispatchEvent(plusKey(bindingCode, shifted));
    });
    press('Enter');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Cmd++');
    const binding = onChange.mock.lastCall![0];
    view.unmount();
    if (source === 'saved') snapshot.settings.keymap.root[binding] = 'frame-all';
    expect(record(snapshot.settings, 'focus-mode', plusKey(shortcutCode))).toBe(
      shortcutCode === 'Equal' ? 'Shift+Cmd+=' : 'Shift+Cmd++',
    );
    snapshot.settings = settingsSchema.parse(snapshot.settings);
    snapshot.revision++;
    receiveSettings(snapshot);
    receiveSessionKeys(
      source === 'session'
        ? { bindings: [{ table: 'root', keys: [binding], line: 'frame-all' }], aliases: [] }
        : emptySessionKeys,
    );

    const commands: string[] = [];
    renderHook(() =>
      useKeySequences(async (lines) => {
        commands.push(...lines);
      }),
    );
    const windowRoute = (event: KeyboardEvent) => {
      const id = windowKeyCommand(event, getState().settings.settings, () => undefined);
      if (typeof id === 'string') commands.push(id);
    };
    const dispatch = (code: string, shiftKey = true) =>
      act(async () => {
        document.body.dispatchEvent(plusKey(code, shiftKey));
      });
    window.addEventListener('keydown', windowRoute, true);
    try {
      await dispatch(bindingCode, shifted);
      await dispatch(shortcutCode);
      expect(commands).toEqual(['frame-all', 'focus-mode']);

      const free = structuredClone(getState().settings);
      free.revision++;
      free.settings.shortcuts['focus-mode'] = '';
      act(() => receiveSettings(free));
      await dispatch(shortcutCode);
      expect(commands).toEqual(['frame-all', 'focus-mode', 'frame-all']);
    } finally {
      window.removeEventListener('keydown', windowRoute, true);
      receiveSessionKeys(emptySessionKeys);
    }
  },
);
