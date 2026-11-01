import { crc32, deflateSync } from 'node:zlib';
import { samRecord } from '../../domain/models/sam';
import { decodeOneBitMask } from '../models/sam-mask';

/** Expand SAM's box-relative mask onto exactly the re-encoded source image's pixel grid. */
export function reconstructionMask(text: string, width: number, height: number): Buffer {
  const record = samRecord(text);
  if (
    !record ||
    record.frame.width !== width ||
    record.frame.height !== height ||
    width * height > 4096 * 4096
  )
    throw new Error('SAM did not return a mask aligned with this photo. Select the object again.');
  const raster = decodeOneBitMask(record.mask.payload, record.mask.width, record.mask.height);
  if (!raster.some((value) => value)) throw new Error('SAM returned an empty selection.');
  const rows = Buffer.alloc((width + 1) * height);
  const { left, top, right, bottom } = record.bounds;
  for (let y = top; y < bottom; y++) {
    const sy = Math.min(
      record.mask.height - 1,
      Math.floor(((y - top) * record.mask.height) / (bottom - top)),
    );
    for (let x = left; x < right; x++) {
      const sx = Math.min(
        record.mask.width - 1,
        Math.floor(((x - left) * record.mask.width) / (right - left)),
      );
      rows[y * (width + 1) + x + 1] = raster[sy * record.mask.width + sx] ? 255 : 0;
    }
  }
  const chunk = (kind: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
