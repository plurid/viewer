// @vitest-environment jsdom
/**
 * Shortcuts in settings: each is recorded by pressing it; a chord another command has
 * is refused and named; a changed one can go back to its default.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { receiveSessionKeys } from '../src/renderer/keys/session';
import { ShortcutSettings } from '../src/renderer/ui/settings/ShortcutSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { defaultSettings, type SettingsSnapshot } from '../src/domain/services';
import type { ApplicationSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';

afterEach(cleanup);
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
const show = (shortcuts: Record<string, string> = {}, more: Partial<ApplicationSettings> = {}) => {
  const patch = vi.fn();
  const snapshot = {
    revision: 1,
    settings: { ...defaultSettings('/fixtures'), shortcuts, ...more },
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
  return { view: render(createElement(ShortcutSettings, { editor })), patch, editor };
};

it('records a shortcut by pressing it, and names one already in use', () => {
  const { view, patch } = show();
  const button = view.getByRole('button', { name: 'Undo shortcut' });
  expect(button.textContent).toBe('⌘Z');
  fireEvent.click(button);
  press('k', { metaKey: true, code: 'KeyK' });
  expect(patch).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toBe('Used by Commands…');
  press('u', { metaKey: true, ctrlKey: true, code: 'KeyU' });
  expect(patch).toHaveBeenLastCalledWith('settings.shortcuts', { 'undo-file': 'Ctrl+Cmd+U' });
});
it('lists a picture’s own keys last, and says when one would take another command’s', () => {
  const { view, patch } = show();
  const rows = [...view.container.querySelectorAll('.settings-row')]
    .filter((row) => row.querySelector('.shortcut-control'))
    .map((row) => row.firstElementChild!.firstChild!.textContent);
  expect(rows.slice(-2)).toEqual(['Rotate Picture Left', 'Rotate Picture Right']);
  const left = view.getByRole('button', { name: 'Rotate Picture Left shortcut' });
  expect(left.textContent).toBe('⌘L');
  // ⌘L is shared on purpose, and both rows say so
  expect(note(view, 'Go to Folder…')).toBe('Over a picture, ⌘L turns it.');
  expect(note(view, 'Rotate Picture Left')).toBe('Elsewhere, Go to Folder… uses ⌘L.');
  expect(note(view, 'Rotate Picture Right')).toBe('');
  // a window command's own chord is taken by the picture key that shares it
  fireEvent.click(view.getByRole('button', { name: 'Undo shortcut' }));
  press('r', { metaKey: true, code: 'KeyR' });
  expect(view.getByRole('alert').textContent).toBe('Used by Rotate Picture Right');
  expect(patch).not.toHaveBeenCalled();
});
/** What a row says under its name. */
const note = (view: ReturnType<typeof render>, label: string) =>
  [...view.container.querySelectorAll('.settings-row')]
    .find((row) => row.firstElementChild!.firstChild!.textContent === label)!
    .querySelector('small')?.textContent ?? '';
const recipe = {
  id: '6f1d1d5e-3c1f-4a43-9d2f-1d6a7d2f0a11',
  name: 'Rename photos',
  kind: 'batch-rename',
  formats: [],
  recursive: false,
  instructions: '',
  template: '{name}',
  data: 'names',
  shortcut: 'Cmd+R',
} as unknown as ApplicationSettings['recipes'][number];
it('leaves ⌘R to a recipe the person put there, and says so in the picture key’s row', () => {
  const { view } = show({}, { recipes: [recipe] });
  expect(view.getByRole('button', { name: 'Rotate Picture Right shortcut' }).textContent).not.toBe(
    '⌘R',
  );
  expect(note(view, 'Rotate Picture Right')).toBe('Rename photos uses ⌘R. Choose another key.');
});
it('gives a command its shipped key back, or none where the person gave that key away, saying so', () => {
  // Undo moved to ⌃⌘U, and its ⌘Z then given to Rotate Picture Right
  const { view, patch } = show({ 'undo-file': 'Ctrl+Cmd+U', 'image-rotate-right': 'Cmd+Z' });
  fireEvent.click(view.getByRole('button', { name: 'Reset Undo' }));
  expect(patch).toHaveBeenLastCalledWith('settings.shortcuts', { 'image-rotate-right': 'Cmd+Z' });
  cleanup();
  // reset, Undo leaves ⌘Z to it, and its row says why it has none
  const after = show({ 'image-rotate-right': 'Cmd+Z' }).view;
  expect(after.getByRole('button', { name: 'Undo shortcut' }).textContent).not.toBe('⌘Z');
  expect(note(after, 'Undo')).toBe('Rotate Picture Right uses ⌘Z. Choose another key.');
});
it('saves only the person’s own keys: pressing the shipped one again saves nothing', () => {
  const { view, patch } = show({ 'undo-file': 'Ctrl+Cmd+U' });
  fireEvent.click(view.getByRole('button', { name: 'Undo shortcut' }));
  press('z', { metaKey: true, code: 'KeyZ' });
  expect(patch).toHaveBeenLastCalledWith('settings.shortcuts', {});
});
it('puts a changed shortcut back to its default', () => {
  const { view, patch } = show({ 'undo-file': 'Ctrl+Cmd+U' });
  fireEvent.click(view.getByRole('button', { name: 'Reset Undo' }));
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

it('records shifted punctuation by its physical key for shortcut conflicts', () => {
  const { view, patch } = show();
  fireEvent.click(view.getByRole('button', { name: 'Undo shortcut' }));
  press('>', { metaKey: true, shiftKey: true, code: 'Period' });
  expect(patch).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain('Show or Hide Hidden Files');
});

it('reports rejected session Keep and Discard in Settings', async () => {
  receiveSessionKeys({ bindings: [], aliases: [{ name: 'Test', line: 'frame-all' }] });
  Object.assign(window, {
    viewer: {
      sessionKeysKeep: vi.fn().mockRejectedValue(new Error('Keep failed')),
      sessionKeysDiscard: vi.fn().mockRejectedValue(new Error('Discard failed')),
    },
  });
  try {
    const { view, editor } = show();
    for (const button of ['Keep', 'Discard']) {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: button }));
      });
      expect(editor.error).toHaveBeenCalledWith(button + ' failed');
    }
  } finally {
    receiveSessionKeys({ bindings: [], aliases: [] });
  }
});

it('preserves a rejected key binding until its own table acknowledges the edit', () => {
  const { view, editor, patch } = show();
  const chooseTable = (name: string) => {
    fireEvent.click(view.getByRole('button', { name: /Key table/ }));
    fireEvent.click(view.getByRole('menuitemradio', { name }));
  };
  chooseTable('No prefix');
  fireEvent.click(view.getByRole('button', { name: "New binding's keys" }));
  press('z');
  press('Enter');
  const line = view.getByLabelText("New binding's line") as HTMLInputElement;
  fireEvent.change(line, { target: { value: 'dock' } });
  const add = () => fireEvent.click(view.getByRole('button', { name: 'Add' }));
  add();
  expect(editor.error).toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
  chooseTable('Prefix');
  expect(line.value).toBe('dock');
  fireEvent.change(line, { target: { value: 'frame-all' } });
  add();
  expect(line.value).toBe('frame-all');
  const [, keymap] = patch.mock.lastCall!;
  const snapshot = {
    ...editor.snapshot,
    revision: editor.snapshot.revision + 1,
    settings: { ...editor.snapshot.settings, keymap },
  };
  view.rerender(createElement(ShortcutSettings, { editor: { ...editor, snapshot } }));
  expect(line.value).toBe('');
});
