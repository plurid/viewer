import { Stats } from 'node:fs';
import { lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileStats } from '../src/desktop/files/stats';
import { temporaryRoot } from '../tools/temporary';

const times = [
  [-8640000000000n, 0n],
  [-2147483648n, 123456789n],
  [-2n, 1n],
  [-1n, 0n],
  [-1n, 1n],
  [-1n, 499999999n],
  [-1n, 500000000n],
  [-1n, 999000000n],
  [-1n, 999499999n],
  [-1n, 999500000n],
  [-1n, 999999000n],
  [-1n, 999999999n],
  [0n, 0n],
  [0n, 1n],
  [0n, 499999n],
  [0n, 500000n],
  [0n, 999999n],
  [0n, 999999999n],
  [1n, 123456789n],
  [2147483648n, 999999999n],
  [1790000000n, 123456789n],
  [8640000000000n, 0n],
] as const;

describe('exact stat metadata', () => {
  it('matches Node for every Date and millisecond field across timespec boundaries', async () => {
    const root = await temporaryRoot('viewer-stat-times-');
    const file = path.join(root, 'Timestamp fixture.txt');
    await writeFile(file, 'retained', { flag: 'wx' });
    const info = await lstat(file, { bigint: true });
    for (const [seconds, nanos] of times) {
      const ns = seconds * 1000000000n + nanos;
      const numericTime = Number(seconds) * 1000 + Number(nanos) / 1e6;
      const base = [1, 0o100600, 1, 1, 1, 0, 4096, 2, 8, 1];
      const pair = [Number(seconds), Number(nanos)];
      const args =
        Stats.length >= 18
          ? [...base, ...pair, ...pair, ...pair, ...pair]
          : [...base, numericTime, numericTime, numericTime, numericTime];
      const native = Reflect.construct(Stats, args) as Stats;
      const converted = fileStats({
        ...info,
        atimeNs: ns,
        mtimeNs: ns,
        ctimeNs: ns,
        birthtimeNs: ns,
      });
      for (const name of ['atime', 'mtime', 'ctime', 'birthtime'] as const) {
        expect(converted[`${name}Ms`], `${name}Ms at ${seconds}:${nanos}`).toBe(
          native[`${name}Ms`],
        );
        expect(converted[name].getTime(), `${name} at ${seconds}:${nanos}`).toBe(
          native[name].getTime(),
        );
      }
    }
  });

  it('retains only fields the application reads and lets Node materialize Dates lazily', async () => {
    const root = await temporaryRoot('viewer-stat-fields-');
    const converted = fileStats(await lstat(root, { bigint: true }));
    expect(Object.keys(converted).sort()).toEqual(
      [
        'dev',
        'ino',
        'mode',
        'nlink',
        'uid',
        'size',
        'blocks',
        'atimeMs',
        'mtimeMs',
        'ctimeMs',
        'birthtimeMs',
      ].sort(),
    );
    expect(Object.hasOwn(converted, 'mtime')).toBe(false);
    expect(converted.mtime).toBeInstanceOf(Date);
  });
});
