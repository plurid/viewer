import { strToU8, zipSync } from 'fflate';

/** Generated text exercises named East Asian families without proprietary fonts. */
export function officeFontFixture(): Uint8Array {
  const paragraphs = [
    ['MS Mincho', 'ja-JP', '日本語の明朝体'],
    ['Meiryo', 'ja-JP', '日本語のゴシック体'],
    ['SimSun', 'zh-CN', '简体中文宋体'],
    ['Microsoft YaHei', 'zh-CN', '简体中文黑体'],
    ['PMingLiU', 'zh-TW', '繁體中文明體'],
    ['Microsoft JhengHei', 'zh-TW', '繁體中文黑體'],
    ['MingLiU_HKSCS', 'zh-HK', '香港繁體中文'],
    ['Batang', 'ko-KR', '한국어 명조체'],
    ['Malgun Gothic', 'ko-KR', '한국어 고딕체'],
  ].map(
    ([font, language, text]) =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${font}" w:hint="eastAsia"/><w:sz w:val="28"/><w:lang w:val="en-US" w:eastAsia="${language}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`,
  );
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        paragraphs.join('') +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>',
    ),
  });
}
