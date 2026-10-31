import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { SettingsService } from '../src/desktop/preferences/settings';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import type { FolderPane } from '../src/domain/contracts';
import { documentConfiguration } from '../src/desktop/preferences/configuration-comments';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
const services: SettingsService[] = [];
const create = (emit = vi.fn()) => {
  const service = new SettingsService(root, root, () => true, emit);
  services.push(service);
  return service;
};
const file = () => path.join(root, 'config.jsonc');
const read = async () => parse(await fs.readFile(file(), 'utf8'));
beforeEach(async () => {
  root = await temporaryRoot('viewer-config-');
});
afterEach(async () => {
  services.splice(0).forEach((service) => service.close());
  await trashTemporary(root);
});

describe('authoritative JSONC configuration', () => {
  it('reads a configuration without fileOpening as the default opening policy', async () => {
    const service = create();
    await service.load();
    const config = await read();
    delete config.settings.fileOpening;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    const opening = service.snapshot().settings.fileOpening;
    expect(opening).toEqual(defaultSettings(root).fileOpening);
    expect(opening.types.docx).toBe('plane');
  });
  it('defaults existing configurations to Trash confirmation and persists the explicit preference', async () => {
    const service = create();
    await service.load();
    const config = await read();
    delete config.settings.browsing.confirmTrash;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().settings.browsing.confirmTrash).toBe(true);
    await service.patch(
      [{ path: 'settings.browsing.confirmTrash', value: false }],
      service.snapshot().revision,
    );
    expect((await read()).settings.browsing.confirmTrash).toBe(false);
    expect(await fs.readFile(file(), 'utf8')).toContain(
      'false sends selected items straight to Trash',
    );
    const reloaded = create();
    await reloaded.load();
    expect(reloaded.snapshot().settings.browsing.confirmTrash).toBe(false);
  });
  it('names new text files .md unless configured otherwise (2026-10-23)', async () => {
    const service = create();
    await service.load();
    const config = await read();
    delete config.settings.browsing.newFileExtension;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().settings.browsing.newFileExtension).toBe('md');
    await service.patch(
      [{ path: 'settings.browsing.newFileExtension', value: 'txt' }],
      service.snapshot().revision,
    );
    expect((await read()).settings.browsing.newFileExtension).toBe('txt');
    for (const value of ['.md', 'a/b', '', 'x'.repeat(17)])
      await expect(
        service.patch(
          [{ path: 'settings.browsing.newFileExtension', value }],
          service.snapshot().revision,
        ),
        value,
      ).rejects.toThrow();
  });
  it("configures the text editor, by default as the owner's VS Code (2026-10-23)", async () => {
    const service = create();
    await service.load();
    const config = await read();
    delete config.settings.editor;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().settings.editor).toEqual({
      fontSize: 18,
      lineHeight: 40,
      fontFamily: 'Menlo',
      tabSize: 4,
      insertSpaces: true,
      wordWrap: false,
      lineNumbers: true,
      trimTrailingWhitespace: true,
    });
    await service.patch(
      [{ path: 'settings.editor.fontSize', value: 14 }],
      service.snapshot().revision,
    );
    expect((await read()).settings.editor.fontSize).toBe(14);
    for (const [path, value] of [
      ['settings.editor.fontSize', 2],
      ['settings.editor.lineHeight', 500],
      ['settings.editor.tabSize', 0],
      ['settings.editor.fontFamily', 'Menlo; color: red'],
    ] as const)
      await expect(
        service.patch([{ path, value }], service.snapshot().revision),
        path,
      ).rejects.toThrow();
  });
  it("sets the terminal font, by default as the owner's iTerm profile (2026-10-23)", async () => {
    const service = create();
    await service.load();
    const config = await read();
    delete config.settings.terminalFont;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().settings.terminalFont).toEqual({
      fontFamily: 'Hack Nerd Font Mono',
      fontSize: 17,
      fontWeight: 'bold',
      lineHeight: 1.3,
      letterSpacing: 1,
    });
    await service.patch(
      [{ path: 'settings.terminalFont.lineHeight', value: 1.1 }],
      service.snapshot().revision,
    );
    expect((await read()).settings.terminalFont.lineHeight).toBe(1.1);
    for (const [path, value] of [
      ['settings.terminalFont.fontSize', 3],
      ['settings.terminalFont.lineHeight', 4],
      ['settings.terminalFont.fontWeight', 'heavy'],
      ['settings.terminalFont.fontFamily', 'Hack"; x'],
    ] as const)
      await expect(
        service.patch([{ path, value }], service.snapshot().revision),
        path,
      ).rejects.toThrow();
  });
  it('keeps a symbolically linked config.jsonc as a link when saving', async () => {
    const dotfiles = path.join(root, 'dotfiles');
    await fs.mkdir(dotfiles);
    const first = create();
    await first.load();
    first.close();
    const target = path.join(dotfiles, 'viewer.jsonc');
    await fs.rename(file(), target);
    await fs.chmod(target, 0o644);
    await fs.symlink(target, file());
    const service = create();
    await service.load();
    await service.patch(
      [{ path: 'settings.browsing.confirmTrash', value: false }],
      service.snapshot().revision,
    );
    expect((await fs.lstat(file())).isSymbolicLink()).toBe(true);
    expect((await fs.stat(target)).mode & 0o777).toBe(0o644);
    expect(parse(await fs.readFile(target, 'utf8')).settings.browsing.confirmTrash).toBe(false);
  });
  it('adds guidance for newly introduced fields in an already-commented configuration', () => {
    const original = documentConfiguration(
      '{"settings":{"browsing":{"newPlaneLocation":"current","newPlanePath":""}}}',
    );
    const updated = applyEdits(
      original,
      modify(original, ['settings', 'browsing', 'emptyWorkspaceLocation'], 'downloads', {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    const documented = documentConfiguration(updated);
    expect(parse(documented)).toEqual(parse(updated));
    expect(documented).toContain('Independent starting folder for the first plane');
    expect(documented.match(/Viewer configuration editing guide \(v1\)\./g)).toHaveLength(1);
    expect(documentConfiguration(documented)).toBe(documented);
  });
  it('rewords earlier guidance in place instead of repeating it', () => {
    const current = documentConfiguration(
      JSON.stringify({
        settings: {
          fileOpening: { default: 'automatic', types: { docx: 'plane' } },
          updates: { checkAtLaunch: true },
          quit: { warnShortcut: true },
          recipes: [],
          shortcuts: {},
        },
        ui: { space: { color: '' } },
      }),
    );
    for (const [now, earlier] of [
      ['Office files open in planes by default.', 'Office extensions default to native.'],
      ['Office files open in planes by default.', 'New settings preview docx and xlsx in planes.'],
      // menu items by their labels, where the menu has them
      ['Viewer > Check for Updates… checks.', 'Viewer > Check for Updates checks.'],
      ['Viewer > Quit Viewer, the Dock', 'Quit in the menu, the Dock'],
      ['(Workspace look…, under its name in the title bar).', '(Workspace background…).'],
      // without filler
      ['instructions, not these', 'instructions rather than these'],
      ['More IDs:', 'Other useful IDs:'],
    ]) {
      const before = current.replace(now!, earlier!);
      expect(before, earlier).not.toBe(current);
      expect(documentConfiguration(before), earlier).toBe(current);
    }
  });
  it.each(['multiline', 'compact', 'crlf'])(
    'documents %s configuration without altering values or user comments',
    async (format) => {
      const service = create();
      await service.load();
      const config = await read();
      config.settings.folders[path.join(root, 'books.2026')] = { mode: 'columns' };
      config.settings.recipes[0].instructions =
        '// Viewer configuration editing guide (v1).\nKeep "quotes", {name}, $() and Unicode: ș.';
      let original =
        '// Keep my explanation.\n' + JSON.stringify(config, null, format === 'compact' ? 0 : 2);
      if (format !== 'compact') original = original.replace(/\n}$/, ',\n}');
      if (format === 'crlf') original = original.replaceAll('\n', '\r\n');
      const documented = documentConfiguration(original);
      const errors: ParseError[] = [];
      expect(parse(documented, errors, { allowTrailingComma: true })).toEqual(config);
      expect(errors).toEqual([]);
      expect(documented).toContain('// Keep my explanation.');
      expect(documented).not.toBe(original);
      expect(documentConfiguration(documented)).toBe(documented);
      expect(documentConfiguration(original)).toBe(documented);
      if (format === 'crlf') expect(documented.replaceAll('\r\n', '')).not.toContain('\n');
      await fs.writeFile(file(), documented);
      await service.reload();
      expect(service.snapshot().config!.diagnostics).toEqual([]);
      expect(service.snapshot().settings.folders).toEqual(config.settings.folders);
      await service.patch(
        [{ path: 'settings.appearance', value: 'dark' }],
        service.snapshot().revision,
      );
      const saved = await fs.readFile(file(), 'utf8');
      expect(saved).toContain('// Keep my explanation.');
      expect((await read()).settings.recipes).toEqual(config.settings.recipes);
    },
  );
  it('preserves comments, merges independent external/UI edits, and rejects overlapping stale edits', async () => {
    const service = create();
    await service.load();
    const original = await fs.readFile(file(), 'utf8');
    await fs.writeFile(
      file(),
      '// Keep this explanation.\n' +
        original.replace('"appearance": "system"', '"appearance": "light"'),
    );
    const result = await service.patch([{ path: 'settings.browsing.mode', value: 'columns' }], 0);
    expect(result.settings.appearance).toBe('light');
    expect(result.settings.browsing.mode).toBe('columns');
    expect(await fs.readFile(file(), 'utf8')).toContain('// Keep this explanation.');
    await expect(
      service.patch([{ path: 'settings.appearance', value: 'dark' }], 0),
    ).rejects.toThrow('another window or config.jsonc');
    expect((await read()).$schema).toBe('config.schema.json');
  });
  it('watches editor-style atomic replacement and keeps the last valid value after malformed edits', async () => {
    const emit = vi.fn();
    const service = create(emit);
    await service.load();
    const config = await read();
    config.settings.browsing.mode = 'gallery';
    await fs.writeFile(file() + '.editor', JSON.stringify(config));
    await fs.rename(file() + '.editor', file());
    await vi.waitFor(() => expect(service.snapshot().settings.browsing.mode).toBe('gallery'), {
      timeout: 3000,
    });
    await fs.writeFile(file(), '{\n "settings": broken');
    await service.reload();
    expect(service.snapshot().settings.browsing.mode).toBe('gallery');
    expect(service.snapshot().config!.diagnostics[0]).toMatch(/line \d+, column \d+/);
    await expect(
      service.patch([{ path: 'settings.appearance', value: 'dark' }], service.snapshot().revision),
    ).rejects.toThrow();
    const reopened = create();
    await reopened.load();
    expect(reopened.snapshot().settings.browsing.mode).toBe('gallery');
    expect(await fs.readFile(file(), 'utf8')).toBe('{\n "settings": broken');
    expect(emit).toHaveBeenCalled();
  });
  it('rejects invalid UI types and future versions without normalizing or overwriting them', async () => {
    const service = create();
    await service.load();
    const config = await read();
    config.ui.list.visible.size = 'no';
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().config!.diagnostics[0]).toContain('ui');
    expect(service.snapshot().ui.list.visible.size).toBe(true);
    config.version = 99;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    await expect(
      service.patch([{ path: 'settings.appearance', value: 'dark' }], 0),
    ).rejects.toThrow();
    expect((await read()).version).toBe(99);
  });
  it('backs up settings-v1 and migrates competing folder views once, with the active plane last', async () => {
    const prior = JSON.stringify({
      version: 1,
      revision: 4,
      settings: defaultSettings(root),
      ui: normalizePreferences(),
    });
    await fs.writeFile(path.join(root, 'settings-v1.json'), prior);
    const service = create();
    await service.load();
    const folder = {
      id: 'root',
      type: 'folder',
      path: path.join(root, 'with.dot'),
      mode: 'list',
      sort: 'name',
      descending: false,
      showHidden: false,
      history: [root],
      historyIndex: 0,
    } as FolderPane;
    await service.seedFolders([folder, { ...folder, id: 'active', mode: 'columns' }]);
    expect(service.snapshot().settings.folders[folder.path].mode).toBe('columns');
    expect(await fs.readFile(path.join(root, 'settings-v1.migration-backup.json'), 'utf8')).toBe(
      prior,
    );
    await service.patch(
      [{ keys: ['settings', 'folders', folder.path], path: '', value: null }],
      service.snapshot().revision,
    );
    const reopened = create();
    await reopened.load();
    await reopened.seedFolders([folder]);
    expect(reopened.snapshot().settings.folders).toEqual({});
    expect(await fs.readFile(path.join(root, 'settings-v1.json'), 'utf8')).toBe(prior);
  });
  it('starts from the defaults when settings-v1 cannot be read, and leaves that file as it is', async () => {
    const texts = ['{"version": 1, "settings": {', '{"version": 1, "settings": {"browsing": 7}}'];
    for (const [index, text] of texts.entries()) {
      // A profile of its own for each earlier file, with no config.jsonc yet.
      const profile = path.join(root, `profile-${index}`);
      await fs.mkdir(profile);
      await fs.writeFile(path.join(profile, 'settings-v1.json'), text);
      const service = new SettingsService(profile, root, () => true, vi.fn());
      services.push(service);
      await service.load();
      expect(service.snapshot().settings.browsing).toEqual(defaultSettings(root).browsing);
      expect(await fs.readFile(path.join(profile, 'settings-v1.json'), 'utf8')).toBe(text);
    }
  });
  it('patches folder keys with dots and nested partial layout safely and rejects approval paths', async () => {
    const service = create();
    await service.load();
    const folder = path.join(root, 'books.2026');
    await service.patch(
      [
        {
          path: '',
          keys: ['settings', 'folders', folder],
          value: { mode: 'columns', columnWidth: 640, list: { visible: { kind: false } } },
        },
      ],
      0,
    );
    expect((await read()).settings.folders[folder]).toMatchObject({ columnWidth: 640 });
    expect(() => service.preview([{ path: 'executionApprovals', value: [] }])).toThrow(
      'Unknown setting',
    );
    expect(() => service.preview([{ path: 'settings.__proto__.polluted', value: true }])).toThrow(
      'Unknown setting',
    );
    expect(() =>
      service.preview([
        { path: '', keys: ['settings', 'folders', folder, 'columnWidth'], value: 2000 },
      ]),
    ).toThrow();
  });
  it('sets an optional key the file does not hold yet, and still refuses one the schema lacks', async () => {
    await create().load();
    // a config.jsonc written before the remembered suggestions and dismissed insights
    const written = await read();
    delete written.ui.suggestionHistory;
    delete written.ui.insightsDismissed;
    await fs.writeFile(file(), JSON.stringify(written, null, 2));
    const service = create();
    await service.load();
    expect(service.snapshot().ui).not.toHaveProperty('suggestionHistory');
    const folder = path.join(root, 'Jobs');
    expect(
      service.preview([{ path: 'ui.suggestionHistory', value: { selection: ['rename'] } }]),
    ).toMatchObject({ valid: true, changes: ['ui.suggestionHistory'] });
    // as the workspace window remembers a ⌘K command run on a selection
    await service.patch(
      [
        { path: 'ui.suggestionHistory', value: { selection: ['rename'] } },
        { path: 'ui.insightsDismissed', value: { [folder]: ['large-files'] } },
      ],
      service.snapshot().revision,
      'workspace',
    );
    expect((await read()).ui).toMatchObject({
      suggestionHistory: { selection: ['rename'] },
      insightsDismissed: { [folder]: ['large-files'] },
    });
    // a key no schema has, at either root and deeper
    for (const keys of [
      ['ui', 'suggestionHistroy'],
      ['settings', 'browsing', 'colour'],
      ['ui', 'sidebar', 'shade'],
    ]) {
      await expect(
        service.patch([{ path: keys.join('.'), value: true }], service.snapshot().revision),
      ).rejects.toThrow('Unknown setting.');
      expect(() => service.preview([{ path: keys.join('.'), value: true }])).toThrow(
        'Unknown setting.',
      );
    }
    // nor is an absent key removed, nor a key added through the prototype
    expect(() => service.preview([{ path: 'ui.suggestionHistroy', value: undefined }])).toThrow(
      'Unknown setting.',
    );
    expect(() => service.preview([{ path: 'ui.constructor', value: {} }])).toThrow(
      'Unknown setting.',
    );
    expect((await read()).ui).not.toHaveProperty('suggestionHistroy');
  });
  it('exports and imports through validation and emits editor schema metadata', async () => {
    const service = create();
    await service.load();
    await service.patch([{ path: 'settings.appearance', value: 'light' }], 0);
    const exported = path.join(root, 'export.jsonc');
    await service.exportConfiguration(exported);
    await service.patch(
      [{ path: 'settings.appearance', value: 'dark' }],
      service.snapshot().revision,
    );
    expect((await service.importConfiguration(exported)).settings.appearance).toBe('light');
    const schema = JSON.parse(await fs.readFile(path.join(root, 'config.schema.json'), 'utf8'));
    expect(schema.properties.settings.properties.browsing.properties.mode.enum).toContain(
      'columns',
    );
    expect(schema.properties.settings.properties.customActions).toBeDefined();
  });
});

