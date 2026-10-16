import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Lenses } from '../src/desktop/lenses';
import { formatLens, type LensFolder } from '../src/domain/lenses';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, data: string, folder: string, lenses: Lenses, clock: number;
const trashed: string[] = [],
  changed: string[] = [];
beforeEach(async () => {
  root = await temporaryRoot('viewer-lenses-');
  data = path.join(root, 'data');
  folder = path.join(root, 'Clients');
  await mkdir(data);
  await mkdir(folder);
  for (const name of ['Acme', 'Borel', 'Cobalt']) await mkdir(path.join(folder, name));
  trashed.length = 0;
  changed.length = 0;
  clock = Date.UTC(2026, 9, 16);
  lenses = new Lenses(data, async () => {}, {
    home: path.join(root, 'home'),
    trash: async (file) => {
      trashed.push(file);
      return 'job-1';
    },
    trashOwn: async (file) => {
      trashed.push(file);
    },
    changed: (value) => changed.push(value),
    now: () => clock,
  });
});
afterEach(async () => {
  await lenses.close();
  await chmod(folder, 0o755).catch(() => {});
  await trashTemporary(root);
});
const only = (value: LensFolder) => {
  expect(value.lenses).toHaveLength(1);
  return value.lenses[0]!;
};

describe('lens storage', () => {
  it('writes nothing until a lens is made, then a README and one fixed-format file', async () => {
    expect(await lenses.list(folder)).toMatchObject({ lenses: [], shared: true });
    expect(await readdir(folder)).not.toContain('.viewer');
    const created = await lenses.create(folder, 'By year', [
      { kind: 'set-group', group: { id: 'gaaaaa', name: '2026', order: 0 } },
      { kind: 'place', name: 'Acme', group: 'gaaaaa', at: [8, 8] },
    ]);
    expect(created).toMatchObject({ local: false, writable: true });
    expect(created.file).toBe(path.join(folder, '.viewer', 'lenses', 'by-year.lens.jsonc'));
    expect(await readFile(path.join(folder, '.viewer', 'README.md'), 'utf8')).toContain(
      'never touched',
    );
    expect(await readFile(created.file, 'utf8')).toBe(formatLens(created.lens));
    expect((await stat(created.file)).mode & 0o777).toBe(0o644);
    expect(only(await lenses.list(folder)).lens.members).toEqual([
      { name: 'Acme', group: 'gaaaaa', at: [8, 8] },
    ]);
    expect(changed).toContain(folder);
  });
  it('applies an edit on top of a change saved elsewhere in the meantime', async () => {
    const created = await lenses.create(folder, 'By year');
    const text = (await readFile(created.file, 'utf8')).replace(
      '"groups": []',
      '"groups": [\n    {"id":"gbbbbb","name":"From a colleague","order":0}\n  ]',
    );
    await writeFile(created.file, text);
    const { document, dropped } = await lenses.apply(folder, created.file, [
      { kind: 'place', name: 'Borel', group: 'gbbbbb' },
    ]);
    expect(dropped).toEqual([]);
    expect(document.lens.groups.map((group) => group.name)).toEqual(['From a colleague']);
    expect(document.lens.members).toEqual([{ name: 'Borel', group: 'gbbbbb' }]);
  });
  it('never overwrites a lens it cannot read', async () => {
    const created = await lenses.create(folder, 'By year');
    const conflicted = '<<<<<<< HEAD\n' + (await readFile(created.file, 'utf8'));
    await writeFile(created.file, conflicted);
    const listed = await lenses.list(folder);
    expect(listed.lenses).toEqual([]);
    expect(listed.broken).toHaveLength(1);
    await expect(
      lenses.apply(folder, created.file, [{ kind: 'place', name: 'Acme', group: null }]),
    ).rejects.toThrow();
    expect(await readFile(created.file, 'utf8')).toBe(conflicted);
  });
  it('leaves a .viewer it did not make alone and keeps lenses on this Mac instead', async () => {
    await mkdir(path.join(folder, '.viewer'));
    await writeFile(path.join(folder, '.viewer', 'datastore.general'), 'old app');
    const created = await lenses.create(folder, 'Mine');
    expect(created.local).toBe(true);
    expect(created.file.startsWith(data)).toBe(true);
    expect(await readdir(path.join(folder, '.viewer'))).toEqual(['datastore.general']);
    expect(only(await lenses.list(folder)).local).toBe(true);
  });
  it('refuses a symbolic link named .viewer', async () => {
    const elsewhere = path.join(root, 'elsewhere');
    await mkdir(path.join(elsewhere, 'lenses'), { recursive: true });
    await symlink(elsewhere, path.join(folder, '.viewer'));
    const created = await lenses.create(folder, 'Mine');
    expect(created.local).toBe(true);
    expect(await readdir(path.join(elsewhere, 'lenses'))).toEqual([]);
    expect((await lstat(path.join(folder, '.viewer'))).isSymbolicLink()).toBe(true);
  });
  it('keeps lenses for a read-only folder or Home on this Mac', async () => {
    await chmod(folder, 0o555);
    const created = await lenses.create(folder, 'Read only');
    expect(created.local).toBe(true);
    expect((await lenses.list(folder)).shared).toBe(false);
    const home = path.join(root, 'home');
    await mkdir(home);
    expect((await lenses.create(home, 'Home')).local).toBe(true);
    expect(await readdir(home)).toEqual([]);
  });
  it('moves a lens kept on this Mac into the folder once it can hold it', async () => {
    await chmod(folder, 0o555);
    const local = await lenses.create(folder, 'Later', [
      { kind: 'place', name: 'Acme', group: null },
    ]);
    await chmod(folder, 0o755);
    const shared = await lenses.share(folder, local.file);
    expect(shared).toMatchObject({ local: false, lens: { id: local.lens.id } });
    expect(trashed).toEqual([local.file]);
  });
  it('sends lens files to the Trash, never deleting them', async () => {
    const created = await lenses.create(folder, 'By year');
    expect(await lenses.trash(folder, created.file)).toEqual({ job: 'job-1' });
    expect(trashed).toEqual([created.file]);
    await expect(lenses.trash(folder, path.join(folder, 'Acme'))).rejects.toThrow();
    await expect(lenses.apply(folder, path.join(root, 'other.lens.jsonc'), [])).rejects.toThrow(
      'Choose a lens of this folder.',
    );
  });
});

