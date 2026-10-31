// @vitest-environment jsdom
/**
 * MORE CONTROL OVER THE WINDOW'S LOOK: the title bar can be hidden (⌥⌘T) and comes
 * back at the window's top edge; the space's grid can be turned off; the space has a general colour,
 * following the appearance unless chosen, and each workspace may have its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { preferencesSchema } from '../src/desktop/preferences/preferences-schema';
import { stateSchema } from '../src/desktop/persistence/storage';
import { defaultShortcuts } from '../src/domain/preferences/shortcuts';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { setWorkspaceSpaceColor } from '../src/renderer/state/workspaces';
import { looks, spaceLook } from '../src/renderer/workspace/look';
import { surfaceConfiguration } from '../src/renderer/workspace/surface-configuration';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import { useTitlebar } from '../src/renderer/ui/titlebar';
import { ColorField } from '../src/renderer/ui/ColorField';
import { settingCatalog } from '../src/domain/preferences/catalog';

const windowButtons = vi.fn(async () => {});
beforeEach(() => {
  windowButtons.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), windowButtons } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the preferences', () => {
  it('saves each title bar icon independently and exposes it in Settings', () => {
    const titlebar = {
      visible: true,
      navigation: false,
      newPlane: false,
      operations: false,
      voice: true,
      commands: false,
    };
    const ui = normalizePreferences({ titlebar } as never);
    expect(ui.titlebar).toEqual(titlebar);
    expect(preferencesSchema.parse(ui).titlebar).toEqual(titlebar);
    expect(
      settingCatalog
        .filter((setting) => setting.section === 'Title bar icons')
        .map((setting) => setting.path),
    ).toEqual([
      'ui.titlebar.navigation',
      'ui.titlebar.newPlane',
      'ui.titlebar.operations',
      'ui.titlebar.voice',
      'ui.titlebar.commands',
    ]);
    expect(preferencesSchema.parse({ ...ui, titlebar: { visible: false } }).titlebar).toMatchObject(
      { visible: false, voice: false, commands: true },
    );
  });
  it('show the title bar and the grid, and follow the appearance, by default', () => {
    const ui = normalizePreferences();
    expect(ui.titlebar).toEqual({
      visible: true,
      navigation: true,
      newPlane: true,
      operations: true,
      voice: false,
      commands: true,
    });
    expect(ui.space).toMatchObject({ grid: true, color: '' });
  });
  it('keep a colour only as a #rrggbb colour', () => {
    const space = (value: unknown) =>
      normalizePreferences({ version: 3, space: value } as never).space;
    expect(space({ color: '#1A2B3C' }).color).toBe('#1a2b3c');
    for (const color of ['red', '#123', 'url(x)', 12]) expect(space({ color }).color).toBe('');
    expect(
      normalizePreferences({ version: 3, titlebar: { visible: false } } as never).titlebar,
    ).toMatchObject({ visible: false, voice: false });
  });
  it('are checked in config.jsonc', () => {
    const ui = normalizePreferences();
    const parse = (color: string) =>
      preferencesSchema.safeParse({ ...ui, space: { ...ui.space, color } }).success;
    expect(parse('#112233')).toBe(true);
    expect(parse('')).toBe(true);
    expect(parse('red')).toBe(false);
  });
});

describe("a workspace's own colour", () => {
  it('is kept with the workspace, set and cleared, and only as a colour', () => {
    act(() => setWorkspaceSpaceColor('#102A3A'));
    expect(activeWorkspace().spaceColor).toBe('#102a3a');
    expect(() => stateSchema.parse(getState().saved)).not.toThrow();
    act(() => setWorkspaceSpaceColor(''));
    expect(activeWorkspace()).not.toHaveProperty('spaceColor');
    const saved = structuredClone(getState().saved);
    saved.workspaces[0]!.spaceColor = 'blue';
    expect(stateSchema.safeParse(saved).success).toBe(false);
  });
});

describe("plurid's look", () => {
  it('takes the grid and the colour, one object per choice', () => {
    expect(spaceLook('dark', { grid: true, color: '' })).toBe(looks.dark);
    const chosen = spaceLook('dark', { grid: false, color: '#102a3a' });
    expect(chosen).toMatchObject({ scheme: 'dark', grid: false, space: '#102a3a' });
    expect(spaceLook('dark', { grid: false, color: '#102a3a' })).toBe(chosen);
    const configuration = surfaceConfiguration({
      look: 'light',
      size: { width: 800, height: 600 },
      preferences: { ...normalizePreferences().space, grid: false },
      minimap: true,
      color: '#f5efe4',
    });
    expect(configuration.global?.look).toMatchObject({ grid: false, space: '#f5efe4' });
  });
});

describe('the commands', () => {
  const controller: Record<string, unknown> = {
    parentPaneID: () => undefined,
    isDocked: () => false,
    arrangementHistory: () => ({ canUndo: false, canRedo: false }),
    hasRepeatedPreviews: () => false,
  };
  const actions = {
    workspace: new Proxy(controller, { get: (target, key: string) => target[key] ?? vi.fn() }),
    workspaceDialog: vi.fn(),
    ready: true,
    tool: null,
  } as unknown as WindowActions;
  const context = { scope: 'window', workspaceID: '', selection: [] } as unknown as CommandContext;
  const find = (id: string) => windowCommands(actions).find((command) => command.id === id)!;
  it('hide and show the title bar with ⌥⌘T', async () => {
    expect(defaultShortcuts['toggle-titlebar']).toBe('Cmd+Alt+T');
    expect(find('toggle-titlebar').label).toBe('Hide title bar');
    await act(async () => find('toggle-titlebar').run(context));
    expect(getState().saved.ui.titlebar.visible).toBe(false);
    expect(find('toggle-titlebar').label).toBe('Show title bar');
  });
  it('hide and show the grid', async () => {
    expect(find('setting.ui.space.grid').label).toBe('Hide background grid');
    await act(async () => find('setting.ui.space.grid').run(context));
    expect(getState().saved.ui.space.grid).toBe(false);
  });
  it("choose the workspace's background", async () => {
    expect(find('workspace-background').label).toBe('Workspace look…');
    await find('workspace-background').run(context);
    expect(actions.workspaceDialog).toHaveBeenCalledWith('background');
  });
});

describe('a hidden title bar', () => {
  it('hides the window buttons with it, and comes back at the top edge', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ visible }) => useTitlebar(visible), {
      initialProps: { visible: false },
    });
    expect(result.current.state).toBe('hidden');
    expect(windowButtons).toHaveBeenLastCalledWith(false);
    act(() => result.current.reveal());
    expect(result.current.state).toBe('revealed');
    expect(windowButtons).toHaveBeenLastCalledWith(true);
    // leaving it hides it again, after a moment
    act(() => result.current.conceal());
    expect(result.current.state).toBe('revealed');
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.state).toBe('hidden');
    rerender({ visible: true });
    expect(result.current.state).toBe('shown');
    expect(windowButtons).toHaveBeenLastCalledWith(true);
  });
  it('stays while one of its menus is open', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTitlebar(false));
    act(() => result.current.reveal());
    const menu = Object.assign(document.createElement('div'), { className: 'context-menu' });
    document.body.append(menu);
    act(() => result.current.conceal());
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.state).toBe('revealed');
    menu.remove();
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.state).toBe('hidden');
  });
});

describe('the colour field', () => {
  it('offers the automatic colour, swatches for the look and a colour of your own', () => {
    const onChange = vi.fn();
    const view = render(
      createElement(ColorField, {
        label: 'Space colour',
        value: '',
        look: 'dark',
        automatic: 'Automatic',
        onChange,
      }),
    );
    expect(view.getByRole('button', { name: 'Automatic' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(view.getByRole('button', { name: 'Ocean' }));
    expect(onChange).toHaveBeenLastCalledWith('#0f2633');
    fireEvent.change(view.getByLabelText('Custom colour'), { target: { value: '#abcdef' } });
    expect(onChange).toHaveBeenLastCalledWith('#abcdef');
    fireEvent.click(view.getByRole('button', { name: 'Automatic' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
