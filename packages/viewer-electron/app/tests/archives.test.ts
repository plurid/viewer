import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32, gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { Archives, zipName } from '../src/desktop/archives';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-archive-');
});
afterEach(async () => {
  await trashTemporary(root);
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
/** A stored ZIP whose names are the given bytes, as an archiver on another platform writes them. */
function storedZip(entries: { name: Buffer; data: Buffer; flags?: number; extra?: Buffer }[]) {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, flags = 0, extra = Buffer.alloc(0) } of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name, extra);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
/** The Info-ZIP Unicode Path extra field (0x7075): the name in UTF-8, for the stored name `raw`. */
function unicodePath(raw: Buffer, name: string, checksum = crc32(raw)) {
  const value = Buffer.from(name, 'utf8');
  const field = Buffer.alloc(9);
  field.writeUInt16LE(0x7075, 0);
  field.writeUInt16LE(5 + value.length, 2);
  field.writeUInt8(1, 4);
  field.writeUInt32LE(checksum, 5);
  return Buffer.concat([field, value]);
}
it('reads ZIP names in the encoding their archiver wrote', async () => {
  // Every name was read as UTF-8, so a ZIP from DOS or Windows tools (CP437, the format's default)
  // listed its accented names garbled.
  const file = path.join(root, 'names.zip');
  const data = Buffer.from('x');
  const cp437 = Buffer.from([0x52, 0x82, 0x73, 0x75, 0x6d, 0x82, 0x2e, 0x74, 0x78, 0x74]);
  const placeholder = Buffer.from('_____.txt');
  await writeFile(
    file,
    storedZip([
      // the format's default: no UTF-8 flag, CP437 bytes
      { name: cp437, data },
      // macOS's archiver: UTF-8 bytes without the flag
      { name: Buffer.from('Café.txt'), data },
      // the UTF-8 flag
      { name: Buffer.from('naïve.txt'), data, flags: 0x0800 },
      // a Windows tool: a CP437 stand-in, and the real name in the Unicode Path field
      { name: placeholder, data, extra: unicodePath(placeholder, 'Ελλάδα.txt') },
      // a Unicode Path field written for another name is not this name's
      { name: Buffer.from('plain.txt'), data, extra: unicodePath(placeholder, 'other.txt') },
    ]),
  );
  expect((await new Archives().list(file)).entries.map((entry) => entry.name)).toEqual([
    'Résumé.txt',
    'Café.txt',
    'naïve.txt',
    'Ελλάδα.txt',
    'plain.txt',
  ]);
  // every high byte of CP437 has its character
  const high = zipName(
    Buffer.from(Array.from({ length: 128 }, (_, index) => 0x80 + index)),
    0,
    Buffer.alloc(0),
  );
  expect([high.length, high[0], high[0x61], high[0x7f]]).toEqual([
    128,
    'Ç',
    'ß',
    String.fromCharCode(0xa0),
  ]);
});
it('rejects damaged TAR headers rather than displaying invented files', async () => {
  const file = path.join(root, 'bad.tar');
  const data = tarEntry('note.txt', Buffer.from('note'));
  data[0] ^= 1;
  await writeFile(file, data);
  await expect(new Archives().list(file)).rejects.toThrow('checksum');
});
