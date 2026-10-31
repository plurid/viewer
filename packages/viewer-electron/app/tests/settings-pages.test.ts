// @vitest-environment jsdom
/**
 * One switch for each on/off setting on its Settings page. A page's own controls had drawn a second
 * toggle for Global shortcut beside the catalog's row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { DesktopEvent } from '../src/domain/contracts';
import type { SettingsSnapshot } from '../src/domain/services';
import { SettingsWindow } from '../src/renderer/ui/settings/Settings';
import { categories, settingCatalog, settingValue } from '../src/domain/preferences/catalog';
import { getState, initialize } from '../src/renderer/state/store';

type Listener = (event: DesktopEvent) => void;
const listeners = new Set<Listener>();
let snapshot: SettingsSnapshot;
beforeEach(() => {
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  snapshot = structuredClone(getState().settings);
  const stubs: Record<string, unknown> = {
    settingsGet: async () => snapshot,
    onEvent: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  Object.assign(window, {
    viewer: new Proxy(stubs, {
      get: (target, key: string) => target[key] ?? vi.fn(async () => undefined),
    }),
  });
});
afterEach(() => cleanup());

/** `snapshot` with the on/off setting at `path` turned the other way, as a newer revision. */
function toggled(path: string): SettingsSnapshot {
  const next = structuredClone(snapshot);
  next.revision++;
  const keys = path.split('.');
  let target = next as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = settingValue(snapshot, path) !== true;
  return next;
}

describe('Settings pages', () => {
  it('focuses search on open and selects the previous query on explicit reopen', async () => {
    const view = render(createElement(SettingsWindow));
    const search = (await view.findByRole('textbox', {
      name: 'Search settings',
    })) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: 'header' } });
    search.blur();
    act(() => listeners.forEach((listener) => listener({ type: 'settings-focus' })));
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe(6);
    search.blur();
    snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    act(() => listeners.forEach((listener) => listener({ type: 'settings', snapshot })));
    expect(document.activeElement).not.toBe(search);
  });

  it('draw one switch for each on/off setting', async () => {
    const view = render(createElement(SettingsWindow));
    await waitFor(() => expect(view.getByRole('heading', { level: 1 })).toBeTruthy());
    const switches = () =>
      [
        ...view.container.querySelectorAll<HTMLInputElement>(
          '.settings-page input[type="checkbox"]',
        ),
      ].map((input) => input.checked);
    for (const category of categories) {
      const definitions = settingCatalog.filter(
        (definition) => definition.category === category && definition.kind === 'boolean',
      );
      if (!definitions.length) continue;
      fireEvent.click(view.getByRole('button', { name: category }));
      await waitFor(() =>
        expect(view.getByRole('heading', { level: 1 }).textContent).toBe(category),
      );
      for (const { path } of definitions) {
        const before = switches();
        snapshot = toggled(path);
        act(() => listeners.forEach((listener) => listener({ type: 'settings', snapshot })));
        const row = () =>
          view.container.querySelector<HTMLInputElement>(
            `[data-setting-path="${CSS.escape(path)}"] input[type="checkbox"]`,
          );
        await waitFor(() => expect(row()?.checked, path).toBe(settingValue(snapshot, path)));
        const changed = switches().filter((checked, index) => checked !== before[index]);
        expect(changed, `${category}: ${path}`).toHaveLength(1);
      }
    }
  });
});
