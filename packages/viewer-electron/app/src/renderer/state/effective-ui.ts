import type { UIPreferences, Look } from '../../domain/contracts';
import type { ApplicationSettings } from '../../domain/services';
import {
  createWindowPreferencesResolver,
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

export function effectiveWindowLook(state: ViewerState): Look {
  return effectiveWindowPreferences(state).look;
}
