import { describe, expect, it } from 'vitest';
import { CURRENT_STATE_VERSION, type SavedState } from '../src/domain/contracts';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { defaultSettings, type SettingsSnapshot } from '../src/domain/services';
import { planLegacyProfileRestoration } from '../src/desktop/preferences/profile-migration';

function fixture(): { state: SavedState; snapshot: SettingsSnapshot } {
  return {
    state: {
      version: CURRENT_STATE_VERSION,
      workspaces: [{ id: 'first', name: 'First', panes: [], roots: [], arrangement: {} }],
      activeWorkspace: 'first',
      favorites: [],
      recents: [],
      look: 'dark',
      profile: { id: 'mine', previous: { 'settings.editor.tabSize': 4, 'ui.space.grid': true } },
    },
    snapshot: {
      revision: 0,
      look: 'dark',
      credentials: [],
      ui: {
        ...normalizePreferences(),
        space: { ...normalizePreferences().space, grid: false },
      },
      settings: {
        ...defaultSettings('/fixtures'),
        editor: { ...defaultSettings('/fixtures').editor, tabSize: 8 },
        profiles: [
          {
            id: 'mine',
            name: 'Mine',
            values: {
              'settings.editor.tabSize': 8,
              'ui.space.grid': false,
            },
          },
        ],
      },
    },
  };
}

describe('legacy global profile restoration', () => {
  it('plans compare-and-set restoration of UI and editor values without changing either source', () => {
    const { state, snapshot } = fixture();
    const original = JSON.stringify({ state, snapshot });
    const plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([
      { path: 'settings.editor.tabSize', value: 4 },
      { path: 'ui.space.grid', value: true },
    ]);
    expect(plan.state.profile?.previous).toEqual({});
    expect(JSON.stringify({ state, snapshot })).toBe(original);
    expect(plan.warnings).toEqual([]);
  });

  it('retains newer preferences and the original previous value for recovery', () => {
    const { state, snapshot } = fixture();
    snapshot.settings.editor.tabSize = 6;
    const plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([{ path: 'ui.space.grid', value: true }]);
    expect(plan.state.profile?.previous).toEqual({ 'settings.editor.tabSize': 4 });
    expect(plan.warnings[0]).toContain('newer preference');
  });

  it('does not guess when an earlier definition is missing or configuration cannot be read', () => {
    const { state, snapshot } = fixture();
    snapshot.settings.profiles = [];
    let plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([]);
    expect(plan.state).toBe(state);
    expect(plan.warnings[0]).toContain('unavailable profile');
    snapshot.config = {
      path: '/config.jsonc',
      diagnostics: ['Unreadable'],
      changes: [],
      fallback: 'defaults',
    };
    plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([]);
    expect(plan.state).toBe(state);
    expect(plan.warnings[0]).toContain('configuration is unavailable');
  });

  it('keeps protected and unknown prior entries without treating them as authority', () => {
    const { state, snapshot } = fixture();
    state.profile!.previous = {
      'settings.browsing.confirmTrash': false,
      'settings.agents.enabled': true,
    };
    const plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([]);
    expect(plan.state).toBe(state);
    expect(plan.warnings).toHaveLength(2);
  });

  it('preserves conflicting previous values from independently retained windows', () => {
    const { state, snapshot } = fixture();
    state.windowProfiles = { second: { id: 'mine', previous: { 'settings.editor.tabSize': 2 } } };
    const plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([{ path: 'ui.space.grid', value: true }]);
    expect(plan.state.profile?.previous).toEqual({ 'settings.editor.tabSize': 4 });
    expect(plan.state.windowProfiles?.second?.previous).toEqual({ 'settings.editor.tabSize': 2 });
    expect(plan.warnings.some((warning) => warning.includes('conflicting earlier window'))).toBe(
      true,
    );
  });

  it('can resume after successful restoration without applying a prior value twice', () => {
    const { state, snapshot } = fixture();
    snapshot.settings.editor.tabSize = 4;
    snapshot.ui.space.grid = true;
    const plan = planLegacyProfileRestoration(state, snapshot);
    expect(plan.patches).toEqual([]);
    expect(plan.state.profile?.previous).toEqual({});
    expect(plan.warnings).toEqual([]);
    expect(planLegacyProfileRestoration(plan.state, snapshot).state).toBe(plan.state);
  });
});
