/**
 * THE KEY LAYER (2026-10-23): a tmux-style prefix (⌃B by default) and an optional leader key start a
 * sequence through `settings.keymap.bindings`: a key names a command, a list of commands, or a
 * nested map for a chord. The sequence ends on a command, Escape, an unbound key or the timeout.
 */
import { describe, expect, it } from 'vitest';
import {
  KeySequence,
  bindingChoices,
  bindingRows,
  bindingsFrom,
  keyGlyphs,
  defaultKeymap,
  keyName,
  validKeymapKey,
  type Keymap,
} from '../src/domain/keymap';
import { keymapSchema } from '../src/desktop/keymap-schema';

const key = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  }) as KeyboardEvent;

describe('key names', () => {
  it('name printable keys by their character, others by name, modifiers first', () => {
    expect(keyName(key('b', { ctrlKey: true }))).toBe('Ctrl+b');
    expect(keyName(key('%', { shiftKey: true }))).toBe('%');
    expect(keyName(key('C', { shiftKey: true }))).toBe('C');
    expect(keyName(key(' '))).toBe('Space');
    expect(keyName(key('ArrowLeft'))).toBe('Left');
    // Option changes the character on a Mac: the key's place names it
    expect(keyName(key('ç', { altKey: true, code: 'KeyC' }))).toBe('Alt+c');
    expect(keyName(key('Shift', { shiftKey: true }))).toBeUndefined();
  });
  it('accept only names a key can have', () => {
    for (const name of ['a', '%', '+', 'Ctrl++', 'Space', 'Left', 'Ctrl+o', 'Alt+Shift+Tab', 'F5'])
      expect(validKeymapKey(name), name).toBe(true);
    for (const name of ['', 'ab', 'Hyper+a', 'Ctrl+', 'Ctrl+Ctrl+a'])
      expect(validKeymapKey(name), name).toBe(false);
  });
});

const keymap: Keymap = {
  ...defaultKeymap,
  timeout: 1000,
  bindings: {
    c: 'new-terminal-plane',
    q: ['select-all', 'copy'],
    b: { s: 'bookmark-save', g: { o: 'bookmark-go' } },
  },
};
describe('a sequence', () => {
  const start = (now = 0) => {
    const ran: string[][] = [];
    const sequence = new KeySequence(keymap, (commands) => ran.push([...commands]));
    sequence.start(now);
    return { sequence, ran };
  };
  it('runs the command its keys name, or each of a list', () => {
    const { sequence, ran } = start();
    expect(sequence.feed('c', 10)).toBe('ran');
    expect(ran).toEqual([['new-terminal-plane']]);
    sequence.start(20);
    expect(sequence.feed('q', 30)).toBe('ran');
    expect(ran.at(-1)).toEqual(['select-all', 'copy']);
  });
  it('follows a chord, offering its next keys', () => {
    const { sequence, ran } = start();
    expect(sequence.feed('b', 10)).toBe('pending');
    expect(bindingChoices(sequence.current()!).map((choice) => choice.key)).toEqual(['s', 'g']);
    expect(sequence.feed('g', 20)).toBe('pending');
    expect(sequence.feed('o', 30)).toBe('ran');
    expect(ran).toEqual([['bookmark-go']]);
    expect(sequence.active()).toBe(false);
  });
  it('ends on Escape, an unbound key or the timeout', () => {
    const { sequence } = start();
    expect(sequence.feed('Escape', 10)).toBe('cancelled');
    sequence.start(20);
    expect(sequence.feed('y', 30)).toBe('unbound');
    sequence.start(40);
    expect(sequence.feed('b', 50)).toBe('pending');
    expect(sequence.expired(1100)).toBe(true);
    expect(sequence.feed('s', 1100)).toBe('cancelled');
  });
});

describe('the keymap in config.jsonc', () => {
  it('accepts the defaults', () => {
    expect(keymapSchema.parse(defaultKeymap)).toEqual(defaultKeymap);
  });
  it('refuses keys no key has, unknown shapes and chords deeper than four', () => {
    const parse = (bindings: unknown) =>
      keymapSchema.safeParse({ ...defaultKeymap, bindings }).success;
    expect(parse({ a: 'palette' })).toBe(true);
    expect(parse({ ab: 'palette' })).toBe(false);
    // a binding is a line (2026-10-23): words are fine, a broken line is not
    expect(parse({ a: 'vs ~/Documents | set grid!' })).toBe(true);
    expect(parse({ a: "e 'open" })).toBe(false);
    expect(parse({ a: Array(21).fill('palette') })).toBe(false);
    expect(parse({ a: { b: { c: { d: 'palette' } } } })).toBe(true);
    expect(parse({ a: { b: { c: { d: { e: 'palette' } } } } })).toBe(false);
    expect(keymapSchema.safeParse({ ...defaultKeymap, prefix: 'b' }).success).toBe(false);
  });
});

describe('bindings as rows, for Settings', () => {
  it('flattens chords to keys in turn and builds them back', () => {
    const rows = bindingRows(keymap.bindings);
    expect(rows).toContainEqual({ keys: ['b', 'g', 'o'], commands: ['bookmark-go'] });
    expect(rows).toContainEqual({ keys: ['q'], commands: ['select-all', 'copy'] });
    expect(bindingsFrom(rows)).toEqual(keymap.bindings);
  });
});

describe('a key as a Mac shows it', () => {
  it('reads modifiers as symbols, and + as a key', () => {
    expect(keyGlyphs('Ctrl+B')).toBe('⌃B');
    expect(keyGlyphs('+')).toBe('+');
    expect(keyGlyphs('Ctrl++')).toBe('⌃+');
    expect(keyGlyphs('Left')).toBe('←');
  });
});

describe('a keymap in part', () => {
  it('is completed from the defaults, as one line of .tmux.conf sets one thing', () => {
    const parsed = keymapSchema.parse({ prefix: 'Ctrl+A' });
    expect(parsed).toEqual({ ...defaultKeymap, prefix: 'Ctrl+A' });
    expect(keymapSchema.parse(undefined)).toEqual(defaultKeymap);
  });
});
