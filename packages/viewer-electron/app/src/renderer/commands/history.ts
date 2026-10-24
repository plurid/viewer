import { getState, savePatch } from '../state/core';
import { changePreferences } from '../state/preferences';

/** Commands share the existing preference queue; command lines use saved session history. */
export function clearRecentCommands(): void {
  changePreferences((ui) => (ui.recentCommands.length ? { ...ui, recentCommands: [] } : ui));
}

export function clearLineHistory(): void {
  if (getState().saved.lineHistory?.length) savePatch({ lineHistory: [] });
}