// Renaming config.jsonc aside stands in for its removal: nothing is deleted.
describe('a removed or unreadable config.jsonc (2026-10-20)', () => {
  let moves = 0;
  const moved = () => fs.rename(file(), `${file()}.moved-${++moves}`);
  it('keeps the settings while config.jsonc is gone, and the next change writes it back with its comments', async () => {
    // A removal was an error that refused every save; the next launch then started from the defaults.
    const service = create();
    await service.load();
    await service.patch(
      [{ path: 'settings.browsing.mode', value: 'columns' }],
      service.snapshot().revision,
    );
    const text = await fs.readFile(file(), 'utf8');
    await fs.writeFile(file(), text.replace('"settings": {', '// kept by me\n  "settings": {'));
    await service.reload();
    await moved();
    await service.reload();
    expect(service.snapshot().config!.diagnostics).toEqual([]);
    expect(service.snapshot().config!.missing).toBe(true);
    expect(service.snapshot().settings.browsing.mode).toBe('columns');
    await service.patch(
      [{ path: 'settings.appearance', value: 'dark' }],
      service.snapshot().revision,
    );
    const written = await fs.readFile(file(), 'utf8');
    expect(written).toContain('// kept by me');
    expect(parse(written).settings.browsing.mode).toBe('columns');
    expect(parse(written).settings.appearance).toBe('dark');
    expect(service.snapshot().config!.missing).toBeFalsy();
  });
  it('writes a removed config.jsonc back on request, and reads one an editor recreated instead', async () => {
    const service = create();
    await service.load();
    await moved();
    await service.reload();
    await service.restoreConfiguration();
    expect(parse(await fs.readFile(file(), 'utf8')).version).toBe(1);
    await moved();
    await service.reload();
    const config = parse(await fs.readFile(`${file()}.moved-${moves}`, 'utf8'));
    config.settings.appearance = 'light';
    const recreated = JSON.stringify(config);
    await fs.writeFile(file(), recreated);
    // the recreated file is read, not written over
    expect((await service.restoreConfiguration()).settings.appearance).toBe('light');
    expect(await fs.readFile(file(), 'utf8')).toBe(recreated);
  });
  it('restores a removed config.jsonc from its last valid copy at the next launch', async () => {
    const service = create();
    await service.load();
    await service.patch(
      [{ path: 'settings.browsing.mode', value: 'columns' }],
      service.snapshot().revision,
    );
    service.close();
    await moved();
    const reopened = create();
    await reopened.load();
    expect(reopened.snapshot().settings.browsing.mode).toBe('columns');
    expect(reopened.snapshot().config!.restored).toMatch(/last valid copy/);
    expect(parse(await fs.readFile(file(), 'utf8')).settings.browsing.mode).toBe('columns');
    expect(
      JSON.parse(await fs.readFile(file() + '.last-valid', 'utf8')).settings.browsing.mode,
    ).toBe('columns');
  });
  it('does not bring settings-v1 back once it was migrated', async () => {
    const defaults = defaultSettings(root);
    await fs.writeFile(
      path.join(root, 'settings-v1.json'),
      JSON.stringify({
        version: 1,
        revision: 4,
        settings: { ...defaults, browsing: { ...defaults.browsing, mode: 'gallery' } },
        ui: normalizePreferences(),
      }),
    );
    const service = create();
    await service.load();
    expect(service.snapshot().settings.browsing.mode).toBe('gallery');
    service.close();
    await moved();
    await fs.rename(file() + '.last-valid', file() + '.last-valid.moved-1');
    const reopened = create();
    await reopened.load();
    expect(reopened.snapshot().settings.browsing.mode).toBe(defaults.browsing.mode);
  });
  it('never overwrites a last valid copy it could not read', async () => {
    const service = create();
    await service.load();
    service.close();
    await moved();
    await fs.writeFile(file() + '.last-valid', 'not json');
    const reopened = create();
    await reopened.load();
    const kept = (await fs.readdir(root)).filter((name) =>
      name.startsWith('config.jsonc.last-valid.unreadable-'),
    );
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(root, kept[0]!), 'utf8')).toBe('not json');
  });
  it('says which copy it runs on when config.jsonc cannot be read', async () => {
    const service = create();
    await service.load();
    service.close();
    await fs.writeFile(file(), '{ broken');
    const recovered = create();
    await recovered.load();
    expect(recovered.snapshot().config!.fallback).toBe('last-valid');
    recovered.close();
    await fs.writeFile(file() + '.last-valid', 'not json');
    const defaults = create();
    await defaults.load();
    expect(defaults.snapshot().config!.fallback).toBe('defaults');
    expect(await fs.readFile(file() + '.last-valid', 'utf8')).toBe('not json');
  });
});

