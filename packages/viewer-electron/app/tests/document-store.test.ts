import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type * as FileSystem from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as review from '../src/desktop/native/reviewed-file';
import * as directorySync from '../src/desktop/persistence/directory-sync';
import { deferred } from './support/deferred';
import { DocumentStore } from '../src/desktop/persistence/document-store';
import { PermissionStore } from '../src/desktop/persistence/permission-store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FileSystem>();
  return { ...fs, mkdir: vi.fn(fs.mkdir), open: vi.fn(fs.open) };
});

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-documents-');
});
afterEach(async () => {
  await trashTemporary(root);
});
const parse = (value: unknown): { version: 1; value: string } => {
  const record = value as { version: unknown; value: unknown };
  if (record.version !== 1 || typeof record.value !== 'string') throw new Error('Invalid document');
  return { version: 1, value: record.value };
};
describe('private application documents', () => {
  it('serializes updates, retains private permissions, and preserves the last valid document', async () => {
    const file = path.join(root, 'private.json'),
      store = new DocumentStore(file, parse);
    await Promise.all(['one', 'two', 'three'].map((value) => store.save({ version: 1, value })));
    expect(await store.load()).toEqual({ version: 1, value: 'three' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(() => store.save({ version: 2, value: 'invalid' } as never)).toThrow('Invalid document');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, value: 'three' });
  });
  it('rejects oversized sparse documents before allocating their contents', async () => {
    const file = path.join(root, 'large.json');
    await writeFile(file, '{}');
    await truncate(file, 128 * 1024 * 1024);
    await expect(new DocumentStore(file, parse).load()).rejects.toThrow('exceeds its limit');
  });
  it('refuses symlink documents instead of reading another file', async () => {
    const target = path.join(root, 'other.json'),
      file = path.join(root, 'private.json');
    await writeFile(target, JSON.stringify({ version: 1, value: 'other' }));
    await symlink(target, file);
    await expect(new DocumentStore(file, parse).load()).rejects.toMatchObject({ code: 'ELOOP' });
    expect(JSON.parse(await readFile(target, 'utf8')).value).toBe('other');
  });
});

it('reads the previous document after a queued save failed', async () => {
  const store = new DocumentStore(path.join(root, 'private.json'), parse);
  const original = { version: 1 as const, value: 'original' };
  await store.save(original);
  await chmod(root, 0o500);
  try {
    await expect(store.save({ ...original, value: 'replacement' })).rejects.toThrow();
  } finally {
    await chmod(root, 0o700);
  }
  await expect(store.load()).resolves.toEqual(original);
  await expect(store.flush()).rejects.toThrow();
});

it('accepts only one overlapping save from a shared revision', async () => {
  const file = path.join(root, 'shared.json');
  const stores = [new DocumentStore(file, parse), new DocumentStore(file, parse)];
  await writeFile(file, JSON.stringify({ version: 1, value: 'base' }));
  const { revision } = await stores[0]!.loadSnapshot();
  const inspect = review.inspectReviewedFile;
  const entered = deferred();
  const release = deferred();
  const delay = vi.spyOn(review, 'inspectReviewedFile').mockImplementationOnce(async (...args) => {
    const read = await inspect(...args);
    entered.resolve();
    await release.promise;
    return read;
  });
  try {
    const first = stores[0]!.save({ version: 1, value: 'edit-0' }, revision);
    await entered.promise;
    const second = stores[1]!.save({ version: 1, value: 'edit-1' }, revision);
    release.resolve();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await stores[0]!.load())?.value).toBe(
      'edit-' + results.findIndex((result) => result.status === 'fulfilled'),
    );
  } finally {
    delay.mockRestore();
  }
});

