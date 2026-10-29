import { crc32, deflateSync } from 'node:zlib';
import type { Sample } from '../types';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { office as officeOpenXML, sample, zip } from './documents';

const office = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const namespaces = [
  `xmlns:office="${office}"`,
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
].join(' ');

/** What each kind of OpenDocument holds in its body, and its MIME type. */
const kinds = {
  text: {
    mime: 'application/vnd.oasis.opendocument.text',
    body: `<office:text>
      <text:h text:outline-level="1">Field notes</text:h>
      <text:p>A short walk, a few photographs and time to look around.</text:p>
      <text:p>Bring a camera, water and a little extra time.</text:p>
    </office:text>`,
  },
  spreadsheet: {
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    body: `<office:spreadsheet>
      <table:table table:name="Materials">
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell>
          <table:table-cell office:value-type="string"><text:p>Count</text:p></table:table-cell>
        </table:table-row>
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>Notebook</text:p></table:table-cell>
          <table:table-cell office:value-type="float" office:value="2"><text:p>2</text:p></table:table-cell>
        </table:table-row>
      </table:table>
      <table:table table:name="Notes">
        <table:table-row>
          <table:table-cell office:value-type="string"><text:p>Second sheet</text:p></table:table-cell>
        </table:table-row>
      </table:table>
    </office:spreadsheet>`,
  },
  presentation: {
    mime: 'application/vnd.oasis.opendocument.presentation',
    body: `<office:presentation>
      <draw:page draw:name="Field notes">
        <draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm">
          <draw:text-box><text:p>Field notes: a weekend outdoors</text:p></draw:text-box>
        </draw:frame>
      </draw:page>
    </office:presentation>`,
  },
  drawing: {
    mime: 'application/vnd.oasis.opendocument.graphics',
    body: `<office:drawing>
      <draw:page draw:name="Plan">
        <draw:rect svg:x="2cm" svg:y="2cm" svg:width="8cm" svg:height="5cm">
          <text:p>Picnic spot</text:p>
        </draw:rect>
      </draw:page>
    </office:drawing>`,
  },
} as const;
type Kind = keyof typeof kinds;

const content = (kind: Kind) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${namespaces} office:version="1.3">
  <office:body>${kinds[kind].body}</office:body>
</office:document-content>
`;

type Mark = [left: number, top: number, width: number, height: number];
const outline = ([left, top, width, height]: Mark): Mark[] => [
  [left, top, width, 1],
  [left, top + height - 1, width, 1],
  [left, top, 1, height],
  [left + width - 1, top, 1, height],
];
/** Each kind's first page, as its editor pictures it: the page's shape and its content's marks. */
const pictures: Record<Kind, { width: number; height: number; marks: Mark[] }> = {
  text: {
    width: 181,
    height: 256,
    marks: [
      [20, 22, 72, 8],
      [20, 40, 140, 3],
      [20, 48, 128, 3],
    ],
  },
  spreadsheet: {
    width: 181,
    height: 256,
    marks: [...outline([20, 20, 70, 22]), [20, 30, 70, 1], [55, 20, 1, 22]],
  },
  presentation: { width: 256, height: 144, marks: [[18, 22, 150, 9]] },
  drawing: { width: 181, height: 256, marks: outline([17, 17, 69, 43]) },
};
/** The PNG an OpenDocument editor stores in `Thumbnails/thumbnail.png`. */
function pagePicture(kind: Kind): Uint8Array {
  const { width, height, marks } = pictures[kind];
  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y++) pixels[y * stride] = 0;
  for (const [left, top, across, down] of marks)
    for (let y = top; y < top + down; y++)
      pixels.fill(0x58, y * stride + 1 + left * 3, y * stride + 1 + (left + across) * 3);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  // eight bits a channel, RGB
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A packaged OpenDocument: its MIME type first and stored, then the manifest, content and the
 * picture of its first page. */
export function openDocument(kind: Kind): Uint8Array {
  return zip({
    mimetype: kinds[kind].mime,
    'META-INF/manifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${kinds[kind].mime}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/>
</manifest:manifest>
`,
    'content.xml': content(kind),
    'Thumbnails/thumbnail.png': pagePicture(kind),
  });
}

/** The same document as one XML file, the "flat" OpenDocument form. */
export function flatOpenDocument(kind: Kind): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document ${namespaces} office:version="1.3" office:mimetype="${kinds[kind].mime}">
  <office:body>${kinds[kind].body}</office:body>
</office:document>
`;
}

export const richText = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fswiss Helvetica;}}
\f0\fs32\b Field notes\b0\par
\fs24 A short walk, a few photographs and time to look around.\par
}
`;

