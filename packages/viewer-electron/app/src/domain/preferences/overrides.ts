import type { UIPreferences } from '../contracts';
import {
  compilePresentationValues,
  presentationPath,
  presentationPaths,
  type PresentationPath,
  type PresentationValues,
} from './presentation/profile-fields';
import { applyPresentationValues } from './presentation/resolver';

/** The compact Workspace look controls; all profile fields also support local overrides. */
export const workspaceLookPaths = [
  'ui.sidebar.visible',
  'ui.titlebar.visible',
  'ui.space.toolbar',
  'ui.space.minimap',
  'ui.space.viewcube',
  'ui.space.grid',
  'ui.space.planeHeaders',
  'ui.space.origin',
  'ui.space.backdropOpacity',
] as const;
export const overridablePaths = presentationPaths;
export type OverridablePath = PresentationPath;
export type WorkspaceOverrides = PresentationValues;
export const overridable = presentationPath;

/** UI-only projection retained for callers that do not consume application preferences. */
export function effectiveUI(
  ui: UIPreferences,
  overrides: Readonly<Record<string, unknown>> | undefined,
): UIPreferences {
  if (!overrides) return ui;
  const { values } = compilePresentationValues(overrides);
  return applyPresentationValues({ ui }, values).ui;
}
