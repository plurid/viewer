// @vitest-environment jsdom
/**
 * THE NEW-ITEM KEYS, AS FINDER'S: ⌘N a new files plane, as Finder's ⌘N a new window of files;
 * ⇧⌘N a new folder; ⌃⌘N a new folder with the selection; ⌥⌘N a new window; ⌘T a scratch plane.
 * A key as shipped always comes from the keymap, never from a saved copy, so a key shipped
 * differently reaches everyone who never changed it; a key the person set is theirs, and a shipped
 * key they gave to something else leaves it to them, the command's row saying so.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/services';
import type { ApplicationSettings } from '../src/domain/services';
import {
  commandGlyphs,
  defaultShortcuts,
  menuShortcuts,
  previewShortcuts,
  resolvedShortcut,
  shippedKeyHolder,
  shortcutClash,
  shortcutFor,
  shortcutKey,
  shortcutLabel,
} from '../src/domain/preferences/shortcuts';
import { keyCommand } from '../src/renderer/explorer/input';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';

const press = (key: string, more: { shiftKey?: boolean; altKey?: boolean } = {}) =>
  ({
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: true,
    ctrlKey: false,
    altKey: !!more.altKey,
    shiftKey: !!more.shiftKey,
    target: null,
    preventDefault() {},
    stopPropagation() {},
  }) as never;
const recipe = (shortcut: string) =>
  ({
    id: '6f1d1d5e-3c1f-4a43-9d2f-1d6a7d2f0a11',
    name: 'Rename photos',
    kind: 'batch-rename',
    formats: [],
    recursive: false,
    instructions: '',
    template: '{name}',
    data: 'names',
    shortcut,
  }) as unknown as ApplicationSettings['recipes'][number];

describe('the new-item keys', () => {
  it('ship as Finder’s, with their names', () => {
    expect(defaultShortcuts['new-root-folder']).toBe('Cmd+N');
    expect(defaultShortcuts['new-folder']).toBe('Cmd+Shift+N');
    expect(defaultShortcuts['new-folder-with-selection']).toBe('Ctrl+Cmd+N');
    expect(defaultShortcuts['new-scratch-plane']).toBe('Cmd+T');
    // the native menu's: the renderer leaves it to the menu, so it opens one window
    expect(menuShortcuts['new-native-window']).toBe('Cmd+Alt+N');
    expect(shortcutLabel('new-root-folder')).toBe('New Files Plane');
    expect(shortcutLabel('new-native-window')).toBe('New Window');
  });

  it('give no key to two commands as shipped, but the ⌘L shared on purpose', () => {
    const shipped = Object.entries({ ...defaultShortcuts, ...menuShortcuts, ...previewShortcuts });
    const keys = new Map<string, string[]>();
    for (const [id, shortcut] of shipped)
      keys.set(shortcutKey(shortcut), [...(keys.get(shortcutKey(shortcut)) ?? []), id]);
    const shared = [...keys.values()].filter((ids) => ids.length > 1);
    expect(shared).toEqual([['go-to', 'image-rotate-left']]);
    expect(shortcutClash(defaultSettings('/fixtures'))).toBeUndefined();
  });

  it('reach a profile that never changed them, and answer as such', () => {
    const settings = defaultSettings('/fixtures');
    expect(settings.shortcuts).toEqual({});
    expect(resolvedShortcut(settings, 'new-root-folder')).toBe('Cmd+N');
    expect(keyCommand(press('n'), settings)).toBe('new-root-folder');
    expect(keyCommand(press('N', { shiftKey: true }), settings)).toBe('new-folder');
    // the menu answers ⌥⌘N itself
    expect(keyCommand(press('n', { altKey: true }), settings)).toBeUndefined();
    // ⌘K and menus show each with its key from the keymap
    expect(commandGlyphs(settings, 'new-root-folder')).toBe('⌘N');
    expect(commandGlyphs(settings, 'new-folder')).toBe('⇧⌘N');
    expect(commandGlyphs(settings, 'new-native-window')).toBe('⌥⌘N');
    expect(commandGlyphs(settings, 'not-in-the-keymap')).toBeUndefined();
  });

  it('keep a key the person set, a shipped one they gave away leaving it to them', () => {
    // New Files Plane given ⇧⌘N by the person: New Folder… leaves it, and says so in its row
    const own = {
      ...defaultSettings('/fixtures'),
      shortcuts: { 'new-root-folder': 'Cmd+Shift+N' },
    };
    expect(settingsSchema.safeParse(own).success).toBe(true);
    expect(resolvedShortcut(own, 'new-root-folder')).toBe('Cmd+Shift+N');
    expect(resolvedShortcut(own, 'new-folder')).toBe('');
    expect(shippedKeyHolder(own, 'new-folder')).toBe('New Files Plane');
    expect(keyCommand(press('N', { shiftKey: true }), own)).toBe('new-root-folder');
    expect(keyCommand(press('n'), own)).toBeUndefined();
    expect(commandGlyphs(own, 'new-folder')).toBe('');
    // a tooltip's hint, from the saved keys alone, says the same
    expect(shortcutFor(own.shortcuts, 'new-folder')).toBe('');
    expect(shortcutFor(own.shortcuts, 'new-root-folder')).toBe('Cmd+Shift+N');
    expect(shortcutFor({}, 'new-folder')).toBe('Cmd+Shift+N');
  });

  it('leave ⌘N to New Folder… for a person who gave it that key', () => {
    const own = { ...defaultSettings('/fixtures'), shortcuts: { 'new-folder': 'Cmd+N' } };
    expect(settingsSchema.safeParse(own).success).toBe(true);
    expect(keyCommand(press('n'), own)).toBe('new-folder');
    expect(resolvedShortcut(own, 'new-root-folder')).toBe('');
    expect(shippedKeyHolder(own, 'new-root-folder')).toBe('New Folder…');
  });

  it('leave ⌥⌘N to a recipe the person put there, the file still loading', () => {
    const settings = { ...defaultSettings('/fixtures'), recipes: [recipe('Cmd+Alt+N')] };
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    expect(resolvedShortcut(settings, 'new-native-window')).toBe('');
    expect(shippedKeyHolder(settings, 'new-native-window')).toBe('Rename photos');
    expect(keyCommand(press('n', { altKey: true }), settings)).toBe(
      'recipe.6f1d1d5e-3c1f-4a43-9d2f-1d6a7d2f0a11',
    );
  });

  it('refuse two of the person’s own on one key', () => {
    const settings = {
      ...defaultSettings('/fixtures'),
      shortcuts: { 'new-folder': 'Cmd+J' },
      recipes: [recipe('Cmd+J')],
    };
    expect(shortcutClash(settings)).toBeDefined();
    expect(settingsSchema.safeParse(settings).success).toBe(false);
  });
});
