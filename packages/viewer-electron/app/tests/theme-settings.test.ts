// @vitest-environment jsdom
/**
 * THE THEMES PAGE AND COMMANDS (2026-10-23): a theme for each appearance; a new theme, an imported
 * one, a colour changed; and Theme: … in the palette.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { ThemeSettings } from '../src/renderer/ui/settings/ThemeSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { defaultSettings, type SettingsSnapshot } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import { builtInThemes, type Theme } from '../src/domain/themes';

afterEach(cleanup);
const show = (themes: Theme[] = []) => {
  const patch = vi.fn();
  const snapshot = {
    revision: 1,
    settings: { ...defaultSettings('/fixtures'), themes },
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
  return { view: render(createElement(ThemeSettings, { editor })), patch, editor };
};

it('makes a new theme from the built-in one and uses it', () => {
  const { view, patch } = show();
  fireEvent.click(view.getByRole('button', { name: 'New theme' }));
  const [themes] = patch.mock.calls.find(([path]) => path === 'settings.themes')!.slice(1);
  expect((themes as Theme[])[0]).toMatchObject({ look: 'dark', name: 'Custom Viewer Dark' });
  expect(patch).toHaveBeenCalledWith('settings.theme', {
    dark: (themes as Theme[])[0]!.id,
    light: '',
  });
});
it('imports a VS Code theme from a file', async () => {
  const { view, patch } = show();
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(
    ['{ "name": "Night", "type": "dark", "colors": { "editor.background": "#011627" } }'],
    'night.json',
  );
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      'settings.themes',
      expect.arrayContaining([
        expect.objectContaining({ name: 'Night', shell: { space: '#011627' } }),
      ]),
    ),
  );
});
it('changes one colour of a theme, leaving the rest', () => {
  const theme: Theme = {
    ...builtInThemes[0],
    id: 'mine',
    name: 'Mine',
    shell: {},
    syntax: {},
    terminal: {},
  };
  const { view, patch } = show([theme]);
  fireEvent.click(view.getByText('Mine'));
  fireEvent.change(view.getByLabelText('Accent'), { target: { value: '#ff8800' } });
  expect(patch).toHaveBeenLastCalledWith('settings.themes', [
    expect.objectContaining({ id: 'mine', shell: { accent: '#ff8800' } }),
  ]);
});
