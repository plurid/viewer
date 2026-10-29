import { expect, it } from 'vitest';
import {
  checkCopyRange,
  rangeLabel,
  tableBounds,
  tableTSV,
} from '../src/domain/previews/documents/table-selection';

const range = { fromRow: 1, toRow: 3, fromColumn: 1, toColumn: 2 };
it('normalizes backwards ranges and includes intersecting merged cells', () => {
  const selected = tableBounds({ anchor: { row: 3, column: 2 }, focus: { row: 1, column: 1 } }, [
    { fromRow: 3, toRow: 4, fromColumn: 2, toColumn: 3 },
    { fromRow: 4, toRow: 5, fromColumn: 3, toColumn: 4 },
  ]);
  expect(rangeLabel(selected)).toBe('A1:D5');
});
it('copies source gaps, quoted tabs/newlines and saved values without evaluating formulas', () => {
  const rows = [
    {
      row: 1,
      cells: [
        { column: 1, value: 'a\tb"c' },
        { column: 2, value: '12.5', formatted: '$12.50' },
      ],
    },
    {
      row: 3,
      cells: [
        { column: 1, value: '', formula: '1+1', cached: false },
        { column: 2, value: 'two\nlines' },
      ],
    },
  ];
  expect(tableTSV(range, rows, [], true)).toBe('"a\tb""c"\t$12.50\n\t\n\t"two\nlines"');
  expect(tableTSV({ ...range, toRow: 1 }, rows, [], false)).toContain('\t12.5');
});
it('copies a merged value once and leaves its covered cells empty', () => {
  const rows = [{ row: 1, cells: [{ column: 1, value: 'Merged' }] }];
  expect(tableTSV(range, rows, [{ ...range, toRow: 2 }], false)).toBe('Merged\t\n\t\n\t');
  expect(
    tableTSV(
      range,
      [],
      [{ ...range, toRow: 2, anchor: { column: 1, value: 'Outside page anchor' } }],
      false,
    ),
  ).toContain('Outside page anchor');
});
it('rejects excessive or invalid selections before allocating their data', () => {
  expect(() => checkCopyRange({ ...range, toRow: 1048576 })).toThrow('10,000');
  expect(() => checkCopyRange({ ...range, fromRow: NaN })).toThrow('valid');
  expect(() =>
    tableTSV(
      { ...range, toRow: 1, toColumn: 1 },
      [{ row: 1, cells: [{ column: 1, value: '文'.repeat(400000) }] }],
      [],
      false,
    ),
  ).toThrow('1 MiB');
});
