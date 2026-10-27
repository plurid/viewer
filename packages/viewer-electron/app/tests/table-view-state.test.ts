import { expect, it } from 'vitest';
import { rememberTableView } from '../src/renderer/previews/DataTable';

it('retains independent sheet addresses and filters in a bounded history', () => {
  let views = rememberTableView({}, 'Materials', { row: 3, column: 4 });
  views = rememberTableView(views, 'Materials', { query: 'spacer' });
  views = rememberTableView(views, 'Notes', { query: 'finish' });
  expect(views.Materials).toEqual({ row: 3, column: 4, query: 'spacer' });
  expect(views.Notes).toEqual({ query: 'finish' });
  for (let i = 0; i < 30; i++)
    views = rememberTableView(views, 'Sheet ' + i, { query: 'q'.repeat(160) });
  expect(Object.keys(views).length).toBeLessThanOrEqual(16);
  expect(JSON.stringify(views).length * 2).toBeLessThanOrEqual(3000);
  expect(views['Sheet 29']).toEqual({ query: 'q'.repeat(160) });
});

it('handles a worksheet named __proto__ as data without changing the history prototype', () => {
  const views = rememberTableView({}, '__proto__', { row: 2, column: 3 });
  expect(Object.hasOwn(views, '__proto__')).toBe(true);
  expect(views['__proto__']).toEqual({ row: 2, column: 3 });
  expect(Object.getPrototypeOf(views)).toBe(Object.prototype);
});
