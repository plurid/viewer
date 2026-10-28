// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchSettings } from '../src/renderer/ui/settings/SearchSettings';
import type { SettingsEditor } from '../src/renderer/ui/settings/editor';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { saveSettingsChange } from '../src/renderer/ui/settings/settings-edits';
import { settingsDiscovery } from '../src/renderer/ui/settings/discovery';

afterEach(cleanup);
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
  fireEvent.click(screen.getByRole('button', { name: 'Add common exclusions' }));
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
