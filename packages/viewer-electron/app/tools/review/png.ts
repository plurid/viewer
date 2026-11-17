/**
 * Just enough PNG for comparing captures with their baseline: Chromium writes 8-bit RGB or RGBA,
 * not interlaced, and the difference picture is written as RGBA.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export interface Picture {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel, row after row. */
  pixels: Uint8Array;
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

export function decodePNG(file: Buffer): Picture {
  if (!file.subarray(0, 8).equals(signature)) throw new Error('Not a PNG file.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const data: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colorType = body[9]!;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0)
        throw new Error('Only 8-bit, non-interlaced RGB or RGBA PNG files compare.');
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x]!;
      const left = x >= channels ? rows[target + x - channels]! : 0;
      const up = y > 0 ? rows[target - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? rows[target - stride + x - channels]! : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth(left, up, upLeft);
      rows[target + x] = (value + predicted) & 0xff;
    }
  }
  if (channels === 4) return { width, height, pixels: rows };
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0, pixel = 0; index < rows.length; index += 3, pixel += 4) {
    pixels[pixel] = rows[index]!;
    pixels[pixel + 1] = rows[index + 1]!;
    pixels[pixel + 2] = rows[index + 2]!;
    pixels[pixel + 3] = 255;
  }
  return { width, height, pixels };
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const named = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(named));
  return Buffer.concat([length, named, check]);
}

export function encodePNG(picture: Picture): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(picture.width, 0);
  header.writeUInt32BE(picture.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = picture.width * 4;
  const raw = Buffer.alloc((stride + 1) * picture.height);
  for (let y = 0; y < picture.height; y++)
    raw.set(picture.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A channel must move this much before a pixel counts as changed: antialiasing noise stays out. */
const tolerance = 24;

export interface PictureDifference {
  /** Share of pixels that changed, 0 to 1. */
  changed: number;
  /** The current picture faded to grey, with changed pixels in red. */
  picture: Picture;
}

/** Compares two pictures of the same size. */
export function comparePictures(before: Picture, after: Picture): PictureDifference {
  if (before.width !== after.width || before.height !== after.height)
    throw new Error('Pictures of different sizes do not compare pixel by pixel.');
  const pixels = new Uint8Array(after.pixels.length);
  let changed = 0;
  for (let index = 0; index < after.pixels.length; index += 4) {
    const moved =
      Math.abs(after.pixels[index]! - before.pixels[index]!) > tolerance ||
      Math.abs(after.pixels[index + 1]! - before.pixels[index + 1]!) > tolerance ||
      Math.abs(after.pixels[index + 2]! - before.pixels[index + 2]!) > tolerance;
    if (moved) {
      changed++;
      pixels[index] = 255;
      pixels[index + 1] = 40;
      pixels[index + 2] = 40;
    } else {
      const grey =
        (after.pixels[index]! * 0.3 +
          after.pixels[index + 1]! * 0.59 +
          after.pixels[index + 2]! * 0.11) *
          0.35 +
        150;
      pixels[index] = grey;
      pixels[index + 1] = grey;
      pixels[index + 2] = grey;
    }
    pixels[index + 3] = 255;
  }
  return {
    changed: changed / (after.width * after.height),
    picture: { width: after.width, height: after.height, pixels },
  };
}
