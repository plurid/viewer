import type { ApplicationSettings } from '../services';
export const defaultShortcuts: Record<string, string> = {
  palette: 'Cmd+K',
  'find-file': 'Cmd+F',
  'new-root-folder': 'Cmd+N',
  settings: 'Cmd+,',
  'frame-all': 'Cmd+0',
  dock: 'Cmd+Enter',
  'toggle-sidebar': 'Cmd+Alt+S',
  // Finder's Hide Toolbar key
  'toggle-titlebar': 'Cmd+Alt+T',
  'go-to': 'Cmd+L',
  'open-selection': 'Cmd+O',
  parent: 'Cmd+ArrowUp',
  'parent-plane': 'Cmd+Alt+ArrowUp',
  'close-plane': 'Cmd+Alt+W',
  back: 'Cmd+[',
  forward: 'Cmd+]',
  copy: 'Cmd+C',
  'copy-path': 'Cmd+Alt+C',
  cut: 'Cmd+X',
  paste: 'Cmd+V',
  'paste-move': 'Cmd+Alt+V',
  'select-all': 'Cmd+A',
  info: 'Cmd+I',
  duplicate: 'Cmd+D',
  trash: 'Cmd+Backspace',
  'new-folder': 'Cmd+Shift+N',
  'new-folder-with-selection': 'Ctrl+Cmd+N',
  'view-list': 'Cmd+1',
  'view-grid': 'Cmd+2',
  'view-columns': 'Cmd+3',
  'view-gallery': 'Cmd+4',
  'view-map': 'Cmd+5',
  'toggle-hidden': 'Cmd+Shift+.',
  // text
  'new-scratch-plane': 'Cmd+T',
  'edit-file': 'Cmd+E',
  'save-file': 'Cmd+S',
  'save-file-as': 'Cmd+Shift+S',
  // the chrome away and back; not ⌃⌘F, the Mac's full screen
  'focus-mode': 'Cmd+Shift+F',
  // a commander's pair: ⌃⌘ with copy's and cut's letters, not F5/F6
  'copy-to-pair': 'Ctrl+Cmd+C',
  'move-to-pair': 'Ctrl+Cmd+X',
  'select-by-pattern': 'Ctrl+Cmd+=',
  'deselect-by-pattern': 'Ctrl+Cmd+-',
  // the space's views: ⌥⌘ goes to one, ⌃⌥⌘ saves the camera as one
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((slot) => [
      [`bookmark.${slot}`, `Cmd+Alt+${slot}`],
      [`bookmark.save.${slot}`, `Ctrl+Cmd+Alt+${slot}`],
    ]),
  ),
};
/** Second bindings kept for Finder habits, alongside the primary shortcut. */
export const alternateShortcuts: Readonly<Record<string, string>> = { 'go-to': 'Cmd+Shift+G' };
/** Menu accelerators handled only by the native menu: the renderer must not also run
 * them (a second Undo would undo another job). Listed for remapping and conflicts. */
export const menuShortcuts: Record<string, string> = {
  'choose-folder': 'Cmd+Shift+O',
  'undo-file': 'Cmd+Z',
  'redo-file': 'Cmd+Shift+Z',
  'undo-arrangement': 'Cmd+Alt+Z',
  'redo-arrangement': 'Cmd+Alt+Shift+Z',
};
/** Every setting the native menu renders; the menu is rebuilt only when this changes. */
export function nativeMenuBindings(settings: ApplicationSettings | undefined): string {
  return JSON.stringify([
    settings?.browsing.confirmTrash,
    settings?.shortcuts,
    settings?.recipes.map((recipe) => [recipe.id, recipe.name, recipe.shortcut]),
    settings?.customActions.map((action) => [
      action.id,
      action.name,
      action.shortcut,
      action.order,
    ]),
  ]);
}
/** Shortcut keys kept for saved remaps whose command has a different ID. */
const shortcutCommands: Readonly<Record<string, string>> = { 'toggle-hidden': 'hidden' };
export const shortcutCommandID = (shortcutID: string) => shortcutCommands[shortcutID] ?? shortcutID;
export const commandShortcutID = (commandID: string) =>
  Object.keys(shortcutCommands).find((key) => shortcutCommands[key] === commandID) ?? commandID;
