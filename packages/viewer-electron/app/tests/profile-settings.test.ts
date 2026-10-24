import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { defaultSettings } from '../src/domain/services';
import { normalizePreferences } from '../src/domain/preferences/ui';
import { resolveWindowPreferences } from '../src/domain/preferences/presentation/resolver';
import { SettingsService } from '../src/desktop/preferences/settings';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
const services: SettingsService[] = [];
beforeEach(async () => {
  root = await temporaryRoot('viewer-profile-settings-');
});
afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  await trashTemporary(root);
});
function create() {
  const service = new SettingsService(
    root,
    root,
    () => false,
    () => {},
  );
  services.push(service);
  return service;
}
const file = () => path.join(root, 'config.jsonc');

describe('profile configuration validation', () => {
  it('retains legacy invalid entries on startup while applying only their valid local fields', async () => {
    const configuration = {
      version: 1,
      ui: normalizePreferences(),
      settings: {
        ...defaultSettings(root),
        profiles: [
          {
            id: 'legacy',
            name: 'Legacy',
            values: {
              'ui.titlebar': null,
              'settings.browsing.restoreSession': false,
              'settings.editor.tabSize': 8,
            },
          },
        ],
      },
    };
    await writeFile(file(), JSON.stringify(configuration));
    const service = create();
    await service.load();
    const snapshot = service.snapshot();
    expect(snapshot.settings.profiles[0]?.values).toEqual(
      configuration.settings.profiles[0]?.values,
    );
    expect(snapshot.config?.warnings?.join(' ')).toContain('ui.titlebar');
    expect(snapshot.config?.warnings?.join(' ')).toContain('restoreSession');
    const result = resolveWindowPreferences({
      settings: snapshot.settings,
      ui: snapshot.ui,
      systemLook: 'light',
      workspace: { profileID: 'legacy' },
    });
    expect(result.ui.titlebar.visible).toBe(true);
    expect(result.settings.editor.tabSize).toBe(8);
    await service.patch([{ path: 'ui.space.grid', value: false }], snapshot.revision);
    expect(service.snapshot().ui.space.grid).toBe(false);
    expect(service.snapshot().settings.profiles[0]?.values).toEqual(
      configuration.settings.profiles[0]?.values,
    );
  });

  it('rejects new invalid definitions and reserved IDs without changing configuration bytes', async () => {
    const service = create();
    await service.load();
    const original = await readFile(file(), 'utf8');
    for (const profile of [
      { id: 'bad', name: 'Bad', values: { 'ui.space.missing.toolbar': false } },
      { id: 'bad', name: 'Bad', values: { 'ui.space': null } },
      { id: 'bad', name: 'Bad', values: { 'settings.browsing.confirmTrash': false } },
      { id: 'focus', name: 'Custom Focus', values: { 'ui.space.grid': true } },
    ]) {
      await expect(
        service.patch(
          [{ path: 'settings.profiles', value: [profile] }],
          service.snapshot().revision,
        ),
      ).rejects.toThrow();
      expect(await readFile(file(), 'utf8')).toBe(original);
    }
  });

  it('rejects a malformed external profile edit and retains its last valid effective settings', async () => {
    const service = create();
    await service.load();
    const configuration = parse(await readFile(file(), 'utf8'));
    configuration.settings.profiles = [{ id: 'bad', name: 'Bad', values: { 'ui.titlebar': null } }];
    const invalid = JSON.stringify(configuration);
    await writeFile(file(), invalid);
    const snapshot = await service.reload();
    expect(snapshot.settings.profiles).toEqual([]);
    expect(snapshot.config?.diagnostics.length).toBeGreaterThan(0);
    expect(await readFile(file(), 'utf8')).toBe(invalid);
  });

  it('exposes the OS look independently from an explicitly chosen shared appearance', async () => {
    const service = create();
    await service.load();
    const snapshot = await service.patch(
      [{ path: 'settings.appearance', value: 'dark' }],
      service.snapshot().revision,
    );
    expect(snapshot.look).toBe('dark');
    expect(snapshot.systemLook).toBe('light');
  });
});