describe('settings the workspace window may change (2026-10-20)', () => {
  it('lets it change its own preferences, and nothing that grants access, data or execution', async () => {
    // Any settings.* path was accepted from the workspace renderer: it could widen agent folders or
    // point a provider elsewhere.
    const service = create();
    await service.load();
    const patch = (path: string, value: unknown, keys?: string[]) =>
      service.patch(
        [{ path, value, ...(keys ? { keys } : {}) }],
        service.snapshot().revision,
        'workspace',
      );
    await patch('settings.appearance', 'dark');
    await patch('ui.recentCommands', ['open-selection']);
    await patch('settings.browsing', { ...service.snapshot().settings.browsing, mode: 'columns' });
    await patch('settings.savedSearches', []);
    await patch('', { mode: 'list' }, ['settings', 'folders', path.join(root, 'with.dot')]);
    for (const [path, value] of [
      ['settings.agents.roots', ['/']],
      ['settings.agents', { ...service.snapshot().settings.agents, enabled: true }],
      ['settings.providers', []],
      ['settings.recipes', []],
      // a program, unlike a macro, is the person's to add
      [
        'settings.customActions',
        [
          {
            id: 'zsh',
            name: 'zsh',
            aliases: [],
            icon: 'command',
            shortcut: '',
            order: 0,
            pinned: false,
            when: { target: 'any', extensions: [], min: 0, max: 10000 },
            executor: { kind: 'shell', executable: '/bin/zsh', script: 'pwd', perItem: false },
          },
        ],
      ],
      ['settings.terminals', service.snapshot().settings.terminals],
      ['settings', service.snapshot().settings],
      // Trash confirmation is the person's, in Settings, even inside a whole browsing section
      ['settings.browsing.confirmTrash', false],
      ['settings.browsing', { ...service.snapshot().settings.browsing, confirmTrash: false }],
    ] as const)
      await expect(patch(path, value)).rejects.toThrow('Change this setting in Settings');
    expect(service.snapshot().settings.browsing.mode).toBe('columns');
    await service.patch(
      [{ path: 'settings.agents.roots', value: [root] }],
      service.snapshot().revision,
    );
    expect(service.snapshot().settings.agents.roots).toEqual([root]);
  });
});

