import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from '../src/desktop/formats';
import { inspectFile } from '../src/desktop/inspection';
import { FileIndex } from '../src/desktop/index-core';
import { entry } from '../src/desktop/filesystem';
import { defaultSettings } from '../src/domain/services';
import { columnName } from '../src/domain/office';
import { officeFixture, workbookSheet } from './office-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-office-');
});
afterEach(async () => {
  await trashTemporary(root);
});
const document = async (kind: 'word' | 'workbook', overrides: Record<string, string> = {}) => {
  const file = path.join(root, kind === 'word' ? 'Report.docx' : 'Measurements.xlsx');
  await writeFile(file, officeFixture(kind, overrides));
  return file;
};
describe('Office read-only adapters', () => {
  it('follows the actual main part, preserves Word paragraphs/tables, and excludes deleted text and field instructions', async () => {
    const result = await extractDocument(await document('word'));
    expect(result.metadata.title).toBe('Panel fabrication');
    expect(result.office).toMatchObject({
      kind: 'word',
      blocks: [
        { kind: 'paragraph', heading: 1, text: 'Panel fabrication' },
        { kind: 'paragraph', text: 'Știință & measurement\t200 mm\nSecond line' },
        {
          kind: 'table',
          rows: [
            ['Material', 'Thickness'],
            ['Steel', '3 mm'],
          ],
        },
        { kind: 'paragraph', text: '<iframe src="https://example.invalid">' },
      ],
    });
    expect(result.text).not.toContain('Deleted secret');
    expect(result.text).not.toContain('EXECUTE FIELD');
    expect(result.evidence.find((item) => item.text.includes('Știință'))?.anchor).toEqual({
      kind: 'document',
      block: 1,
    });
    expect(result.coverageReason).toContain('headers');
  });
  it('keeps sparse worksheet coordinates, Unicode shared strings, booleans, error values and unevaluated formulas', async () => {
    const result = await extractDocument(await document('workbook'));
    if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
    expect(
      result.office.sheets.map((sheet) => ({ name: sheet.name, hidden: sheet.hidden })),
    ).toEqual([
      { name: 'Hidden', hidden: true },
      { name: 'Measurements', hidden: false },
    ]);
    const sheet = result.office.sheets[1];
    expect(sheet.rows.map((row) => row.row)).toEqual([1, 61, 104]);
    expect(sheet.rows[0].cells[0].value).toBe('Știință & CAD');
    expect(sheet.rows[1].cells[1]).toMatchObject({
      column: 2,
      value: '20',
      formula: 'SUM(B1,7.5)',
      cached: true,
    });
    expect(sheet.rows[1].cells[2]).toMatchObject({ column: 3, value: '', cached: false });
    expect(sheet.rows[2].cells.map((cell) => cell.value)).toEqual([
      'TRUE',
      '#DIV/0!',
      '<script>alert(1)</script>',
    ]);
    expect(result.office.missingCached).toBe(1);
    expect(result.evidence.find((item) => item.source === 'Measurements!B61')).toMatchObject({
      text: '20',
      anchor: { kind: 'cells', sheet: 'Measurements', row: 61, column: 2 },
    });
    expect(result.coverageReason).toContain('not recalculated');
    expect(columnName(16384)).toBe('XFD');
  });
  it('indexes original cell and paragraph anchors and reports partial coverage instead of full Office fidelity', async () => {
    const index = await FileIndex.open(path.join(root, 'index.sqlite'));
    try {
      index.configure({
        ...defaultSettings(root).search,
        roots: [root],
        contentRoots: [root],
        paused: true,
      });
      for (const kind of ['word', 'workbook'] as const) {
        const file = await document(kind),
          data = await extractDocument(file);
        index.put(await entry(file), root, Date.now(), data);
        const inspection = await inspectFile(file, { content: true });
        expect(inspection.coverage.content).toBe('partial');
        expect(inspection.coverage.reason).toContain(
          kind === 'word' ? 'Page layout' : 'Saved cell values',
        );
        if (kind === 'workbook')
          expect(inspection.facts.worksheets).toEqual({
            value: 2,
            source: 'bounded worksheet reader; retained sheets',
          });
      }
      const hits = index.query({ query: 'stiinta', root, content: true }).evidence!;
      expect(hits).toHaveLength(2);
      expect(hits.map((hit) => hit.anchor.kind).sort()).toEqual(['cells', 'document']);
      expect(hits.every((hit) => hit.coverage === 'partial' && hit.quote.includes('Știință'))).toBe(
        true,
      );
      index.configure({
        ...defaultSettings(root).search,
        roots: [root],
        contentRoots: [],
        paused: true,
      });
      expect(index.query({ query: 'stiinta', root, content: true }).entries).toHaveLength(0);
    } finally {
      index.close();
    }
  });
  it('rejects package traversal, external main parts, DTD entities, broken shared strings, and duplicate cell addresses', async () => {
    const rel =
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
    const invalidParts: Record<string, string>[] = [
      {
        '_rels/.rels': `<Relationships><Relationship Id="x" Type="${rel}" Target="../escape.xml"/></Relationships>`,
      },
      {
        '_rels/.rels': `<Relationships><Relationship Id="x" Type="${rel}" Target="https://example.invalid" TargetMode="External"/></Relationships>`,
      },
      {
        'xl/sharedStrings.xml':
          '<!DOCTYPE sst [<!ENTITY read SYSTEM "file:///etc/passwd">]><sst><si><t>&read;</t></si></sst>',
      },
      { 'xl/sharedStrings.xml': '<sst/>' },
      { 'xl/worksheets/data.xml': workbookSheet.replace('r="B61"', 'r="A61"') },
    ];
    for (const overrides of invalidParts)
      await expect(extractDocument(await document('workbook', overrides))).rejects.toThrow();
  });
  it('fails closed on corrupted/encrypted containers, wrong document types, deep XML, oversized parts and symlink sources', async () => {
    const file = await document('word');
    await writeFile(file, officeFixture('workbook'));
    await expect(extractDocument(file)).rejects.toThrow('type');
    await writeFile(file, 'encrypted OLE document');
    await expect(extractDocument(file)).rejects.toThrow();
    for (const xml of [
      '<w:document>' + '<x>'.repeat(70) + '</x>'.repeat(70) + '</w:document>',
      '<w:document>' + 'a'.repeat(4000000) + '</w:document>',
      '<w:document><w:body></w:document>',
    ])
      await expect(
        extractDocument(await document('word', { 'word/custom/document.xml': xml })),
      ).rejects.toThrow();
    const target = await document('word'),
      link = path.join(root, 'Link.docx');
    await symlink(target, link);
    await expect(extractDocument(link)).rejects.toThrow('regular');
  });
  it('bounds worksheet rows and columns without renumbering the retained source cells', async () => {
    const rows = Array.from(
      { length: 2001 },
      (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c></row>`,
    ).join('');
    const result = await extractDocument(
      await document('workbook', {
        'xl/worksheets/data.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
      }),
    );
    if (result.office?.kind !== 'workbook') throw new Error('Missing workbook');
    expect(result.office.sheets[1].rows).toHaveLength(2000);
    expect(result.office.sheets[1].rows.at(-1)?.row).toBe(2000);
    expect(result.truncated).toBe(true);
    const wide = await extractDocument(
      await document('workbook', {
        'xl/worksheets/data.xml':
          '<worksheet><sheetData><row r="500"><c r="XFD500"><v>99</v></c></row></sheetData></worksheet>',
      }),
    );
    expect(wide.truncated).toBe(true);
    expect(wide.evidence.some((item) => item.text === '99')).toBe(false);
  });
  it('supports XML entities once and honours cancellation without returning partial unmarked data', async () => {
    const file = await document('word', {
      'word/custom/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>&amp;lt; &#x1f4cf; &#537; &quot;quoted&quot;</w:t></w:r></w:p></w:body></w:document>',
    });
    expect((await extractDocument(file)).evidence[2].text).toBe('&lt; 📏 ș "quoted"');
    const controller = new AbortController();
    controller.abort();
    await expect(extractDocument(file, { signal: controller.signal })).rejects.toThrow();
  });
});
