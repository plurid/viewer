import { expect, it } from 'vitest';
import {
  buildVersionMinimum,
  compatibleMacOSMinimum,
  macOSMinimum,
} from '../tools/native-build/macos-target';

it.each([
  ['12.0.0', '13.0', true],
  ['13', '13.0.0', true],
  ['13.0.0', '13', true],
  ['13.0', '13.0.1', true],
  ['13.0.1', '13.0', false],
  ['14.0', '13.0', false],
  ['13.10', '13.2', false],
  ['13.2', '13.10', true],
  ['', '13.0', false],
  ['not-a-version', '13.0', false],
  ['13.0', '13.0.0.1', false],
])('checks compatibility of a %s helper with a %s application', (built, target, expected) => {
  expect(compatibleMacOSMinimum(built, target)).toBe(expected);
});

it('reads the highest macOS minimum a Mach-O file declares', () => {
  const slice = (minimum: string) =>
    `Load command 10\n      cmd LC_BUILD_VERSION\n platform MACOS\n    minos ${minimum}\n      sdk 26.5\n`;
  expect(buildVersionMinimum('Generated.dylib:\n' + slice('13.3'))).toBe('13.3');
  expect(buildVersionMinimum(slice('13.0') + slice('14.2'))).toBe('14.2');
  expect(buildVersionMinimum('Generated without a build version\n')).toBeUndefined();
  expect(compatibleMacOSMinimum('13.3', macOSMinimum)).toBe(true);
});
