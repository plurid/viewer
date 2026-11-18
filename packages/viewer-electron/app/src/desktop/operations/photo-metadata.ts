/**
 * A PHOTO'S OWN DETAILS THROUGH THE SYSTEM DECODER: a HEIC photo is decoded by macOS, which hands
 * back pixels only, so the copy made of it would lose when it was taken. Its EXIF block is read from
 * the HEIC container here, and what the default policy keeps of it, who made it and when it was
 * taken (transforms/image.ts), is written into the JPEG copy as its own EXIF segment. The pixels
 * the system encoded are not touched.
 */

/** The EXIF tags a copy keeps, by name, with their numbers: IFD0's and the EXIF sub-IFD's. */
const tags = {
  IFD0: { ImageDescription: 270, Artist: 315, Copyright: 33432 },
  IFD2: { DateTimeOriginal: 36867, OffsetTimeOriginal: 36881, SubSecTimeOriginal: 37521 },
} as const;
const exifPointer = 34665;
/** What a copy keeps of a photo's EXIF, as `imageCredits` and `imageCaptureTime` read it. */
export interface PhotoDetails {
  IFD0: Readonly<Record<string, string>>;
  IFD2: Readonly<Record<string, string>>;
}

/** The boxes of an ISO base media file (HEIC, HEIF) between `start` and `end`. */
function* boxes(
  bytes: Buffer,
  start: number,
  end: number,
): Generator<{ type: string; body: number; end: number }> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let body = offset + 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(bytes.readBigUInt64BE(offset + 8));
      body = offset + 16;
    } else if (size === 0) size = end - offset;
    if (size < body - offset || offset + size > end) return;
    yield { type, body, end: offset + size };
    offset += size;
  }
}
/** An unsigned integer of `size` bytes, as `iloc` stores its offsets and lengths. */
function read(bytes: Buffer, offset: number, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return bytes.readUInt32BE(offset);
  if (size === 8) return Number(bytes.readBigUInt64BE(offset));
  if (size === 2) return bytes.readUInt16BE(offset);
  throw new Error('Unsupported field size.');
}

/**
 * The EXIF block of a HEIC or HEIF photo: its TIFF data, as `imageCredits` reads it. None when the
 * file holds none, or is not one this reader follows.
 */
export function heicExif(bytes: Buffer): Buffer | undefined {
  try {
    const meta = [...boxes(bytes, 0, bytes.length)].find((box) => box.type === 'meta');
    if (!meta) return;
    // a full box: its version and flags first
    const children = [...boxes(bytes, meta.body + 4, meta.end)];
    const item = exifItem(
      bytes,
      children.find((box) => box.type === 'iinf'),
    );
    const locations = children.find((box) => box.type === 'iloc');
    if (item === undefined || !locations) return;
    const place = itemExtents(bytes, locations.body, item);
    if (!place) return;
    // in the file itself, or in the meta box's own data
    const origin =
      place.method === 0
        ? 0
        : place.method === 1
          ? children.find((box) => box.type === 'idat')?.body
          : undefined;
    if (origin === undefined) return;
    const data = Buffer.concat(
      place.extents.map(({ offset, length }) =>
        bytes.subarray(origin + offset, origin + offset + length),
      ),
    );
    if (data.length < 4) return;
    // the item starts with how far into it the TIFF header is
    return data.subarray(4 + data.readUInt32BE(0));
  } catch {
    /* a container this reader does not follow keeps its details to itself */
  }
}
/** The item `iinf` names as the photo's EXIF. */
function exifItem(bytes: Buffer, information?: { body: number; end: number }): number | undefined {
  if (!information) return;
  const version = bytes[information.body]!;
  const first = information.body + 4 + (version === 0 ? 2 : 4);
  for (const entry of boxes(bytes, first, information.end)) {
    const entryVersion = bytes[entry.body]!;
    if (entry.type !== 'infe' || entryVersion < 2) continue;
    const wide = entryVersion >= 3;
    const id = wide ? bytes.readUInt32BE(entry.body + 4) : bytes.readUInt16BE(entry.body + 4);
    const type = wide ? entry.body + 10 : entry.body + 8;
    if (bytes.toString('latin1', type, type + 4) === 'Exif') return id;
  }
}
/** Where `iloc` puts `item`: how its offsets count, and each of its pieces. */
function itemExtents(
  bytes: Buffer,
  body: number,
  item: number,
): { method: number; extents: { offset: number; length: number }[] } | undefined {
  const version = bytes[body]!;
  const sizes = bytes.readUInt16BE(body + 4);
  const offsetSize = sizes >> 12;
  const lengthSize = (sizes >> 8) & 15;
  const baseSize = (sizes >> 4) & 15;
  const indexSize = version >= 1 ? sizes & 15 : 0;
  const wide = version >= 2;
  let at = body + 6;
  const count = wide ? bytes.readUInt32BE(at) : bytes.readUInt16BE(at);
  at += wide ? 4 : 2;
  for (let index = 0; index < count; index++) {
    const id = wide ? bytes.readUInt32BE(at) : bytes.readUInt16BE(at);
    at += wide ? 4 : 2;
    const method = version >= 1 ? bytes.readUInt16BE(at) & 15 : 0;
    if (version >= 1) at += 2;
    // its data reference
    at += 2;
    const base = read(bytes, at, baseSize);
    at += baseSize;
    const pieces = bytes.readUInt16BE(at);
    at += 2;
    const extents: { offset: number; length: number }[] = [];
    for (let piece = 0; piece < pieces; piece++) {
      at += indexSize;
      const offset = read(bytes, at, offsetSize);
      at += offsetSize;
      const length = read(bytes, at, lengthSize);
      at += lengthSize;
      extents.push({ offset: base + offset, length });
    }
    if (id === item) return { method, extents };
  }
}

