// @vitest-environment jsdom
/**
 * SETTING PROFILES (2026-10-23): named sets of settings applied at once (Focus: no chrome; Present;
 * Full), left again to what was there before, and saved from the current values. Focus mode is one
 * key: ⇧⌘F.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { builtInProfiles, profilePaths } from '../src/domain/profiles';
import { defaultShortcuts } from '../src/domain/shortcuts';
import { agentCommandID } from '../src/domain/agent-safety';
import { profileSchema } from '../src/desktop/settings';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import { getState, initialize } from '../src/renderer/state/store';
import { effectiveWindowUI } from '../src/renderer/state/effective-ui';
import { changeWorkspace } from '../src/renderer/state/core';

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
