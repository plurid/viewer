import { shortcutFor, shortcutGlyphs } from '../../domain/preferences/shortcuts';
import { useViewer } from '../state/core';
import { effectiveWindowSettings } from '../state/effective-ui';

/**
 * A command's key as a Mac menu shows it, following this window's shortcuts: "⌘K", or "" once
 * the person cleared it. A hint built here follows a remap; a hint typed as text would not.
 */
export function useShortcutGlyphs(id: string): string {
  return useViewer((state) =>
    shortcutGlyphs(shortcutFor(effectiveWindowSettings(state).shortcuts, id)),
  );
}
