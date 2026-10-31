// @vitest-environment jsdom
/**
 * THE DARK PAGES BUTTON keeps its choice for every page preview: it saves the setting, and an
 * automatic mode it replaces is named once, with how to choose it again. At night, pages switch as
 * the night begins and ends, even after the Mac slept through the edge; with macOS dark mode, as
 * macOS changes. A dark page takes the dark theme's colours whatever the window's look.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { DarkPageSettings } from '../src/domain/previews/documents/dark-pages';
import type { SettingsSnapshot } from '../src/domain/services';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { builtInTheme } from '../src/domain/preferences/themes';
import { dismissNotice, getState, initialize, receiveSettings } from '../src/renderer/state/store';
import { toggleDarkPages, useDarkPages } from '../src/renderer/previews/dark-pages';
import { windowCommands } from '../src/renderer/commands/window';

const settingsPatch = vi.fn(async (patches: { path: string; value: unknown }[]) => {
  const snapshot = structuredClone(getState().settings);
  snapshot.revision++;
  for (const { path, value } of patches) {
    const keys = path.split('.').slice(1);
    let target = snapshot.settings as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = value;
  }
  return snapshot;
});
const openSettings = vi.fn(async () => {});
beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), settingsPatch, openSettings } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The settings as the desktop announces them, with `previews` and `snapshot` changed. */
function announce(
  previews: Partial<DarkPageSettings>,
  snapshot: Partial<SettingsSnapshot> = {},
): void {
  const current = structuredClone(getState().settings);
  receiveSettings({
    ...current,
    ...snapshot,
    revision: current.revision + 1,
    settings: {
      ...current.settings,
      ...snapshot.settings,
      previews: { ...current.settings.previews, ...previews },
    },
  });
}
const mode = () => getState().settings.settings.previews.darkPages;
const settle = () => act(async () => {});

describe('the Dark pages button', () => {
  it('turns pages dark for every page preview, and back', async () => {
    toggleDarkPages(false);
    await settle();
    expect(settingsPatch).toHaveBeenLastCalledWith(
      [{ path: 'settings.previews.darkPages', value: 'on' }],
      expect.any(Number),
    );
    expect(mode()).toBe('on');
    toggleDarkPages(true);
    await settle();
    expect(mode()).toBe('off');
    expect(getState().notice).toBeFalsy();
  });
  it('replaces an automatic mode with the choice and says so once', async () => {
    announce({ darkPages: 'night' });
    toggleDarkPages(true);
    await settle();
    expect(mode()).toBe('off');
    expect(getState()).toMatchObject({
      noticeKind: 'info',
      notice:
        'Dark pages stay off. Choose At night in Settings → Previews to switch with the time.',
    });
    dismissNotice();
    announce({ darkPages: 'system' });
    toggleDarkPages(false);
    await settle();
    expect(mode()).toBe('on');
    expect(getState().notice).toBe(
      'Dark pages stay on. Choose With macOS dark mode in Settings → Previews to follow macOS.',
    );
  });
  it('is a setting the palette changes in the workspace, without opening Settings', async () => {
    const actions = {
      workspace: new Proxy({} as Record<string, unknown>, { get: () => vi.fn() }),
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const context = {
      scope: 'window',
      workspaceID: '',
      selection: [],
    } as unknown as CommandContext;
    const command = windowCommands(actions).find(
      (item) => item.id === 'setting.settings.previews.darkPages=night',
    );
    expect(command?.label).toBe('Previews › Dark pages: At night');
    await act(async () => command!.run(context));
    expect(openSettings).not.toHaveBeenCalled();
    expect(mode()).toBe('night');
  });
});

/** What the window's page previews draw: the dark page's colour, or `light`. */
function Probe() {
  const pages = useDarkPages();
  return <output>{pages.dark?.page ?? 'light'}</output>;
}
const page = builtInTheme('dark').shell.surface;

describe('pages at night', () => {
  it('turn dark as the night begins and light as it ends, live', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 31, 19, 59, 30));
    announce({ darkPages: 'night', darkPagesFrom: '20:00', darkPagesUntil: '07:00' });
    const view = render(<Probe />);
    expect(view.container.textContent).toBe('light');
    act(() => vi.advanceTimersByTime(29_000));
    expect(view.container.textContent).toBe('light');
    act(() => vi.advanceTimersByTime(1_000));
    expect(view.container.textContent).toBe(page);
    // past midnight it is still night, until 07:00
    vi.setSystemTime(new Date(2026, 10, 1, 6, 59, 0));
    act(() => vi.advanceTimersByTime(60_000));
    expect(view.container.textContent).toBe('light');
  });
  it('switch within a minute of waking from sleep through the edge', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 31, 18, 0, 0));
    announce({ darkPages: 'night', darkPagesFrom: '20:00', darkPagesUntil: '07:00' });
    const view = render(<Probe />);
    expect(view.container.textContent).toBe('light');
    // the clock moves on while the Mac sleeps, and its timers do not
    vi.setSystemTime(new Date(2026, 9, 31, 21, 30, 0));
    act(() => vi.advanceTimersByTime(60_000));
    expect(view.container.textContent).toBe(page);
  });
  it('follow the times as Settings changes them', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 31, 21, 0, 0));
    announce({ darkPages: 'night', darkPagesFrom: '20:00', darkPagesUntil: '07:00' });
    const view = render(<Probe />);
    expect(view.container.textContent).toBe(page);
    act(() => announce({ darkPagesFrom: '22:00' }));
    expect(view.container.textContent).toBe('light');
    act(() => announce({ darkPages: 'on' }));
    expect(view.container.textContent).toBe(page);
  });
});

describe('pages with macOS dark mode', () => {
  it('follow macOS as it changes, and take the dark theme in a light window', () => {
    announce(
      { darkPages: 'system' },
      { systemLook: 'light', settings: { ...getState().settings.settings, appearance: 'light' } },
    );
    const view = render(<Probe />);
    expect(view.container.textContent).toBe('light');
    act(() => announce({}, { systemLook: 'dark' }));
    expect(view.container.textContent).toBe(page);
    expect(getState().settings.settings.appearance).toBe('light');
    act(() => announce({}, { systemLook: 'light' }));
    expect(view.container.textContent).toBe('light');
  });
});
