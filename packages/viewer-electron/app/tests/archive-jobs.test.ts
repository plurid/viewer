import { afterEach, beforeEach, expect, it } from 'vitest';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  createArchive,
  extractArchive,
  unwrapped,
  type ArchiveWork,
} from '../src/desktop/operations/archive-jobs';
import { Archives } from '../src/desktop/previews/archives';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
const work = (): ArchiveWork => ({
  signal: new AbortController().signal,
  access: async () => {},
  progress: () => {},
});
beforeEach(async () => {
  root = await temporaryRoot('viewer-archive-job-');
});
afterEach(async () => {
  await trashTemporary(root);
});
it('streams folders and Unicode files into ZIP and safely extracts them', async () => {
  const source = path.join(root, 'Résumé'),
    file = path.join(source, 'notes.txt'),
    archive = path.join(root, 'notes.zip'),
    destination = path.join(root, 'extracted');
  await mkdir(source);
  await writeFile(file, 'Notes '.repeat(100000));
  await createArchive([source], archive, work());
  expect((await lstat(archive)).size).toBeLessThan((await lstat(file)).size);
  expect((await new Archives().list(archive)).entries.map((entry) => entry.name)).toEqual([
    'Résumé/',
    'Résumé/notes.txt',
  ]);
  await extractArchive(archive, destination, work());
  // one folder holding everything: its contents are the output, never a folder inside a folder
  expect(await readFile(path.join(destination, 'notes.txt'), 'utf8')).toBe(
    await readFile(file, 'utf8'),
  );
});
it('keeps several top-level items and a lone file, and leaves out macOS resource forks', () => {
  const entry = (name: string, directory = false) => ({ name, directory });
  const names = (entries: { name: string }[]) => entries.map((item) => item.name);
  expect(
    names(unwrapped([entry('Photos', true), entry('Photos/a.jpg'), entry('Photos/b.jpg')])),
  ).toEqual(['a.jpg', 'b.jpg']);
  // implied by its entries alone, as many ZIP tools write it
  expect(names(unwrapped([entry('Photos/a.jpg'), entry('Photos/sub/b.jpg')]))).toEqual([
    'a.jpg',
    'sub/b.jpg',
  ]);
  expect(names(unwrapped([entry('a.txt'), entry('b.txt')]))).toEqual(['a.txt', 'b.txt']);
  expect(names(unwrapped([entry('report.pdf')]))).toEqual(['report.pdf']);
  expect(
    names(
      unwrapped([entry('Photos/a.jpg'), entry('__MACOSX', true), entry('__MACOSX/Photos/._a.jpg')]),
    ),
  ).toEqual(['a.jpg']);
});
it('rejects traversal before creating any extraction output', async () => {
  const archive = path.join(root, 'unsafe.zip'),
    destination = path.join(root, 'out');
  await writeFile(
    archive,
    zipSync({ '../escape.txt': strToU8('escape'), 'safe.txt': strToU8('safe') }),
  );
  await expect(extractArchive(archive, destination, work())).rejects.toThrow('unsafe');
  await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(lstat(path.join(root, 'escape.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects case-colliding names and file/folder conflicts', async () => {
  const cases: Zippable[] = [
    { 'A.txt': strToU8('one'), 'a.txt': strToU8('two') },
    { a: strToU8('file'), 'a/child': strToU8('child') },
  ];
  for (const entries of cases) {
    const archive = path.join(root, 'conflict.zip');
    await writeFile(archive, zipSync(entries));
    await expect(extractArchive(archive, path.join(root, 'out'), work())).rejects.toThrow(
      /conflict/,
    );
  }
});
it('cancels before creating an archive and leaves the sources intact', async () => {
  const source = path.join(root, 'source');
  await writeFile(source, 'original');
  const controller = new AbortController();
  controller.abort();
  await expect(
    createArchive([source], path.join(root, 'cancelled.zip'), {
      ...work(),
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  await expect(lstat(path.join(root, 'cancelled.zip'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(source, 'utf8')).toBe('original');
});
it('rejects an expanded ZIP entry above its limit before allocating its data', async () => {
  const archive = path.join(root, 'oversized.zip');
  const data = Buffer.from(zipSync({ 'huge.txt': strToU8('tiny') }));
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  data.writeUInt32LE(33 * 1024 * 1024, central + 24);
  await writeFile(archive, data);
  await expect(extractArchive(archive, path.join(root, 'out'), work())).rejects.toThrow('32 MB');
  await expect(lstat(path.join(root, 'out'))).rejects.toMatchObject({ code: 'ENOENT' });
});
