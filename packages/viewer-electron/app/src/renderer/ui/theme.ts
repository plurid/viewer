import { useEffect, useMemo } from 'react';
import { themeFor, themeVariables, type Theme } from '../../domain/themes';
import type { ApplicationSettings } from '../../domain/services';

/** The theme for an appearance, the same object while its settings are (2026-10-23). */
export function useTheme(
  settings: Pick<ApplicationSettings, 'themes' | 'theme'>,
  look: 'dark' | 'light',
): Theme {
  const { themes, theme } = settings;
  return useMemo(() => themeFor({ themes, theme }, look), [themes, theme, look]);
}
/** A theme's colours as the page's CSS variables: the shell, the code and the terminal. */
export function useThemeVariables(theme: Theme): void {
  useEffect(() => {
    const style = document.documentElement.style;
    const variables = themeVariables(theme);
    for (const [name, value] of Object.entries(variables)) style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(variables)) style.removeProperty(name);
    };
  }, [theme]);
}