it('preserves the actual bytes displaced by an uncoordinated replacement', async () => {
  const file = path.join(root, 'shared.json');
  const store = new DocumentStore(file, parse);
  await writeFile(file, JSON.stringify({ version: 1, value: 'base' }));
  const { revision } = await store.loadSnapshot();
  const inspected = review.inspectReviewedFile;
  const newer = '{"version":2,"value":"newer writer"}';
  const replace = vi
    .spyOn(review, 'inspectReviewedFile')
    .mockImplementationOnce(async (...args) => {
      const current = await inspected(...args);
      await writeFile(file, newer);
      return current;
    });
  try {
    await expect(store.save({ version: 1, value: 'my edit' }, revision)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(newer);
  } finally {
    replace.mockRestore();
  }
});

it('keeps both entries if another writer fills the name during publication', async () => {
  const file = path.join(root, 'overlap.json');
  const original = JSON.stringify({ version: 1, value: 'old title' }),
    newer = '{"version":2}';
  await writeFile(file, original);
  const store = new DocumentStore(file, parse),
    { revision } = await store.loadSnapshot();
  const inspect = review.inspectReviewedFile;
  const fill = vi.spyOn(review, 'inspectReviewedFile').mockImplementation(async (...args) => {
    const result = await inspect(...args);
    if (args[0] !== file) await writeFile(file, newer, { flag: 'wx' });
    return result;
  });
  try {
    await expect(store.save({ version: 1, value: 'new title' }, revision)).rejects.toThrow(
      'displaced file',
    );
    expect(await readFile(file, 'utf8')).toBe(newer);
    const recovery = (await readdir(root)).find((name) =>
      name.startsWith('overlap.json.publishing-'),
    );
    expect(await readFile(path.join(root, recovery!), 'utf8')).toBe(original);
  } finally {
    fill.mockRestore();
  }
});
it('refuses to initialize an absent document while interrupted bytes need recovery', async () => {
  const file = path.join(root, 'missing.json'),
    recovery = file + '.publishing-17593d56-e8a6-42dd-956e-f6c0cf527141';
  await writeFile(recovery, '{"version":2}');
  const store = new DocumentStore(file, parse);
  await expect(store.loadSnapshot()).rejects.toThrow('interrupted metadata');
  await expect(store.save({ version: 1, value: 'initial' }, null)).rejects.toThrow(
    'interrupted metadata',
  );
  expect(await readFile(recovery, 'utf8')).toBe('{"version":2}');
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['load', 'loadSnapshot'] as const)(
  'restores one verified predecessor on %s',
  async (read) => {
    const file = path.join(root, 'private.json');
    const kept = file + '.publishing-' + crypto.randomUUID();
    const value = { version: 1 as const, value: 'last saved' };
    const bytes = JSON.stringify(value, null, 2);
    await writeFile(kept, bytes, { mode: 0o600 });
    const store = new DocumentStore(file, parse);
    if (process.platform !== 'darwin') {
      await expect(store[read]()).rejects.toThrow('interrupted metadata');
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(kept, 'utf8')).toBe(bytes);
      return;
    }
    await expect(store[read]()).resolves.toEqual(
      read === 'load' ? value : { value, revision: expect.any(String) },
    );
    const backup = (await readdir(root)).find((name) => name.endsWith('.bak'))!;
    expect((await stat(file, { bigint: true })).ino).toBe(
      (await stat(path.join(root, backup), { bigint: true })).ino,
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const { revision } = await store.loadSnapshot();
    await store.save({ ...value, value: 'next' }, revision);
    const history = (await readdir(root)).find((name) => name.startsWith('private.json.history-'))!;
    expect(await readFile(path.join(root, history, path.basename(kept)), 'utf8')).toBe(bytes);
    expect(await readFile(path.join(root, backup), 'utf8')).toBe(bytes);
    expect((await store.load())?.value).toBe('next');
  },
);

it('leaves ambiguous, linked and oversized recovery files in place', async () => {
  const value = JSON.stringify({ version: 1, value: 'kept' });
  for (const kind of ['multiple', 'symlink', 'oversized']) {
    const file = path.join(root, kind + '.json');
    const kept = file + '.publishing-' + crypto.randomUUID();
    if (kind === 'symlink') {
      const target = path.join(root, 'target');
      await writeFile(target, value);
      await symlink(target, kept);
    } else {
      await writeFile(kept, value);
      if (kind === 'multiple') await writeFile(file + '.publishing-' + crypto.randomUUID(), value);
    }
    const store = new DocumentStore(file, parse, kind === 'oversized' ? 4 : 100);
    await expect(store.load()).rejects.toThrow('interrupted metadata');
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(kept, 'utf8')).toBe(value);
  }
});

it('reads an occupied current name without restoring a predecessor', async () => {
  const file = path.join(root, 'private.json');
  const kept = file + '.publishing-' + crypto.randomUUID();
  const current = { version: 1, value: 'current' };
  await writeFile(file, JSON.stringify(current));
  await writeFile(kept, JSON.stringify({ ...current, value: 'older' }));
  await expect(new DocumentStore(file, parse).load()).resolves.toEqual(current);
  expect((await stat(file)).ino).not.toBe((await stat(kept)).ino);
});

it.each(['directory', 'symlink'])(
  'preserves a %s in a publication slot during save',
  async (kind) => {
    const file = path.join(root, 'state.json');
    const store = new DocumentStore(file, parse);
    const value = { version: 1 as const, value: 'current' };
    await store.save(value);
    const { revision } = await store.loadSnapshot();
    const kept = file + '.publishing-' + crypto.randomUUID();
    const notes = path.join(root, 'notes');
    if (kind === 'directory') await mkdir(kept);
    else await symlink(notes, kept);
    const content = kind === 'directory' ? path.join(kept, 'notes') : notes;
    await writeFile(content, 'preserve these notes');
    if (process.platform === 'darwin') {
      await expect(store.save({ ...value, value: 'next' }, revision)).rejects.toThrow(
        path.basename(kept),
      );
      expect(await store.loadSnapshot()).toEqual({ value, revision });
    }
    expect((await lstat(kept)).isDirectory()).toBe(kind === 'directory');
    expect(await readFile(content, 'utf8')).toBe('preserve these notes');
  },
);

it('keeps a current file that appears while the predecessor is being verified', async () => {
  const file = path.join(root, 'private.json');
  const kept = file + '.publishing-' + crypto.randomUUID();
  const current = { version: 1, value: 'concurrent' };
  const older = JSON.stringify({ ...current, value: 'older' });
  await writeFile(kept, older);
  const inspect = review.inspectReviewedFile;
  using inspected = vi
    .spyOn(review, 'inspectReviewedFile')
    .mockImplementationOnce(async (...args) => {
      const result = await inspect(...args);
      await writeFile(file, JSON.stringify(current), { flag: 'wx' });
      return result;
    });
  const read = new DocumentStore(file, parse).load();
  if (process.platform === 'darwin') {
    await expect(read).resolves.toEqual(current);
    expect(inspected).toHaveBeenCalledWith(kept, expect.any(Number));
  } else {
    await expect(read).rejects.toThrow('interrupted metadata');
    expect(inspected).not.toHaveBeenCalled();
  }
  expect(await readFile(kept, 'utf8')).toBe(older);
});

it.each(['intact', 'changed history', 'changed matching pair'])(
  'checks a file-by-file profile copy with %s before the next revisioned save',
  async (condition) => {
    const source = path.join(root, 'source');
    const copy = path.join(root, 'copy');
    await mkdir(source);
    const file = path.join(source, 'state.json');
    const generation = crypto.randomUUID();
    const name = 'state.json.publishing-' + generation;
    const value = { version: 1 as const, value: 'original' };
    await writeFile(path.join(source, name), JSON.stringify(value), { mode: 0o600 });
    const originalStore = new DocumentStore(file, parse);
    if (process.platform !== 'darwin') {
      await expect(originalStore.load()).rejects.toThrow('interrupted metadata');
      return;
    }
    expect(await originalStore.load()).toEqual(value);
    await cp(source, copy, { recursive: true, errorOnExist: true, force: false });
    const previous = path.join(copy, name);
    const archived = path.join(copy, 'state.json.history-' + generation, name);
    expect((await stat(previous, { bigint: true })).ino).not.toBe(
      (await stat(archived, { bigint: true })).ino,
    );
    const copiedStore = new DocumentStore(path.join(copy, 'state.json'), parse);
    const current = await copiedStore.loadSnapshot();
    expect(current.value).toEqual(value);
    const next = { ...value, value: 'updated' };
    if (condition === 'intact') {
      await copiedStore.save(next, current.revision);
      expect(await copiedStore.load()).toEqual(next);
      expect(await originalStore.load()).toEqual(value);
    } else {
      const changed = JSON.stringify({ ...value, value: 'modified' });
      await writeFile(archived, changed);
      if (condition === 'changed matching pair') await writeFile(previous, changed);
      await expect(copiedStore.save(next, current.revision)).rejects.toThrow('interrupted metadata');
      expect(await copiedStore.loadSnapshot()).toEqual(current);
      expect(await readFile(archived, 'utf8')).toBe(changed);
      expect(await readFile(previous, 'utf8')).toBe(
        condition === 'changed matching pair' ? changed : JSON.stringify(value),
      );
    }
  },
);

it('returns restored permissions on the first read when history creation fails', async () => {
  const file = path.join(root, 'permissions.json');
  const previous = file + '.publishing-' + crypto.randomUUID();
  const value = { version: 1 as const, value: 'saved grant' };
  await writeFile(previous, JSON.stringify(value));
  const store = new PermissionStore(file, parse);
  if (process.platform !== 'darwin') {
    await expect(store.load()).resolves.toBeNull();
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    return;
  }
  using warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(mkdir).mockRejectedValueOnce(new Error('Cannot create history'));
  await expect(store.load()).resolves.toEqual(value);
  expect(warning).toHaveBeenCalledOnce();
  expect(await readFile(previous, 'utf8')).toBe(JSON.stringify(value));
  const next = { ...value, value: 'changed grant' };
  vi.mocked(mkdir)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Still unavailable'));
  await expect(store.save(next)).rejects.toThrow('interrupted metadata');
  expect(await readFile(file, 'utf8')).toBe(JSON.stringify(value));
  await store.save(next);
  expect(await store.load()).toEqual(next);
  const history = (await readdir(root)).find((name) =>
    name.startsWith('permissions.json.history-'),
  )!;
  expect(await readFile(path.join(root, history, path.basename(previous)), 'utf8')).toBe(
    JSON.stringify(value),
  );
});

it('recovers in a fresh reader after repeated short snapshot writes', async () => {
  const file = path.join(root, 'state.json');
  const previous = file + '.publishing-' + crypto.randomUUID();
  const value = { version: 1 as const, value: 'last saved' };
  const original = Buffer.from(JSON.stringify(value));
  await writeFile(previous, original, { mode: 0o600 });
  if (process.platform !== 'darwin') {
    await expect(new DocumentStore(file, parse).load()).rejects.toThrow('interrupted metadata');
    return;
  }
  const fs = await vi.importActual<typeof FileSystem>('node:fs/promises');
  let writes = 0;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await fs.open(...args);
    if (String(args[0]).includes('.recovery-')) {
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async (data) => {
        await handle.write((data as Buffer).subarray(0, 1));
        writes++;
        throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
      });
    }
    return handle;
  });
  try {
    let firstEntries: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(new DocumentStore(file, parse).load()).rejects.toThrow('interrupted metadata');
      await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(previous)).toEqual(original);
      const entries = (await readdir(root)).sort();
      if (attempt === 1) firstEntries = entries;
      expect(entries).toEqual(firstEntries);
    }
  } finally {
    vi.mocked(open).mockImplementation(fs.open);
  }
  const store = new DocumentStore(file, parse);
  const snapshot = await store.loadSnapshot();
  expect(snapshot.value).toEqual(value);
  expect(writes).toBe(3);
  expect(await readFile(file)).toEqual(original);
  await store.save({ ...value, value: 'next' }, snapshot.revision);
});

