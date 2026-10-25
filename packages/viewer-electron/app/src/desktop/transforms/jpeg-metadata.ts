import { imageCredits, safeImageXmp } from './image';
import type { ImageTransform } from '../../domain/operations/transforms';
function exifOrientation(bytes: Buffer): number {
  try {
    const start = 6,
      little = bytes.toString('ascii', 6, 8) === 'II';
    const u16 = (offset: number) =>
      little ? bytes.readUInt16LE(start + offset) : bytes.readUInt16BE(start + offset);
    const u32 = (offset: number) =>
      little ? bytes.readUInt32LE(start + offset) : bytes.readUInt32BE(start + offset);
    const offset = u32(4),
      count = Math.min(256, u16(offset));
    for (let index = 0; index < count; index++) {
      const item = offset + 2 + index * 12;
      if (u16(item) === 274 && u16(item + 2) === 3 && u32(item + 4) === 1) {
        const value = u16(item + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    /* malformed optional metadata does not survive */
  }
  return 1;
}
function descriptiveExif(bytes: Buffer, credit: boolean): Buffer | undefined {
  const orientation = exifOrientation(bytes),
    values = credit ? imageCredits(bytes) : {};
  const tags = Object.entries(values)
    .map(([name, value]) => ({
      tag: ({ ImageDescription: 270, Artist: 315, Copyright: 33432 } as Record<string, number>)[
        name
      ]!,
      value: Buffer.from(value + '\0', 'utf8'),
    }))
    .sort((a, b) => a.tag - b.tag);
  if (!tags.length && orientation === 1) return;
  const entries = [
    ...tags.map((tag) => ({ ...tag, type: 2, count: tag.value.length })),
    { tag: 274, type: 3, count: 1, value: Buffer.from([orientation, 0]) },
  ].sort((a, b) => a.tag - b.tag);
  const count = entries.length,
    dataStart = 8 + 2 + count * 12 + 4;
  const tiff = Buffer.alloc(
    dataStart +
      entries.reduce((sum, tag) => sum + (tag.value.length > 4 ? tag.value.length : 0), 0),
  );
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(count, 8);
  let dataOffset = dataStart;
  for (const [index, item] of entries.entries()) {
    const offset = 10 + index * 12;
    tiff.writeUInt16LE(item.tag, offset);
    tiff.writeUInt16LE(item.type, offset + 2);
    tiff.writeUInt32LE(item.count, offset + 4);
    if (item.value.length <= 4) item.value.copy(tiff, offset + 8);
    else {
      tiff.writeUInt32LE(dataOffset, offset + 8);
      item.value.copy(tiff, dataOffset);
      dataOffset += item.value.length;
    }
  }
  return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
}
function app(marker: number, data: Buffer): Buffer {
  if (data.length > 65533) throw new Error('Image metadata exceeds its JPEG segment limit.');
  const head = Buffer.from([255, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}
/** Rewrites metadata only; entropy-coded JPEG coefficients are untouched.
 * Orientation is technical rendering state and survives even strip mode. */
export function jpegMetadata(input: Buffer, policy: ImageTransform['metadata']): Buffer {
  if (input.readUInt16BE(0) !== 0xffd8)
    throw new Error('Lossless JPEG optimization requires a JPEG source.');
  const chunks: Buffer[] = [input.subarray(0, 2)];
  let offset = 2,
    exif = false;
  while (offset < input.length) {
    const start = offset;
    if (input[offset++] !== 255) throw new Error('Invalid JPEG marker.');
    while (input[offset] === 255) offset++;
    const marker = input[offset++];
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(input.subarray(start));
      break;
    }
    if (marker === undefined || marker === 0 || (marker >= 0xd0 && marker <= 0xd7))
      throw new Error('Invalid JPEG header.');
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) throw new Error('Incomplete JPEG metadata.');
    const data = input.subarray(offset + 2, offset + length);
    offset += length;
    if (marker === 0xe2 && data.toString('ascii', 0, 4) === 'MPF\0')
      throw new Error('Multi-picture JPEG needs a dedicated export. The source was kept.');
    if (
      policy === 'all' ||
      marker < 0xe0 ||
      (marker > 0xef && marker !== 0xfe) ||
      marker === 0xe0 ||
      marker === 0xee
    ) {
      chunks.push(input.subarray(start, offset));
      continue;
    }
    if (marker === 0xe2 && policy === 'safe' && data.toString('ascii', 0, 12) === 'ICC_PROFILE\0')
      chunks.push(input.subarray(start, offset));
    if (marker === 0xe1 && data.toString('ascii', 0, 6) === 'Exif\0\0' && !exif) {
      exif = true;
      const value = descriptiveExif(data, policy === 'safe');
      if (value) chunks.push(app(marker, value));
    }
    const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
    if (
      marker === 0xe1 &&
      policy === 'safe' &&
      data.toString('ascii', 0, xmpHeader.length) === xmpHeader
    ) {
      const value = safeImageXmp(data.subarray(xmpHeader.length));
      if (value) chunks.push(app(marker, Buffer.from(xmpHeader + value)));
    }
  }
  return Buffer.concat(chunks);
}
