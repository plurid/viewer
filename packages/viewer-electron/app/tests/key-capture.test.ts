// @vitest-environment jsdom
/**
 * Press to set a key: every shortcut, the prefix, the leader and a binding's keys are
 * recorded by pressing them. Escape keeps the key; Backspace clears it.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { KeyCapture } from '../src/renderer/ui/settings/KeyCapture';
import { keyGlyphs } from '../src/domain/preferences/keymap';
import { shortcutLabel, shortcutOwner } from '../src/domain/preferences/shortcuts';
import { defaultSettings } from '../src/domain/services';

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
  expect(shortcutOwner(settings, 'Cmd+K', 'go-to')).toBe('Palette');
  expect(shortcutOwner(settings, 'Cmd+K', 'palette')).toBeUndefined();
  expect(shortcutOwner(settings, 'Ctrl+B', 'palette')).toBe('Prefix key');
  expect(shortcutOwner(settings, 'Ctrl+Cmd+Y', 'palette')).toBeUndefined();
  expect(shortcutLabel('undo-file')).toBe('Undo file');
  expect(shortcutLabel('bookmark.3')).toBe('Go to view 3');
  expect(shortcutLabel('bookmark.save.3')).toBe('Save view as 3');
});