describe('references to missing items (2026-10-20)', () => {
  const dangling = (settings: ReturnType<typeof defaultSettings>) => ({
    ...settings,
    customActions: [
      {
        id: 'run-missing',
        name: 'Run missing',
        aliases: [],
        icon: 'command',
        shortcut: '',
        order: 0,
        pinned: false,
        when: { target: 'any', extensions: [], min: 0, max: 10000 },
        executor: { kind: 'recipe', recipeID: 'missing' },
      },
    ],
    recipes: [{ ...settings.recipes[0]!, providerID: 'nope' }],
  });
  it('loads a configuration that names a missing recipe or provider, and says so', async () => {
    // Nothing checked them: a recipe action opened an empty dialog. Refusing the file instead would
    // put Viewer on its defaults, so they are warnings, and a use fails visibly.
    const service = create();
    await service.load();
    const config = await read();
    config.settings = dangling(config.settings);
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().settings.customActions[0]!.id).toBe('run-missing');
    const warnings = service.snapshot().config!.warnings!.join('\n');
    expect(warnings).toContain('“missing”');
    expect(warnings).toContain('“nope”');
  });
  it('refuses an agent’s change that adds one, but not one that leaves an earlier one alone', async () => {
    const service = create();
    await service.load();
    const added = dangling(service.snapshot().settings).customActions;
    expect(() => service.preview([{ path: 'settings.customActions', value: added }])).toThrow(
      '“missing”',
    );
    const config = await read();
    config.settings = dangling(config.settings);
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.preview([{ path: 'settings.appearance', value: 'dark' }]).valid).toBe(true);
  });
});