const aliases: Record<string, string> = {
  command: 'cmd',
  cmdorctrl: 'cmd',
  control: 'ctrl',
  option: 'alt',
  return: 'enter',
};
export function shortcutParts(value: string): string[] {
  return value
    .toLowerCase()
    .split('+')
    .map((part) => aliases[part.trim()] || part.trim())
    .filter(Boolean);
}
export function shortcutKey(value: string): string {
  return shortcutParts(value).sort().join('+');
}
export function validShortcut(value: string): boolean {
  if (!value) return true;
  const parts = shortcutParts(value);
  return (
    parts.length >= 2 &&
    parts.some((part) => part === 'cmd' || part === 'ctrl') &&
    parts.filter((part) => !['cmd', 'ctrl', 'shift', 'alt'].includes(part)).length === 1 &&
    new Set(parts).size === parts.length &&
    parts.every(
      (part) =>
        // space too: ⌃Space is a common prefix, as in tmux
        ['cmd', 'ctrl', 'shift', 'alt', 'enter', 'backspace', 'delete', 'escape', 'space'].includes(
          part,
        ) ||
        part.length === 1 ||
        /^arrow(up|down|left|right)$/.test(part) ||
        /^f([1-9]|1[0-9]|2[0-4])$/.test(part),
    )
  );
}

/** Global shortcuts may use Option alone; ordinary application shortcuts retain their rules. */
export function validGlobalShortcut(value: string): boolean {
  return (
    !!value &&
    (validShortcut(value) ||
      (shortcutParts(value).includes('alt') && validShortcut('Ctrl+' + value)))
  );
}
const codePunctuation: Readonly<Record<string, string>> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};
/** The unmodified key on a US layout, from the physical key code. */
function codeKey(code = ''): string | undefined {
  return (
    /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ??
    /^Digit(\d)$/.exec(code)?.[1] ??
    codePunctuation[code]
  );
}
export function matchesShortcut(
  value: string,
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
): boolean {
  const parts = shortcutParts(value);
  const key = parts.find((part) => !['cmd', 'ctrl', 'shift', 'alt'].includes(part));
  return (
    !!value &&
    event.metaKey === parts.includes('cmd') &&
    event.ctrlKey === parts.includes('ctrl') &&
    event.altKey === parts.includes('alt') &&
    event.shiftKey === parts.includes('shift') &&
    (key === (event.key === ' ' ? 'space' : event.key.toLowerCase()) ||
      // Option and Shift change the produced character (Option+C is "ç", Shift+. is ">").
      ((event.altKey || event.shiftKey) && key === codeKey(event.code)))
  );
}
export function accelerator(value: string): string | undefined {
  if (!value) return undefined;
  return shortcutParts(value)
    .map(
      (part) =>
        ({
          cmd: 'Command',
          ctrl: 'Control',
          alt: 'Alt',
          shift: 'Shift',
          enter: 'Return',
          arrowup: 'Up',
          arrowdown: 'Down',
          arrowleft: 'Left',
          arrowright: 'Right',
        })[part] || part.toUpperCase(),
    )
    .join('+');
}
/** A shortcut's command in words: `undo-file` → "Undo file", `bookmark.3` → "Go to view 3". */
export function shortcutLabel(id: string): string {
  const view = /^bookmark\.(save\.)?(\d)$/.exec(id);
  if (view) return view[1] ? `Save view as ${view[2]}` : `Go to view ${view[2]}`;
  const words = shortcutCommandID(id).replace(/[-.]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/**
 * What already answers a chord, other than `except`: a built-in or menu shortcut,
 * a recipe's, a custom action's, or the prefix. Settings says so rather than saving a conflict.
 */
export function shortcutOwner(
  settings: ApplicationSettings,
  value: string,
  except: string,
): string | undefined {
  const wanted = shortcutKey(value);
  const owners: [string, string, string][] = [
    ...Object.entries({ ...defaultShortcuts, ...menuShortcuts, ...settings.shortcuts }).map(
      ([id, shortcut]): [string, string, string] => [id, shortcut, shortcutLabel(id)],
    ),
    ...Object.entries(alternateShortcuts).map(([id, shortcut]): [string, string, string] => [
      `${id}:alternate`,
      shortcut,
      shortcutLabel(id),
    ]),
    ...settings.recipes.map((recipe): [string, string, string] => [
      `recipe.${recipe.id}`,
      recipe.shortcut ?? '',
      recipe.name,
    ]),
    ...settings.customActions.map((action): [string, string, string] => [
      `custom.${action.id}`,
      action.shortcut,
      action.name,
    ]),
    ['keymap-prefix', settings.keymap.prefix, 'Prefix key'],
  ];
  return owners.find(
    ([id, shortcut]) => id !== except && !!shortcut && shortcutKey(shortcut) === wanted,
  )?.[2];
}
