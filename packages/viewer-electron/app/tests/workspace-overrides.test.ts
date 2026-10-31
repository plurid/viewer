// @vitest-environment jsdom
/**
 * A WORKSPACE'S OWN SETTINGS: a workspace may override the window's chrome and the
 * space's look (title bar, toolbar, minimap, viewcube, grid, headers, backdrop opacity) over the
 * general settings; other workspaces keep theirs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { effectiveUI, overridablePaths } from '../src/domain/preferences/overrides';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { stateSchema } from '../src/desktop/persistence/storage';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { setWorkspaceOverride } from '../src/renderer/state/workspaces';
import { changeWorkspace } from '../src/renderer/state/core';
import { headerPresets } from '../src/domain/preferences/header';

const setWorkspaceProfile = (profileID: string) =>
  changeWorkspace((space) => ({ ...space, profileID }));

beforeEach(() => {
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});

describe('the effective settings', () => {
  it('are the general ones with the workspace’s overrides, only those it may override', () => {
    const ui = normalizePreferences();
    const effective = effectiveUI(ui, {
      'ui.space.minimap': false,
      'ui.titlebar.visible': false,
      'ui.space.backdrop': 'clear',
    });
    expect(effective.space.minimap).toBe(false);
    expect(effective.titlebar.visible).toBe(false);
    // Desired backdrop is local; the native adapter decides whether reopening is needed.
    expect(effective.space.backdrop).toBe('clear');
    expect(effectiveUI(ui, undefined)).toBe(ui);
    expect(overridablePaths).toContain('ui.space.backdrop');
  });
});

describe('a workspace override', () => {
  it('is kept with the workspace, set and cleared', () => {
    act(() => setWorkspaceOverride('ui.space.grid', false));
    expect(activeWorkspace().overrides).toEqual({ 'ui.space.grid': false });
    expect(() => stateSchema.parse(getState().saved)).not.toThrow();
    act(() => setWorkspaceOverride('ui.space.grid', undefined));
    expect(activeWorkspace()).not.toHaveProperty('overrides');
    const saved = structuredClone(getState().saved);
    // what a hand-edited state file might hold: refused when read
    saved.workspaces[0]!.overrides = { 'settings.browsing.confirmTrash': false } as never;
    expect(stateSchema.safeParse(saved).success).toBe(false);
  });
  it('is a command for each overridable setting, and one to clear them', async () => {
    const actions = {
      workspace: new Proxy({} as Record<string, unknown>, {
        get: (target, key: string) =>
          ({
            parentPaneID: () => undefined,
            isDocked: () => false,
            arrangementHistory: () => ({ canUndo: false, canRedo: false }),
            hasRepeatedPreviews: () => false,
            bookmarks: () => [],
          })[key] ?? vi.fn(),
      }),
      ready: true,
      tool: null,
    } as unknown as WindowActions;
    const context = {
      scope: 'window',
      workspaceID: '',
      selection: [],
    } as unknown as CommandContext;
    const find = (id: string) => windowCommands(actions).find((command) => command.id === id)!;
    const label = (id: string) => {
      const value = find(id).label;
      return typeof value === 'string' ? value : value(context);
    };
    expect(label('setting.ui.space.minimap@workspace')).toBe('This workspace: Hide minimap');
    await act(async () => find('setting.ui.space.minimap@workspace').run(context));
    expect(activeWorkspace().overrides).toEqual({ 'ui.space.minimap': false });
    expect(label('setting.ui.space.minimap@workspace')).toBe('This workspace: Show minimap');
    // the general setting is as it was
    expect(getState().saved.ui.space.minimap).toBe(true);
    expect(find('workspace-overrides-clear').when(context)).toBe(true);
    await act(async () => find('workspace-overrides-clear').run(context));
    expect(activeWorkspace()).not.toHaveProperty('overrides');
  });
  it('chooses a plane toolbar preset for this workspace under a profile, control by control', async () => {
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
    const find = (id: string) => windowCommands(actions).find((command) => command.id === id)!;
    act(() => setWorkspaceProfile('focus'));
    await act(async () => find('plane-toolbar.full').run(context));
    expect(activeWorkspace().overrides).toEqual({
      'ui.space.headerControls.layout': true,
      'ui.space.headerControls.discover': true,
      'ui.space.headerControls.formatTools': true,
    });
    expect(getState().saved.ui.space.headerControls).toEqual(headerPresets.essential);
    // Essential again is the inherited set: no override is left
    await act(async () => find('plane-toolbar.essential').run(context));
    expect(activeWorkspace()).not.toHaveProperty('overrides');
  });
});
