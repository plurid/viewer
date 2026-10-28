import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { boundPluridCamera, pluridCameraSource } from '../tools/plurid-camera';
import type { createSelector } from 'reselect';

for (const extension of ['.js', '.mjs'] as const)
  it(`bounds the installed ${extension} camera selector across 20,000 positions`, async () => {
    const original = await pluridCameraSource(extension);
    const patched = boundPluridCamera(original);
    const start = patched.search(/var getTransform = (?:toolkit\.)?createSelector\(/);
    const end = patched.indexOf('\nvar getActiveUniverseID', start);
    expect(end).toBeGreaterThan(start);
    const toolkit = createRequire(import.meta.url)('@reduxjs/toolkit') as {
      createSelector: typeof createSelector;
    };
    const factory = new Function(
      'toolkit',
      'createSelector',
      'getRotationX',
      'getRotationY',
      'getTranslationX',
      'getTranslationY',
      'getTranslationZ',
      'getScale',
      patched.slice(start, end) + '\nreturn getTransform;',
    );
    const select = factory(
      toolkit,
      toolkit.createSelector,
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
    expect(() =>
      boundPluridCamera(original.replace('    getScale\n', '    getNewScale\n')),
    ).toThrow('Review the Plurid camera selector');
  });
