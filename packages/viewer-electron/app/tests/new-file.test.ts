import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OperationJob, OperationRequest } from '../src/domain/contracts';
import { Operations } from '../src/desktop/operations';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, trash: string, operations: Operations;
beforeEach(async () => {
  root = await temporaryRoot('viewer-new-file-');
  trash = path.join(root, 'trash');
  await mkdir(trash);
  operations = new Operations(
    async (file) => {
      await rename(file, path.join(trash, path.basename(file) + '-' + crypto.randomUUID()));
    },
    () => undefined,
  );
});
afterEach(async () => {
  await operations.close();
  await trashTemporary(root);
});
const job = (id: string) => operations.all().find((item) => item.id === id)!;
async function settle(id: string, status: OperationJob['status'][]) {
  await vi.waitFor(() => expect(status).toContain(job(id)?.status), {
    timeout: 10000,
    interval: 10,
  });
  return job(id);
}
const create = (name: string): OperationRequest => ({
  kind: 'mkfile',
  sources: [],
  destination: root,
  name,
});

describe('new file', () => {
  it('creates an empty file that Undo moves to the Trash', async () => {
    const id = operations.start(create('notes.txt'));
    expect((await settle(id, ['completed'])).undoable).toBe(true);
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('');
    await operations.undo(id);
    expect(await readdir(root)).not.toContain('notes.txt');
    expect(await readdir(trash)).toHaveLength(1);
  });
  it('never replaces an existing item: it keeps both or skips', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'kept');
    const id = operations.start(create('notes.txt'));
    await settle(id, ['collision']);
    expect(job(id).collision?.replaceable).toBe(false);
    operations.resolve(id, 'replace', false);
    expect((await settle(id, ['failed'])).errors[0].message).toContain('cannot replace');
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('kept');
    const both = operations.start(create('notes.txt'));
    await settle(both, ['collision']);
    operations.resolve(both, 'keep-both', false);
    await settle(both, ['completed']);
    expect(await readFile(path.join(root, 'notes copy.txt'), 'utf8')).toBe('');
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('kept');
  });
  it('needs a name and a folder', () => {
    expect(() => operations.start({ ...create(''), name: undefined })).toThrow('file name');
    expect(() => operations.start({ ...create('a.txt'), destination: undefined })).toThrow(
      'destination folder',
    );
  });
});
