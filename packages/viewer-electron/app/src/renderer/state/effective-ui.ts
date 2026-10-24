import type { UIPreferences, Workspace } from '../../domain/contracts';
import type { ApplicationSettings } from '../../domain/services';
import {
  createWindowPreferencesResolver,
  resolveWindowPreferences,
  type WindowPreferences,
} from '../../domain/preferences/presentation/resolver';
import { activeWorkspace, type ViewerState } from './core';

const effective = createWindowPreferencesResolver();
const inherited = createWindowPreferencesResolver();

function input(state: ViewerState) {
  return {
    settings: state.settings.settings,
    ui: state.saved.ui,
    systemLook: state.settings.systemLook ?? state.settings.look,
    workspace: activeWorkspace(state),
    profileID: state.saved.profile?.id,
  };
}

/** Profiles project canonical preferences inside this window without writing them back. */
export function effectiveWindowPreferences(state: ViewerState): WindowPreferences {
  return effective(input(state));
}

/** The value a local override replaces, including the window's active profiles. */
export function inheritedWindowPreferences(state: ViewerState): WindowPreferences {
  return inherited({ ...input(state), includeOverrides: false });
}

export function effectiveWindowUI(state: ViewerState): UIPreferences {
  return effectiveWindowPreferences(state).ui;
}

export function effectiveWindowSettings(state: ViewerState): ApplicationSettings {
  return effectiveWindowPreferences(state).settings;
}

export function effectiveWindowLook(state: ViewerState): 'dark' | 'light' {
  return effectiveWindowPreferences(state).look;
}

/** Resolve another workspace while configuration changes refresh its retained folder panes. */
export function windowPreferencesFor(
  state: ViewerState,
  workspace: Workspace,
  settings = state.settings.settings,
  ui = state.saved.ui,
): WindowPreferences {
  return resolveWindowPreferences({
    settings,
    ui,
    systemLook: state.settings.systemLook ?? state.settings.look,
    workspace,
    profileID: workspace.id === state.saved.activeWorkspace ? state.saved.profile?.id : undefined,
  });
}
