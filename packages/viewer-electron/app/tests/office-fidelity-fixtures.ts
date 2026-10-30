import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { officeFixture } from './office-fixtures';
export const relationNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const sheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const fidelityStyles = `<styleSheet xmlns="${sheetNS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="[DBNum1]0"/></numFmts><cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="46"/></cellXfs></styleSheet>`;
// Pages hold 100 rows that exist, so the merge A3:C104 reaches a second page only when rows 4 to
// 99 exist too.
const fillerRows = Array.from(
  { length: 96 },
  (_, index) => `<row r="${index + 4}"><c r="D${index + 4}"><v>0</v></c></row>`,
).join('');
export function fidelityWorkbook(date1904 = false, changes: Record<string, string> = {}) {
  return officeFixture('workbook', {
    'xl/workbook.xml': `<workbook xmlns="${sheetNS}" xmlns:r="${relationNS}"><workbookPr date1904="${date1904 ? '1' : '0'}"/><sheets><sheet name="Report" sheetId="1" r:id="data"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="data" Type="${relationNS}worksheet" Target="worksheets/data.xml"/><Relationship Id="styles" Type="${relationNS}styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': fidelityStyles,
    'xl/worksheets/data.xml': `<worksheet xmlns="${sheetNS}"><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Quarterly materials</t></is></c></row>
  <row r="2"><c r="D2" s="1"><v>1234.5</v></c><c r="E2" s="2"><v>0.125</v></c><c r="F2" s="3"><v>60</v></c><c r="G2" s="1"><f>SUM(D2)</f><v>1234.5</v></c><c r="H2" s="4"><v>42</v></c><c r="I2" s="5"><v>1.5</v></c></row>
  <row r="3"><c r="A3" t="inlineStr"><is><t>Continued source range</t></is></c><c r="D3"><v>1</v></c></row>
  ${fillerRows}
  <row r="100"><c r="D100"><v>7</v></c></row><row r="104"><c r="D104"><v>8</v></c></row>
  </sheetData><mergeCells count="2"><mergeCell ref="A1:C2"/><mergeCell ref="A3:C104"/></mergeCells></worksheet>`,
    ...changes,
  });
}
export function fidelityWord(image: Uint8Array, changes: Record<string, string | Uint8Array> = {}) {
  const draw = (id: string, alt: string) =>
    `<w:r><w:drawing><wp:inline><wp:extent cx="3810000" cy="2286000"/><wp:docPr id="1" descr="${alt}"/><a:graphic><a:graphicData><a:blip r:embed="${id}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const base = unzipSync(officeFixture('word'));
  const types = strFromU8(base['[Content_Types].xml']!).replace(
    '</Types>',
    '<Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/></Types>',
  );
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': types,
    'word/custom/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${relationNS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Materials report</w:t></w:r></w:p>
  <w:p><w:r><w:t>Before the image.</w:t></w:r>${draw('picture', 'Material study')}<w:r><w:t>After the image.</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table photograph</w:t></w:r>${draw('picture', 'Table study')}</w:p></w:tc></w:tr></w:tbl>
  <w:p>${draw('outside', 'External reference')}</w:p><w:p>${draw('vector', 'Unsupported diagram')}</w:p>
  </w:body></w:document>`,
    'word/custom/_rels/document.xml.rels': `<Relationships><Relationship Id="picture" Type="${relationNS}image" Target="../media/study.png"/><Relationship Id="outside" Type="${relationNS}image" Target="https://example.invalid/image.png" TargetMode="External"/><Relationship Id="vector" Type="${relationNS}image" Target="../media/diagram.svg"/></Relationships>`,
    'word/media/study.png': image,
    'word/media/diagram.svg':
      '<svg xmlns="http://www.w3.org/2000/svg"><script>invalid()</script></svg>',
    ...changes,
  };
  return zipSync({
    ...base,
    ...Object.fromEntries(
      Object.entries(parts).map(([name, value]) => [
        name,
        typeof value === 'string' ? strToU8(value) : value,
      ]),
    ),
  });
}