describe('lens names follow the items', () => {
  it('renames a member when Viewer renames the item, and leaves a moved item as missing', async () => {
    const created = await lenses.create(folder, 'By year', [
      { kind: 'place', name: 'Acme', group: null, at: [0, 0] },
      { kind: 'place', name: 'Borel', group: null },
    ]);
    await lenses.remap([
      { source: path.join(folder, 'Acme'), destination: path.join(folder, 'Acme Corp') },
      { source: path.join(folder, 'Borel'), destination: path.join(root, 'Borel') },
    ]);
    const lens = only(await lenses.list(folder)).lens;
    expect(lens.members).toContainEqual({ name: 'Acme Corp', at: [0, 0] });
    expect(lens.members).toContainEqual({ name: 'Borel' });
    expect(created.lens.id).toBe(lens.id);
  });
  it('recognizes an item renamed in Finder by its identity', async () => {
    await lenses.create(folder, 'By year', [
      { kind: 'place', name: 'Cobalt', group: null, at: [16, 0] },
    ]);
    await rename(path.join(folder, 'Cobalt'), path.join(folder, 'Cobalt Labs'));
    expect(only(await lenses.list(folder)).lens.members).toEqual([
      { name: 'Cobalt Labs', at: [16, 0] },
    ]);
  });
  it('drops items missing for a month with the next edit', async () => {
    const created = await lenses.create(folder, 'By year', [
      { kind: 'place', name: 'Gone', group: null },
      { kind: 'place', name: 'Acme', group: null },
    ]);
    await lenses.list(folder);
    clock += 31 * 86400000;
    await lenses.list(folder);
    const { document } = await lenses.apply(folder, created.file, [
      { kind: 'place', name: 'Borel', group: null },
    ]);
    expect(document.lens.members.map((member) => member.name).sort()).toEqual(['Acme', 'Borel']);
  });
  it('keeps lenses on this Mac with their folder when Viewer moves it', async () => {
    await chmod(folder, 0o555);
    await lenses.create(folder, 'Local');
    await chmod(folder, 0o755);
    const moved = path.join(root, 'Customers');
    await rename(folder, moved);
    await lenses.remap([{ source: folder, destination: moved }]);
    expect(only(await lenses.list(moved)).lens.name).toBe('Local');
    folder = moved;
  });
  it('remembers collapsed groups per lens', async () => {
    const created = await lenses.create(folder, 'By year');
    await lenses.collapse(created.lens.id, ['gaaaaa']);
    expect((await lenses.list(folder)).collapsed).toEqual({ [created.lens.id]: ['gaaaaa'] });
  });
});
