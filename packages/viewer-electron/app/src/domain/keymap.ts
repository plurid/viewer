/**
 * THE KEY LAYER (2026-10-23): a tmux-style prefix and an optional leader key start a sequence through
 * `settings.keymap.bindings`. A key names a line (`vs`, `set grid!`, a command id), a list of lines
 * (run in order) or a nested map: a chord. `root` keys need no prefix; `repeat` keys may be pressed
 * again without it for a moment; `modes` are tables that stay until Escape, where digits count. This
 * module is pure: the renderer feeds it key names and the time.
 */
export type KeymapBinding = string | readonly string[] | { readonly [key: string]: KeymapBinding };
export interface Keymap {
  /** A chord with ⌃ or ⌘ (`Ctrl+B`, tmux's); empty turns it off. */
  prefix: string;
  /** A key that starts a sequence outside text fields and terminals (`Space`); empty is none. */
  leader: string;
  /** Whether the prefix works inside a terminal plane; otherwise the shell receives it. */
  inTerminals: boolean;
  /** Whether the prefix works inside text fields and editors, where ⌃B moves the caret. */
  inTextFields: boolean;
  /** Whether the next keys are shown while a sequence waits. */
  whichKey: boolean;
  /** How long a sequence waits for its next key, in milliseconds. */
  timeout: number;
  bindings: Record<string, KeymapBinding>;
  /** Keys without the prefix, as tmux's `bind -n`: chords with ⌃, ⌥ or ⌘, or F-keys. */
  root: Record<string, KeymapBinding>;
  /** Prefix keys that repeat, as tmux's `bind -r`: pressed again within `repeatTime`, no prefix. */
  repeat: string[];
  repeatTime: number;
  /** Named tables that stay until Escape (`mode resize`), as tmux's key tables and vim's modes. */
  modes: Record<string, { bindings: Record<string, KeymapBinding> }>;
}
export const defaultKeymap: Keymap = {
  prefix: 'Ctrl+B',
  leader: '',
  inTerminals: false,
  inTextFields: false,
  whichKey: true,
  timeout: 1500,
  bindings: {
    // tmux's own keys where Viewer has the same idea: windows are workspaces, panes are planes
    c: 'new-terminal-plane',
    x: 'close-plane',
    z: 'dock',
    o: 'focus-next-plane',
    h: 'focus-left',
    j: 'focus-down',
    k: 'focus-up',
    l: 'focus-right',
    Left: 'focus-left',
    Down: 'focus-down',
    Up: 'focus-up',
    Right: 'focus-right',
    f: 'plane-hints',
    n: 'next-workspace',
    p: 'previous-workspace',
    w: 'change-workspace',
    ',': 'rename-workspace',
    // tmux's command prompt: the command line (2026-10-23)
    ':': 'command-line',
    '?': 'keymap-help',
    q: 'record-macro',
    t: 'new-scratch-plane',
    s: 'toggle-sidebar',
    // the space's views: a digit flies to one; b then s, m or t saves, manages or tours them
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => [String(slot), `bookmark.${slot}`]),
    ),
    b: { s: 'bookmark-save', m: 'bookmark-manage', t: 'tour' },
    // tiling, with tmux's keys: % and " split, Space the next layout, { } swap, ! untile
    '%': 'tile-split-right',
    '"': 'tile-split-down',
    Space: 'tile-next-layout',
    '=': 'tile-visible',
    '{': 'tile-swap-previous',
    '}': 'tile-swap-next',
    M: 'tile-promote',
    '+': 'tile-main-grow',
    '-': 'tile-main-shrink',
    '!': 'untile',
    // a folder's subfolders as planes, and back
    e: 'explode-folder',
    E: 'collapse-folder',
    // a mode for the tiles: h and l size the main tile, j and k swap, until Escape
    R: 'mode resize',
  },
  root: {},
  repeat: ['+', '-'],
  repeatTime: 500,
  modes: {
    resize: {
      bindings: {
        h: 'tile-main-shrink',
        l: 'tile-main-grow',
        j: 'tile-swap-next',
        k: 'tile-swap-previous',
        Left: 'tile-main-shrink',
        Right: 'tile-main-grow',
        Space: 'tile-next-layout',
        '=': 'tile-visible',
      },
    },
  },
};

