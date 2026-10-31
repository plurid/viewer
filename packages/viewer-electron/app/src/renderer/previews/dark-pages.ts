import { useEffect, useMemo, useState } from 'react';
import type { Look } from '../../domain/contracts';
import {
  atNight,
  darkPageColors,
  darkPageDefaults,
  darkPagesNote,
  nextNightChange,
  pagesDark,
  toggledDarkPages,
  type DarkPageSettings,
} from '../../domain/previews/documents/dark-pages';
import { themeFor } from '../../domain/preferences/themes';
import { announce, getState, report, useViewer } from '../state/store';
import { effectiveWindowSettings } from '../state/effective-ui';
import { changeSetting } from '../commands/window-commands/settings';
import type { PagePresentation } from './contracts';

/** A timer counts only time awake, so one set for the night's edge is late after the Mac sleeps:
 * the night is checked at least this often too. */
const recheck = 60_000;

/**
 * Whether pages are dark now, for the Dark pages setting in `previews`. It switches as the night
 * begins and ends, and as macOS changes its appearance (`systemLook`).
 */
export function usePagesDark(previews: Partial<DarkPageSettings>, systemLook: Look): boolean {
  const mode = previews.darkPages ?? darkPageDefaults.darkPages;
  const from = previews.darkPagesFrom ?? darkPageDefaults.darkPagesFrom;
  const until = previews.darkPagesUntil ?? darkPageDefaults.darkPagesUntil;
  const night = mode === 'night';
  // renders as the night begins or ends; the value itself is read below, as it is at that render
  const [, setNight] = useState<boolean>();
  useEffect(() => {
    if (!night) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const now = new Date();
      setNight(atNight(now, from, until));
      const edge = nextNightChange(now, from, until).getTime() - now.getTime();
      timer = setTimeout(check, Math.min(recheck, edge));
    };
    check();
    return () => clearTimeout(timer);
  }, [night, from, until]);
  return pagesDark(
    { darkPages: mode, darkPagesFrom: from, darkPagesUntil: until },
    new Date(),
    systemLook,
  );
}

/**
 * The Dark pages button and command: pages the other way from how they are now, in every page
 * preview from then on. An automatic mode gives way to the manual choice, and a note says so
 * once, with how to choose it again.
 */
export function toggleDarkPages(dark: boolean): void {
  const mode = effectiveWindowSettings(getState()).previews.darkPages ?? darkPageDefaults.darkPages;
  const { mode: next, replaced } = toggledDarkPages(mode, dark);
  void changeSetting('settings.previews.darkPages', next)
    .then(() => {
      if (replaced) announce(darkPagesNote({ mode: next, replaced }));
    })
    .catch(report);
}

/** This window's page previews: the dark page's colours from the dark theme while pages are
 * dark, whatever the window's own look, and the button that turns them. */
export function useDarkPages(): PagePresentation {
  const settings = useViewer(effectiveWindowSettings);
  const systemLook = useViewer((state) => state.settings.systemLook ?? state.settings.look);
  const dark = usePagesDark(settings.previews, systemLook);
  const { themes, theme } = settings;
  const colors = useMemo(
    () => (dark ? darkPageColors(themeFor({ themes, theme }, 'dark')) : undefined),
    [dark, themes, theme],
  );
  return useMemo(() => ({ dark: colors, toggle: () => toggleDarkPages(!!colors) }), [colors]);
}
