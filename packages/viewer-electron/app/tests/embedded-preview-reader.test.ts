/**
 * The picture a container saved of itself, read by the desktop within fixed bounds: from a ZIP's
 * own members, or from inside an iWork package folder without following a link. Each format reads
 * only its named pictures and the members its facts come from.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { Resources } from '../src/desktop/previews/resources';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string, resources: Resources;
beforeEach(async () => {
  root = await temporaryRoot('viewer-embedded-previews-');
  resources = new Resources();
});
afterEach(async () => {
  await resources.quiesce();
  await trashTemporary(root);
});

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
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * Math.min(height, 4)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** A JPEG's start, an APP0 segment and the frame header that gives its size. */
function jpeg(width: number, height: number): Buffer {
  const frame = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([
    Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
    frame,
    Buffer.from([0x11, 1, 0xff, 0xd9]),
  ]);
}
const zip = (entries: Record<string, string | Uint8Array>) => {
  const files: Zippable = {};
  for (const [name, content] of Object.entries(entries))
    files[name] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(files);
};
async function grant(name: string, bytes: Uint8Array) {
  const file = path.join(root, name);
  await writeFile(file, bytes);
  return resources.grant(file);
}
async function folder(name: string, files: Record<string, string | Uint8Array>) {
  const bundle = path.join(root, name);
  for (const [member, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(bundle, member)), { recursive: true });
    await writeFile(path.join(bundle, member), content);
  }
  return bundle;
}

describe('a picture saved in a ZIP container', () => {
  it('lists only the members its format reads and serves its picture with its dimensions', async () => {
    const resource = await grant(
      'Report.pages',
      zip({
        'Index/Document.iwa': 'not read',
        'Metadata/Properties.plist': '<plist/>',
        'preview.jpg': jpeg(1600, 1200),
        'preview-micro.jpg': jpeg(80, 60),
      }),
    );
    const listing = await resources.archive(resource.id);
    expect(listing.entries.map((entry) => entry.name).sort()).toEqual([
      'preview-micro.jpg',
      'preview.jpg',
    ]);
    const picture = await resources.archiveEntry(resource.id, 'preview.jpg');
    expect(picture.dimensions).toEqual({ width: 1600, height: 1200 });
    expect(picture.entry).toMatchObject({ name: 'preview.jpg', mime: 'image/jpeg' });
    expect((await resources.response(new Request(picture.url))).status).toBe(200);
    await expect(resources.archiveEntry(resource.id, 'Index/Document.iwa')).rejects.toThrow(
      'reads only its saved picture',
    );
  });

  it('reads the members its facts come from as text, and no other', async () => {
    const resource = await grant(
      'Study.kra',
      zip({
        mimetype: 'application/x-krita',
        'maindoc.xml': '<DOC><IMAGE width="640" height="480"/></DOC>',
        'mergedimage.png': png(640, 480),
        'layers/layer1': 'tile data',
      }),
    );
    const facts = await resources.archiveEntry(resource.id, 'maindoc.xml');
    expect((await resources.read(facts.id)).text).toContain('width="640"');
    await expect(resources.archiveEntry(resource.id, 'layers/layer1')).rejects.toThrow(
      'reads only its saved picture',
    );
    const picture = await resources.archiveEntry(resource.id, 'mergedimage.png');
    expect(picture.dimensions).toEqual({ width: 640, height: 480 });
  });

  it('refuses a picture over its byte or pixel limit and facts over theirs', async () => {
    const large = await grant('Large.kra', zip({ 'mergedimage.png': Buffer.alloc(32_000_001) }));
    await expect(resources.archiveEntry(large.id, 'mergedimage.png')).rejects.toThrow(
      'missing or exceeds',
    );
    const wide = await grant('Wide.ora', zip({ 'mergedimage.png': png(10000, 10000) }));
    await expect(resources.archiveEntry(wide.id, 'mergedimage.png')).rejects.toThrow(
      'exceeds its preview limit',
    );
    const long = await grant(
      'Long.sketch',
      zip({ 'meta.json': '{"pagesAndArtboards":{}}' + ' '.repeat(1_000_000) }),
    );
    await expect(resources.archiveEntry(long.id, 'meta.json')).rejects.toThrow(
      'missing or exceeds',
    );
  });

  it('finds no picture in a document that saved none', async () => {
    const resource = await grant(
      'Plain.xps',
      zip({
        'FixedDocumentSequence.fdseq': '<FixedDocumentSequence/>',
        'Documents/1/FixedDocument.fdoc': '<FixedDocument/>',
      }),
    );
    const listing = await resources.archive(resource.id);
    expect(listing.entries.map((entry) => entry.name).sort()).toEqual([
      'Documents/1/FixedDocument.fdoc',
      'FixedDocumentSequence.fdseq',
    ]);
    await expect(resources.archiveEntry(resource.id, 'docProps/thumbnail.jpeg')).rejects.toThrow(
      'missing or exceeds',
    );
  });

  it('refuses a picture that is not the image its name says', async () => {
    for (const [name, member, bytes] of [
      ['Swapped.kra', 'mergedimage.png', jpeg(64, 64)],
      ['Text.pages', 'preview.jpg', Buffer.from('A note, not a picture.\n')],
      ['Named.xps', 'docProps/thumbnail.png', jpeg(64, 64)],
    ] as const) {
      const resource = await grant(name, zip({ [member]: bytes }));
      await expect(resources.archiveEntry(resource.id, member), name).rejects.toThrow(
        'not the PNG or JPEG it is named',
      );
    }
  });
});