const named: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
};
const namedKeys = new Set([
  'Space',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Left',
  'Right',
  'Up',
  'Down',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
/** The unmodified key on a US layout, from the physical key code: Option changes the character. */
const codeKey = (code = '') =>
  /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? /^Digit(\d)$/.exec(code)?.[1];
/**
 * A keymap with the defaults that moved since it was saved (2026-10-23): prefix `:` opened the
 * palette, and opens the command line now, as tmux's prefix `:` opens its command prompt.
 */
export function upgradeKeymap(keymap: Keymap): Keymap {
  return keymap.bindings[':'] === 'palette'
    ? { ...keymap, bindings: { ...keymap.bindings, ':': 'command-line' } }
    : keymap;
}
/**
 * A key as bindings name it: modifiers (Ctrl, Alt, Cmd) then the key. Shift is in the character
 * (`%`, `C`) except with named keys (`Shift+Tab`). Undefined for a modifier alone.
 */
export function keyName(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
): string | undefined {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'AltGraph'].includes(event.key))
    return undefined;
  let base = named[event.key] ?? event.key;
  if (event.altKey && base.length === 1) base = codeKey(event.code) ?? base;
  const modifiers = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.metaKey && 'Cmd',
    event.shiftKey && base.length > 1 && 'Shift',
  ].filter(Boolean);
  // a letter with ⌃ or ⌘ is the letter, whatever Shift did to it
  if ((event.ctrlKey || event.metaKey) && base.length === 1 && !event.shiftKey)
    base = base.toLowerCase();
  return [...modifiers, base].join('+');
}
/** A key's modifiers and the key itself: `+` is a key too (`+`, `Ctrl++`), so not a plain split. */
function keyParts(value: string): { base: string; modifiers: string[] } {
  const base = value === '+' || value.endsWith('++') ? '+' : (value.split('+').at(-1) ?? '');
  const rest = value.slice(0, value.length - base.length);
  return { base, modifiers: rest ? rest.replace(/\+$/, '').split('+') : [] };
}
const namedAliases: Readonly<Record<string, string>> = {
  space: 'Space',
  spc: 'Space',
  enter: 'Enter',
  return: 'Enter',
  cr: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  bs: 'Backspace',
  bspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  dc: 'Delete',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  ppage: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  npage: 'PageDown',
  lt: '<',
  bar: '|',
};
const modifierNames: Readonly<Record<string, 'Ctrl' | 'Alt' | 'Cmd' | 'Shift'>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  c: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  meta: 'Alt',
  m: 'Alt',
  a: 'Alt',
  cmd: 'Cmd',
  command: 'Cmd',
  d: 'Cmd',
  shift: 'Shift',
  s: 'Shift',
};
/**
 * A key written any familiar way, as the key layer names it (2026-10-23): Viewer's `Ctrl+b`, tmux's
 * `C-b` and `M-h`, vim's `<C-b>`, `<M-h>`, `<D-k>`, `<Space>`, `<CR>`. A letter with ⌃ or ⌘ is
 * the letter whatever its case, unless Shift is written; with ⌥ it is the letter (⌥ changes the
 * character, so the key is read). Undefined when it is no key.
 */
export function canonicalKey(written: string): string | undefined {
  let text = written.trim();
  if (!text) return undefined;
  const vim = /^<(.+)>$/.exec(text);
  if (vim && text.length > 2) text = vim[1]!;
  const modifiers = new Set<'Ctrl' | 'Alt' | 'Cmd' | 'Shift'>();
  let base: string;
  if (text === '+' || text === '-' || text.length === 1) base = text;
  else {
    const separator = /^[A-Za-z]+-./.test(text) && !text.includes('+') ? '-' : '+';
    const parts = text.endsWith(separator + separator)
      ? [...text.slice(0, -2).split(separator), separator]
      : text.split(separator);
    base = parts.pop()!;
    if (!base) return undefined;
    for (const part of parts) {
      const modifier = modifierNames[part.toLowerCase()];
      if (!modifier || modifiers.has(modifier)) return undefined;
      modifiers.add(modifier);
    }
  }
  if (base.length > 1) {
    const named = namedAliases[base.toLowerCase()] ?? (namedKeys.has(base) ? base : undefined);
    const fkey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(base);
    if (named) base = named;
    else if (fkey) base = `F${fkey[1]}`;
    else return undefined;
  }
  const letter = /^[a-z]$/i.test(base);
  if (letter && modifiers.has('Alt')) {
    base = base.toLowerCase();
    modifiers.delete('Shift');
  } else if (letter && (modifiers.has('Ctrl') || modifiers.has('Cmd'))) {
    base = modifiers.has('Shift') ? base.toUpperCase() : base.toLowerCase();
    modifiers.delete('Shift');
  } else if (base.length === 1 && modifiers.has('Shift')) {
    // Shift is in the character: S-a is A
    base = base.toUpperCase();
    modifiers.delete('Shift');
  }
  return [
    ...(['Ctrl', 'Alt', 'Cmd'] as const).filter((modifier) => modifiers.has(modifier)),
    ...(modifiers.has('Shift') ? ['Shift'] : []),
    base,
  ].join('+');
}
/** Whether a binding's key could ever be pressed: `a`, `%`, `+`, `Space`, `Ctrl+o`, `C-o`, `F5`. */
export function validKeymapKey(value: string): boolean {
  return canonicalKey(value) !== undefined;
}
/** Whether a key needs no prefix to be safe: a chord with ⌃, ⌥ or ⌘, or an F-key. */
export function rootKey(value: string): boolean {
  const key = canonicalKey(value);
  return !!key && (/^(Ctrl|Alt|Cmd)\+/.test(key) || /^F\d+$/.test(key));
}
/**
 * Bindings with their keys as the key layer names them, and the keys two spellings made one
 * (`Ctrl+B` and `C-b`): the later wins, as a later line of .tmux.conf does.
 */
