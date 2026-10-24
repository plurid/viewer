import { readFile, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
