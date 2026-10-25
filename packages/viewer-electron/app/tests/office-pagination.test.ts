import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from '../src/desktop/previews/formats';
import { worksheetPageSchema } from '../src/domain/previews/documents/office';
import { officeFixture } from './office-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';

let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-office-pagination-');
});
afterEach(async () => {
  await trashTemporary(root);
});
const source = async (overrides: Record<string, string> = {}) => {
  const file = path.join(root, 'Workbook.xlsx');
  await writeFile(file, officeFixture('workbook', overrides));
  return file;
};

it('reads a requested source row beyond the legacy retained preview and supplies an exact continuation', async () => {
  const rows = Array.from(
    { length: 3000 },
    (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i + 1}</v></c></row>`,
  ).join('');
  const file = await source({
    'xl/worksheets/data.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });
  const result = await extractDocument(file, {
    worksheet: { sheet: 'Measurements', fromRow: 2401, limit: 100 },
  });
  if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(result.office.page).toMatchObject({
    sheet: 'Measurements',
    fromRow: 2401,
    nextRow: 2501,
    limited: false,
  });
  const sheet = result.office.sheets[1];
  expect(sheet.loaded).toBe(true);
  expect(sheet.rows).toHaveLength(100);
  expect(sheet.rows[0]).toEqual({ row: 2401, cells: [{ column: 1, value: '2401' }] });
  expect(sheet.rows.at(-1)?.row).toBe(2500);
  expect(result.evidence.some((item) => item.source === 'Measurements!A2401')).toBe(true);
});

it('loads each worksheet with its own budget and defaults to the first visible sheet', async () => {
  const rows = Array.from(
    { length: 2000 },
    (_, i) =>
      `<row r="${i + 1}">${Array.from(
        { length: 30 },
        (_, c) => `<c r="${String.fromCharCode(65 + (c % 26))}${i + 1}"><v>${i}</v></c>`,
      )
        .slice(0, 26)
        .join('')}</row>`,
  ).join('');
  const file = await source({
    'xl/worksheets/hidden.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });
  const result = await extractDocument(file, { worksheet: { fromRow: 1, limit: 100 } });
  if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(result.office.page?.sheet).toBe('Measurements');
  expect(result.office.sheets.map((sheet) => ({ name: sheet.name, loaded: sheet.loaded }))).toEqual(
    [
      { name: 'Hidden', loaded: false },
      { name: 'Measurements', loaded: true },
    ],
  );
  expect(result.office.sheets[1].rows.map((row) => row.row)).toEqual([1, 61, 104]);
  const hidden = await extractDocument(file, {
    worksheet: { sheet: 'Hidden', fromRow: 1700, limit: 100 },
  });
  if (hidden.office?.kind !== 'workbook') throw new Error('Missing hidden sheet');
  expect(hidden.office.sheets[0].rows[0].row).toBe(1700);
});

it('keeps sparse addresses and reports the end without inventing rows', async () => {
  const file = await source();
  const result = await extractDocument(file, {
    worksheet: { sheet: 'Measurements', fromRow: 2, limit: 1 },
  });
  if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(result.office.sheets[1].rows.map((row) => row.row)).toEqual([61]);
  expect(result.office.page?.nextRow).toBe(104);
  const end = await extractDocument(file, {
    worksheet: { sheet: 'Measurements', fromRow: 105, limit: 100 },
  });
  if (end.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(end.office.sheets[1].rows).toEqual([]);
  expect(end.office.page?.nextRow).toBeUndefined();
});

it('moves a whole row into the next page when the remaining character budget cannot fit it', async () => {
  const cells = (row: number, count: number) =>
    Array.from({ length: count }, () =>
      `<c><is><t>${String(row).repeat(10000)}</t></is></c>`.replace('<c>', '<c t="inlineStr">'),
    ).join('');
  const file = await source({
    'xl/worksheets/data.xml': `<worksheet><sheetData><row r="1">${cells(1, 40)}</row><row r="2">${cells(2, 20)}</row></sheetData></worksheet>`,
  });
  const first = await extractDocument(file, {
    worksheet: { sheet: 'Measurements', fromRow: 1, limit: 100 },
  });
  if (first.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(first.office.sheets[1].rows.map((row) => row.row)).toEqual([1]);
  expect(first.office.page).toMatchObject({ nextRow: 2, limited: false });
  const next = await extractDocument(file, {
    worksheet: { sheet: 'Measurements', fromRow: 2, limit: 100 },
  });
  if (next.office?.kind !== 'workbook') throw new Error('Missing workbook');
  expect(next.office.sheets[1].rows[0].cells).toHaveLength(20);
  expect(next.office.page?.nextRow).toBeUndefined();
});

it('rejects invalid windows, unknown sheets and malformed suffixes after the requested page', async () => {
  for (const options of [
    { fromRow: 0 },
    { fromRow: 1048577 },
    { limit: 101 },
    { limit: 0 },
    { other: true },
  ])
    expect(worksheetPageSchema.safeParse(options).success).toBe(false);
  const file = await source();
  await expect(
    extractDocument(file, { worksheet: { sheet: 'Unknown', fromRow: 1, limit: 100 } }),
  ).rejects.toThrow('worksheet');
  const broken = await source({
    'xl/worksheets/data.xml':
      '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row></sheetData><tail></worksheet>',
  });
  await expect(
    extractDocument(broken, { worksheet: { sheet: 'Measurements', fromRow: 1, limit: 1 } }),
  ).rejects.toThrow('Malformed');
});
