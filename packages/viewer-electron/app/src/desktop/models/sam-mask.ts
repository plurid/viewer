/*
 * Copyright (c) Meta Platforms, Inc. and affiliates. All Rights Reserved.
 */
/**
 * SAM 3.1 one_bit MASKS: the decoder for the `!` mask payloads SAM's Responses API returns, derived
 * from @meta-sam/parser 0.1.0 (mask-codec.js) under the SAM License, whose text ships in
 * assets/licenses/sam-parser-0.1.0.txt. Only the one_bit path is ported: a base85 payload with a
 * five-character length prefix, then an adaptive binary range coder over a 12-pixel context. The
 * raster is row-major, one byte per cell, 0 or 1.
 */

/** Printable ASCII without the characters SAM's record grammar reserves. */
const excluded = new Set(['"', '\\', ',', ';', '<', '>', '|']);
const alphabet = Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) =>
  String.fromCharCode(0x21 + index),
)
  .filter((character) => !excluded.has(character))
  .join('');
const radix = 85;
const prefixLength = 5;
const values = new Int16Array(128).fill(-1);
for (let index = 0; index < alphabet.length; index++) values[alphabet.charCodeAt(index)] = index;

const top = 1 << 24;
const bottom = 1 << 16;
const mask32 = 0xffffffff;
const increment = 14;
const countLimit = 4096;
const contextCount = 1 << 12;
const padding = 2;
/** Cells past this are refused, as an image this large is never sent. */
const cellLimit = 4096 * 4096;

export class SamMaskError extends Error {}

function digit(character: string): number {
  const code = character.charCodeAt(0);
  const value = code < values.length ? values[code]! : -1;
  if (value < 0 || value >= radix)
    throw new SamMaskError('The mask has a character it cannot have.');
  return value;
}

/** The payload's bytes: its length from the prefix, then four bytes for each five characters. */
function unpack(payload: string): Uint8Array {
  if (payload.length < prefixLength) throw new SamMaskError('The mask is missing its length.');
  let length = 0;
  for (let index = 0; index < prefixLength; index++)
    length = length * radix + digit(payload[index]!);
  const remainder = length % 4;
  const expected =
    prefixLength + Math.floor(length / 4) * 5 + (remainder === 0 ? 0 : remainder + 1);
  if (payload.length !== expected)
    throw new SamMaskError('The mask is not as long as its length says.');
  const output = new Uint8Array(length);
  let source = prefixLength;
  let destination = 0;
  for (const full = length - remainder; destination < full; destination += 4) {
    let value = 0;
    for (let index = 0; index < 5; index++) value = value * radix + digit(payload[source + index]!);
    if (value > mask32) throw new SamMaskError('The mask has a group out of range.');
    source += 5;
    output[destination] = (value >>> 24) & 0xff;
    output[destination + 1] = (value >>> 16) & 0xff;
    output[destination + 2] = (value >>> 8) & 0xff;
    output[destination + 3] = value & 0xff;
  }
  if (remainder > 0) {
    let value = 0;
    for (let index = 0; index < 5; index++)
      value = value * radix + (index < remainder + 1 ? digit(payload[source + index]!) : radix - 1);
    if (value > mask32) throw new SamMaskError('The mask ends out of range.');
    for (let index = 0; index < remainder; index++)
      output[destination + index] = (value >>> (24 - index * 8)) & 0xff;
  }
  return output;
}

class RangeDecoder {
  private position = 0;
  private low = 0;
  private range = mask32;
  private code = 0;
  private scaled = 0;
  constructor(private input: Uint8Array) {
    if (input.length < 4) throw new SamMaskError('The mask is missing its end.');
    for (let index = 0; index < 4; index++) this.code = ((this.code << 8) | this.read()) >>> 0;
  }
  frequency(total: number): number {
    this.scaled = Math.floor(this.range / total);
    if (this.scaled === 0) throw new SamMaskError('The mask cannot be decoded.');
    const value = Math.floor(((this.code - this.low) >>> 0) / this.scaled);
    return value >= total ? total - 1 : value;
  }
  decode(cumulative: number, frequency: number): void {
    this.low = (this.low + this.scaled * cumulative) >>> 0;
    this.range = this.scaled * frequency;
    while (
      (this.low ^ (this.low + this.range)) >>> 0 < top ||
      (this.range < bottom && ((this.range = (-this.low >>> 0) & (bottom - 1)), true))
    ) {
      this.code = ((this.code << 8) | this.read()) >>> 0;
      this.low = (this.low << 8) >>> 0;
      this.range = (this.range << 8) >>> 0;
    }
  }
  private read(): number {
    if (this.position >= this.input.length) throw new SamMaskError('The mask ends too soon.');
    return this.input[this.position++]!;
  }
}

/** The 12 cells before this one, two rows up and two to each side, as one context number. */
function contextAt(raster: Uint8Array, position: number, prior: number, earlier: number): number {
  return (
    raster[position - 1]! |
    (raster[position - 2]! << 1) |
    (raster[prior - 2]! << 2) |
    (raster[prior - 1]! << 3) |
    (raster[prior]! << 4) |
    (raster[prior + 1]! << 5) |
    (raster[prior + 2]! << 6) |
    (raster[earlier - 2]! << 7) |
    (raster[earlier - 1]! << 8) |
    (raster[earlier]! << 9) |
    (raster[earlier + 1]! << 10) |
    (raster[earlier + 2]! << 11)
  );
}
function updateCounts(counts: Uint16Array, offset: number, bit: number): void {
  counts[offset + bit] = counts[offset + bit]! + increment;
  if (counts[offset]! + counts[offset + 1]! >= countLimit) {
    counts[offset] = counts[offset]! >> 1 || 1;
    counts[offset + 1] = counts[offset + 1]! >> 1 || 1;
  }
}

/** A `!` payload of `width` × `height` cells, decoded. */
export function decodeOneBitMask(payload: string, width: number, height: number): Uint8Array {
  if (!payload.startsWith('!')) throw new SamMaskError('A one_bit mask starts with “!”.');
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > cellLimit
  )
    throw new SamMaskError('The mask’s size is not one Viewer reads.');
  const decoder = new RangeDecoder(unpack(payload.slice(1)));
  const counts = new Uint16Array(contextCount * 2).fill(1);
  const paddedWidth = width + 2 * padding;
  const padded = new Uint8Array(paddedWidth * (height + padding));
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = (y + padding) * paddedWidth + padding;
    for (let x = 0; x < width; x++) {
      const position = row + x;
      const offset =
        contextAt(padded, position, position - paddedWidth, position - 2 * paddedWidth) << 1;
      const zero = counts[offset]!;
      const one = counts[offset + 1]!;
      const bit = decoder.frequency(zero + one) < zero ? 0 : 1;
      if (bit === 0) decoder.decode(0, zero);
      else decoder.decode(zero, one);
      padded[position] = bit;
      output[y * width + x] = bit;
      updateCounts(counts, offset, bit);
    }
  }
  return output;
}
