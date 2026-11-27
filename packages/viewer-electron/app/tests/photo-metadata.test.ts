/**
 * A HEIC PHOTO'S DETAILS IN ITS JPEG COPY: the system decoder hands back pixels only, so the EXIF
 * block is read from the HEIC container and what the default policy keeps of it, who made the
 * photo and when it was taken, is written into the copy as its own segment, its pixels untouched.
 */
import { describe, expect, it } from 'vitest';
import { exifSegment, heicExif, withSegment } from '../src/desktop/operations/photo-metadata';
import { imageCaptureTime, imageCredits, jpegQuality } from '../src/desktop/transforms/image';

const taken = {
  DateTimeOriginal: '2024:05:06 07:08:09',
  OffsetTimeOriginal: '+02:00',
  SubSecTimeOriginal: '42',
};
const credits = { Artist: 'Viewer fixture', Copyright: 'Generated CC0' };

/** An ISO base media box: its size, its type and its body. */
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
};
const u16 = (value: number) => Buffer.from([value >> 8, value & 255]);
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
/** A HEIC holding only an EXIF item, as Apple's lay one out: its data in `mdat`, found by `iloc`. */
function heic(exif: Buffer, version: 0 | 1 = 0, header?: number): Buffer {
  const ftyp = box(
    'ftyp',
    Buffer.from('heic', 'latin1'),
    u32(0),
    Buffer.from('mif1heic', 'latin1'),
  );
  // how far into the item its TIFF header is, past its "Exif" mark, as Apple's write it
  const item =
    header === undefined
      ? Buffer.concat([u32(6), Buffer.from('Exif\0\0', 'latin1'), exif])
      : Buffer.concat([u32(header), exif]);
  const meta = (offset: number) =>
    box(
      'meta',
      u32(0),
      box('hdlr', u32(0), u32(0), Buffer.from('pict', 'latin1'), Buffer.alloc(13)),
      box(
        'iinf',
        u32(0),
        u16(1),
        box('infe', Buffer.from([2, 0, 0, 0]), u16(1), u16(0), Buffer.from('Exif\0', 'latin1')),
      ),
      box(
        'iloc',
        Buffer.from([version, 0, 0, 0]),
        // four-byte offsets and lengths, no base offset
        u16((4 << 12) | (4 << 8)),
        u16(1),
        u16(1),
        ...(version === 1 ? [u16(0)] : []),
        u16(0),
        u16(1),
        u32(offset),
        u32(item.length),
      ),
    );
  // where `mdat`'s data starts, once `meta` is laid out
  const offset = ftyp.length + meta(0).length + 8;
  return Buffer.concat([ftyp, meta(offset), box('mdat', item)]);
}
/** The TIFF of a photo's EXIF, as a camera writes one: built here by the writer under test. */
const tiff = (details: Parameters<typeof exifSegment>[0]) => exifSegment(details)!.subarray(10);

describe('a HEIC photo’s EXIF', () => {
  it('is read from its container, the item `iloc` points to', () => {
    for (const version of [0, 1] as const) {
      const exif = heicExif(heic(tiff({ IFD0: credits, IFD2: taken }), version));
      expect(imageCaptureTime(exif)).toEqual(taken);
      expect(imageCredits(exif)).toEqual(credits);
    }
  });
  it('is read past any bytes the item holds before its TIFF header', () => {
    const exif = tiff({ IFD0: credits, IFD2: taken });
    const padded = heic(Buffer.concat([Buffer.from('pad.'), exif]), 0, 4);
    expect(imageCaptureTime(heicExif(padded))).toEqual(taken);
  });
  it('is none in a file that holds none, or is not a HEIC', () => {
    expect(heicExif(Buffer.from('not a photo'))).toBeUndefined();
    expect(heicExif(box('ftyp', Buffer.from('heic', 'latin1')))).toBeUndefined();
  });
});

describe('a JPEG copy’s EXIF segment', () => {
  // a JPEG as the system encoder writes one: its start, JFIF, then its image data
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0, 16]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.alloc(9),
    Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]),
  ]);
  it('holds who made it and when it was taken, and nothing else', () => {
    const segment = exifSegment({ IFD0: credits, IFD2: taken })!;
    expect(segment.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xe1]));
    expect(segment.readUInt16BE(2)).toBe(segment.length - 2);
    const exif = segment.subarray(4);
    expect(imageCaptureTime(exif)).toEqual(taken);
    expect(imageCredits(exif)).toEqual(credits);
    // a name it does not keep is left out
    expect(
      imageCredits(exifSegment({ IFD0: { Make: 'Fixture camera' }, IFD2: taken })!.subarray(4)),
    ).toEqual({});
    expect(exifSegment({ IFD0: {}, IFD2: {} })).toBeUndefined();
  });
  it('follows JFIF, the image data as it was', () => {
    const segment = exifSegment({ IFD0: {}, IFD2: taken })!;
    const copy = withSegment(jpeg, segment);
    expect(copy.subarray(0, 20)).toEqual(jpeg.subarray(0, 20));
    expect(copy.subarray(20, 20 + segment.length)).toEqual(segment);
    expect(copy.subarray(20 + segment.length)).toEqual(jpeg.subarray(20));
    expect(() => withSegment(Buffer.from('png'), segment)).toThrow('Not a JPEG.');
  });
});

describe('a JPEG’s own quality', () => {
  /** The IJG library's tables at quality 50, as JPEG's Annex K gives them. */
  const luminance = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
  ];
  /** A table as the IJG library scales it for `quality`. */
  const scaled = (table: number[], quality: number) => {
    const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
    return table.map((value) => Math.min(255, Math.max(1, Math.floor((value * scale + 50) / 100))));
  };
  /** A JPEG's head: its start, one quantization segment of `tables`, then its image data. */
  const head = (tables: [number, number[]][]) => {
    const body = Buffer.concat(tables.map(([id, values]) => Buffer.from([id, ...values])));
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length + 2);
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
      length,
      body,
      Buffer.from([0xff, 0xda, 0, 2]),
    ]);
  };
  it('is read from its luminance table, wherever its segment puts it', () => {
    expect(jpegQuality(head([[0, scaled(luminance, 85)]]))).toBe(85);
    // the colour table first, all coarse, then the luminance one
    expect(
      jpegQuality(
        head([
          [1, Array(64).fill(99)],
          [0, scaled(luminance, 70)],
        ]),
      ),
    ).toBe(70);
    expect(jpegQuality(Buffer.from('not a jpeg'))).toBeUndefined();
  });
});