export function canonicalBindings(
  bindings: Record<string, KeymapBinding>,
  path: string[] = [],
  collisions: string[] = [],
): { bindings: Record<string, KeymapBinding>; collisions: string[] } {
  const next: Record<string, KeymapBinding> = {};
  for (const [written, binding] of Object.entries(bindings)) {
    const key = canonicalKey(written) ?? written;
    if (key in next) collisions.push([...path, key].join(' '));
    next[key] =
      typeof binding === 'string' || Array.isArray(binding)
        ? binding
        : canonicalBindings(binding as Record<string, KeymapBinding>, [...path, key], collisions)
            .bindings;
  }
  return { bindings: next, collisions };
}
/** A keymap whose keys, in every table, are as the key layer names them. */
export function canonicalKeymap(keymap: Keymap): Keymap {
  return {
    ...keymap,
    bindings: canonicalBindings(keymap.bindings).bindings,
    root: canonicalBindings(keymap.root ?? {}).bindings,
    repeat: (keymap.repeat ?? []).map((key) => canonicalKey(key) ?? key),
    modes: Object.fromEntries(
      Object.entries(keymap.modes ?? {}).map(([name, mode]) => [
        name,
        { bindings: canonicalBindings(mode.bindings).bindings },
      ]),
    ),
  };
}
/** A chord's next keys, for which-key: each key and what it does. */
export function bindingChoices(binding: KeymapBinding): { key: string; binding: KeymapBinding }[] {
  if (typeof binding === 'string' || Array.isArray(binding)) return [];
  return Object.entries(binding as Record<string, KeymapBinding>).map(([key, next]) => ({
    key,
    binding: next,
  }));
}
export type SequenceStep = 'pending' | 'ran' | 'cancelled' | 'unbound' | 'counting' | 'passed';
const lines = (binding: string | readonly string[]) =>
  typeof binding === 'string' ? [binding] : binding;
/**
 * One sequence at a time: started by the prefix or leader, fed keys, ended by a line; or a mode,
 * which stays until Escape; or the moment after a repeat key, when another needs no prefix. A
 * count typed in a mode (digits it does not bind) runs the next line that many times.
 */
