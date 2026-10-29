/**
 * THEMES: the shell's colours, the code colours and the terminal's palette as one
 * theme per appearance, editable and importable from an iTerm colour preset or a VS Code theme.
 */
import { describe, expect, it } from 'vitest';
import { builtInThemes, themeVariables, themeFor } from '../src/domain/preferences/themes';
import { importItermColors, importVSCodeTheme } from '../src/domain/preferences/theme-import';
import { themeSchema } from '../src/desktop/preferences/settings-schema';
import { defaultSettings } from '../src/domain/services';

const component = (name: string, r: number, g: number, b: number) =>
  `<key>${name}</key>\n<dict>\n<key>Blue Component</key>\n<real>${b}</real>\n<key>Green Component</key>\n<real>${g}</real>\n<key>Red Component</key>\n<real>${r}</real>\n</dict>`;
const iterm = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
${component('Ansi 0 Color', 0, 0, 0)}
${component('Ansi 1 Color', 1, 0, 0)}
${component('Ansi 4 Color', 0.2, 0.4, 1)}
${component('Ansi 15 Color', 1, 1, 1)}
${component('Background Color', 0.1, 0.1, 0.12)}
${component('Foreground Color', 0.9, 0.9, 0.9)}
${component('Cursor Color', 1, 0.8, 0)}
${component('Selection Color', 0.2, 0.3, 0.4)}
</dict></plist>`;
const vscode = `{
  // a comment, as theme files have
  "name": "Night Owl",
  "type": "dark",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "sideBar.background": "#011627",
    "focusBorder": "#7e57c2",
    "editor.selectionBackground": "#1d3b53",
    "terminal.ansiRed": "#ef5350",
    "terminal.ansiBrightBlue": "#82aaff",
  },
  "tokenColors": [
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#637777" } },
    { "scope": "string", "settings": { "foreground": "#ecc48d" } },
    { "scope": "keyword", "settings": { "foreground": "#c792ea" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#f78c6c" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#82aaff" } }
  ]
}`;

describe('themes', () => {
  it('have a built-in one per appearance, the colours Viewer has now', () => {
    expect(builtInThemes.map((theme) => theme.look)).toEqual(['dark', 'light']);
    expect(builtInThemes[0]!.shell.space).toBe('#272a30');
    for (const theme of builtInThemes) expect(themeSchema.safeParse(theme).success).toBe(true);
  });
  it('are chosen per appearance, the built-in one when none is', () => {
    const settings = defaultSettings('/fixtures');
    expect(themeFor(settings, 'dark').id).toBe('viewer-dark');
    const mine = { ...builtInThemes[0]!, id: 'mine', name: 'Mine', shell: { accent: '#ff0000' } };
    const chosen = themeFor(
      { ...settings, themes: [mine], theme: { dark: 'mine', light: '' } },
      'dark',
    );
    // what a theme leaves out is the built-in one's
    expect(chosen.shell).toMatchObject({ accent: '#ff0000', space: '#272a30' });
  });
  it('become CSS variables for the shell, the code and the terminal', () => {
    const variables = themeVariables(builtInThemes[0]!);
    expect(variables['--space']).toBe('#272a30');
    expect(variables['--syntax-string']).toBe('#b7c79e');
    expect(variables['--terminal-red']).toBe('#e06c75');
    expect(variables['--media-stage']).toBe(builtInThemes[0]!.shell.mediaStage);
    expect(variables['--selection-muted']).toBe(builtInThemes[0]!.shell.selectionMuted);
    expect(variables['--shadow-color']).toBe(builtInThemes[0]!.shell.shadowColor);
  });
});

describe('importing', () => {
  it('an iTerm colour preset: the terminal palette, and the shell from it', () => {
    const theme = importItermColors(iterm, 'Dracula');
    expect(theme.look).toBe('dark');
    expect(theme.terminal).toMatchObject({
      black: '#000000',
      red: '#ff0000',
      blue: '#3366ff',
      brightWhite: '#ffffff',
      background: '#1a1a1f',
      foreground: '#e6e6e6',
      cursor: '#ffcc00',
    });
    expect(theme.shell).toMatchObject({ space: '#1a1a1f', ink: '#e6e6e6', accent: '#3366ff' });
    expect(themeSchema.safeParse(theme).success).toBe(true);
  });
  it('a VS Code theme, comments and trailing commas and all', () => {
    const theme = importVSCodeTheme(vscode);
    expect(theme).toMatchObject({ name: 'Night Owl', look: 'dark' });
    expect(theme.shell).toMatchObject({
      space: '#011627',
      ink: '#d6deeb',
      accent: '#7e57c2',
      selection: '#1d3b53',
    });
    expect(theme.syntax).toEqual({
      comment: '#637777',
      string: '#ecc48d',
      keyword: '#c792ea',
      number: '#f78c6c',
      function: '#82aaff',
    });
    expect(theme.terminal).toMatchObject({ red: '#ef5350', brightBlue: '#82aaff' });
    expect(themeSchema.safeParse(theme).success).toBe(true);
  });
  it('refuses what is neither', () => {
    expect(() => importItermColors('<plist></plist>', 'x')).toThrow();
    expect(() => importVSCodeTheme('{ "nothing": true }')).toThrow();
  });
});