it.each(['', '{'])('preserves a partial fixed backup containing %j while restoring the store', async (prefix) => {
  const file = path.join(root, 'state.json');
  const generation = crypto.randomUUID();
  const previous = file + '.publishing-' + generation;
  const backup = file + '.recovery-' + generation + '.bak';
  const value = { version: 1 as const, value: 'complete' };
  await writeFile(previous, JSON.stringify(value), { mode: 0o600 });
  await writeFile(backup, prefix, { mode: 0o600 });
  const store = new DocumentStore(file, parse);
  if (process.platform === 'darwin') {
    expect(await store.load()).toEqual(value);
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify(value));
  } else {
    await expect(store.load()).rejects.toThrow('interrupted metadata');
  }
  expect(await readFile(backup, 'utf8')).toBe(prefix);
  expect(await readFile(previous, 'utf8')).toBe(JSON.stringify(value));
});

it('reuses one private snapshot across failed directory syncs and a successful retry', async () => {
  const file = path.join(root, 'state.json');
  const previous = file + '.publishing-' + crypto.randomUUID();
  const value = { version: 1 as const, value: 'last saved' };
  const store = new DocumentStore(file, parse);
  await writeFile(previous, JSON.stringify(value));
  const backups = async () => (await readdir(root)).filter((name) => name.endsWith('.bak'));
  const sync = vi
    .spyOn(directorySync, 'syncParentDirectory')
    .mockRejectedValue(new Error('Disk unavailable'));
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(store.loadSnapshot()).rejects.toThrow('interrupted metadata');
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await backups()).toHaveLength(process.platform === 'darwin' ? 1 : 0);
    }
  } finally {
    sync.mockRestore();
  }
  if (process.platform !== 'darwin') return;
  const [backup] = await backups();
  const identity = (await stat(path.join(root, backup!), { bigint: true })).ino;
  await expect(store.load()).resolves.toEqual(value);
  expect((await stat(file, { bigint: true })).ino).toBe(identity);
  expect(await backups()).toEqual([backup]);
});

