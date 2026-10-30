import { expect, it } from 'vitest';
import { sameBytes } from './support/bytes';

it('compares byte arrays by their bytes and keeps their kinds apart', () => {
  expect(Buffer.from([1, 2, 3])).toEqual(Buffer.from([1, 2, 3]));
  expect(Buffer.from([1, 2, 3])).not.toEqual(Buffer.from([1, 2, 4]));
  expect(Buffer.from([1, 2])).not.toEqual(Buffer.from([1, 2, 3]));
  expect(sameBytes(Buffer.from([1]), new Uint8Array([1]))).toBe(false);
  expect(sameBytes('a', 'a')).toBeUndefined();
  // equal 16 MB files compare at once, without a walk through every index
  const large = Buffer.alloc(16_000_000, 7);
  expect(Buffer.from(large)).toEqual(large);
});
