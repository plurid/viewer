// @vitest-environment jsdom
/**
 * SHORTCUTS IN SETTINGS (2026-10-23): each is recorded by pressing it; a chord another command has
 * is refused and named; a changed one can go back to its default.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { ShortcutSettings } from '../src/renderer/ui/settings/ShortcutSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { defaultSettings, type SettingsSnapshot } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';

afterEach(cleanup);
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
const show = (shortcuts: Record<string, string> = {}) => {
  const patch = vi.fn();
  const snapshot = {
    revision: 1,
    settings: { ...defaultSettings('/fixtures'), shortcuts },
    ui: normalizePreferences(),
    look: 'dark',
    credentials: [],
  } as SettingsSnapshot;
  const editor = {
    snapshot,
    patch,
    patches: vi.fn(),
    save: vi.fn(),
    error: vi.fn(),
  } as SettingsEditor;
  return { view: render(createElement(ShortcutSettings, { editor })), patch };
};

it('records a shortcut by pressing it, and names one already in use', () => {
  const { view, patch } = show();
  const button = view.getByRole('button', { name: 'Undo file shortcut' });
  expect(button.textContent).toBe('⌘Z');
  fireEvent.click(button);
  press('k', { metaKey: true, code: 'KeyK' });
  expect(patch).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toBe('Used by Palette');
  press('u', { metaKey: true, ctrlKey: true, code: 'KeyU' });
  expect(patch).toHaveBeenLastCalledWith('settings.shortcuts', { 'undo-file': 'Ctrl+Cmd+U' });
});
it('puts a changed shortcut back to its default', () => {
  const { view, patch } = show({ 'undo-file': 'Ctrl+Cmd+U' });
  fireEvent.click(view.getByRole('button', { name: 'Reset Undo file' }));
  expect(patch).toHaveBeenLastCalledWith('settings.shortcuts', {});
});
it('sets the prefix by pressing it', () => {
  const { view, patch } = show();
  fireEvent.click(view.getByRole('button', { name: 'Prefix' }));
  press('a', { ctrlKey: true, code: 'KeyA' });
  expect(patch).toHaveBeenLastCalledWith(
    'settings.keymap',
    expect.objectContaining({ prefix: 'Ctrl+A', leader: '', whichKey: true }),
  );
});
it('is found by searching Settings for “shortcut”', async () => {
  const { settingsDiscovery } = await import('../src/renderer/ui/settings/discovery');
  const settings = defaultSettings('/fixtures');
  for (const query of ['shortcut', 'Shortcuts', 'prefix', 'tmux'])
    expect(
      settingsDiscovery(settings, query).map((item) => item.category),
      query,
    ).toContain('Shortcuts');
});
