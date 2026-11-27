// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchSettings } from '../src/renderer/ui/settings/SearchSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { saveSettingsChange } from '../src/renderer/ui/settings/settings-edits';
import { settingsDiscovery } from '../src/renderer/ui/settings/discovery';

import { PathHome } from '../src/renderer/ui/PathLabel';

afterEach(cleanup);
it('shows home-relative exclusions and saves absolute paths while keeping bare folder names', () => {
  const home = '/sample/home';
  const settings = defaultSettings(home);
  settings.search.exclusions = [home + '/Library', '~', home, 'node_modules'];
  Object.assign(window, {
    viewer: {
      indexStatus: vi.fn(async () => ({ roots: [], count: 0, running: false })),
      onEvent: () => () => {},
    },
  });
  const editor: SettingsEditor = {
    snapshot: {
      revision: 1,
      settings,
      look: 'dark',
      credentials: [],
      ui: normalizePreferences({}),
    },
    error: vi.fn(),
    patch: vi.fn(),
    patches: vi.fn(),
    save: vi.fn(),
  };
  render(
    <PathHome.Provider value={home}>
      <SearchSettings editor={editor} />
    </PathHome.Provider>,
  );
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Excluded search names and paths',
  });
  expect(input.value).toBe('~/Library\n~\n~/\nnode_modules');
  fireEvent.change(input, { target: { value: input.value + '\n~/Cache' } });
  fireEvent.blur(input);
  expect(editor.patch).toHaveBeenCalledWith('settings.search.exclusions', [
    ...settings.search.exclusions,
    home + '/Cache',
  ]);
});
it('merges common exclusions after a preceding textarea blur has saved, without losing custom rules', async () => {
  const current = {
    revision: 0,
    settings: defaultSettings('/fixture'),
    ui: normalizePreferences(),
    look: 'dark' as const,
    credentials: [],
  };
  current.settings.search.exclusions = ['node_modules'];
  const errors = vi.fn();
  Object.assign(window, {
    viewer: {
      indexStatus: async () => ({ roots: [], count: 0, running: false }),
      onEvent: () => () => {},
    },
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let queued: Promise<void> = Promise.resolve();
  const editor: SettingsEditor = {
    snapshot: current,
    error: errors,
    patches: vi.fn(),
    patch: (_path, value) => {
      queued = gate.then(() => {
        current.settings.search.exclusions = value as string[];
        current.revision++;
      });
    },
    save: (change) => {
      queued = saveSettingsChange(
        queued,
        {
          current: () => current,
          write: async (patches) => {
            current.settings.search.exclusions = patches[0]!.value as string[];
            current.revision++;
            return current;
          },
          refresh: async () => current,
          accept: () => {},
          error: errors,
        },
        change,
      );
    },
  };
  render(<SearchSettings editor={editor} />);
  const input = screen.getByRole('textbox', { name: 'Excluded search names and paths' });
  fireEvent.change(input, { target: { value: 'node_modules\nprivate-project-cache' } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole('button', { name: 'Add Common Exclusions' }));
  finish();
  await act(() => queued);
  expect(errors).not.toHaveBeenCalled();
  expect(current.settings.search.exclusions).toEqual(
    expect.arrayContaining(['private-project-cache', 'node_modules', '.venv', '__pycache__']),
  );
});

it('finds exclusions by dependency and environment names, including before defaults are adopted', () => {
  const settings = defaultSettings('/fixture');
  settings.search.exclusions = ['private-project-cache'];
  for (const query of ['node_modules', '.venv', 'Python', 'exclude', 'private-project-cache'])
    expect(settingsDiscovery(settings, query).map((item) => item.category)).toContain('Search');
});
