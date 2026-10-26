import { expect, it } from 'vitest';
import { planeIsActive } from '../src/renderer/previews/activity';

it('keeps painted frozen planes live when the camera zooms out', () => {
  expect(planeIsActive({ shown: true, culled: 'visible' })).toBe(true);
  expect(planeIsActive({ shown: true, culled: 'frozen' })).toBe(true);
  expect(planeIsActive({ shown: false, culled: 'visible' })).toBe(false);
  expect(planeIsActive({ shown: false, culled: 'frozen' })).toBe(false);
  expect(planeIsActive({ shown: true, culled: 'hidden' })).toBe(false);
  expect(planeIsActive({ shown: true, culled: 'detached' })).toBe(false);
});
