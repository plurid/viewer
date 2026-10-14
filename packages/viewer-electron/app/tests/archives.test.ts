import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { Archives } from '../src/desktop/archives';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'viewer-archive-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it.skipIf(process.platform === 'win32')(
  'refuses special archive sources without waiting for a FIFO writer',
  async () => {
    const file = path.join(root, 'Pipe.xlsx');
    await promisify(execFile)('/usr/bin/mkfifo', [file]);
    const archives = new Archives();
    await expect(archives.list(file)).rejects.toThrow('regular file');
    await expect(archives.list(root)).rejects.toThrow('regular file');
  },
);
function tarEntry(name: string, value: Buffer, type = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write('0000644\0', 100);
  header.write(value.length.toString(8).padStart(11, '0') + '\0', 124);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write(
    header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
  );
  return Buffer.concat([header, value, Buffer.alloc((512 - (value.length % 512)) % 512)]);
}
function paxPath(name: string): Buffer {
  const record = `path=${name}\n`;
  let length = Buffer.byteLength(record) + 3;
  for (;;) {
    const text = `${length} ${record}`;
    const actual = Buffer.byteLength(text);
    if (actual === length) return Buffer.from(text);
    length = actual;
  }
}
it('reads Unicode PAX names from TAR and TAR.GZ without extraction', async () => {
  const name = 'Documents/Résumé and project notes.md',
    value = Buffer.from('# Notes');
  const data = Buffer.concat([
    tarEntry('PaxHeader', paxPath(name), 'x'),
    tarEntry('truncated-name', value),
    Buffer.alloc(1024),
  ]);
  const archives = new Archives();
  for (const extension of ['tar', 'tar.gz']) {
    const file = path.join(root, `notes.${extension}`);
    await writeFile(file, extension === 'tar' ? data : gzipSync(data));
    expect((await archives.list(file)).entries.map((entry) => entry.name)).toEqual([name]);
    expect((await archives.read(file, name)).toString()).toBe('# Notes');
    archives.release(file);
  }
});
it('refreshes an index when the archive changes and validates entry integrity', async () => {
  const file = path.join(root, 'notes.zip'),
    archives = new Archives();
  await writeFile(file, zipSync({ 'first.txt': strToU8('first') }));
  expect((await archives.list(file)).entries[0].name).toBe('first.txt');
  const changed = Buffer.from(
    zipSync({ 'second.txt': strToU8('second entry'), 'third.txt': strToU8('third') }, { level: 0 }),
  );
  await writeFile(file, changed);
  expect((await archives.list(file)).entries[0].name).toBe('second.txt');
  const offset = 30 + changed.readUInt16LE(26) + changed.readUInt16LE(28);
  changed[offset] ^= 1;
  await writeFile(file, changed);
  await expect(archives.read(file, 'second.txt')).rejects.toThrow('checksum');
});
it('rejects damaged TAR headers rather than displaying invented files', async () => {
  const file = path.join(root, 'bad.tar');
  const data = tarEntry('note.txt', Buffer.from('note'));
  data[0] ^= 1;
  await writeFile(file, data);
  await expect(new Archives().list(file)).rejects.toThrow('checksum');
});
