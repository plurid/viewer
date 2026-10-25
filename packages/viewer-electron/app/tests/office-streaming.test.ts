import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from '../src/desktop/previews/formats';
import { officeFixture } from './office-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-office-streaming-');
});
afterEach(async () => {
  await trashTemporary(root);
});

const largeRows = () =>
  Array.from({ length: 9000 }, (_, index) => {
    const row = index + 1;
    return `<row r="${row}">${Array.from({ length: 20 }, (_, column) => `<c r="${String.fromCharCode(65 + column)}${row}"><v>${row}</v></c>`).join('')}</row>`;
  }).join('');

it('previews a worksheet larger than 4 MB while retaining bounded original cell addresses', async () => {
  const file = path.join(root, 'Large worksheet.xlsx');
  const xml = `<worksheet><sheetData>${largeRows()}</sheetData></worksheet>`;
  expect(Buffer.byteLength(xml)).toBeGreaterThan(4_000_000);
  const bytes = officeFixture('workbook', {
    'xl/worksheets/data.xml': xml,
    'xl/worksheets/hidden.xml': '<worksheet><sheetData/></worksheet>',
  });
  await writeFile(file, bytes);
  const result = await extractDocument(file);
  expect(result.office?.kind).toBe('workbook');
  if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
  const sheet = result.office.sheets[1];
  expect(sheet.rows).toHaveLength(2000);
  expect(sheet.rows[0].row).toBe(1);
  expect(sheet.rows[0].cells[0]).toMatchObject({ column: 1, value: '1' });
  expect(sheet.rows.at(-1)?.row).toBe(2000);
  expect(sheet.rows.at(-1)?.cells.at(-1)).toMatchObject({ column: 20, value: '2000' });
  expect(sheet.truncated).toBe(true);
  expect(result.truncated).toBe(true);
  expect(result.evidence.some((item) => item.source === 'Measurements!A1')).toBe(true);
});

it('still rejects malformed XML after the retained row budget is exhausted', async () => {
  const file = path.join(root, 'Malformed tail.xlsx');
  await writeFile(
    file,
    officeFixture('workbook', {
      'xl/worksheets/data.xml': `<worksheet><sheetData>${largeRows()}</sheetData><tail></worksheet>`,
    }),
  );
  await expect(extractDocument(file)).rejects.toThrow('Malformed or unsupported Office XML');
});

it('bounds retained inline text and formulas while continuing through later cells', async () => {
  const file = path.join(root, 'Long cells.xlsx');
  await writeFile(
    file,
    officeFixture('workbook', {
      'xl/worksheets/data.xml': `<worksheet><sheetData><row r="740"><c r="A740" t="inlineStr"><is><r><t>${'é'.repeat(100000)}</t></r><rPh><t>not cell text</t></rPh></is></c><c r="B740"><f>${'x'.repeat(100000)}</f><v>7</v></c><c r="C740"><v>8</v></c></row></sheetData></worksheet>`,
    }),
  );
  const result = await extractDocument(file);
  if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(result.office.sheets[1].rows[0]).toMatchObject({ row: 740 });
  const cells = result.office.sheets[1].rows[0].cells;
  expect(cells[0].value).toBe('é'.repeat(10000));
  expect(cells[1]).toMatchObject({ value: '7', formula: 'x'.repeat(10000), cached: true });
  expect(cells[2]).toMatchObject({ column: 3, value: '8' });
  expect(result.truncated).toBe(true);
});

it('never substitutes a truncated shared-string index or concatenates duplicate values', async () => {
  const file = path.join(root, 'Invalid cells.xlsx');
  for (const cell of [
    `<c r="A1" t="s"><v>${'0'.repeat(10000)}1</v></c>`,
    '<c r="A1"><v>1</v><v>2</v></c>',
  ]) {
    await writeFile(
      file,
      officeFixture('workbook', {
        'xl/worksheets/data.xml': `<worksheet><sheetData><row r="1">${cell}</row></sheetData></worksheet>`,
      }),
    );
    await expect(extractDocument(file)).rejects.toThrow();
  }
});
