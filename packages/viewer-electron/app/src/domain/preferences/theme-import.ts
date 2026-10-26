import {
  themeColor,
  type ShellToken,
  type SyntaxToken,
  type TerminalToken,
  type Theme,
} from './themes';

const hex = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
/** Light or dark, by the relative luminance of the background. */
const lookOf = (color: string): 'dark' | 'light' => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.5 ? 'light' : 'dark';
};
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'theme';
const ansi: readonly TerminalToken[] = [
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
];
/**
 * An iterm colour preset: an `.itermcolors` property list. Its sixteen ANSI colours,
 * background, foreground, cursor and selection become the terminal's palette, and the shell takes
 * its space, text and accent from them.
 */
export function importItermColors(xml: string, name: string): Theme {
  const colors = new Map<string, string>();
  for (const block of xml.matchAll(/<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g)) {
    const channel = (component: string) =>
      Number(
        new RegExp(`<key>${component} Component</key>\\s*<real>([^<]+)</real>`).exec(
          block[2]!,
        )?.[1],
      );
    const [r, g, b] = ['Red', 'Green', 'Blue'].map(channel);
    if ([r, g, b].every((value) => Number.isFinite(value)))
      colors.set(block[1]!.trim(), `#${hex(r!)}${hex(g!)}${hex(b!)}`);
  }
  const background = colors.get('Background Color');
  const foreground = colors.get('Foreground Color');
  if (!background || !foreground) throw new Error('This is not an iTerm colour preset.');
  const terminal: Partial<Record<TerminalToken, string>> = {
    background,
    foreground,
    ...(colors.get('Cursor Color') ? { cursor: colors.get('Cursor Color') } : {}),
    ...(colors.get('Selection Color')
      ? { selectionBackground: colors.get('Selection Color') }
      : {}),
  };
  ansi.forEach((token, index) => {
    const color = colors.get(`Ansi ${index} Color`);
    if (color) terminal[token] = color;
  });
  return {
    id: `${slug(name)}-${Date.now().toString(36)}`,
    name,
    look: lookOf(background),
    shell: {
      space: background,
      ink: foreground,
      ...(terminal.blue ? { accent: terminal.blue } : {}),
      ...(terminal.selectionBackground ? { selection: terminal.selectionBackground } : {}),
    },
    syntax: {},
    terminal,
  };
}

/** JSON with comments and trailing commas, as VS Code's theme files are. */
function parseJSONC(text: string): unknown {
  let out = '';
  let string = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (string) {
      out += char;
      if (char === '\\') out += text[++index] ?? '';
      else if (char === '"') string = false;
    } else if (char === '"') {
      string = true;
      out += char;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++;
    } else if (char === '/' && text[index + 1] === '*') {
      index = text.indexOf('*/', index + 2);
      if (index < 0) break;
      index++;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
const shellKeys: [ShellToken, string[]][] = [
  ['space', ['editor.background']],
  ['surface', ['sideBar.background', 'editorWidget.background']],
  ['raised', ['editorWidget.background', 'dropdown.background', 'list.hoverBackground']],
  ['field', ['input.background']],
  ['ink', ['editor.foreground', 'foreground']],
  ['muted', ['descriptionForeground', 'sideBar.foreground']],
  ['subtle', ['editorLineNumber.foreground']],
  ['accent', ['focusBorder', 'button.background', 'textLink.foreground']],
  ['line', ['panel.border', 'editorGroup.border', 'sideBar.border']],
  ['selection', ['editor.selectionBackground', 'list.activeSelectionBackground']],
  ['danger', ['errorForeground', 'editorError.foreground']],
];
const syntaxScopes: [SyntaxToken, string[]][] = [
  ['comment', ['comment']],
  ['string', ['string']],
  ['keyword', ['keyword', 'storage.type']],
  ['number', ['constant.numeric', 'constant']],
  ['function', ['entity.name.function', 'support.function']],
];
/**
 * A vs code theme: its workbench colours become the shell's, its token colours the
 * code colours, and its terminal colours the terminal's palette.
 */
export function importVSCodeTheme(text: string, fallbackName = 'Imported theme'): Theme {
  const json = parseJSONC(text) as {
    name?: unknown;
    type?: unknown;
    colors?: Record<string, unknown>;
    tokenColors?: { scope?: unknown; settings?: { foreground?: unknown } }[];
  };
  const colors = json.colors ?? {};
  const tokens = Array.isArray(json.tokenColors) ? json.tokenColors : [];
  if (!Object.keys(colors).length && !tokens.length)
    throw new Error('This is not a VS Code colour theme.');
  const pick = (keys: string[]) => keys.map((key) => themeColor(colors[key])).find(Boolean);
  const shell: Theme['shell'] = {};
  for (const [token, keys] of shellKeys) {
    const color = pick(keys);
    if (color) shell[token] = color;
  }
  const syntax: Theme['syntax'] = {};
  for (const [token, scopes] of syntaxScopes)
    for (const scope of scopes) {
      const rule = tokens.find((item) =>
        (Array.isArray(item.scope) ? item.scope : String(item.scope ?? '').split(','))
          .map((value) => String(value).trim())
          .includes(scope),
      );
      const color = themeColor(rule?.settings?.foreground);
      if (color && !syntax[token]) syntax[token] = color;
    }
  const terminal: Theme['terminal'] = {};
  for (const token of ansi) {
    const color = themeColor(colors[`terminal.ansi${token[0]!.toUpperCase()}${token.slice(1)}`]);
    if (color) terminal[token] = color;
  }
  for (const [token, key] of [
    ['background', 'terminal.background'],
    ['foreground', 'terminal.foreground'],
    ['cursor', 'terminalCursor.foreground'],
    ['selectionBackground', 'terminal.selectionBackground'],
  ] as const) {
    const color = themeColor(colors[key]);
    if (color) terminal[token] = color;
  }
  const name = typeof json.name === 'string' && json.name.trim() ? json.name.trim() : fallbackName;
  const look =
    json.type === 'light' || json.type === 'dark'
      ? json.type
      : shell.space
        ? lookOf(shell.space)
        : 'dark';
  return { id: `${slug(name)}-${Date.now().toString(36)}`, name, look, shell, syntax, terminal };
}
