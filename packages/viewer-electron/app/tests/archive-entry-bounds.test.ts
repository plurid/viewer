/**
 * Entries the desktop reads out of a granted file within fixed bounds: the one file a gzip file
 * holds, expanded to at most 8 MB, and the picture of its first page an OpenDocument carries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { Resources } from '../src/desktop/previews/resources';
import { gzipMember } from '../src/domain/files/containers';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, resources: Resources;
beforeEach(async () => {
  root = await temporaryRoot('viewer-archive-entries-');
  resources = new Resources();
});
afterEach(async () => {
  await resources.quiesce();
  await trashTemporary(root);
});
async function grant(name: string, bytes: Uint8Array | string) {
  const file = path.join(root, name);
  await writeFile(file, bytes);
  return resources.grant(file);
}
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('a single gzip-compressed file', () => {
  it('names the file it holds by its own name, leaving TAR archives to the archive reader', () => {
    expect(gzipMember('notes.txt.gz')).toBe('notes.txt');
    expect(gzipMember('access.log.2.GZ')).toBe('access.log.2');
    expect(gzipMember('backup.tar.gz')).toBeUndefined();
    expect(gzipMember('backup.tgz')).toBeUndefined();
    expect(gzipMember('.gz')).toBeUndefined();
  });

  it('lists its one file with the size its trailer records and expands it', async () => {
    const text = 'A short walk.\n'.repeat(100);
    const resource = await grant('notes.txt.gz', gzipSync(text));
    expect(await resources.archive(resource.id)).toEqual({
      entries: [{ name: 'notes.txt', size: text.length, directory: false, previewable: true }],
      truncated: false,
    });
    const child = await resources.archiveEntry(resource.id, 'notes.txt');
    expect(child.entry).toMatchObject({ name: 'notes.txt', extension: 'txt', size: text.length });
    expect(await resources.read(child.id)).toMatchObject({ text, binary: false });
    await expect(resources.archiveEntry(resource.id, 'other.txt')).rejects.toThrow(
      'holds only notes.txt',
    );
    resources.release(resource.id);
    await expect(resources.read(child.id)).rejects.toThrow('expired');
  });

  it('refuses a gzip bomb at the 8 MB limit, whatever its trailer claims', async () => {
    const bomb = gzipSync(Buffer.alloc(9 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(64 * 1024);
    const honest = await grant('honest.log.gz', bomb);
    const listed = (await resources.archive(honest.id)).entries[0];
    expect(listed).toMatchObject({ size: 9 * 1024 * 1024, previewable: false });
    await expect(resources.archiveEntry(honest.id, 'honest.log')).rejects.toThrow(
      'expands beyond the 8.4 MB preview limit',
    );
    // a trailer that understates the size is caught by the expansion itself
    const lying = Buffer.from(bomb);
    lying.writeUInt32LE(100, lying.length - 4);
    const resource = await grant('lying.log.gz', lying);
    expect((await resources.archive(resource.id)).entries[0]).toMatchObject({
      size: 100,
      previewable: true,
    });
    await expect(resources.archiveEntry(resource.id, 'lying.log')).rejects.toThrow(
      'expands beyond the 8.4 MB preview limit',
    );
  });

  it('reports damaged, truncated and mislabeled files', async () => {
    const damaged = Buffer.from(gzipSync('A short walk.\n'));
    damaged[damaged.length - 6] ^= 1;
    const resource = await grant('damaged.txt.gz', damaged);
    await expect(resources.archiveEntry(resource.id, 'damaged.txt')).rejects.toThrow(
      'damaged or incomplete',
    );
    const truncated = await grant(
      'short.txt.gz',
      gzipSync('A short walk.\n'.repeat(50)).subarray(0, 24),
    );
    await expect(resources.archiveEntry(truncated.id, 'short.txt')).rejects.toThrow(
      'damaged or incomplete',
    );
    const plain = await grant('plain.txt.gz', 'Not compressed at all.\n');
    await expect(resources.archive(plain.id)).rejects.toThrow('not gzip-compressed');
    await expect(resources.archiveEntry(plain.id, 'plain.txt')).rejects.toThrow(
      'not gzip-compressed',
    );
  });

  it('keeps listing a compressed TAR as an archive', async () => {
    const header = Buffer.alloc(512);
    const body = Buffer.from('# Notes\n');
    header.write('notes.md');
    header.write('0000644\0', 100);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write(
      header
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148,
    );
    const tar = Buffer.concat([header, body, Buffer.alloc(504), Buffer.alloc(1024)]);
    for (const name of ['notes.tar.gz', 'notes.tgz']) {
      const resource = await grant(name, gzipSync(tar));
      expect((await resources.archive(resource.id)).entries.map((entry) => entry.name)).toEqual([
        'notes.md',
      ]);
      const child = await resources.archiveEntry(resource.id, 'notes.md');
      expect((await resources.read(child.id)).text).toBe('# Notes\n');
    }
  });
});

describe('the picture of its first page an OpenDocument carries', () => {
  const document = (picture?: Uint8Array) =>
    zipSync({
      mimetype: strToU8('application/vnd.oasis.opendocument.text'),
      'content.xml': strToU8('<office:document-content/>'),
      ...(picture ? { 'Thumbnails/thumbnail.png': picture } : {}),
    });

  it('serves a bounded PNG with its dimensions', async () => {
    const resource = await grant('Field notes.odt', document(png(181, 256)));
    const picture = await resources.archiveEntry(resource.id, 'Thumbnails/thumbnail.png');
    expect(picture.dimensions).toEqual({ width: 181, height: 256 });
    expect(picture.entry).toMatchObject({ name: 'thumbnail.png', mime: 'image/png' });
    expect((await resources.response(new Request(picture.url))).status).toBe(200);
  });

  it('refuses a missing, oversized, oversided or non-PNG picture', async () => {
    const jpeg = Buffer.from('ffd8ffe000104a46494600', 'hex');
    for (const [name, bytes, message] of [
      ['Missing.odt', document(), 'missing or exceeds'],
      ['Large.ods', document(Buffer.alloc(512 * 1024 + 1)), 'missing or exceeds'],
      ['Wide.odp', document(png(2048, 16)), 'not a PNG'],
      ['Photo.odg', document(jpeg), 'not a PNG'],
    ] as const) {
      const resource = await grant(name, bytes);
      await expect(
        resources.archiveEntry(resource.id, 'Thumbnails/thumbnail.png'),
        name,
      ).rejects.toThrow(message);
    }
  });
});
