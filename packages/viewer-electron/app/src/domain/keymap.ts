/**
 * THE KEY LAYER (2026-10-23): a tmux-style prefix and an optional leader key start a sequence through
 * `settings.keymap.bindings`. A key names a command id, a list of command ids (run in order) or a
 * nested map: a chord. This module is pure: the renderer feeds it key names and the time.
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
    ':': 'palette',
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
const modifierOrder = ['Ctrl', 'Alt', 'Cmd'] as const;
/** The unmodified key on a US layout, from the physical key code: Option changes the character. */
const codeKey = (code = '') =>
  /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? /^Digit(\d)$/.exec(code)?.[1];
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
/** Whether a binding's key could ever be pressed: `a`, `%`, `+`, `Space`, `Ctrl+o`, `F5`. */
export function validKeymapKey(value: string): boolean {
  const { base, modifiers } = keyParts(value);
  return (
    !!base &&
    (base.length === 1 || namedKeys.has(base) || /^F([1-9]|1[0-9]|2[0-4])$/.test(base)) &&
    new Set(modifiers).size === modifiers.length &&
    modifiers.every((part) => [...modifierOrder, 'Shift'].includes(part as 'Ctrl'))
  );
}
/** A chord's next keys, for which-key: each key and what it does. */
export function bindingChoices(binding: KeymapBinding): { key: string; binding: KeymapBinding }[] {
  if (typeof binding === 'string' || Array.isArray(binding)) return [];
  return Object.entries(binding as Record<string, KeymapBinding>).map(([key, next]) => ({
    key,
    binding: next,
  }));
}
export type SequenceStep = 'pending' | 'ran' | 'cancelled' | 'unbound';
/** One sequence at a time: started by the prefix or leader, fed keys, ended by a command. */
export class KeySequence {
  private node: KeymapBinding | undefined;
  private deadline = 0;
  private keys: string[] = [];
  constructor(
    private keymap: Keymap,
    private run: (commands: readonly string[]) => void,
  ) {}
  /** The keymap in force; a sequence in progress keeps the one it started with. */
  configure(keymap: Keymap): void {
    if (!this.node) this.keymap = keymap;
  }
  start(now: number): void {
    this.node = this.keymap.bindings;
    this.keys = [];
    this.deadline = now + this.keymap.timeout;
  }
  active(): boolean {
    return !!this.node;
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
    return !!this.node && now > this.deadline;
  }
  cancel(): void {
    this.node = undefined;
  }
  feed(key: string, now: number): SequenceStep {
    const node = this.node;
    if (!node || this.expired(now) || key === 'Escape') {
      this.cancel();
      return 'cancelled';
    }
    const next = (node as Record<string, KeymapBinding>)[key];
    if (next === undefined) {
      this.cancel();
      return 'unbound';
    }
    if (typeof next === 'string' || Array.isArray(next)) {
      this.cancel();
      this.run(typeof next === 'string' ? [next] : (next as readonly string[]));
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
  const modifiers = parts.modifiers.map((part) => glyphs[part] ?? part);
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
