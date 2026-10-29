import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { fidelityWorkbook, fidelityWord, fidelityStyles } from './office-fidelity-fixtures';
import { extractOffice } from '../src/desktop/previews/office';
import { workbookFormatter } from '../src/desktop/previews/office-formatting';
import { officeXML } from '../src/desktop/previews/office-xml';
import { officeImageParts } from '../src/domain/previews/documents/office';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-office-fidelity-');
});
afterEach(async () => {
  await trashTemporary(root);
});
it('formats numeric presentation while retaining stored values, formulas and cell evidence', async () => {
  const file = path.join(root, 'Report.xlsx');
  await writeFile(file, fidelityWorkbook());
  const doc = await extractOffice(file, undefined, { sheet: 'Report', fromRow: 1, limit: 100 });
  if (doc.office?.kind !== 'workbook') throw Error('Expected workbook');
  const cells = doc.office.sheets[0]!.rows.find((row) => row.row === 2)!.cells;
  expect(cells.find((cell) => cell.column === 4)).toMatchObject({
    value: '1234.5',
    formatted: '$1,234.50',
  });
  expect(cells.find((cell) => cell.column === 5)).toMatchObject({
    value: '0.125',
    formatted: '12.50%',
  });
  expect(cells.find((cell) => cell.column === 6)).toMatchObject({
    value: '60',
    formatted: '1900-02-29',
  });
  expect(cells.find((cell) => cell.column === 7)).toMatchObject({
    value: '1234.5',
    formula: 'SUM(D2)',
    cached: true,
    formatted: '$1,234.50',
  });
  expect(cells.find((cell) => cell.column === 8)).toMatchObject({
    value: '42',
    formatWarning: expect.stringContaining('stored value'),
  });
  expect(cells.find((cell) => cell.column === 9)).toMatchObject({
    value: '1.5',
    formatted: '36:00:00',
  });
  expect(doc.evidence.find((item) => item.source === 'Report!D2')?.text).toBe('1234.5');
});
it('handles the 1900 leap-day convention and 1904 date base without recalculation', () => {
  const styles = officeXML(Buffer.from(fidelityStyles)),
    old = workbookFormatter(styles, false),
    modern = workbookFormatter(styles, true);
  expect(old('59', 'n', '3').formatted).toBe('1900-02-28');
  expect(old('61', 'n', '3').formatted).toBe('1900-03-01');
  expect(modern('0', 'n', '3').formatted).toBe('1904-01-01');
  expect(modern('59', 'n', '3').formatted).toBe('1904-02-29');
});
it('loads a merged range anchor outside the requested page and keeps true source coordinates', async () => {
  const file = path.join(root, 'Report.xlsx');
  await writeFile(file, fidelityWorkbook());
  const doc = await extractOffice(file, undefined, { sheet: 'Report', fromRow: 100, limit: 100 });
  if (doc.office?.kind !== 'workbook') throw Error('Expected workbook');
  expect(doc.office.sheets[0]!.rows.map((row) => row.row)).toEqual([100, 104]);
  expect(doc.office.sheets[0]!.merges?.find((merge) => merge.fromRow === 3)).toMatchObject({
    fromRow: 3,
    toRow: 104,
    fromColumn: 1,
    toColumn: 3,
    anchor: { column: 1, value: 'Continued source range' },
  });
  expect(doc.office.page?.lastRow).toBe(104);
  expect(doc.evidence.some((item) => item.source === 'Report!A3')).toBe(false);
});
it('rejects malformed or overlapping merged ranges after the retained rows', async () => {
  const file = path.join(root, 'Overlap.xlsx');
  await writeFile(
    file,
    fidelityWorkbook(false, {
      'xl/worksheets/data.xml':
        '<worksheet><sheetData/><mergeCells><mergeCell ref="A1:C9"/><mergeCell ref="B2:D3"/></mergeCells></worksheet>',
    }),
  );
  await expect(extractOffice(file)).rejects.toThrow('Overlapping');
});
it('retains embedded image order and alt text without exposing external or unsupported image parts', async () => {
  const image = await readFile(path.resolve('tools/playground/assets/study.png')),
    file = path.join(root, 'Report.docx');
  await writeFile(file, fidelityWord(image));
  const doc = await extractOffice(file);
  if (doc.office?.kind !== 'word') throw Error('Expected Word');
  const paragraph = doc.office.blocks[1];
  expect(paragraph).toMatchObject({
    kind: 'paragraph',
    text: 'Before the image.After the image.',
    inlines: [
      { kind: 'text', text: 'Before the image.' },
      { kind: 'image', part: 'word/media/study.png', alt: 'Material study' },
      { kind: 'text', text: 'After the image.' },
    ],
  });
  expect(officeImageParts(doc.office)).toEqual(['word/media/study.png', 'word/media/study.png']);
  expect(doc.office.blocks[3]).toMatchObject({
    inlines: [{ kind: 'image', warning: 'External images are not loaded.' }],
  });
  expect(doc.office.blocks[4]).toMatchObject({
    inlines: [{ kind: 'image', warning: 'Only embedded PNG and JPEG images are shown.' }],
  });
  expect(
    doc.evidence[doc.evidence.findIndex((item) => item.source === 'document block 2')]?.text,
  ).toBe('Before the image.After the image.');
});
it('refuses image relationships that escape the document package', async () => {
  const image = await readFile(path.resolve('tools/playground/assets/study.png')),
    file = path.join(root, 'Escape.docx');
  await writeFile(
    file,
    fidelityWord(image, {
      'word/custom/_rels/document.xml.rels':
        '<Relationships><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../../../private.png"/></Relationships>',
    }),
  );
  await expect(extractOffice(file)).rejects.toThrow('escapes');
});
it('reads macro and template packages as the documents they are, and checks each declared type', async () => {
  const swap = (bytes: Uint8Array, from: string, to: string) => {
    const files = unzipSync(bytes);
    const types = strFromU8(files['[Content_Types].xml']!);
    expect(types).toContain(from);
    return zipSync({ ...files, '[Content_Types].xml': strToU8(types.replace(from, to)) });
  };
  const image = await readFile(path.resolve('tools/playground/assets/study.png'));
  const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
  const sheet = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  for (const [extension, type] of [
    ['docm', 'application/vnd.ms-word.document.macroEnabled.main+xml'],
    ['dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'],
  ] as const) {
    const file = path.join(root, `Fidelity.${extension}`);
    await writeFile(file, swap(fidelityWord(image), word, type));
    expect((await extractOffice(file)).office?.kind).toBe('word');
  }
  const book = path.join(root, 'Fidelity.xlsm');
  await writeFile(
    book,
    swap(fidelityWorkbook(), sheet, 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'),
  );
  const workbook = await extractOffice(book, undefined, { sheet: 'Report', fromRow: 1, limit: 10 });
  expect(workbook.office?.kind).toBe('workbook');
  // a document declared as another type is refused
  const mismatched = path.join(root, 'Mismatched.docm');
  await writeFile(mismatched, fidelityWord(image));
  await expect(extractOffice(mismatched)).rejects.toThrow('does not match');
});
