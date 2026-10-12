import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { SettingsService } from '../src/desktop/settings';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences';
import type { FolderPane } from '../src/domain/contracts';
import { documentConfiguration } from '../src/desktop/configuration-comments';

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-config-'));
});
afterEach(async () => {
  services.splice(0).forEach((service) => service.close());
  await fs.rm(root, { recursive: true, force: true });
});

describe('authoritative JSONC configuration', () => {
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
  it('backs up legacy settings and migrates competing folder views once, with the active plane last', async () => {
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