const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const presentationML = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawingML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const presentationTypes = 'application/vnd.openxmlformats-officedocument.presentationml';
const slideNamespaces = `xmlns:a="${drawingML}" xmlns:r="${officeRelations}" xmlns:p="${presentationML}"`;
const group =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const relationships = (...targets: [id: string, type: string, target: string][]) =>
  `<Relationships xmlns="${packageRelations}">${targets
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${officeRelations}/${type}" Target="${target}"/>`,
    )
    .join('')}</Relationships>`;
const scheme = (name: string) => `<a:solidFill><a:schemeClr val="${name}"/></a:solidFill>`;
const three = (item: string) => item + item + item;

/** The smallest presentation PowerPoint and the Office engine both open: one slide, its layout,
 * master and theme. */
export function presentation(): Uint8Array {
  const colors = ['81B7CF', 'D7A56B', '6BA368', 'C46A6A', '8A7FC2', '5E8C9A']
    .map(
      (value, index) => `<a:accent${index + 1}><a:srgbClr val="${value}"/></a:accent${index + 1}>`,
    )
    .join('');
  const fonts = '<a:latin typeface="Helvetica"/><a:ea typeface=""/><a:cs typeface=""/>';
  return zip({
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="${presentationTypes}.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="${presentationTypes}.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${presentationTypes}.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${presentationTypes}.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>
`,
    '_rels/.rels': relationships(['main', 'officeDocument', 'ppt/presentation.xml']),
    'ppt/presentation.xml': `<p:presentation ${slideNamespaces}>
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
`,
    'ppt/_rels/presentation.xml.rels': relationships(
      ['master', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['slide', 'slide', 'slides/slide1.xml'],
      ['theme', 'theme', 'theme/theme1.xml'],
    ),
    'ppt/slides/slide1.xml': `<p:sld ${slideNamespaces}><p:cSld><p:spTree>${group}
  <p:sp>
    <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="838200" y="2286000"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4400"/><a:t>Field notes: a weekend outdoors</a:t></a:r></a:p></p:txBody>
  </p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>
`,
    'ppt/slides/_rels/slide1.xml.rels': relationships([
      'layout',
      'slideLayout',
      '../slideLayouts/slideLayout1.xml',
    ]),
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${slideNamespaces}><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>
`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relationships([
      'master',
      'slideMaster',
      '../slideMasters/slideMaster1.xml',
    ]),
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${slideNamespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="layout"/></p:sldLayoutIdLst>
</p:sldMaster>
`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationships(
      ['layout', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['theme', 'theme', '../theme/theme1.xml'],
    ),
    'ppt/theme/theme1.xml': `<a:theme xmlns:a="${drawingML}" name="Field notes"><a:themeElements>
  <a:clrScheme name="Field notes"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="192833"/></a:dk2><a:lt2><a:srgbClr val="E2EDF2"/></a:lt2>${colors}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
  <a:fontScheme name="Field notes"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme>
  <a:fmtScheme name="Field notes">
    <a:fillStyleLst>${three(scheme('phClr'))}</a:fillStyleLst>
    <a:lnStyleLst>${three(`<a:ln w="9525">${scheme('phClr')}</a:ln>`)}</a:lnStyleLst>
    <a:effectStyleLst>${three('<a:effectStyle><a:effectLst/></a:effectStyle>')}</a:effectStyleLst>
    <a:bgFillStyleLst>${three(scheme('phClr'))}</a:bgFillStyleLst>
  </a:fmtScheme>
</a:themeElements></a:theme>
`,
  });
}

/** Macro-enabled, template and show packages differ from the plain one only in the main part's
 * declared type; these carry no macros. */
const variants = {
  docx: {
    from: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    to: {
      docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
      dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
      dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
    },
  },
  xlsx: {
    from: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    to: {
      xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
      xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
      xltm: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
    },
  },
  pptx: {
    from: presentationTypes + '.presentation.main+xml',
    to: {
      pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
      ppsx: presentationTypes + '.slideshow.main+xml',
      potx: presentationTypes + '.template.main+xml',
      potm: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
    },
  },
} as const;
function declared(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const files = unzipSync(bytes);
  const types = strFromU8(files['[Content_Types].xml']!);
  if (!types.includes(from)) throw new Error('The package does not declare ' + from);
  return zip({ ...files, '[Content_Types].xml': strToU8(types.replace(from, to)) });
}
function packageVariants(): Sample[] {
  const sources = {
    docx: officeOpenXML('docx'),
    xlsx: officeOpenXML('xlsx'),
    pptx: presentation(),
  };
  return Object.entries(variants).flatMap(([kind, { from, to }]) =>
    Object.entries(to).map(([extension, type]) =>
      sample(
        `previews/documents/Field notes.${extension}`,
        [extension],
        'Office layout',
        `A ${kind.toUpperCase()} package declared as .${extension}, without macros.`,
        declared(sources[kind as keyof typeof sources], from, type),
      ),
    ),
  );
}

/** One file per OpenDocument kind, each also flat, and a Rich Text file. */
export function officeSamples(): Sample[] {
  const kindsWithExtensions: [Kind, string, string][] = [
    ['text', 'odt', 'fodt'],
    ['spreadsheet', 'ods', 'fods'],
    ['presentation', 'odp', 'fodp'],
    ['drawing', 'odg', 'fodg'],
  ];
  return [
    ...kindsWithExtensions.flatMap(([kind, packaged, flat]) => [
      sample(
        `previews/documents/Field notes.${packaged}`,
        [packaged],
        'Office layout',
        `A small OpenDocument ${kind}, laid out by the bundled engine.`,
        openDocument(kind),
      ),
      sample(
        `previews/documents/Field notes.${flat}`,
        [flat],
        'Office layout',
        `The flat XML form of an OpenDocument ${kind}.`,
        flatOpenDocument(kind),
      ),
    ]),
    ...packageVariants(),
    sample(
      'previews/documents/Field notes.rtf',
      ['rtf'],
      'Office layout',
      'Rich Text with a heading and a paragraph.',
      richText,
    ),
  ];
}
