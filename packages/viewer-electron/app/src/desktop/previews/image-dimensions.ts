import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
export function imageDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24) return;
  let width = 0,
    height = 0;
  if (bytes.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.toString('ascii', 0, 3) === 'GIF') {
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
  } else if (bytes.toString('ascii', 0, 2) === 'BM' && bytes.length >= 26) {
    width = Math.abs(bytes.readInt32LE(18));
    height = Math.abs(bytes.readInt32LE(22));
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1] ?? 0;
      offset += 2;
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 217)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.length >= 30) {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X') {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (type === 'VP8 ') {
      width = bytes.readUInt16LE(26) & 16383;
      height = bytes.readUInt16LE(28) & 16383;
    } else if (type === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  } else if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const offset = bytes.indexOf('ispe');
    if (offset >= 4 && offset + 16 <= bytes.length) {
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
    }
  }
  return width > 0 && height > 0 ? { width, height } : undefined;
}
export async function readImageDimensions(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const bytes = Buffer.alloc(512000);
    const read = await handle.read(bytes, 0, bytes.length, 0);
    return imageDimensions(bytes.subarray(0, read.bytesRead));
  } finally {
    await handle.close();
  }
}