describe('a picture saved in an iWork package folder', () => {
  it('grants the package as its document and reads only its pictures', async () => {
    const bundle = await folder('Report.pages', {
      'QuickLook/Thumbnail.jpg': jpeg(320, 240),
      'index.xml.gz': 'not read',
    });
    const resource = await resources.grant(bundle);
    expect(resource.entry).toMatchObject({ directory: true, extension: 'pages' });
    const listing = await resources.archive(resource.id);
    expect(listing.entries).toEqual([
      expect.objectContaining({ name: 'QuickLook/Thumbnail.jpg', previewable: true }),
    ]);
    const picture = await resources.archiveEntry(resource.id, 'QuickLook/Thumbnail.jpg');
    expect(picture.dimensions).toEqual({ width: 320, height: 240 });
    expect((await resources.response(new Request(picture.url))).status).toBe(200);
    await expect(resources.archiveEntry(resource.id, 'index.xml.gz')).rejects.toThrow(
      'reads only its saved picture',
    );
    // the folder itself is never read as a file
    await expect(resources.read(resource.id)).rejects.toThrow();
    expect(() => resources.documentSource(resource.id)).toThrow('document package');
    expect(() => resources.editableFile(resource.id)).toThrow('its own app');
    expect((await resources.response(new Request(resource.url))).status).not.toBe(200);
  });

  it('refuses other folders, as it did', async () => {
    for (const name of ['Notes', 'Study.kra', 'Field notes.app'])
      await expect(
        resources.grant(await folder(name, { 'preview.jpg': jpeg(16, 16) })),
        name,
      ).rejects.toThrow('Choose a regular file');
  });

  it('follows no link inside the package', async () => {
    const outside = await folder('Elsewhere', {
      'Thumbnail.jpg': jpeg(32, 32),
      'preview.jpg': jpeg(32, 32),
    });
    const bundle = await folder('Linked.key', { 'Metadata/Properties.plist': '<plist/>' });
    await symlink(outside, path.join(bundle, 'QuickLook'));
    await symlink(path.join(outside, 'preview.jpg'), path.join(bundle, 'preview.jpg'));
    const resource = await resources.grant(bundle);
    expect((await resources.archive(resource.id)).entries).toEqual([]);
    for (const member of ['QuickLook/Thumbnail.jpg', 'preview.jpg'])
      await expect(resources.archiveEntry(resource.id, member), member).rejects.toThrow();
  });
});
