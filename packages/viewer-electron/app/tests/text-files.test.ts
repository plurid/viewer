/**
 * EDITING TEXT FILES (2026-10-23). What can be edited where it is, and how a save treats the version
 * it replaces: the first save of an editor session sends it to the Trash, later saves of that session
 * overwrite their own, and a file someone else changed is never overwritten.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Operations } from '../src/desktop/operations';
import { TextFiles } from '../src/desktop/text-files';
import { FileAccessRequired } from '../src/desktop/file-access';
import { textChangedCode, type TextDocument } from '../src/domain/text-documents';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, trash: string, operations: Operations, texts: TextFiles;
const receipts = async (file: string) => {
  const directory = (await lstat(file)).isDirectory(),
    target = path.join(trash, crypto.randomUUID());
  await rename(file, target);
  return { path: target, directory };
};
beforeEach(async () => {
  root = await temporaryRoot('viewer-text-');
  trash = path.join(root, 'trash');
  await mkdir(trash);
  operations = new Operations(receipts, () => {});
  texts = new TextFiles(operations, async () => {});
});
afterEach(async () => {
  await operations.close();
  await trashTemporary(root);
});
const opened = async (file: string): Promise<TextDocument> => {
  const opening = await texts.open(file);
  if (!opening.editable) throw new Error(opening.reason);
  return opening.document;
};
const trashed = async () =>
  Promise.all((await readdir(trash)).map((name) => readFile(path.join(trash, name), 'utf8')));

describe('opening a text file for editing', () => {
  it('reads its text and the version a save is checked against', async () => {
    const file = path.join(root, 'notes.md');
    await writeFile(file, '# Notes\n');
    const document = await opened(file);
    expect(document).toMatchObject({ file, text: '# Notes\n', bom: false });
    expect(document.version.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.version.size).toBe(8);
  });
  it('keeps a byte-order mark out of the text, and puts it back on save', async () => {
    const file = path.join(root, 'bom.txt');
    await writeFile(file, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('one')]));
    const document = await opened(file);
    expect(document).toMatchObject({ text: 'one', bom: true });
    await texts.save(file, 'two', document.version, 'session', true);
    expect([...(await readFile(file)).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect((await readFile(file, 'utf8')).slice(1)).toBe('two');
  });
  it('refuses what a save would damage', async () => {
    const reason = async (file: string) => {
      const opening = await texts.open(file);
      return opening.editable ? '' : opening.reason;
    };
    const latin = path.join(root, 'latin.txt');
    await writeFile(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
    expect(await reason(latin)).toContain('UTF-8');
    const binary = path.join(root, 'data.bin');
    await writeFile(binary, Buffer.from([0x61, 0, 0x62]));
    expect(await reason(binary)).toContain('UTF-8');
    const linked = path.join(root, 'linked.txt');
    await writeFile(linked, 'shared');
    await link(linked, path.join(root, 'other name.txt'));
    expect(await reason(linked)).toContain('hard link');
    const target = path.join(root, 'target.txt'),
      alias = path.join(root, 'alias.txt');
    await writeFile(target, 'text');
    await symlink(target, alias);
    expect(await reason(alias)).toContain('link');
    const locked = path.join(root, 'locked.txt');
    await writeFile(locked, 'text');
    await chmod(locked, 0o444);
    expect(await reason(locked)).toContain('read-only');
    const large = path.join(root, 'large.log');
    await writeFile(large, Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    expect(await reason(large)).toContain('4 MiB');
  });
  it('names the folder to allow when only the file was granted', async () => {
    const file = path.join(root, 'granted.txt');
    await writeFile(file, 'text');
    texts = new TextFiles(operations, async (files) => {
      if (files.includes(root)) throw new FileAccessRequired(root);
    });
    expect(await texts.open(file)).toMatchObject({ editable: false, folder: root });
  });
});

describe('saving an edited text file', () => {
  it("sends the version it replaces to the Trash once, then overwrites the session's own", async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'original');
    const document = await opened(file);
    const first = await texts.save(file, 'first', document.version, 'one', false);
    expect(await readFile(file, 'utf8')).toBe('first');
    expect(await trashed()).toEqual(['original']);
    const second = await texts.save(file, 'second', first, 'one', false);
    expect(await readFile(file, 'utf8')).toBe('second');
    // the session's own first save was overwritten, not sent to the Trash
    expect(await trashed()).toEqual(['original']);
    // another editor session never overwrites what it did not write
    await texts.save(file, 'third', second, 'two', false);
    expect((await trashed()).sort()).toEqual(['original', 'second']);
  });
  it('refuses a file changed since it was read, even after its own save', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'original');
    const document = await opened(file);
    const saved = await texts.save(file, 'mine', document.version, 'one', false);
    await writeFile(file, 'someone else');
    await expect(texts.save(file, 'mine again', saved, 'one', false)).rejects.toMatchObject({
      code: textChangedCode,
    });
    expect(await readFile(file, 'utf8')).toBe('someone else');
    expect(await trashed()).toEqual(['original']);
  });
  it('creates a new file, whose later saves in the session overwrite it', async () => {
    const file = path.join(root, 'Untitled.txt');
    const created = await texts.create(file, 'draft', 'one');
    expect(await readFile(file, 'utf8')).toBe('draft');
    await texts.save(file, 'draft two', created, 'one', false);
    expect(await readFile(file, 'utf8')).toBe('draft two');
    expect(await trashed()).toEqual([]);
  });
  it('forgets a session once its editor closes', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'original');
    const saved = await texts.save(file, 'first', (await opened(file)).version, 'one', false);
    texts.end('one');
    await texts.save(file, 'second', saved, 'one', false);
    expect((await trashed()).sort()).toEqual(['first', 'original']);
  });
});

describe('saving text as a file chosen in the save panel', () => {
  it('creates a new file, or replaces the chosen one by moving it to the Trash', async () => {
    const fresh = path.join(root, 'Fresh.txt');
    await texts.saveAs(fresh, 'new text', 'one');
    expect(await readFile(fresh, 'utf8')).toBe('new text');
    const chosen = path.join(root, 'Existing.bin');
    await writeFile(chosen, Buffer.from([0, 1, 2]));
    const version = await texts.saveAs(chosen, 'replacing text', 'one');
    expect(await readFile(chosen, 'utf8')).toBe('replacing text');
    expect((await readdir(trash)).length).toBe(1);
    // the session's own file now: a further save overwrites it
    await texts.save(chosen, 'edited', version, 'one', false);
    expect((await readdir(trash)).length).toBe(1);
  });
});
