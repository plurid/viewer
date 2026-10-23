// @vitest-environment jsdom
/**
 * SETTING THE PREFIX BY PRESSING IT (2026-10-23), as tmux's `set -g prefix C-a` sets it by name:
 * click, press ⌃A. A prefix needs ⌃ or ⌘; Escape keeps the key; Backspace turns it off.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { KeyCapture } from '../src/renderer/ui/settings/KeyCapture';

afterEach(cleanup);
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });

it('sets the prefix to the chord pressed, showing it as a Mac does', () => {
  const onChange = vi.fn();
  const view = render(
    createElement(KeyCapture, { label: 'Prefix', kind: 'prefix', value: 'Ctrl+B', onChange }),
  );
  const button = view.getByRole('button', { name: 'Prefix' });
  expect(button.textContent).toBe('⌃B');
  fireEvent.click(button);
  expect(button.textContent).toBe('Press a key…');
  press('a');
  expect(onChange).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain('⌃ or ⌘');
  press('a', { ctrlKey: true, code: 'KeyA' });
  expect(onChange).toHaveBeenLastCalledWith('Ctrl+A');
  fireEvent.click(button);
  press(' ', { ctrlKey: true, code: 'Space' });
  expect(onChange).toHaveBeenLastCalledWith('Ctrl+Space');
});
it('keeps the key on Escape and turns it off on Backspace', () => {
  const onChange = vi.fn();
  const view = render(
    createElement(KeyCapture, { label: 'Prefix', kind: 'prefix', value: 'Ctrl+B', onChange }),
  );
  const button = view.getByRole('button', { name: 'Prefix' });
  fireEvent.click(button);
  press('Escape');
  expect(onChange).not.toHaveBeenCalled();
  expect(button.textContent).toBe('⌃B');
  fireEvent.click(button);
  press('Backspace');
  expect(onChange).toHaveBeenLastCalledWith('');
});
it('takes any key as the leader', () => {
  const onChange = vi.fn();
  const view = render(
    createElement(KeyCapture, { label: 'Leader', kind: 'leader', value: '', onChange }),
  );
  expect(view.getByRole('button', { name: 'Leader' }).textContent).toBe('Off');
  fireEvent.click(view.getByRole('button', { name: 'Leader' }));
  press(' ');
  expect(onChange).toHaveBeenLastCalledWith('Space');
});
