import { expect, it } from 'vitest';
import { compatibleMacOSMinimum } from '../tools/native-build/macos-target';

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
