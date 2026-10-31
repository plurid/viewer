/**
 * THE DARK PAGES SETTING: off unless chosen, so a configuration written before it reads as it did.
 * The workspace window's button may set the mode; the night's times, like the other preview
 * settings, change only in Settings. A time is 24-hour HH:MM.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { SettingsService } from '../src/desktop/preferences/settings';
import { defaultSettings } from '../src/domain/services';
import { settingCatalog, workspaceMayChange } from '../src/domain/preferences/catalog';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
const services: SettingsService[] = [];
const create = () => {
  const service = new SettingsService(
    root,
    root,
    () => false,
    () => {},
  );
  services.push(service);
  return service;
};
const file = () => path.join(root, 'config.jsonc');
beforeEach(async () => {
  root = await temporaryRoot('viewer-dark-pages-');
});
afterEach(async () => {
  services.splice(0).forEach((service) => service.close());
  await trashTemporary(root);
});

describe('the Dark pages setting', () => {
  it('is off by default, with a night from 20:00 until 07:00', () => {
    expect(defaultSettings('/fixtures').previews).toMatchObject({
      darkPages: 'off',
      darkPagesFrom: '20:00',
      darkPagesUntil: '07:00',
    });
    const definition = settingCatalog.find((item) => item.path === 'settings.previews.darkPages');
    expect(definition).toMatchObject({ category: 'Previews', label: 'Dark pages', kind: 'choice' });
    expect(definition?.choices).toEqual([
      ['off', 'Off'],
      ['on', 'On'],
      ['night', 'At night'],
      ['system', 'With macOS dark mode'],
    ]);
  });
  it('reads a configuration written before it as off', async () => {
    const service = create();
    await service.load();
    const config = parse(await fs.readFile(file(), 'utf8'));
    delete config.settings.previews.darkPages;
    delete config.settings.previews.darkPagesFrom;
    delete config.settings.previews.darkPagesUntil;
    await fs.writeFile(file(), JSON.stringify(config));
    await service.reload();
    expect(service.snapshot().config?.diagnostics).toEqual([]);
    expect(service.snapshot().settings.previews).toMatchObject({
      darkPages: 'off',
      darkPagesFrom: '20:00',
      darkPagesUntil: '07:00',
    });
  });
  it('saves a choice with its guidance, and refuses a mode or time it does not know', async () => {
    const service = create();
    await service.load();
    const patch = (key: string, value: unknown) =>
      service.patch([{ path: 'settings.previews.' + key, value }], service.snapshot().revision);
    await patch('darkPages', 'night');
    await patch('darkPagesFrom', '21:30');
    await patch('darkPagesUntil', '06:15');
    const text = await fs.readFile(file(), 'utf8');
    expect(parse(text).settings.previews).toMatchObject({
      darkPages: 'night',
      darkPagesFrom: '21:30',
      darkPagesUntil: '06:15',
    });
    expect(text).toContain('// PDF and Office previews draw pages dark with light ink');
    expect(text).toContain('// Settings choices: off | on | night | system.');
    expect(text).toContain('Earlier than darkPagesFrom, the night passes midnight.');
    for (const [key, value] of [
      ['darkPages', 'sunset'],
      ['darkPages', true],
      ['darkPagesFrom', '24:00'],
      ['darkPagesFrom', '7:00'],
      ['darkPagesUntil', '07:00:00'],
      ['darkPagesUntil', ''],
    ] as const)
      await expect(patch(key, value), `${key} ${value}`).rejects.toThrow();
    expect(service.snapshot().settings.previews.darkPagesFrom).toBe('21:30');
  });
  it('lets the workspace window set the mode, and nothing else among preview settings', async () => {
    const service = create();
    await service.load();
    const patch = (key: string, value: unknown) =>
      service.patch(
        [{ path: 'settings.previews' + key, value }],
        service.snapshot().revision,
        'workspace',
      );
    expect(workspaceMayChange(['settings', 'previews', 'darkPages'])).toBe(true);
    await patch('.darkPages', 'on');
    expect(service.snapshot().settings.previews.darkPages).toBe('on');
    for (const [key, value] of [
      ['.darkPagesFrom', '18:00'],
      ['.maxModelMB', 512],
      ['', { ...service.snapshot().settings.previews, darkPages: 'off' }],
    ] as const)
      await expect(patch(key, value), key).rejects.toThrow('Change this setting in Settings');
    expect(service.snapshot().settings.previews.darkPages).toBe('on');
  });
});