it.each(['public', 'alias', 'shared', 'different', 'symlink'])(
  'preserves an occupied %s recovery snapshot and leaves the current name vacant',
  async (kind) => {
    const file = path.join(root, 'state.json');
    const generation = crypto.randomUUID();
    const previous = file + '.publishing-' + generation;
    const backup = file + '.recovery-' + generation + '.bak';
    const original = JSON.stringify({ version: 1, value: 'last saved' });
    await writeFile(previous, original, { mode: 0o600 });
    if (kind === 'alias') await link(previous, backup);
    else if (kind === 'symlink') await symlink(previous, backup);
    else {
      await writeFile(backup, kind === 'different' ? '{}' : original, { mode: 0o600 });
      if (kind === 'public') await chmod(backup, 0o644);
      if (kind === 'shared') await link(backup, path.join(root, 'separate-file'));
    }
    await expect(new DocumentStore(file, parse).load()).rejects.toThrow('interrupted metadata');
    await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(backup, 'utf8')).toBe(kind === 'different' ? '{}' : original);
  },
);

it('resumes a verified recovery with an independently named backup', async () => {
  const file = path.join(root, 'state.json');
  const previous = file + '.publishing-' + crypto.randomUUID();
  const backup = file + '.recovery-' + crypto.randomUUID() + '.bak';
  const value = { version: 1, value: 'last saved' };
  await writeFile(previous, JSON.stringify(value));
  await writeFile(backup, JSON.stringify(value), { mode: 0o600 });
  await link(backup, previous + '.verifying');
  const store = new DocumentStore(file, parse);
  if (process.platform !== 'darwin') {
    await expect(store.loadSnapshot()).rejects.toThrow('interrupted metadata');
    return;
  }
  await expect(store.load()).resolves.toEqual(value);
  expect((await stat(file, { bigint: true })).ino).toBe((await stat(backup, { bigint: true })).ino);
});

