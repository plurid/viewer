import { strToU8, zipSync } from 'fflate';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const wordNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const workbookSheet = `<worksheet xmlns="${sheetNS}"><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12.5</v></c></row>
  <row r="61"><c r="A61" t="inlineStr"><is><t>Panel front</t></is></c><c r="B61"><f>SUM(B1,7.5)</f><v>20</v></c><c r="C61"><f>HYPERLINK("https://example.invalid", "external")</f></c></row>
  <row r="104"><c r="B104" t="b"><v>1</v></c><c r="C104" t="e"><v>#DIV/0!</v></c><c r="D104" t="str"><v>&lt;script&gt;alert(1)&lt;/script&gt;</v></c></row>
</sheetData></worksheet>`;
export function officeFixture(
  kind: 'word' | 'workbook',
  overrides: Record<string, string> = {},
): Uint8Array {
  const main = kind === 'word' ? 'word/custom/document.xml' : 'xl/workbook.xml';
  const parts: Record<string, string> = {
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${rel}officeDocument" Target="${main}"/><Relationship Id="meta" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${kind === 'word' ? 'wordprocessingml.document' : 'spreadsheetml.sheet'}.main+xml"/></Types>`,
    'docProps/core.xml':
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Panel fabrication</dc:title><dc:creator>Viewer fixture</dc:creator></cp:coreProperties>',
  };
  if (kind === 'word')
    parts[main] = `<w:document xmlns:w="${wordNS}"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Panel fabrication</w:t></w:r></w:p>
    <w:p><w:r><w:t>Știință &amp; measurement</w:t><w:tab/><w:t>200 mm</w:t><w:br/><w:t>Second line</w:t></w:r><w:del><w:r><w:delText>Deleted secret</w:delText></w:r></w:del><w:r><w:instrText>EXECUTE FIELD</w:instrText></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Material</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Thickness</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Steel</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3 mm</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:hyperlink><w:r><w:t>&lt;iframe src="https://example.invalid"&gt;</w:t></w:r></w:hyperlink></w:p>
  </w:body></w:document>`;
  else
    Object.assign(parts, {
      [main]: `<workbook xmlns="${sheetNS}" xmlns:r="${rel}"><sheets><sheet name="Hidden" sheetId="1" state="hidden" r:id="hidden"/><sheet name="Measurements" sheetId="2" r:id="data"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="hidden" Type="${rel}worksheet" Target="worksheets/hidden.xml"/><Relationship Id="data" Type="${rel}worksheet" Target="worksheets/data.xml"/><Relationship Id="strings" Type="${rel}sharedStrings" Target="sharedStrings.xml"/><Relationship Id="external" Type="${rel}externalLink" Target="https://example.invalid" TargetMode="External"/></Relationships>`,
      'xl/sharedStrings.xml': `<sst xmlns="${sheetNS}"><si><r><t>Știință</t></r><r><t> &amp; CAD</t></r></si></sst>`,
      'xl/worksheets/data.xml': workbookSheet,
      'xl/worksheets/hidden.xml': `<worksheet xmlns="${sheetNS}"><sheetData><row r="4"><c r="B4" t="inlineStr"><is><t>Hidden source</t></is></c></row></sheetData></worksheet>`,
    });
  return zipSync(
    Object.fromEntries(
      Object.entries({ ...parts, ...overrides }).map(([name, xml]) => [name, strToU8(xml)]),
    ),
  );
}
