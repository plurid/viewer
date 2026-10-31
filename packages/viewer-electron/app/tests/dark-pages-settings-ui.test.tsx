// @vitest-environment jsdom
/**
 * SETTINGS → PREVIEWS → DARK PAGES: a choice of Off, On, At night and With macOS dark mode. At night
 * shows the night's times beneath it, saved as they change; both automatic modes say how pages are
 * now, so the choice is seen working.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { SettingsPatch, SettingsSnapshot } from '../src/domain/services';
import type { DarkPageSettings } from '../src/domain/previews/documents/dark-pages';
import { atNight } from '../src/domain/previews/documents/dark-pages';
import { SettingsWindow } from '../src/renderer/ui/settings/Settings';
import { getState, initialize } from '../src/renderer/state/store';

let snapshot: SettingsSnapshot;
const settingsPatch = vi.fn(async (patches: SettingsPatch[]) => {
  snapshot = structuredClone(snapshot);
  snapshot.revision++;
  for (const { path, value } of patches)
    Object.assign(snapshot.settings.previews, { [path.split('.').at(-1)!]: value });
  return snapshot;
});
beforeEach(() => {
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  snapshot = structuredClone(getState().settings);
  const stubs: Record<string, unknown> = {
    settingsGet: async () => snapshot,
    settingsPatch,
    onEvent: () => () => {},
  };
  Object.assign(window, {
    viewer: new Proxy(stubs, {
      get: (target, key: string) => target[key] ?? vi.fn(async () => undefined),
    }),
  });
});
afterEach(() => cleanup());

async function previews(values: Partial<DarkPageSettings>, systemLook: 'dark' | 'light' = 'light') {
  Object.assign(snapshot.settings.previews, values);
  snapshot.systemLook = systemLook;
  const view = render(createElement(SettingsWindow));
  await waitFor(() => expect(view.getByRole('heading', { level: 1 })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Previews' }));
  await waitFor(() => expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Previews'));
  return view;
}

it('offers the four choices, with nothing beneath Off', async () => {
  const view = await previews({ darkPages: 'off' });
  const row = view.container.querySelector('[data-setting-path="settings.previews.darkPages"]');
  expect(row?.textContent).toContain('Dark pages');
  expect(row?.textContent).toContain('Off');
  expect(view.container.querySelector('.settings-dark-pages')).toBeNull();
});

it('shows the night’s times at night, saves them as they change, and says how pages are now', async () => {
  const view = await previews({
    darkPages: 'night',
    darkPagesFrom: '20:00',
    darkPagesUntil: '07:00',
  });
  const from = view.getByLabelText('Dark pages from') as HTMLInputElement;
  const until = view.getByLabelText('Dark pages until') as HTMLInputElement;
  expect([from.value, until.value]).toEqual(['20:00', '07:00']);
  const status = view.container.querySelector('.settings-dark-pages small')!.textContent;
  expect(status).toMatch(
    atNight(new Date(), '20:00', '07:00') ? /^Pages are dark now, until / : /^Pages turn dark at /,
  );
  fireEvent.change(from, { target: { value: '21:30' } });
  await waitFor(() =>
    expect(settingsPatch).toHaveBeenCalledWith(
      [{ path: 'settings.previews.darkPagesFrom', value: '21:30' }],
      expect.any(Number),
    ),
  );
  // a time the field has not finished is not saved
  fireEvent.change(until, { target: { value: '' } });
  expect(settingsPatch).toHaveBeenCalledTimes(1);
});

it('says a night that begins as it ends keeps pages light', async () => {
  const view = await previews({
    darkPages: 'night',
    darkPagesFrom: '22:00',
    darkPagesUntil: '22:00',
  });
  expect(view.container.querySelector('.settings-dark-pages small')?.textContent).toBe(
    'From and until are the same time, so pages stay light.',
  );
});

it('says what macOS is doing, with how it can switch at sunset', async () => {
  const dark = await previews({ darkPages: 'system' }, 'dark');
  expect(dark.container.querySelector('.settings-dark-pages small')?.textContent).toBe(
    'macOS is in dark mode, so pages are dark now.',
  );
  expect(dark.queryByLabelText('Dark pages from')).toBeNull();
  cleanup();
  const light = await previews({ darkPages: 'system' }, 'light');
  expect(light.container.querySelector('.settings-dark-pages small')?.textContent).toContain(
    'With Appearance set to Auto in System Settings, macOS turns dark at sunset.',
  );
});