it('keeps a changed predecessor out of the current name on this read and the next', async () => {
  const file = path.join(root, 'permissions.json');
  const previous = file + '.publishing-' + crypto.randomUUID();
  const original = JSON.stringify({ version: 1, value: 'first' });
  const rival = JSON.stringify({ version: 1, value: 'changed' });
  await writeFile(previous, original);
  const inspect = review.inspectReviewedFile;
  using changed = vi
    .spyOn(review, 'inspectReviewedFile')
    .mockImplementationOnce(async (...args) => {
      const read = await inspect(...args);
      await writeFile(previous, rival);
      return read;
    });
  await expect(new DocumentStore(file, parse).loadSnapshot()).rejects.toThrow(
    'interrupted metadata',
  );
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(new DocumentStore(file, parse).load()).rejects.toThrow('interrupted metadata');
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  if (process.platform === 'darwin') {
    expect(await readFile(previous, 'utf8')).toBe(rival);
    expect(await readFile(previous + '.verifying', 'utf8')).toBe(original);
    expect(changed).toHaveBeenCalled();
  } else {
    expect(await readFile(previous, 'utf8')).toBe(original);
    expect(changed).not.toHaveBeenCalled();
  }
});

it('restores the correct generation on two successive interrupted updates', async () => {
  const file = path.join(root, 'permissions.json');
  const store = new DocumentStore(file, parse);
  for (const value of ['first', 'second']) {
    const snapshot = await store.loadSnapshot();
    await store.save({ version: 1, value }, snapshot.revision);
    const kept = file + '.publishing-' + crypto.randomUUID();
    await rename(file, kept);
    if (process.platform !== 'darwin') {
      await expect(store.loadSnapshot()).rejects.toThrow('interrupted metadata');
      expect(await readFile(kept, 'utf8')).toBe(JSON.stringify({ version: 1, value }));
      return;
    }
    expect((await store.loadSnapshot()).value?.value).toBe(value);
  }
  const bytes = await Promise.all(
    (await readdir(root))
      .filter((name) => name.endsWith('.bak'))
      .map((name) => readFile(path.join(root, name), 'utf8')),
  );
  for (const value of ['first', 'second'])
    expect(bytes).toContain(JSON.stringify({ version: 1, value }));
});

