/**
 * KEYS THAT SPEAK LINES (2026-10-23): keys written as Viewer, tmux or vim write them; keys without
 * the prefix; repeat keys; modes that stay until Escape, with counts; and session bindings.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalBindings,
  canonicalKey,
  defaultKeymap,
  KeySequence,
  rootKey,
  type Keymap,
} from '../src/domain/preferences/keymap';
import { sessionAliases, withSessionKeys } from '../src/domain/preferences/session-keys';
import { referenceIssues } from '../src/domain/automation/references';
import { defaultSettings } from '../src/domain/services';

describe('a key, written any familiar way', () => {
  it('is named as the key layer names it', () => {
    const same: [string, string][] = [
      ['Ctrl+b', 'Ctrl+b'],
      // ⌃B in Settings is ⌃b, as the prefix field shows it; ⌃⇧B is written so
      ['Ctrl+B', 'Ctrl+b'],
      ['Ctrl+Shift+b', 'Ctrl+B'],
      ['C-b', 'Ctrl+b'],
      ['<C-b>', 'Ctrl+b'],
      ['M-h', 'Alt+h'],
      ['<A-H>', 'Alt+h'],
      ['<D-k>', 'Cmd+k'],
      ['Cmd+Ctrl+x', 'Ctrl+Cmd+x'],
      ['<Space>', 'Space'],
      ['<CR>', 'Enter'],
      ['<S-Tab>', 'Shift+Tab'],
      ['S-a', 'A'],
      ['C', 'C'],
      ['%', '%'],
      ['+', '+'],
      ['Ctrl++', 'Ctrl++'],
      ['C--', 'Ctrl+-'],
      ['f5', 'F5'],
      ['<lt>', '<'],
    ];
    for (const [written, named] of same) expect(canonicalKey(written), written).toBe(named);
    for (const written of ['', 'ab', 'Hyper+a', 'Ctrl+', 'C-C-a', '<>', 'F25'])
      expect(canonicalKey(written), written).toBeUndefined();
  });
  it('needs ⌃, ⌥ or ⌘ to work without the prefix, or is an F-key', () => {
    expect(['M-h', 'C-x', 'F6', '<D-j>'].every(rootKey)).toBe(true);
    expect(['h', 'S-a', 'Space', '%'].some(rootKey)).toBe(false);
  });
  it('makes two spellings of one key one binding, the later winning', () => {
    expect(canonicalBindings({ 'Ctrl+B': 'a', 'C-b': 'b', x: { 'M-h': 'c' } })).toEqual({
      bindings: { 'Ctrl+b': 'b', x: { 'Alt+h': 'c' } },
      collisions: ['Ctrl+b'],
    });
  });
});

const keymap: Keymap = {
  ...defaultKeymap,
  timeout: 1000,
  repeatTime: 500,
  bindings: { '+': 'grow', x: 'close', R: 'mode resize', '1': 'view-one' },
  repeat: ['+'],
  modes: { resize: { bindings: { l: 'grow', h: 'shrink', g: { g: 'first' } } } },
};
describe('a mode', () => {
  it('stays until Escape, a digit it does not bind counting', () => {
    const run = vi.fn();
    const sequence = new KeySequence(keymap, run);
    expect(sequence.enterMode('nothing')).toBe(false);
    expect(sequence.enterMode('resize')).toBe(true);
    expect(sequence.feed('l', 0)).toBe('ran');
    // no timeout: a mode is not a sequence
    expect(sequence.feed('3', 10_000)).toBe('counting');
    expect(sequence.feed('2', 10_001)).toBe('counting');
    expect(sequence.counted()).toBe(32);
    expect(sequence.feed('h', 10_002)).toBe('ran');
    expect(run.mock.calls).toEqual([
      [['grow'], 1],
      [['shrink'], 32],
    ]);
    expect(sequence.feed('g', 0)).toBe('pending');
    expect(sequence.feed('g', 0)).toBe('ran');
    expect(sequence.feed('q', 0)).toBe('unbound');
    expect(sequence.mode()).toBe('resize');
    expect(sequence.feed('Escape', 0)).toBe('cancelled');
    expect(sequence.active()).toBe(false);
  });
});
describe('a repeat key', () => {
  it('may be pressed again without the prefix for a moment; another key is the window’s', () => {
    const run = vi.fn();
    const sequence = new KeySequence(keymap, run);
    sequence.start(0);
    expect(sequence.feed('+', 100)).toBe('ran');
    expect(sequence.repeating()).toBe(true);
    expect(sequence.feed('+', 400)).toBe('ran');
    expect(sequence.feed('+', 800)).toBe('ran');
    expect(sequence.feed('x', 900)).toBe('passed');
    expect(sequence.active()).toBe(false);
    expect(run).toHaveBeenCalledTimes(3);
    sequence.start(1000);
    sequence.feed('+', 1000);
    expect(sequence.feed('+', 1600)).toBe('passed');
  });
  it('does not make the prefix’s digits counts: they are bound', () => {
    const run = vi.fn();
    const sequence = new KeySequence(keymap, run);
    sequence.start(0);
    expect(sequence.feed('1', 0)).toBe('ran');
    expect(run).toHaveBeenCalledWith(['view-one'], 1);
  });
});
describe('session keys', () => {
  it('lay :bind and :unbind over the keymap, in order', () => {
    const next = withSessionKeys(keymap, {
      bindings: [
        { table: 'prefix', keys: ['%'], line: 'vs | e ~', repeat: true },
        { table: 'prefix', keys: ['x'], line: null },
        { table: 'root', keys: ['Alt+h'], line: 'select-pane -L' },
        { table: 'panes', keys: ['b', 's'], line: 'tile-swap-next' },
        { table: 'prefix', keys: ['+'], line: 'grow', repeat: false },
      ],
      aliases: [],
    });
    expect(next.bindings).toMatchObject({ '%': 'vs | e ~', R: 'mode resize' });
    expect(next.bindings).not.toHaveProperty('x');
    expect(next.root).toEqual({ 'Alt+h': 'select-pane -L' });
    expect(next.modes.panes).toEqual({ bindings: { b: { s: 'tile-swap-next' } } });
    expect(next.repeat).toEqual(['%']);
    // the keymap given is not changed
    expect(keymap.bindings).toHaveProperty('x');
  });
  it('name lines, the later over the earlier', () => {
    expect(
      Object.fromEntries(
        sessionAliases({
          bindings: [],
          aliases: [
            { name: 'Dev', line: 'e ~/Developer' },
            { name: 'Old', line: 'q' },
            { name: 'Dev', line: 'cd ~/Developer | vs' },
            { name: 'Old', line: null },
          ],
        }),
      ),
    ).toEqual({ Dev: 'cd ~/Developer | vs' });
  });
});

describe('the keymap’s warnings', () => {
  it('say when two spellings are one key, and when a line enters no mode', () => {
    const settings = defaultSettings('/fixtures');
    settings.keymap = {
      ...settings.keymap,
      bindings: { 'Ctrl+B': 'palette', 'C-b': 'frame-all', y: 'mode yank' },
    };
    expect(referenceIssues(settings)).toEqual([
      'Two prefix bindings are the key Ctrl+b: the later one is used.',
      'y (prefix) enters the mode “yank”, which does not exist.',
    ]);
    expect(referenceIssues(defaultSettings('/fixtures'))).toEqual([]);
  });
});
