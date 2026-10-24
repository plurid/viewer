// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { trashLocation } from '../src/domain/files/trash';
import { preferencesSchema } from '../src/domain/preferences/presentation/ui-schema';
import { Sidebar, SIDEBAR_DRAG } from '../src/renderer/ui/navigation/Sidebar';
import { sidebarCommands } from '../src/renderer/commands/window-commands/sidebar';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { replaceState } from '../src/renderer/state/core';
import { effectiveWindowUI } from '../src/renderer/state/effective-ui';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';

const home = '/fixture/Home';
const hidden = '/fixture/Hidden';
const applications = '/fixture/Applications';
const stale = '/fixture/Unavailable';
const downloads = '/fixture/Downloads';
const initial = [home, hidden, applications, stale, downloads];
const profileOrder = [applications, hidden, downloads, stale, home];
const moved = [applications, hidden, home, stale, downloads];
const locations = [
  { path: home, name: 'Home' },
  { path: hidden, name: 'Hidden' },
  { path: applications, name: 'Applications' },
  { path: downloads, name: 'Downloads' },
  { path: trashLocation, name: 'Trash' },
];
const workspace = { openPath: vi.fn() } as unknown as WorkspaceController;

beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home, platform: 'darwin', state: null, locations, openPaths: [] });
  const state = getState();
  replaceState({
    ...state,
    saved: {
      ...state.saved,
      ui: {
        ...state.saved.ui,
        sidebar: { ...state.saved.ui.sidebar, visible: true, locations: initial, hidden: [hidden] },
      },
    },
  });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
});

function withProfile() {
  const state = getState();
  replaceState({
    ...state,
    saved: { ...state.saved, profile: { id: 'ordered', previous: {} } },
    settings: {
      ...state.settings,
      settings: {
        ...state.settings.settings,
        profiles: [
          { id: 'ordered', name: 'Ordered', values: { 'ui.sidebar.locations': profileOrder } },
        ],
      },
    },
  });
}

function mount() {
  const view = render(
    createElement(WorkspaceContext.Provider, { value: workspace }, createElement(Sidebar)),
  );
  const order = () =>
    Array.from(
      view.container.querySelectorAll<HTMLElement>('section[aria-label="Locations"] .location'),
    ).map((item) => item.title);
  const drop = (source: string, before: string) => {
    const target = Array.from(view.container.querySelectorAll<HTMLElement>('.location')).find(
      (item) => item.title === before,
    )!;
    fireEvent.drop(target, {
      dataTransfer: {
        types: [SIDEBAR_DRAG],
        getData: () => JSON.stringify({ section: 'locations', path: source }),
      },
    });
  };
  return { ...view, order, drop };
}

function commands() {
  const context: CommandContext = {
    scope: 'sidebar',
    workspaceID: activeWorkspace().id,
    sidebar: { section: 'locations', path: home, name: 'Home' },
    selection: [],
    jobs: [],
    clipboard: null,
  };
  const registry = new CommandRegistry();
  registry.register('window', {
    context: () => context,
    definitions: () => sidebarCommands(windowScopes({ workspace, ready: true } as WindowActions)),
  });
  return { registry, context };
}

describe('displayed sidebar location moves', () => {
  it('moves past hidden and unavailable references while preserving them for future sessions', async () => {
    const view = mount();
    expect(view.order()).toEqual([home, applications, downloads, trashLocation]);
    const { registry, context } = commands();
    await act(async () => expect(await registry.invoke('shortcut-down', { context })).toBe(true));
    await waitFor(() =>
      expect(view.order()).toEqual([applications, home, downloads, trashLocation]),
    );
    expect(getState().saved.ui.sidebar.locations).toEqual(moved);
    expect(preferencesSchema.parse(getState().saved.ui).sidebar.locations).toEqual(moved);
  });

  it.each(['command', 'drag'] as const)(
    'uses the profile’s displayed order for a %s move and keeps canonical preferences intact',
    async (route) => {
      withProfile();
      const view = mount();
      expect(view.order()).toEqual([applications, downloads, home, trashLocation]);
      if (route === 'command') {
        const { registry, context } = commands();
        expect(registry.list({ context }).some((command) => command.id === 'shortcut-up')).toBe(
          true,
        );
        await act(async () => expect(await registry.invoke('shortcut-up', { context })).toBe(true));
      } else {
        await act(async () => view.drop(home, downloads));
      }
      await waitFor(() =>
        expect(view.order()).toEqual([applications, home, downloads, trashLocation]),
      );
      expect(getState().saved.ui.sidebar.locations).toEqual(initial);
      expect(activeWorkspace().overrides?.['ui.sidebar.locations']).toEqual(moved);
      expect(preferencesSchema.parse(effectiveWindowUI(getState())).sidebar.locations).toEqual(
        moved,
      );
    },
  );

  it('allows dropping a physical shortcut before pinned Trash without saving its sentinel', async () => {
    const view = mount();
    await act(async () => view.drop(home, trashLocation));
    await waitFor(() =>
      expect(view.order()).toEqual([applications, downloads, home, trashLocation]),
    );
    expect(getState().saved.ui.sidebar.locations).toEqual(profileOrder);
    expect(preferencesSchema.parse(getState().saved.ui).sidebar.locations).not.toContain(
      trashLocation,
    );
  });

  it.each([trashLocation, hidden, stale, '/fixture/Forged'])(
    'rejects a hidden, unavailable or pinned drag source: %s',
    async (source) => {
      const view = mount();
      const before = getState().saved.ui;
      await act(async () => view.drop(source, applications));
      expect(getState().saved.ui).toBe(before);
      expect(view.order()).toEqual([home, applications, downloads, trashLocation]);
    },
  );
});