describe('comments inside lists (2026-10-20)', () => {
  // A list was written whole on any change, so every comment inside it went, unchanged items too.
  const set = async (keys: string[], value: unknown, formatted = true) => {
    const text = await fs.readFile(file(), 'utf8');
    await fs.writeFile(
      file(),
      applyEdits(
        text,
        modify(
          text,
          keys,
          value,
          formatted ? { formattingOptions: { insertSpaces: true, tabSize: 2 } } : {},
        ),
      ),
    );
  };
  const exclusions = async (service: SettingsService) => {
    await set(['settings', 'search', 'exclusions'], ['alpha-x', 'beta-x', 'gamma-x']);
    const text = await fs.readFile(file(), 'utf8');
    await fs.writeFile(
      file(),
      text
        .replace('"alpha-x"', '// note-A\n      "alpha-x"')
        .replace('"beta-x"', '// note-B\n      "beta-x"')
        .replace('"gamma-x"', '// note-C\n      "gamma-x"'),
    );
    await service.reload();
  };
  const above = (text: string, comment: string, value: string) =>
    new RegExp(`// note-${comment}\\s*"${value}"`).test(text);
  it('keeps the comments of the items that stay when one is added', async () => {
    const service = create();
    await service.load();
    await exclusions(service);
    await service.patch(
      [{ path: 'settings.search.exclusions', value: ['alpha-x', 'beta-x', 'gamma-x', 'delta-x'] }],
      service.snapshot().revision,
    );
    const text = await fs.readFile(file(), 'utf8');
    expect(
      above(text, 'A', 'alpha-x') && above(text, 'B', 'beta-x') && above(text, 'C', 'gamma-x'),
    ).toBe(true);
    expect(parse(text).settings.search.exclusions).toEqual([
      'alpha-x',
      'beta-x',
      'gamma-x',
      'delta-x',
    ]);
  });
  it('removes an item with its own comment, and only that', async () => {
    const service = create();
    await service.load();
    await exclusions(service);
    await service.patch(
      [{ path: 'settings.search.exclusions', value: ['alpha-x', 'gamma-x'] }],
      service.snapshot().revision,
    );
    const text = await fs.readFile(file(), 'utf8');
    expect(text).not.toContain('// note-B');
    expect(above(text, 'A', 'alpha-x') && above(text, 'C', 'gamma-x')).toBe(true);
    expect(parse(text).settings.search.exclusions).toEqual(['alpha-x', 'gamma-x']);
    await service.patch(
      [{ path: 'settings.search.exclusions', value: ['alpha-x'] }],
      service.snapshot().revision,
    );
    const last = await fs.readFile(file(), 'utf8');
    expect(above(last, 'A', 'alpha-x')).toBe(true);
    expect(parse(last).settings.search.exclusions).toEqual(['alpha-x']);
  });
  it('keeps a comment inside one action when another is renamed', async () => {
    const service = create();
    await service.load();
    const action = (id: string, name: string) => ({
      id,
      name,
      aliases: [],
      icon: 'command',
      shortcut: '',
      order: 0,
      pinned: false,
      when: { target: 'any', extensions: [], min: 0, max: 10000 },
      executor: { kind: 'builtin', command: 'copy-path' },
    });
    await set(['settings', 'customActions'], [action('a', 'First'), action('b', 'Second')]);
    const text = await fs.readFile(file(), 'utf8');
    const second = text.indexOf('"name": "Second"');
    await fs.writeFile(
      file(),
      text.slice(0, second) + '// about the second action\n        ' + text.slice(second),
    );
    await service.reload();
    await service.patch(
      [
        {
          path: 'settings.customActions',
          value: [action('a', 'Renamed'), action('b', 'Second')],
        },
      ],
      service.snapshot().revision,
    );
    const saved = await fs.readFile(file(), 'utf8');
    expect(saved).toMatch(/\/\/ about the second action\s*"name": "Second"/);
    expect(parse(saved).settings.customActions.map((item: { name: string }) => item.name)).toEqual([
      'Renamed',
      'Second',
    ]);
  });
  it('edits a list written on one line', async () => {
    const service = create();
    await service.load();
    await set(
      ['settings', 'customActions'],
      [
        {
          id: 'a',
          name: 'Inline',
          aliases: ['ps', 'shell'],
          icon: 'command',
          shortcut: '',
          order: 0,
          pinned: false,
          when: { target: 'any', extensions: [], min: 0, max: 10000 },
          executor: { kind: 'builtin', command: 'copy-path' },
        },
      ],
      false,
    );
    await service.reload();
    const [action] = service.snapshot().settings.customActions;
    for (const aliases of [['ps'], ['ps', 'sh', 'zsh'], ['zsh'], []])
      await service.patch(
        [{ path: 'settings.customActions', value: [{ ...action!, aliases }] }],
        service.snapshot().revision,
      );
    expect(parse(await fs.readFile(file(), 'utf8')).settings.customActions[0].aliases).toEqual([]);
  });
});

