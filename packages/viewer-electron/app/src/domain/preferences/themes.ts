import type { ApplicationSettings } from '../services';

export const shellTokens = [
  'space',
  'surface',
  'raised',
  'field',
  'ink',
  'muted',
  'subtle',
  'accent',
  'line',
  'selection',
  'danger',
  'selectionMuted',
  'mediaStage',
  'overlay',
  'familyDocument',
  'familyArchive',
  'tagGray',
  'tagGreen',
  'tagPurple',
  'tagBlue',
  'tagYellow',
  'tagRed',
  'tagOrange',
  'imageRegion',
  'shadowColor',
  'softShadowColor',
  'strongShadowColor',
] as const;
export const syntaxTokens = ['comment', 'string', 'keyword', 'number', 'function'] as const;
export const terminalTokens = [
  'background',
  'foreground',
  'cursor',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;
export type ShellToken = (typeof shellTokens)[number];
export type SyntaxToken = (typeof syntaxTokens)[number];
export type TerminalToken = (typeof terminalTokens)[number];
/**
 * A THEME (2026-10-23): the shell's colours, the code colours and the terminal's palette, for one
 * appearance. What it leaves out is the built-in theme's.
 */
export interface Theme {
  id: string;
  name: string;
  look: 'dark' | 'light';
  shell: Partial<Record<ShellToken, string>>;
  syntax: Partial<Record<SyntaxToken, string>>;
  terminal: Partial<Record<TerminalToken, string>>;
  metrics?: { fontFamily?: string; density?: 'compact' | 'comfortable'; radius?: number };
}
const sharedShell = {
  mediaStage: '#17191e',
  overlay: '#101319a6',
  tagGray: '#92969e',
  tagGreen: '#70ac75',
  tagPurple: '#a78ac2',
  tagBlue: '#7fa9ce',
  tagYellow: '#d1ba6b',
  tagRed: '#cf8585',
  tagOrange: '#ca9a70',
  imageRegion: '#3399ff66',
  shadowColor: '#00000055',
  softShadowColor: '#00000033',
  strongShadowColor: '#00000066',
};
export const builtInThemes: readonly [Theme, Theme] = [
  {
    id: 'viewer-dark',
    name: 'Viewer Dark',
    look: 'dark',
    shell: {
      ...sharedShell,
      selectionMuted: '#c4d7e3',
      familyDocument: '#b7ba93',
      familyArchive: '#b4aecf',
      space: '#272a30',
      surface: '#31353d',
      raised: '#393e47',
      field: '#292d34',
      ink: '#f2f4f6',
      muted: '#b1bac6',
      subtle: '#9fabb9',
      accent: '#82b3cf',
      line: '#454b55',
      selection: '#3a5368',
      danger: '#ff9da0',
    },
    syntax: {
      comment: '#9fabb9',
      string: '#b7c79e',
      keyword: '#c9b4d6',
      number: '#dfb891',
      function: '#82b3cf',
    },
    terminal: {
      background: '#25282e',
      foreground: '#e6e8eb',
      cursor: '#9abfd1',
      selectionBackground: '#3a5368',
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
    },
  },
  {
    id: 'viewer-light',
    name: 'Viewer Light',
    look: 'light',
    shell: {
      ...sharedShell,
      selectionMuted: '#546071',
      familyDocument: '#686d32',
      familyArchive: '#6c5d9c',
      shadowColor: '#20304025',
      space: '#eef0f4',
      surface: '#ffffff',
      raised: '#f4f6f8',
      field: '#f4f6f8',
      ink: '#202733',
      muted: '#546071',
      subtle: '#637084',
      accent: '#337396',
      line: '#d5dbe2',
      selection: '#dcebf4',
      danger: '#a62f3e',
    },
    syntax: {
      comment: '#637084',
      string: '#386731',
      keyword: '#755183',
      number: '#805d32',
      function: '#337396',
    },
    terminal: {
      background: '#f5f6f8',
      foreground: '#25282e',
      cursor: '#40748d',
      selectionBackground: '#cfe1ec',
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
    },
  },
];
export const builtInTheme = (look: 'dark' | 'light') =>
  look === 'dark' ? builtInThemes[0] : builtInThemes[1];
/** The theme for an appearance, every token filled from the built-in theme. */
export function themeFor(
  settings: Pick<ApplicationSettings, 'themes' | 'theme'>,
  look: 'dark' | 'light',
): Theme {
  const base = builtInTheme(look);
  const id = settings.theme[look];
  const chosen = settings.themes.find((theme) => theme.id === id && theme.look === look);
  if (!chosen) return base;
  return {
    ...chosen,
    shell: { ...base.shell, ...chosen.shell },
    syntax: { ...base.syntax, ...chosen.syntax },
    terminal: { ...base.terminal, ...chosen.terminal },
    metrics: { ...base.metrics, ...chosen.metrics },
  };
}
const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
/** A theme as CSS variables: `--space`, `--syntax-string`, `--terminal-red`. */
export function themeVariables(theme: Theme): Record<string, string> {
  const radius = theme.metrics?.radius ?? 5;
  return {
    '--interface-font':
      theme.metrics?.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    '--density-scale': theme.metrics?.density === 'compact' ? '0.92' : '1',
    '--radius-control': `${radius}px`,
    '--radius-panel': `${radius + 3}px`,
    '--radius-dialog': `${radius + 5}px`,
    ...Object.fromEntries(
      Object.entries(theme.shell).map(([token, color]) => [`--${kebab(token)}`, color]),
    ),
    ...Object.fromEntries(
      Object.entries(theme.syntax).map(([token, color]) => [`--syntax-${token}`, color]),
    ),
    ...Object.fromEntries(
      Object.entries(theme.terminal).map(([token, color]) => [`--terminal-${kebab(token)}`, color]),
    ),
  };
}
/** A colour as themes keep it: `#rrggbb`, or `#rrggbbaa` with transparency. */
export function themeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(text) ? text : undefined;
}
