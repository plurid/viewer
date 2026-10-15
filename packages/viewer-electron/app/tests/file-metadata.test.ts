import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FolderSizes } from '../src/desktop/folder-sizes';
import { Applications } from '../src/desktop/applications';
import type { FolderSizeTask } from '../src/domain/metadata';
import { temporaryRoot, trashTemporary, trashFixtureEntry } from '../tools/temporary';
const owned: string[] = [];
async function temporary() {
  const root = await temporaryRoot('viewer-metadata-');
  owned.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map((root) => trashTemporary(root)));
});
async function measure(paths: string[], cancel = false) {
  let done!: (task: FolderSizeTask) => void;
  const result = new Promise<FolderSizeTask>((resolve) => {
    done = resolve;
  });
  const sizes = new FolderSizes((task) => {
    if (cancel && task.status === 'running') queueMicrotask(() => sizes.cancel(task.id));
    if (task.status !== 'running') done(task);
  });
  const task = sizes.start(paths);
  return { task, result: await result };
}
describe('read-only folder sizes', () => {
  it('retains individual folder totals when calculating a mixed selection', async () => {
    const root = await temporary();
    const folder = path.join(root, 'folder');
    const empty = path.join(root, 'empty');
    const file = path.join(root, 'note.txt');
    await mkdir(folder);
    await mkdir(empty);
    await writeFile(path.join(folder, 'nested.txt'), '12345');
    await writeFile(file, 'abc');
    const { result } = await measure([folder, empty, file]);
    expect(result.bytes).toBe(8);
    expect(result.items).toEqual(
      expect.arrayContaining([
        { path: folder, bytes: 5, files: 1, folders: 1, skipped: 0 },
        { path: empty, bytes: 0, files: 0, folders: 1, skipped: 0 },
        { path: file, bytes: 3, files: 1, folders: 0, skipped: 0 },
      ]),
    );
  });
  it('measures hidden files, preserves files and prunes overlapping selections without following links', async () => {
    const root = await temporary();
    const folder = path.join(root, 'folder');
    const child = path.join(folder, 'child');
    await mkdir(child, { recursive: true });
    await writeFile(path.join(folder, 'a'), 'abc');
    await writeFile(path.join(child, '.hidden'), '12345');
    await writeFile(path.join(root, 'outside'), 'x'.repeat(10000));
    const link = path.join(folder, 'outside-link');
    await symlink(path.join(root, 'outside'), link);
    await symlink(folder, path.join(child, 'loop'));
    const expected = 8 + (await lstat(link)).size + (await lstat(path.join(child, 'loop'))).size;
    const { result } = await measure([folder, child, path.join(child, '.hidden'), folder]);
    expect(result).toMatchObject({
      status: 'completed',
      bytes: expected,
      folders: 2,
      files: 4,
      skipped: 0,
    });
    expect(await readFile(path.join(root, 'outside'), 'utf8')).toBe('x'.repeat(10000));
    expect(await readFile(path.join(folder, 'a'), 'utf8')).toBe('abc');
  });
  it('distinguishes a measured empty folder from a missing or unreadable result', async () => {
    const root = await temporary();
    expect((await measure([root])).result).toMatchObject({
      status: 'completed',
      bytes: 0,
      skipped: 0,
    });
    expect((await measure([path.join(root, 'missing')])).result).toMatchObject({
      status: 'completed',
      bytes: 0,
      skipped: 1,
    });
  });
  it.skipIf(process.getuid?.() === 0)('marks permission failures as partial', async () => {
    const root = await temporary();
    const locked = path.join(root, 'locked');
    await mkdir(locked);
    await writeFile(path.join(locked, 'private'), 'contents');
    await chmod(locked, 0);
    try {
      expect((await measure([locked])).result).toMatchObject({ status: 'completed', skipped: 1 });
    } finally {
      await chmod(locked, 0o700);
    }
  });
  it('cancels promptly without reading or modifying contents', async () => {
    const root = await temporary();
    await writeFile(path.join(root, 'source'), 'unchanged');
    expect((await measure([root], true)).result.status).toBe('cancelled');
    expect(await readFile(path.join(root, 'source'), 'utf8')).toBe('unchanged');
  });
  it('shares repeated requests, bounds concurrent scans and cancels all owned work on close', async () => {
    const root = await temporary();
    const folders = ['a', 'b', 'c'].map((name) => path.join(root, name));
    for (const folder of folders) {
      await mkdir(folder);
      await writeFile(path.join(folder, 'source'), 'unchanged');
    }
    const sizes = new FolderSizes(() => {});
    const first = sizes.start([folders[0]]);
    expect(sizes.start([folders[0], folders[0]]).id).toBe(first.id);
    const second = sizes.start([folders[1]]);
    expect(() => sizes.start([folders[2]])).toThrow('Finish or cancel');
    sizes.close();
    await vi.waitFor(() => {
      expect(sizes.get(first.id).status).toBe('cancelled');
      expect(sizes.get(second.id).status).toBe('cancelled');
    });
    for (const folder of folders)
      expect(await readFile(path.join(folder, 'source'), 'utf8')).toBe('unchanged');
  });
});
describe('native application adapter', () => {
  it.skipIf(process.platform !== 'darwin')(
    'validates discovered choices and retains opaque IDs across discovery',
    async () => {
      const root = await temporary();
      const app = path.join(root, 'Fixture.app');
      await mkdir(app);
      const file = path.join(root, 'source.txt');
      await writeFile(file, 'read only');
      const list = vi.fn(async () => ({
        applications: [
          { path: app, name: 'Fixture', default: true },
          { path: path.join(root, 'Missing.app'), name: 'Missing', default: false },
          { path: file, name: 'Ordinary file', default: false },
        ],
        defaultName: 'Fixture',
      }));
      const applications = new Applications('helper', { list, open: vi.fn(async () => {}) });
      const first = await applications.list([file]);
      expect(first).toMatchObject({
        supported: true,
        defaultName: 'Fixture',
        applications: [{ name: 'Fixture', default: true }],
      });
      expect(first.applications).toHaveLength(1);
      expect(first.applications[0].id).not.toBe(app);
      expect((await applications.list([file])).applications[0].id).toBe(first.applications[0].id);
      expect(list).toHaveBeenCalledWith('helper', [file]);
      expect(await readFile(file, 'utf8')).toBe('read only');
    },
  );
  it('returns opaque application IDs and opens captured literal paths through the selected app', async () => {
    const root = await temporary();
    const app = path.join(root, 'Fixture.app');
    await mkdir(app);
    const file = path.join(root, 'quotes " and $(literal);.txt');
    await writeFile(file, 'read only');
    const open = vi.fn(async () => {});
    const applications = new Applications('helper', {
      list: vi.fn(async () => ({
        applications: [{ path: app, name: 'Fixture', default: true }],
        defaultName: 'Fixture',
      })),
      open,
    });
    const choice = await applications.register(app, 'Fixture');
    expect(choice.id).not.toBe(app);
    await applications.open([file], choice.id);
    expect(open).toHaveBeenCalledWith(
      await import('node:fs/promises').then((fs) => fs.realpath(app)),
      [file],
    );
    expect(await readFile(file, 'utf8')).toBe('read only');
    await expect(applications.open([file], 'unknown')).rejects.toThrow(
      'Choose the application again',
    );
  });
  it('rejects ordinary executables and applications removed after selection', async () => {
    const root = await temporary();
    const file = path.join(root, 'plain');
    await writeFile(file, 'contents');
    const open = vi.fn(async () => {});
    const applications = new Applications('helper', { list: vi.fn(), open });
    await expect(applications.register(file)).rejects.toThrow('application bundle');
    const app = path.join(root, 'Fixture.app');
    await mkdir(app);
    const choice = await applications.register(app);
    await trashFixtureEntry(app);
    await expect(applications.open([file], choice.id)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});
