import type { ApplicationSettings } from '../services';
import { keyGlyphs, keyParts, lowerKey, upperKey } from './keymap';
export const defaultShortcuts: Record<string, string> = {
  palette: 'Cmd+K',
  dictate: 'Ctrl+Shift+Space',
  'find-file': 'Cmd+F',
  // Finder's: ⌘N a new window of files, here a files plane; ⇧⌘N a new folder
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
/**
 * A picture's own keys, as Preview's: they turn the picture that has the keyboard
 * (renderer/previews/keys.ts), and the window's command for the same chord, as ⌘L's Go to
 * Folder…, answers everywhere else. Settings lists them with the rest.
 */
export const previewShortcuts: Readonly<Record<string, string>> = {
  'image-rotate-left': 'Cmd+L',
  'image-rotate-right': 'Cmd+R',
};
export const isPreviewShortcut = (id: string) => Object.hasOwn(previewShortcuts, id);
/** Second bindings kept for Finder habits, alongside the primary shortcut. */
export const alternateShortcuts: Readonly<Record<string, string>> = { 'go-to': 'Cmd+Shift+G' };
/** Menu accelerators handled only by the native menu: the renderer must not also run
 * them (a second Undo would undo another job). Listed for remapping and conflicts. */
export const menuShortcuts: Record<string, string> = {
  // a window of its own, with ⌥ as ⌘N's: ⌘N opens a files plane in this one
  'new-native-window': 'Cmd+Alt+N',
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
  const { modifiers, base } = keyParts(value.trim());
  return [...modifiers, base]
    .map((part) => {
      const key = lowerKey(part.trim());
      return Object.hasOwn(aliases, key) ? aliases[key]! : key;
    })
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
export function codeKey(code = ''): string | undefined {
  return (
    /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ??
    /^Digit(\d)$/.exec(code)?.[1] ??
    codePunctuation[code]
  );
}
type ShortcutEvent = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'> &
  Partial<Pick<KeyboardEvent, 'code'>>;

function modifiedKey(event: ShortcutEvent): string | undefined {
  return event.altKey || event.shiftKey ? codeKey(event.code) : undefined;
}

/** Shift and Option record the unmodified key at that position when its code is known. */
export function recordedShortcut(event: ShortcutEvent): string | undefined {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  const key = modifiedKey(event) ?? event.key;
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Cmd',
    key === ' ' ? 'Space' : key.length === 1 ? upperKey(key) : key,
  ]
    .filter(Boolean)
    .join('+');
}

/** A character binding may use another key that types it until that recorded chord has an owner. */
function canUseChord(value: string, event: ShortcutEvent, settings: ApplicationSettings): boolean {
  const recorded = recordedShortcut(event);
  return (
    !recorded ||
    sameKey(value, recorded) ||
    !bindings(settings).some(([, chord]) => sameKey(chord, recorded))
  );
}

/** No Prefix and the leader spell Shift in the character. An uppercase letter carries Shift,
 * while an entry such as Cmd++ can also match the keypad without Shift. */
export function canStartKeyBinding(
  name: string,
  event: ShortcutEvent,
  settings: ApplicationSettings,
): boolean {
  if (!event.altKey && !event.shiftKey) return true;
  const { base } = keyParts(name);
  if (base.length !== 1) return true;
  const chord = event.shiftKey && base !== lowerKey(base) ? 'Shift+' + name : name;
  return canUseChord(chord, event, settings);
}

export function matchesShortcut(
  value: string,
  event: ShortcutEvent,
  settings?: ApplicationSettings,
): boolean {
  if (!value) return false;
  const parts = shortcutParts(value);
  if (
    event.metaKey !== parts.includes('cmd') ||
    event.ctrlKey !== parts.includes('ctrl') ||
    event.altKey !== parts.includes('alt') ||
    event.shiftKey !== parts.includes('shift')
  )
    return false;
  const key = parts.find((part) => !['cmd', 'ctrl', 'shift', 'alt'].includes(part));
  const physical = modifiedKey(event);
  if (physical && key === physical) return true;
  if (key !== (event.key === ' ' ? 'space' : lowerKey(event.key))) return false;
  return !physical || !settings || canUseChord(value, event, settings);
}

/** Includes bindings handled outside the window router, such as the prefix and picture rotation. */
export function hasShortcutForEvent(settings: ApplicationSettings, event: ShortcutEvent): boolean {
  return bindings(settings).some(([, chord]) => matchesShortcut(chord, event));
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
          '+': 'Plus',
          arrowup: 'Up',
          arrowdown: 'Down',
          arrowleft: 'Left',
          arrowright: 'Right',
        })[part] || upperKey(part),
    )
    .join('+');
}
// a saved shortcut's parts as keyGlyphs names them, whatever case and spelling it was saved in
const glyphNames: Readonly<Record<string, string>> = {
  cmd: 'Cmd',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};
