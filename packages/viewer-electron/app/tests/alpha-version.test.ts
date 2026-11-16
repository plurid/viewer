import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  alphaVersionSchema,
  compareAlphaVersions,
  nextAlphaVersion,
  storeVersion,
} from '../src/domain/updates/version';

describe('alpha release versions', () => {
  it('keeps the manifest on an alpha version whose ender is zero', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(alphaVersionSchema.safeParse(manifest.version).success).toBe(true);
    expect(manifest.version.split('.')[0]).toBe('0');
  });

  it.each([
    '0.1.0',
    '1.0.0-0',
    '2.1.0-0',
    '0.1.0-0-extra',
    '0.1.0--1',
    '0.1.0-01',
    '0.01.0-0',
    '0.1.0-9007199254740992',
  ])('rejects %s as a release version', (version) => {
    expect(alphaVersionSchema.safeParse(version).success).toBe(false);
  });

  it('orders every pair by its four numeric parts', () => {
    const versions = ['0.1.0-0', '0.1.0-1', '0.1.0-10', '0.1.1-0', '0.2.0-0'];
    for (let left = 0; left < versions.length; left++)
      for (let right = 0; right < versions.length; right++)
        expect(compareAlphaVersions(versions[left]!, versions[right]!)).toBe(
          Math.sign(left - right),
        );
  });

  it.each([
    ['0.1.0-0', '0.1.0-1'],
    ['0.1.0-9', '0.1.0-10'],
    ['0.1.1-0', '0.1.1-1'],
    ['0.2.0-10', '0.2.0-11'],
  ])('raises only the release number in %s', (version, next) => {
    expect(nextAlphaVersion(version)).toBe(next);
  });

  it('refuses an invalid version or a release counter that cannot be increased safely', () => {
    expect(() => nextAlphaVersion('1.0.0-0')).toThrow();
    expect(() => nextAlphaVersion('0.1.0-9007199254740991')).toThrow('increased safely');
  });

  it.each([
    ['0.1.0-0', '1.0.0'],
    ['0.1.0-1', '1.0.1'],
    ['0.1.0-10', '1.0.10'],
    ['0.1.1-0', '1.1.0'],
    ['0.2.0-0', '2.0.0'],
  ])('maps %s to the Store bundle version %s', (version, expected) => {
    expect(storeVersion(version)).toBe(expected);
  });
});
