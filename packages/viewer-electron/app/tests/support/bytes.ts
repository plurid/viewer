/**
 * Byte arrays compare by their bytes. Vitest's deep equality walks a Buffer index by index: two
 * equal 10 MB files took over 2 GB of heap, past the default limit on CI's smaller runners. A Buffer
 * and a plain Uint8Array still differ, as they do in Vitest's own equality.
 */
import { expect } from 'vitest';

export function sameBytes(a: unknown, b: unknown): boolean | undefined {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return undefined;
  return a.constructor === b.constructor && Buffer.compare(a, b) === 0;
}

expect.addEqualityTesters([sameBytes]);
