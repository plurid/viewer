import { chmod, readFile, readdir, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as review from '../src/desktop/native/reviewed-file';
import { DocumentStore } from '../src/desktop/persistence/document-store';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

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
  const delay = vi.spyOn(review, 'inspectReviewedFile').mockImplementation(async (...args) => {
    const read = await inspect(...args);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return read;
  });
  try {
    const results = await Promise.allSettled(
      stores.map((store, i) => store.save({ version: 1, value: 'edit-' + i }, revision)),
    );
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
