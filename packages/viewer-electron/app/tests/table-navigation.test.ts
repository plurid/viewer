import { expect, it } from 'vitest';
import { moveTableCell, parseCellAddress } from '../src/domain/previews/documents/table-navigation';

it('parses bounded A1 addresses, including absolute and lowercase references', () => {
  expect(parseCellAddress(' $ab$42 ', 100)).toEqual({ row: 42, column: 28 });
  for (const value of ['A0', 'A1048577', 'AAAA1', 'A1:B3', 'B-2', '=A1', 'Z3'])
    expect(parseCellAddress(value, 10)).toBeUndefined();
});
it('moves through sparse source rows and requests a next page beyond the visible rows', () => {
  const move = (key: string, whole = false) =>
    moveTableCell({ row: 11, column: 2 }, key, [1, 11, 25], 4, 2, 1000, whole);
  expect(move('ArrowDown')).toEqual({ row: 25, column: 2 });
  expect(move('ArrowUp')).toEqual({ row: 1, column: 2 });
  expect(move('PageDown')).toEqual({ row: 26, column: 2 });
  expect(move('Home')).toEqual({ row: 11, column: 1 });
  expect(move('End', true)).toEqual({ row: 1000, column: 4 });
  expect(move('x')).toBeUndefined();
});
