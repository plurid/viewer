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
import { CommandsContext } from '../src/renderer/commands/context';
import { suggestionsFor } from '../src/renderer/commands/suggestions';

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
  const { registry } = commands();
  const view = render(
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(WorkspaceContext.Provider, { value: workspace }, createElement(Sidebar)),
    ),
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
  it('marks the boundary before pinned Trash even when browser drag payloads are hidden', () => {
    const view = mount();
    const group = view.getByRole('region', { name: 'Locations' });
    fireEvent.dragOver(group, {
      dataTransfer: {
        types: [SIDEBAR_DRAG, 'application/x-viewer-sidebar-locations'],
        getData: () => '',
      },
    });
    expect(
      view.getByRole('button', { name: 'Trash' }).classList.contains('sidebar-drop-before'),
    ).toBe(true);
    expect(group.classList.contains('sidebar-drop-after')).toBe(false);
    fireEvent.dragEnd(group);
    expect(
      view.getByRole('button', { name: 'Trash' }).classList.contains('sidebar-drop-before'),
    ).toBe(false);
  });

  it('shows an insertion boundary and uses the same half-row position on drop', async () => {
    const view = mount();
    const row = view.getByRole('button', { name: 'Applications' });
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 } as DOMRect);
    const transfer = {
      types: [SIDEBAR_DRAG],
      getData: () => JSON.stringify({ section: 'locations', path: home }),
      dropEffect: '',
    };
    const drag = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientY: { value: clientY },
        dataTransfer: { value: transfer },
      });
      fireEvent(row, event);
    };
    drag('dragover', 110);
    expect(row.classList.contains('sidebar-drop-before')).toBe(true);
    drag('dragover', 135);
    expect(row.classList.contains('sidebar-drop-after')).toBe(true);
    expect(row.classList.contains('sidebar-drop')).toBe(false);
    await act(async () => drag('drop', 135));
    await waitFor(() =>
      expect(view.order()).toEqual([applications, home, downloads, trashLocation]),
    );
    expect(row.classList.contains('sidebar-drop-after')).toBe(false);
  });

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

it('offers Remove from Favorites directly and removes only the clicked shortcut', async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const state = getState();
  replaceState({
    ...state,
    saved: {
      ...state.saved,
      favorites: [
        { path: home, name: 'Favorite Home' },
        { path: downloads, name: 'Favorite Downloads' },
      ],
      ui: { ...state.saved.ui, sidebar: { ...state.saved.ui.sidebar, collapsed: [] } },
    },
  });
  const view = mount();
  fireEvent.contextMenu(view.getByRole('button', { name: 'Favorite Downloads' }));
  const suggested = await view.findByRole('menuitem', { name: /Remove from Favorites/ });
  expect(view.getByText('Suggested')).toBeTruthy();
  fireEvent.click(suggested);
  await waitFor(() =>
    expect(getState().saved.favorites).toEqual([{ path: home, name: 'Favorite Home' }]),
  );
});

it('suggests removal only for a favorite item and respects disabled suggestions', () => {
  const { registry, context } = commands();
  for (const sidebar of [
    { section: 'favorites' as const },
    { section: 'locations' as const, path: home },
  ]) {
    expect(suggestionsFor(registry.list({ context: { ...context, sidebar } }), [])).toEqual([]);
  }
  const available = registry.list({
    context: { ...context, sidebar: { section: 'favorites', path: home } },
  });
  expect(suggestionsFor(available, []).map((item) => item.command.id)).toEqual(['shortcut-remove']);
  const state = getState();
  replaceState({
    ...state,
    settings: {
      ...state.settings,
      settings: {
        ...state.settings.settings,
        browsing: { ...state.settings.settings.browsing, suggestions: false },
      },
    },
  });
  expect(suggestionsFor(available, [])).toEqual([]);
});
