import { expect, it } from 'vitest';
import { parseDelimited } from '../src/domain/previews/data/delimited';
import {
  delimitedPreview,
  delimitedRows,
  tableMatches,
  tableSearchIndex,
} from '../src/renderer/previews/table-data';

it('bounds retained records/cells and still detects malformed quoted content in the omitted suffix', () => {
  const parsed = parseDelimited('name,note\nfirst,complete\nsecond,"unfinished', ',', {
    rows: 2,
    cells: 4,
  });
  expect(parsed.rows).toEqual([
    ['name', 'note'],
    ['first', 'complete'],
  ]);
  expect(parsed.truncated).toBe(true);
  expect(parsed.malformed).toBe(true);
  expect(parseDelimited('""').rows).toEqual([['']]);
  expect(parseDelimited('a,b,c\nd,e,f', ',', { cells: 4 }).rows).toEqual([['a', 'b', 'c'], ['d']]);
});

it('retains quoted line breaks, original row/column addresses and filter results', () => {
  const parsed = delimitedPreview('name,note\n"A, B","one\ntwo"\nthird,"said ""yes"""', ',');
  expect(parsed.malformed).toBe(false);
  expect(parsed.truncated).toBe(false);
  const rows = delimitedRows(parsed);
  expect(rows[0]).toMatchObject({
    row: 2,
    cells: [
      { column: 1, value: 'A, B' },
      { column: 2, value: 'one\ntwo' },
    ],
  });
  expect(rows[1]!.cells[1]).toEqual({ column: 2, value: 'said "yes"' });
  const index = tableSearchIndex(parsed.rows);
  expect([...tableMatches(index, 'THIRD')]).toEqual([1]);
  expect([...tableMatches(index, 'one\ntwo')]).toEqual([0]);
  expect([...tableMatches(index, 'missing')]).toEqual([]);
});

it('keeps large-table rows source-addressed after revisiting data beyond the cell cache', () => {
  const parsed = delimitedPreview(
    'id,value\n' + Array.from({ length: 3000 }, (_, row) => `${row},Item ${row}`).join('\n'),
    ',',
  );
  const rows = delimitedRows(parsed);
  for (const row of rows) expect(row.cells[0]!.value).toBe(String(row.row - 2));
  expect(rows[0]!.cells[1]).toEqual({ column: 2, value: 'Item 0' });
  expect(rows.at(-1)!.row).toBe(3001);
});

it('reports a column-limited prefix honestly and refuses inputs beyond the preview budget', () => {
  const parsed = delimitedPreview(
    Array.from({ length: 101 }, (_, index) => 'column' + index).join(','),
    ',',
  );
  expect(parsed.headers).toHaveLength(100);
  expect(parsed.truncated).toBe(true);
  expect(() => delimitedPreview('x'.repeat(4_000_001), ',')).toThrow('4 MB');
  expect(() => tableMatches([], 'x'.repeat(4097))).toThrow('4096');
});