/** A shortcut as a Mac menu shows it: `Cmd+Shift+N` → `⇧⌘N`, `Cmd+ArrowUp` → `⌘↑`; none → "". */
export function shortcutGlyphs(value: string): string {
  if (!value) return '';
  return keyGlyphs(
    shortcutParts(value)
      .map((part) => glyphNames[part] ?? (/^f\d+$/.test(part) ? part.toUpperCase() : part))
      .join('+'),
  );
}
/**
 * A command's shortcut as saved, else as shipped; "" when it has none, was cleared, or the person
 * gave its shipped key to another command, which keeps it. For hints, from the saved keys alone:
 * `resolvedShortcut` also counts recipes and custom actions.
 */
export function shortcutFor(
  shortcuts: Readonly<Record<string, string>> | undefined,
  id: string,
): string {
  const saved = shortcuts?.[id];
  if (saved !== undefined) return saved;
  const shipped = shippedShortcut(id) ?? '';
  const taken = Object.entries(shortcuts ?? {}).some(
    ([other, shortcut]) =>
      other !== id && sameKey(shortcut, shipped) && !sharedAsShipped(id, shipped, other, shortcut),
  );
  return taken ? '' : shipped;
}
/** A command's own shortcut before any change, if it ships with one. */
export function shippedShortcut(id: string): string | undefined {
  return defaultShortcuts[id] ?? menuShortcuts[id] ?? previewShortcuts[id];
}
/** A control's name with its key, as a tooltip shows it: "Edit Text (⌘E)", or the name alone. */
export function withShortcut(label: string, glyphs: string): string {
  return glyphs ? `${label} (${glyphs})` : label;
}
// Each shortcut's command by the name its menu item and palette row show. A command whose label
// follows its state (Hide Title Bar, Show Title Bar) is named for both.
const shortcutNames: Readonly<Record<string, string>> = {
  palette: 'Commands…',
  dictate: 'Ask Viewer by Voice…',
  'find-file': 'Find File…',
  'new-root-folder': 'New Files Plane',
  settings: 'Settings…',
  'frame-all': 'Frame All Planes',
  dock: 'Dock Plane',
  'toggle-sidebar': 'Show or Hide Window Navigation',
  'toggle-titlebar': 'Show or Hide Title Bar',
  'go-to': 'Go to Folder…',
  'open-selection': 'Open Selection',
  parent: 'Parent Folder',
  // DESIGN.md names this command in these words
  'parent-plane': 'Back to parent plane',
  'close-plane': 'Close Plane',
  back: 'Back',
  forward: 'Forward',
  copy: 'Copy',
  'copy-path': 'Copy Path',
  cut: 'Cut',
  paste: 'Paste',
  'paste-move': 'Move Copied Items Here',
  'select-all': 'Select All',
  info: 'Get Info',
  duplicate: 'Duplicate',
  trash: 'Move to Trash',
  'new-folder': 'New Folder…',
  'new-folder-with-selection': 'New Folder with Selection…',
  'view-list': 'View as List',
  'view-grid': 'View as Grid',
  'view-columns': 'View as Columns',
  'view-gallery': 'View as Gallery',
  'view-map': 'View as Map',
  'toggle-hidden': 'Show or Hide Hidden Files',
  'new-scratch-plane': 'New Scratch Plane',
  'edit-file': 'Edit Text',
  'save-file': 'Save',
  'save-file-as': 'Save As…',
  'focus-mode': 'Focus Mode',
  'copy-to-pair': 'Copy to the Other Folder',
  'move-to-pair': 'Move to the Other Folder',
  'select-by-pattern': 'Select by Pattern…',
  'deselect-by-pattern': 'Deselect by Pattern…',
  'new-native-window': 'New Window',
  'choose-folder': 'Open Folder…',
  'undo-file': 'Undo',
  'redo-file': 'Redo',
  'undo-arrangement': 'Undo Arrangement',
  'redo-arrangement': 'Redo Arrangement',
  'image-rotate-left': 'Rotate Picture Left',
  'image-rotate-right': 'Rotate Picture Right',
};
/** A shortcut's command by its menu name: `undo-file` → "Undo", `bookmark.3` → "Go to View 3". */
export function shortcutLabel(id: string): string {
  const view = /^bookmark\.(save\.)?(\d)$/.exec(id);
  if (view) return view[1] ? `Save View as ${view[2]}` : `Go to View ${view[2]}`;
  const named = shortcutNames[id] ?? shortcutNames[commandShortcutID(id)];
  if (named) return named;
  const words = shortcutCommandID(id).replace(/[-.]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** A binding: what answers, its chord, and its name as Settings shows it. */
type Binding = readonly [id: string, shortcut: string, label: string];
const sameKey = (a: string, b: string) => !!a && !!b && shortcutKey(a) === shortcutKey(b);
/** Two built-ins that share a chord as shipped, a picture's and a window command's as ⌘L, each
 * holding its own: no conflict, for each answers in its own place. */
function sharedAsShipped(a: string, aChord: string, b: string, bChord: string): boolean {
  const own = (id: string, chord: string) => sameKey(shippedShortcut(id) ?? '', chord);
  return sameKey(aChord, bChord) && own(a, aChord) && own(b, bChord);
}
/** The bindings the person made, but `except`'s: keys they gave commands, recipes and custom
 * actions, and the prefix. */
function ownBindings(settings: ApplicationSettings, except?: string): Binding[] {
  return [
    ...Object.entries(settings.shortcuts)
      .filter(([id, shortcut]) => id !== except && !!shortcut)
      .map(([id, shortcut]): Binding => [id, shortcut, shortcutLabel(id)]),
    ...settings.recipes.map((recipe): Binding => [
      `recipe.${recipe.id}`,
      recipe.shortcut ?? '',
      recipe.name,
    ]),
    ...settings.customActions.map((action): Binding => [
      `custom.${action.id}`,
      action.shortcut,
      action.name,
    ]),
    ['keymap-prefix', settings.keymap.prefix, 'Prefix key'],
  ];
}
/**
 * Who holds the key built-in `id` ships with, which it then leaves to them: a recipe, custom action
 * or command the person gave that key before it was this command's, as a recipe on ⌘R before ⌘R
 * turned pictures. None while the key is free, or shared as shipped.
 */
export function shippedKeyHolder(settings: ApplicationSettings, id: string): string | undefined {
  const shipped = shippedShortcut(id);
  if (!shipped) return;
  return ownBindings(settings, id).find(
    ([other, shortcut]) =>
      sameKey(shortcut, shipped) && !sharedAsShipped(id, shipped, other, shortcut),
  )?.[2];
}
/**
 * A command's key in effect: as the person set it, else as shipped, unless the person gave that
 * key to something else, which keeps it: Settings → Shortcuts says so in the command's row. The
 * keys shipped come from here, never from a saved copy, so a key shipped differently reaches
 * every person who never changed it. '' for none.
 */
export function resolvedShortcut(settings: ApplicationSettings, id: string): string {
  return (
    settings.shortcuts[id] ?? (shippedKeyHolder(settings, id) ? '' : (shippedShortcut(id) ?? ''))
  );
}
/** The key a command in the keymap shows in ⌘K and menus, as `resolvedShortcut` has it: none for
 * a command the keymap does not hold, which shows the one it declares. */
export function commandGlyphs(settings: ApplicationSettings, command: string): string | undefined {
  const id = commandShortcutID(command);
  return Object.hasOwn(settings.shortcuts, id) || shippedShortcut(id) !== undefined
    ? shortcutGlyphs(resolvedShortcut(settings, id))
    : undefined;
}
/** The picture keys in effect, as `resolvedShortcut` says: '' for none. */
export function pictureShortcuts(settings: ApplicationSettings): Record<string, string> {
  return Object.fromEntries(
    Object.keys(previewShortcuts).map((id) => [id, resolvedShortcut(settings, id)]),
  );
}
export function resolvedAlternateShortcuts(settings: ApplicationSettings): Record<string, string> {
  const own = ownBindings(settings);
  return Object.fromEntries(
    Object.entries(alternateShortcuts).filter(
      ([id, key]) =>
        settings.shortcuts[id] === undefined && !own.some(([, shortcut]) => sameKey(shortcut, key)),
    ),
  );
}
/** Every binding in effect but a picture's keys: commands' and the menu's, Finder's second keys,
 * recipes, custom actions and the prefix. */
function windowBindings(settings: ApplicationSettings): Binding[] {
  const commands = {
    ...Object.fromEntries(
      Object.keys({ ...defaultShortcuts, ...menuShortcuts }).map((id) => [
        id,
        resolvedShortcut(settings, id),
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(settings.shortcuts).filter(([id]) => !isPreviewShortcut(id)),
    ),
  };
  return [
    ...Object.entries(commands).map(([id, shortcut]): Binding => [id, shortcut, shortcutLabel(id)]),
    ...Object.entries(resolvedAlternateShortcuts(settings)).map(([id, shortcut]): Binding => [
      `${id}:alternate`,
      shortcut,
      shortcutLabel(id),
    ]),
    ...ownBindings(settings).filter(([id]) => !Object.hasOwn(settings.shortcuts, id)),
  ];
}
/** Every binding in effect, a picture's keys too. */
function bindings(settings: ApplicationSettings): Binding[] {
  return [
    ...windowBindings(settings),
    ...Object.entries(pictureShortcuts(settings)).map(([id, shortcut]): Binding => [
      id,
      shortcut,
      shortcutLabel(id),
    ]),
  ];
}
/** The window command a picture key shares its chord with, as ⌘L is Go to Folder…'s elsewhere. */
export function pictureKeyPartner(settings: ApplicationSettings, id: string): string | undefined {
  const chord = pictureShortcuts(settings)[id] ?? '';
  return windowBindings(settings).find(
    ([other, shortcut]) => sameKey(shortcut, chord) && sharedAsShipped(id, chord, other, shortcut),
  )?.[2];
}
/** The picture key a window command shares its chord with, as Rotate Picture Left shares ⌘L. */
export function sharedPictureKey(settings: ApplicationSettings, id: string): string | undefined {
  const chord = resolvedShortcut(settings, id);
  return Object.entries(pictureShortcuts(settings)).find(([picture, shortcut]) =>
    sharedAsShipped(picture, shortcut, id, chord),
  )?.[0];
}
/**
 * A key two bindings in effect hold at once, as the desktop refuses to save: its name, or none.
 * A shipped key never clashes, for it leaves a key the person gave elsewhere, and the pair shipped
 * sharing ⌘L shares it on purpose.
 */
export function shortcutClash(settings: ApplicationSettings): string | undefined {
  const all = bindings(settings).filter(([, shortcut]) => !!shortcut);
  for (const [index, [id, shortcut, label]] of all.entries())
    if (
      all
        .slice(index + 1)
        .some(
          ([other, chord]) =>
            sameKey(chord, shortcut) && !sharedAsShipped(id, shortcut, other, chord),
        )
    )
      return label;
}
/**
 * What already answers a chord, other than `except`: a built-in or menu shortcut, a picture's,
 * a recipe's, a custom action's, or the prefix. Settings says so rather than saving a conflict.
 * Two built-ins that share a chord as shipped, a picture's and a window command's as ⌘L, are no
 * conflict while both keep it: each answers in its own place.
 */
export function shortcutOwner(
  settings: ApplicationSettings,
  value: string,
  except: string,
): string | undefined {
  return bindings(settings).find(
    ([id, shortcut]) =>
      id !== except &&
      !id.endsWith(':alternate') &&
      sameKey(shortcut, value) &&
      !sharedAsShipped(id, shortcut, except, value),
  )?.[2];
}
