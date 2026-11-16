import { describe, expect, it } from 'vitest';
import {
  itemIdentity,
  nativeIdentityArgument,
  nativeItemIdentity,
  readItemIdentity,
} from '../src/domain/files/item-identity';
import { sameItem } from '../src/desktop/files/item-identity';

describe('exact unsigned file identity', () => {
  it('distinguishes low bits that ordinary Node stats round away', () => {
    const first = { dev: 12n, ino: (1n << 64n) - 1n };
    const second = { dev: 12n, ino: (1n << 64n) - 2n };
    expect(Number(first.ino)).toBe(Number(second.ino));
    expect(itemIdentity(first)).not.toBe(itemIdentity(second));
    expect(sameItem(first, second)).toBe(false);
  });

  it('normalizes the signed values returned by Node to unsigned 64-bit values', () => {
    expect(itemIdentity({ dev: 12n, ino: -1n })).toBe('12:18446744073709551615:u64');
    expect(itemIdentity({ dev: 12n, ino: -2n })).toBe('12:18446744073709551614:u64');
    expect(nativeItemIdentity('12:18446744073709551615')).toBe(
      itemIdentity({ dev: 12n, ino: -1n }),
    );
    expect(nativeIdentityArgument(itemIdentity({ dev: 12n, ino: -1n }))).toBe(
      '12:18446744073709551615',
    );
    expect(() => nativeIdentityArgument('12:18446744073709552000')).toThrow(
      'The file identity cannot be verified; inspect the item again.',
    );
  });

  it('reads safe older identities and rejects rounded older identities', () => {
    expect(readItemIdentity('12:42')).toBe(itemIdentity({ dev: 12n, ino: 42n }));
    expect(readItemIdentity('12:18446744073709552000')).toBeUndefined();
    expect(readItemIdentity('12:18446744073709551614:u64')).toBe(
      itemIdentity({ dev: 12n, ino: -2n }),
    );
    expect(() => itemIdentity({ dev: 12, ino: Number((1n << 64n) - 1n) })).toThrow(
      'The file identity cannot be verified from rounded numbers.',
    );
  });
});
