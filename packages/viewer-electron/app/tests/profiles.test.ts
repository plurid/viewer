// @vitest-environment jsdom
/**
 * SETTING PROFILES (2026-10-23): named sets of settings applied at once (Focus: no chrome; Present;
 * Full), left again to what was there before, and saved from the current values. Focus mode is one
 * key: ⇧⌘F.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { builtInProfiles, profilePaths } from '../src/domain/preferences/profiles';
import { defaultShortcuts } from '../src/domain/preferences/shortcuts';
import { agentCommandID } from '../src/domain/agents/safety';
import { profileSchema } from '../src/desktop/preferences/settings';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import {
  activeWorkspace,
  getState,
  initialize,
  switchWorkspace,
} from '../src/renderer/state/store';
import { effectiveWindowSettings, effectiveWindowUI } from '../src/renderer/state/effective-ui';
import { changeWorkspace, replaceState, savePatch } from '../src/renderer/state/core';
import { folderPresentation } from '../src/renderer/state/presentation';
import { applyProfile } from '../src/renderer/commands/window-commands/profiles';

const settingsPatch = vi.fn(async () => getState().settings);
beforeEach(() => {
  settingsPatch.mockClear();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), settingsPatch } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
const controller: Record<string, unknown> = {
  parentPaneID: () => undefined,
  isDocked: () => false,
  arrangementHistory: () => ({ canUndo: false, canRedo: false }),
  hasRepeatedPreviews: () => false,
  bookmarks: () => [],
};
const actions = {
  workspace: new Proxy(controller, { get: (target, key: string) => target[key] ?? vi.fn() }),
  ready: true,
  tool: null,
  profileDialog: vi.fn(),
} as unknown as WindowActions;
const context = { scope: 'window', workspaceID: '', selection: [] } as unknown as CommandContext;
const find = (id: string) => windowCommands(actions).find((command) => command.id === id)!;
const label = (id: string) => {
  const value = find(id).label;
  return typeof value === 'string' ? value : value(context);
};
const space = () => effectiveWindowUI(getState()).space;

describe('profiles', () => {
  it('layers a workspace default, an explicit profile, then that workspace’s overrides', async () => {
    act(() => changeWorkspace((space) => ({ ...space, profileID: 'focus' })));
    expect(space().toolbar).toBe(false);
    expect(getState().saved.ui.space.toolbar).toBe(true);
    await act(async () => find('profile.full').run(context));
    expect(space().toolbar).toBe(true);
    act(() => changeWorkspace((space) => ({ ...space, overrides: { 'ui.space.toolbar': false } })));
    expect(space().toolbar).toBe(false);
    expect(getState().saved.ui.space.toolbar).toBe(true);
  });
  it('applies editor and list preferences at their actual consumer seams', async () => {
    const state = getState();
    const profile = {
      id: 'mine',
      name: 'Mine',
      values: {
        'settings.editor.tabSize': 8,
        'ui.list.visible.kind': false,
        'settings.browsing.mode': 'columns',
      },
    };
    replaceState({
      ...state,
      settings: {
        ...state.settings,
        settings: {
          ...state.settings.settings,
          profiles: [profile],
        },
      },
    });
    const canonical = getState().settings.settings;
    await act(async () => applyProfile(profile));
    expect(effectiveWindowSettings(getState()).editor.tabSize).toBe(8);
    expect(folderPresentation('/fixtures').list.visible.kind).toBe(false);
    expect(folderPresentation('/fixtures').mode).toBe('columns');
    expect(getState().settings.settings).toBe(canonical);
    expect(canonical.editor.tabSize).toBe(4);
    expect(settingsPatch).not.toHaveBeenCalled();
  });
  it('keeps window commands truthful while a profile hides chrome', async () => {
    await act(async () => find('profile.focus').run(context));
    expect(label('toggle-titlebar')).toBe('Show title bar');
    expect(label('setting.ui.space.grid@workspace')).toBe('This workspace: Show background grid');
    await act(async () => find('toggle-titlebar').run(context));
    expect(effectiveWindowUI(getState()).titlebar.visible).toBe(true);
    expect(getState().saved.ui.titlebar.visible).toBe(true);
    await act(async () => find('setting.ui.space.grid@workspace').run(context));
    expect(space().grid).toBe(true);
    expect(label('setting.ui.space.grid@workspace')).toBe('This workspace: Hide background grid');
    await act(async () => find('setting.ui.space.grid@workspace').run(context));
    expect(space().grid).toBe(false);
    expect(activeWorkspace().overrides).not.toHaveProperty('ui.space.grid');
    expect(settingsPatch).not.toHaveBeenCalled();
  });
  it('uses each workspace default across A/B switches without carrying the explicit profile', async () => {
    const state = getState();
    const first = activeWorkspace().id;
    const second = {
      ...structuredClone(activeWorkspace()),
      id: 'second',
      name: 'Second',
      profileID: 'full',
    };
    savePatch({ workspaces: [{ ...activeWorkspace(), profileID: 'focus' }, second] });
    const canonical = state.settings.settings;
    expect(effectiveWindowUI(getState()).space.grid).toBe(false);
    await act(async () => find('profile.present').run(context));
    expect(effectiveWindowUI(getState()).space.planeHeaders).toBe(false);
    await act(async () => switchWorkspace(second.id));
    expect(getState().saved.profile).toBeUndefined();
    expect(effectiveWindowUI(getState()).sidebar.visible).toBe(true);
    expect(effectiveWindowUI(getState()).space.grid).toBe(true);
    await act(async () => switchWorkspace(first));
    expect(effectiveWindowUI(getState()).space.grid).toBe(false);
    expect(effectiveWindowUI(getState()).space.planeHeaders).toBe(true);
    expect(getState().settings.settings).toBe(canonical);
    expect(settingsPatch).not.toHaveBeenCalled();
  });
  it('are sets of settings the workspace may change, the built-in ones valid', () => {
    for (const profile of builtInProfiles)
      expect(profileSchema.safeParse(profile).success).toBe(true);
    expect(
      profileSchema.safeParse({
        id: 'mine',
        name: 'Mine',
        values: { 'settings.browsing.confirmTrash': false },
      }).success,
    ).toBe(false);
    expect(profilePaths).toContain('ui.space.minimap');
  });
  it('Focus hides the chrome, and leaving it puts back what was there', async () => {
    expect(defaultShortcuts['focus-mode']).toBe('Cmd+Shift+F');
    expect(label('focus-mode')).toBe('Focus mode');
    await act(async () => find('focus-mode').run(context));
    expect(space()).toMatchObject({ toolbar: false, minimap: false, viewcube: false, grid: false });
    expect(effectiveWindowUI(getState()).titlebar.visible).toBe(false);
    expect(getState().saved.ui.titlebar.visible).toBe(true);
    expect(settingsPatch).not.toHaveBeenCalled();
    expect(label('focus-mode')).toBe('Leave focus mode');
    await act(async () => find('focus-mode').run(context));
    expect(space()).toMatchObject({ toolbar: true, minimap: true, viewcube: true, grid: true });
    expect(getState().saved.ui.titlebar.visible).toBe(true);
  });
  it('switching from one profile to another still leaves to the first state', async () => {
    await act(async () => find('profile.focus').run(context));
    await act(async () => find('profile.present').run(context));
    expect(space().planeHeaders).toBe(false);
    expect(find('profile.present').icon).toBe('check');
    await act(async () => find('profile-restore').run(context));
    expect(space()).toMatchObject({ planeHeaders: true, toolbar: true, minimap: true });
    expect(find('profile-restore').when(context)).toBe(false);
  });
  it('may be proposed by an agent when built in, as Focus mode may', () => {
    for (const id of ['profile.focus', 'profile.full', 'focus-mode', 'profile-restore'])
      expect(agentCommandID(id, [])).toBe(id);
    expect(() => agentCommandID('profile.mine', [])).toThrow();
  });
});