it('keeps an unfinished recovery visible when only its verification copy remains', async () => {
  const file = path.join(root, 'permissions.json');
  const witness = file + '.publishing-' + crypto.randomUUID() + '.verifying';
  const value = { version: 1 as const, value: 'original' };
  await writeFile(witness, JSON.stringify(value));
  const store = new DocumentStore(file, parse);
  await expect(store.loadSnapshot()).rejects.toThrow('interrupted metadata');
  await expect(store.save(value, null)).rejects.toThrow('interrupted metadata');
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(witness, 'utf8')).toBe(JSON.stringify(value));
});

it.each(['linux', 'win32'] as const)(
  'a %s reader leaves the publication gap to the active writer',
  async (platform) => {
    const file = path.join(root, 'race.json');
    const store = new DocumentStore(file, parse);
    await store.save({ version: 1, value: 'old' });
    const { revision } = await store.loadSnapshot();
    const inspect = review.inspectReviewedFile;
    let observation = '';
    using watched = vi.spyOn(review, 'inspectReviewedFile').mockImplementation(async (...args) => {
      const current = await inspect(...args);
      if (args[0].includes('.publishing-')) {
        const program = `
        import { DocumentStore } from './src/desktop/persistence/document-store.ts';
        Object.defineProperty(process, 'platform', { value: process.argv[2] });
        const reader = new DocumentStore(process.argv[1], value => value);
        try { console.log(JSON.stringify(await reader.loadSnapshot())); }
        catch (error) { console.log(error.message); }
      `;
        observation = (
          await promisify(execFile)(process.execPath, [
            '--import',
            'tsx',
            '--input-type=module',
            '--eval',
            program,
            file,
            platform,
          ])
        ).stdout;
      }
      return current;
    });
    const finished = store.save({ version: 1, value: 'new' }, revision);
    await expect(finished).resolves.toBeUndefined();
    expect(observation).toContain('interrupted metadata');
    expect((await store.load())?.value).toBe('new');
    expect(watched).toHaveBeenCalled();
  },
);

it('publishes the inspected bytes when the predecessor changes after the final check', async () => {
  const file = path.join(root, 'state.json');
  const previous = file + '.publishing-' + crypto.randomUUID();
  const original = { version: 1, value: 'inspected' };
  await writeFile(previous, JSON.stringify(original));
  const verify = review.verifyReviewedFile;
  using changed = vi.spyOn(review, 'verifyReviewedFile').mockImplementationOnce(async (...args) => {
    await verify(...args);
    await writeFile(previous, '{"version":2}');
  });
  const store = new DocumentStore(file, parse);
  if (process.platform === 'darwin') {
    await expect(store.loadSnapshot()).resolves.toMatchObject({ value: original });
    expect(await readFile(file, 'utf8')).toBe(JSON.stringify(original));
    await expect(store.load()).resolves.toEqual(original);
    const history = (await readdir(root)).find((name) => name.startsWith('state.json.history-'))!;
    expect(await readFile(path.join(root, history, path.basename(previous)), 'utf8')).toBe(
      '{"version":2}',
    );
    expect(changed).toHaveBeenCalledOnce();
  } else {
    await expect(store.loadSnapshot()).rejects.toThrow('interrupted metadata');
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(changed).not.toHaveBeenCalled();
  }
});