/** A JPEG's EXIF segment (APP1) holding only `details`: nothing when they are empty. */
export function exifSegment(details: PhotoDetails): Buffer | undefined {
  const entries = (group: keyof typeof tags) =>
    Object.entries(details[group])
      .flatMap(([name, value]): [number, Buffer][] => {
        const tag = (tags[group] as Readonly<Record<string, number>>)[name];
        return tag ? [[tag, Buffer.from(`${value}\0`, 'latin1')]] : [];
      })
      .sort((a, b) => a[0] - b[0]);
  const first = entries('IFD0');
  const taken = entries('IFD2');
  if (!first.length && !taken.length) return;
  const zeroth = [...first, ...(taken.length ? ([[exifPointer, Buffer.alloc(0)]] as const) : [])];
  const ifdSize = (count: number) => 2 + count * 12 + 4;
  const zerothAt = 8;
  const exifAt = zerothAt + ifdSize(zeroth.length);
  let dataAt = exifAt + (taken.length ? ifdSize(taken.length) : 0);
  const tiff: Buffer[] = [];
  const header = Buffer.alloc(8);
  header.write('II', 0, 'latin1');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(zerothAt, 4);
  tiff.push(header);
  const data: Buffer[] = [];
  const directory = (items: readonly (readonly [number, Buffer])[]) => {
    const ifd = Buffer.alloc(ifdSize(items.length));
    ifd.writeUInt16LE(items.length, 0);
    items.forEach(([tag, value], index) => {
      const entry = 2 + index * 12;
      ifd.writeUInt16LE(tag, entry);
      if (tag === exifPointer) {
        ifd.writeUInt16LE(4, entry + 2); // LONG
        ifd.writeUInt32LE(1, entry + 4);
        ifd.writeUInt32LE(exifAt, entry + 8);
        return;
      }
      ifd.writeUInt16LE(2, entry + 2); // ASCII
      ifd.writeUInt32LE(value.length, entry + 4);
      if (value.length <= 4) value.copy(ifd, entry + 8);
      else {
        ifd.writeUInt32LE(dataAt, entry + 8);
        data.push(value);
        dataAt += value.length + (value.length % 2);
        if (value.length % 2) data.push(Buffer.alloc(1));
      }
    });
    return ifd;
  };
  tiff.push(directory(zeroth));
  if (taken.length) tiff.push(directory(taken));
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), ...tiff, ...data]);
  if (body.length + 2 > 0xffff) return;
  const marker = Buffer.from([0xff, 0xe1, 0, 0]);
  marker.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([marker, body]);
}

/** `jpeg` with `segment` after its start and its JFIF header: its encoded pixels as they were. */
export function withSegment(jpeg: Buffer, segment: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG.');
  let at = 2;
  // JFIF's APP0 stays first, as readers expect
  if (jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) at += 2 + jpeg.readUInt16BE(at + 2);
  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}
