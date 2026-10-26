import { builtInTheme, type Theme } from '../../domain/preferences/themes';
import type { ApplicationSettings } from '../../domain/services';

/**
 * xterm colours for each Viewer look, from the theme: its terminal palette over the
 * built-in one, and scrollbars in the theme's text colour.
 */
export function terminalTheme(look: 'dark' | 'light', palette?: Theme['terminal']) {
  const colors = { ...builtInTheme(look).terminal, ...palette };
  const ink = look === 'dark' ? '230, 232, 235' : '37, 40, 46';
  return {
    ...colors,
    cursorAccent: colors.background,
    scrollbarSliderBackground: `rgba(${ink}, ${look === 'dark' ? 0.16 : 0.14})`,
    scrollbarSliderHoverBackground: `rgba(${ink}, ${look === 'dark' ? 0.28 : 0.26})`,
    scrollbarSliderActiveBackground: `rgba(${ink}, ${look === 'dark' ? 0.36 : 0.34})`,
  };
}

/** The terminal's text from Settings → Terminals; Menlo follows a family that is not installed. */
export const terminalFontOptions = (font: ApplicationSettings['terminalFont']) => ({
  fontFamily: `"${font.fontFamily}", Menlo, Monaco, monospace`,
  fontSize: font.fontSize,
  fontWeight: font.fontWeight,
  fontWeightBold: 'bold' as const,
  lineHeight: font.lineHeight,
  letterSpacing: font.letterSpacing,
});

/** Find's highlights: every match, and the current one stronger, in the overview ruler too. */
export const searchDecorations = (look: 'dark' | 'light') =>
  look === 'dark'
    ? {
        matchBackground: '#4b5b2f',
        matchOverviewRuler: '#98c379',
        activeMatchBackground: '#8a6d1f',
        activeMatchColorOverviewRuler: '#e5c07b',
      }
    : {
        matchBackground: '#e3f0c9',
        matchOverviewRuler: '#3f8f2f',
        activeMatchBackground: '#f5d77a',
        activeMatchColorOverviewRuler: '#b07e00',
      };
