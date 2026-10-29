import { getState, savePatch } from '../state/core';
import { changePreferences } from '../state/preferences';

/** Commands share the existing preference queue; command lines use saved session history. */
export function clearRecentCommands(): void {
  changePreferences((ui) => (ui.recentCommands.length ? { ...ui, recentCommands: [] } : ui));
}

/** Suggested actions forget what was chosen for each kind of file; the rules remain. */
export function forgetSuggestions(): void {
  changePreferences((ui) =>
    Object.keys(ui.suggestionHistory ?? {}).length ? { ...ui, suggestionHistory: {} } : ui,
  );
}

export function clearLineHistory(): void {
  if (getState().saved.lineHistory?.length) savePatch({ lineHistory: [] });
}