describe('importing a configuration (2026-10-20)', () => {
  it('keeps the imported file’s own comments', async () => {
    // Its values were patched into the current text, so its comments were dropped.
    const service = create();
    await service.load();
    const exported = path.join(root, 'export.jsonc');
    const text = (await fs.readFile(file(), 'utf8')).replace(
      '"appearance":',
      '// imported note\n    "appearance":',
    );
    await fs.writeFile(exported, text.replace('"appearance": "system"', '"appearance": "light"'));
    const imported = await service.importConfiguration(exported);
    expect(imported.settings.appearance).toBe('light');
    expect(await fs.readFile(file(), 'utf8')).toContain('// imported note');
  });
  it('replaces a configuration that cannot be read, and keeps it beside', async () => {
    const service = create();
    await service.load();
    const exported = path.join(root, 'export.jsonc');
    await fs.copyFile(file(), exported);
    await fs.writeFile(file(), '{ broken');
    await service.reload();
    await service.importConfiguration(exported);
    expect(service.snapshot().config!.diagnostics).toEqual([]);
    expect(await fs.readFile(file(), 'utf8')).toBe(await fs.readFile(exported, 'utf8'));
    const kept = (await fs.readdir(root)).filter((name) =>
      name.startsWith('config.jsonc.before-import-'),
    );
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(root, kept[0]!), 'utf8')).toBe('{ broken');
  });
  it('asks before an import changes providers, agents, programs or terminals', async () => {
    const service = create();
    await service.load();
    const config = await read();
    config.settings.providers = [
      {
        id: 'elsewhere',
        name: 'Elsewhere',
        kind: 'local',
        endpoint: 'https://models.example',
        model: 'm',
        allowContent: false,
      },
    ];
    const exported = path.join(root, 'export.jsonc');
    await fs.writeFile(exported, JSON.stringify(config));
    const confirm = vi.fn(async (_changes: string[]) => false);
    await expect(service.importConfiguration(exported, confirm)).rejects.toThrow('cancelled');
    expect(confirm.mock.calls[0]![0].join(' ')).toContain('model providers');
    expect(service.snapshot().settings.providers).toEqual([]);
    confirm.mockResolvedValue(true);
    await service.importConfiguration(exported, confirm);
    expect(service.snapshot().settings.providers[0]!.id).toBe('elsewhere');
  });
  it('leaves out guidance a person deleted from config.jsonc', async () => {
    // Every save put back every guide line that was missing.
    const service = create();
    await service.load();
    const lines = (await fs.readFile(file(), 'utf8')).split('\n');
    const at = lines.findIndex((line) => line.includes('"appearance":'));
    const deleted = lines[at - 1]!;
    expect(deleted.trim().startsWith('//')).toBe(true);
    lines.splice(at - 1, 1);
    await fs.writeFile(file(), lines.join('\n'));
    await service.reload();
    await service.patch(
      [{ path: 'settings.browsing.mode', value: 'columns' }],
      service.snapshot().revision,
    );
    expect((await fs.readFile(file(), 'utf8')).split('\n')).not.toContain(deleted);
  });
});

