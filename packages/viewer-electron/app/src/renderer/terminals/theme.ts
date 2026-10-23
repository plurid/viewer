import type { ApplicationSettings } from '../../domain/services';

/**
 * xterm colours for each Viewer look; one source for new and restyled terminals. A full ANSI palette
 * (2026-10-23): with only background, foreground and cursor, programs' colours were xterm's defaults.
 */
export function terminalTheme(look: 'dark' | 'light') {
  return look === 'dark'
    ? {
        background: '#25282e',
        foreground: '#e6e8eb',
        cursor: '#9abfd1',
        cursorAccent: '#25282e',
        selectionBackground: '#3a5368',
        scrollbarSliderBackground: 'rgba(230, 232, 235, 0.16)',
        scrollbarSliderHoverBackground: 'rgba(230, 232, 235, 0.28)',
        scrollbarSliderActiveBackground: 'rgba(230, 232, 235, 0.36)',
        black: '#3b4048',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#d7dae0',
        brightBlack: '#6b7380',
        brightRed: '#ef8890',
        brightGreen: '#b0d892',
        brightYellow: '#f0d197',
        brightBlue: '#82c1f5',
        brightMagenta: '#d495e6',
        brightCyan: '#77c9d4',
        brightWhite: '#ffffff',
      }
    : {
        background: '#f5f6f8',
        foreground: '#25282e',
        cursor: '#40748d',
        cursorAccent: '#f5f6f8',
        selectionBackground: '#cfe1ec',
        scrollbarSliderBackground: 'rgba(37, 40, 46, 0.14)',
        scrollbarSliderHoverBackground: 'rgba(37, 40, 46, 0.26)',
        scrollbarSliderActiveBackground: 'rgba(37, 40, 46, 0.34)',
        black: '#383a42',
        red: '#c8414b',
        green: '#3f8f2f',
        yellow: '#9a6a00',
        blue: '#3a6fd8',
        magenta: '#9a3fb0',
        cyan: '#11808f',
        white: '#a0a1a7',
        brightBlack: '#696c77',
        brightRed: '#e0505a',
        brightGreen: '#50a13f',
        brightYellow: '#b07e00',
        brightBlue: '#4f84ec',
        brightMagenta: '#b257c8',
        brightCyan: '#1f99a8',
        brightWhite: '#25282e',
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