export class KeySequence {
  private node: KeymapBinding | undefined;
  private deadline = 0;
  private keys: string[] = [];
  private table: 'prefix' | 'repeat' | 'mode' | undefined;
  private modeName: string | undefined;
  private count = 0;
  constructor(
    private keymap: Keymap,
    private run: (lines: readonly string[], count: number) => void,
  ) {}
  /** The keymap in force; a sequence or mode in progress keeps the one it started with. */
  configure(keymap: Keymap): void {
    if (!this.node) this.keymap = keymap;
  }
  start(now: number): void {
    this.node = this.keymap.bindings;
    this.keys = [];
    this.table = 'prefix';
    this.modeName = undefined;
    this.count = 0;
    this.deadline = now + this.keymap.timeout;
  }
  /** Into a mode, until Escape; false when the keymap has none of that name. */
  enterMode(name: string): boolean {
    const mode = this.keymap.modes?.[name];
    if (!mode) return false;
    this.node = mode.bindings;
    this.keys = [];
    this.table = 'mode';
    this.modeName = name;
    this.count = 0;
    return true;
  }
  active(): boolean {
    return !!this.node;
  }
  /** The mode on, or undefined. */
  mode(): string | undefined {
    return this.table === 'mode' ? this.modeName : undefined;
  }
  /** Within a repeat key's moment: another repeat key needs no prefix. */
  repeating(): boolean {
    return this.table === 'repeat';
  }
  /** The count typed so far in a mode, or undefined. */
  counted(): number | undefined {
    return this.count || undefined;
  }
  /** The chord being completed, or undefined. */
  current(): KeymapBinding | undefined {
    return this.node;
  }
  /** The keys pressed after the prefix so far. */
  pressed(): readonly string[] {
    return this.keys;
  }
  expired(now: number): boolean {
    return !!this.node && this.table !== 'mode' && now > this.deadline;
  }
  cancel(): void {
    this.node = undefined;
    this.table = undefined;
    this.modeName = undefined;
    this.keys = [];
    this.count = 0;
  }
  feed(key: string, now: number): SequenceStep {
    const node = this.node;
    if (!node) return 'cancelled';
    if (this.table === 'repeat') {
      // a key that does not repeat, or one too late, is the window's again
      if (now > this.deadline || !this.keymap.repeat.includes(key)) {
        this.cancel();
        return 'passed';
      }
      const binding = this.keymap.bindings[key];
      if (typeof binding !== 'string' && !Array.isArray(binding)) {
        this.cancel();
        return 'passed';
      }
      this.deadline = now + this.keymap.repeatTime;
      this.run(lines(binding as string | readonly string[]), 1);
      return 'ran';
    }
    if (key === 'Escape' || this.expired(now)) {
      this.cancel();
      return 'cancelled';
    }
    const next = (node as Record<string, KeymapBinding>)[key];
    const atRoot = !this.keys.length;
    if (next === undefined) {
      if (this.table === 'mode' && atRoot && /^[0-9]$/.test(key) && (this.count || key !== '0')) {
        this.count = Math.min(99, this.count * 10 + Number(key));
        return 'counting';
      }
      if (this.table === 'mode') {
        this.node = this.keymap.modes[this.modeName!]?.bindings;
        this.keys = [];
        this.count = 0;
        return 'unbound';
      }
      this.cancel();
      return 'unbound';
    }
    if (typeof next === 'string' || Array.isArray(next)) {
      const count = this.count || 1;
      if (this.table === 'mode') {
        this.node = this.keymap.modes[this.modeName!]?.bindings;
        this.keys = [];
        this.count = 0;
      } else if (this.table === 'prefix' && atRoot && this.keymap.repeat?.includes(key)) {
        this.table = 'repeat';
        this.node = this.keymap.bindings;
        this.deadline = now + this.keymap.repeatTime;
      } else this.cancel();
      this.run(lines(next as string | readonly string[]), count);
      return 'ran';
    }
    this.node = next;
    this.keys = [...this.keys, key];
    this.deadline = now + this.keymap.timeout;
    return 'pending';
  }
}
const glyphs: Readonly<Record<string, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Cmd: '⌘',
  Shift: '⇧',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Enter: '↩',
  Escape: '⎋',
  Tab: '⇥',
  Backspace: '⌫',
  Space: '␣',
};
/** A key as a Mac shows it: `Ctrl+B` → `⌃B`, `Left` → `←`, `%` → `%`. */
export function keyGlyphs(name: string): string {
  const parts = keyParts(name);
  const base = parts.base;
  // the Mac's order, whatever order they were written in: ⌃⌥⇧⌘
  const order = ['Ctrl', 'Alt', 'Shift', 'Cmd'];
  const modifiers = [...parts.modifiers]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((part) => glyphs[part] ?? part);
  // a letter after a modifier reads as Finder's menus show it: ⌃B
  const key = glyphs[base] ?? (modifiers.length && base.length === 1 ? base.toUpperCase() : base);
  return modifiers.join('') + key;
}
/** A binding as one row, for Settings: the keys in turn and the commands they run. */
export interface BindingRow {
  keys: string[];
  commands: string[];
}
export function bindingRows(bindings: Keymap['bindings'], keys: string[] = []): BindingRow[] {
  return Object.entries(bindings).flatMap(([key, binding]) =>
    typeof binding === 'string'
      ? [{ keys: [...keys, key], commands: [binding] }]
      : Array.isArray(binding)
        ? [{ keys: [...keys, key], commands: [...(binding as readonly string[])] }]
        : bindingRows(binding as Keymap['bindings'], [...keys, key]),
  );
}
/** Rows back into bindings: a later row wins where two would bind the same keys. */
export function bindingsFrom(rows: readonly BindingRow[]): Keymap['bindings'] {
  const bindings: Record<string, KeymapBinding> = {};
  for (const { keys, commands } of rows) {
    if (!keys.length || !commands.length) continue;
    let node = bindings;
    for (const key of keys.slice(0, -1)) {
      const next = node[key];
      if (!next || typeof next === 'string' || Array.isArray(next)) node[key] = {};
      node = node[key] as Record<string, KeymapBinding>;
    }
    node[keys.at(-1)!] = commands.length === 1 ? commands[0]! : commands;
  }
  return bindings;
}