describe('reloading config.jsonc (2026-10-20)', () => {
  it('announces a change once', async () => {
    // It was announced by the read and again by the reload, so every window applied it twice.
    const emit = vi.fn();
    const service = create(emit);
    await service.load();
    service.close();
    const config = await read();
    config.settings.appearance = 'dark';
    await fs.writeFile(file(), JSON.stringify(config));
    emit.mockClear();
    await service.reload();
    expect(emit).toHaveBeenCalledOnce();
    emit.mockClear();
    await service.reload();
    expect(emit).toHaveBeenCalledOnce();
  });
});

describe('announcing before config.jsonc is read (2026-10-30)', () => {
  it('announces nothing until the person’s settings are read', async () => {
    // A theme change at launch announced the defaults, which hold no providers, and every model
    // data approval was reconciled away.
    const emit = vi.fn();
    const service = create(emit);
    service.announce();
    expect(service.isLoaded()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    await service.load();
    expect(service.isLoaded()).toBe(true);
    service.announce();
    expect(emit).toHaveBeenCalledOnce();
  });
});

describe('a macro saved from the workspace (2026-10-23)', () => {
  const action = (id: string, executor: Record<string, unknown>) => ({
    id,
    name: id,
    aliases: [],
    icon: 'command',
    shortcut: '',
    order: 0,
    pinned: false,
    when: { target: 'any', extensions: [], min: 0, max: 10000 },
    executor,
  });
  it('may add or change a command sequence, and nothing that runs a program', async () => {
    const service = create();
    await service.load();
    const patch = (value: unknown) =>
      service.patch(
        [{ path: 'settings.customActions', value }],
        service.snapshot().revision,
        'workspace',
      );
    const macro = action('macro-copy', { kind: 'sequence', commands: ['select-all', 'copy'] });
    await patch([macro]);
    expect(service.snapshot().settings.customActions).toHaveLength(1);
    await expect(
      patch([
        macro,
        action('shell', { kind: 'shell', executable: '/bin/zsh', script: 'pwd', perItem: false }),
      ]),
    ).rejects.toThrow('Change this setting in Settings');
    await expect(
      patch([action('macro-copy', { kind: 'builtin', command: 'copy' })]),
    ).rejects.toThrow('Change this setting in Settings');
    await expect(
      patch([action('bad', { kind: 'sequence', commands: ['custom.other'] })]),
    ).rejects.toThrow();
  });
});
