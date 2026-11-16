import { describe, expect, it } from 'vitest';
import {
  itemIdentity,
  nativeIdentityArgument,
  nativeItemIdentity,
  readItemIdentity,
  versionIdentity,
  matchesVersionIdentity,
  syntheticInode,
  readTemporalIdentity,
} from '../src/domain/files/item-identity';
import type { TemporalIdentity } from '../src/domain/files/item-identity';
import { sameItem } from '../src/desktop/files/item-identity';

describe('exact unsigned file identity', () => {
  it('keeps upper-half folder, link and real file identities exact and distinct by type', () => {
    const base = { dev: 12n, ino: (1n << 63n) + 5n, birthtimeMs: 1000 };
    const file = { ...base, mode: 0o100600 };
    const folder = { ...base, mode: 0o040700 };
    const link = { ...base, mode: 0o120700 };
    for (const info of [file, folder, link]) {
      const record = readTemporalIdentity(versionIdentity(info))!;
      expect(matchesVersionIdentity(info, record)).toBe(true);
      expect(matchesVersionIdentity({ ...info, ino: info.ino + 1n }, record)).toBe(false);
    }
    expect(matchesVersionIdentity(file, versionIdentity(folder))).toBe(false);
    expect(matchesVersionIdentity(file, versionIdentity(link))).toBe(false);
    expect(syntheticInode(file)).toBe(false);
  });

  it('binds a synthetic identity to creation time and a currently synthetic inode', () => {
    const file = { dev: 12n, ino: -1n, mode: 0o100600, birthtimeMs: 1000 };
    const retained = versionIdentity(file);
    expect(matchesVersionIdentity({ ...file, ino: -2n }, retained)).toBe(true);
    expect(matchesVersionIdentity({ ...file, ino: -2n, birthtimeMs: 2000 }, retained)).toBe(false);
    expect(matchesVersionIdentity({ ...file, ino: 42n }, retained)).toBe(false);
    expect(matchesVersionIdentity(file, readTemporalIdentity('12:synthetic:file')!)).toBe(false);
    expect(syntheticInode({ ...file, ino: (1n << 64n) - (1n << 32n) })).toBe(true);
    expect(syntheticInode({ ...file, ino: (1n << 64n) - (1n << 32n) - 1n })).toBe(false);
  });
  it('separates moment identity from temporal evidence only in the synthetic regular-file range', () => {
    const file = { dev: 12n, ino: -1n, mode: 0o100600, birthtimeMs: 1000 };
    expect(versionIdentity(file)).toBe('12:synthetic:file:1000');
    expect(matchesVersionIdentity({ ...file, ino: 42n }, versionIdentity(file))).toBe(false);
    expect(matchesVersionIdentity({ ...file, mode: 0o040700 }, versionIdentity(file))).toBe(false);
    expect(matchesVersionIdentity({ ...file, dev: 13n }, versionIdentity(file))).toBe(false);
    expect(syntheticInode({ ...file, ino: (1n << 63n) - 1n })).toBe(false);
    expect(syntheticInode({ ...file, ino: 1n << 63n })).toBe(false);
    expect(versionIdentity({ ...file, ino: (1n << 60n) - 1n })).toBe(
      itemIdentity({ ...file, ino: (1n << 60n) - 1n }) + ':file',
    );
    expect(versionIdentity({ ...file, mode: 0o040700 })).toBe(itemIdentity(file) + ':directory');
    if (false) {
      // @ts-expect-error A same-moment identity cannot construct a temporal record.
      const retained: TemporalIdentity = itemIdentity(file);
      // @ts-expect-error String conversion cannot manufacture retained evidence.
      const converted: TemporalIdentity = String(itemIdentity(file));
      // @ts-expect-error Interpolation cannot manufacture retained evidence.
      const interpolated: TemporalIdentity = `${itemIdentity(file)}`;
      // @ts-expect-error JSON serialization cannot manufacture retained evidence.
      const serialized: TemporalIdentity = JSON.stringify(itemIdentity(file));
      void [retained, converted, interpolated, serialized];
    }
  });
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
