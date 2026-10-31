import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { pluridCameraSource } from '../tools/plurid-camera';
import type { createSelector, lruMemoize } from 'reselect';

for (const extension of ['.js', '.mjs'] as const)
  it(`bounds the installed ${extension} camera selector across 20,000 positions`, async () => {
    const published = await pluridCameraSource(extension);
    const start = published.search(/var getTransform = (?:toolkit\.)?createSelector\(/);
    const end = published.indexOf('\nvar getActiveUniverseID', start);
    expect(end).toBeGreaterThan(start);
    const toolkit = createRequire(import.meta.url)('@reduxjs/toolkit') as {
      createSelector: typeof createSelector;
      lruMemoize: typeof lruMemoize;
    };
    const factory = new Function(
      'toolkit',
      'createSelector',
      'lruMemoize',
      'getRotationX',
      'getRotationY',
      'getTranslationX',
      'getTranslationY',
      'getTranslationZ',
      'getScale',
      published.slice(start, end) + '\nreturn getTransform;',
    );
    const select = factory(
      toolkit,
      toolkit.createSelector,
      toolkit.lruMemoize,
      ...Array.from({ length: 6 }, (_, index) => (state: number[]) => state[index]),
    ) as ReturnType<typeof createSelector>;
    const first = select([0, 0, 0, 0, 0, 1]);
    expect(select([0, 0, 0, 0, 0, 1])).toBe(first);
    for (let index = 1; index <= 20000; index++) select([index, index, index, index, index, 1]);
    expect(select([0, 0, 0, 0, 0, 1])).not.toBe(first);
    const current = select([3, 4, 5, 6, 7, 2]);
    expect(select([3, 4, 5, 6, 7, 2])).toBe(current);
    expect(current).toEqual({
      rotationX: 3,
      rotationY: 4,
      translationX: 5,
      translationY: 6,
      translationZ: 7,
      scale: 2,
    });
  });
