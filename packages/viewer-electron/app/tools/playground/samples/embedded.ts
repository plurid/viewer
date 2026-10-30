import type { Sample } from '../types';
import { sample, zip } from './documents';

/** The study images each container carries as the picture its app saved. */
export interface EmbeddedImages {
  jpeg: Uint8Array;
  png: Uint8Array;
  thumbnail: Uint8Array;
}

const properties = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>isMultiPage</key>
  <false/>
</dict>
</plist>
`;
const iWork: [extension: string, application: string][] = [
  ['pages', 'Pages'],
  ['numbers', 'Numbers'],
  ['key', 'Keynote'],
];

const kritaDocument = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DOC PUBLIC '-//KDE//DTD krita 2.0//EN' 'http://www.calligra.org/DTD/krita-2.0.dtd'>
<DOC xmlns="http://www.calligra.org/DTD/krita" syntaxVersion="2.0" editor="Krita"
     kritaVersion="5.2.2">
 <IMAGE name="Field notes" mime="application/x-kra" width="640" height="480"
        colorspacename="RGBA" x-res="72" y-res="72">
  <layers>
   <layer name="Background" filename="layer1" nodetype="paintlayer" visible="1"
          opacity="255" x="0" y="0"/>
  </layers>
 </IMAGE>
</DOC>
`;
const openRasterStack = `<?xml version="1.0" encoding="UTF-8"?>
<image version="0.0.5" w="640" h="480" xres="72" yres="72">
  <stack>
    <layer name="Background" src="data/background.png" x="0" y="0" opacity="1.0"
           visibility="visible"/>
  </stack>
</image>
`;

const sketchPages = {
  'B1A7C3D0-5E2F-4A61-9C8B-0D4E6F1A2B3C': 'Field notes',
  'C2B8D4E1-6F3A-4B72-8D9C-1E5F7A2B3C4D': 'Symbols',
};
const sketchMeta = {
  commit: 'generated',
  pagesAndArtboards: Object.fromEntries(
    Object.entries(sketchPages).map(([id, name]) => [id, { name, artboards: {} }]),
  ),
  version: 146,
  compatibilityVersion: 99,
  app: 'com.bohemiancoding.sketch3',
};
const sketchDocument = {
  _class: 'document',
  do_objectID: 'D3C9E5F2-7A4B-4C83-9E0D-2F6A8B3C4D5E',
  pages: Object.keys(sketchPages).map((id) => ({
    _class: 'MSJSONFileReference',
    _ref_class: 'MSImmutablePage',
    _ref: `pages/${id}`,
  })),
};

/** The XPS and OpenXPS namespaces: the second, ECMA-388, renamed the first's. */
const xpsNamespaces = {
  xps: {
    markup: 'http://schemas.microsoft.com/xps/2005/06',
    representation: 'http://schemas.microsoft.com/xps/2005/06/fixedrepresentation',
  },
  oxps: {
    markup: 'http://schemas.openxps.org/oxps/v1.0',
    representation: 'http://schemas.openxps.org/oxps/v1.0/fixedrepresentation',
  },
};
type XPSFlavor = keyof typeof xpsNamespaces;
/** A fixed-layout package of `pages` letter-size pages, each a filled band; fonts are not needed. */
function xps(flavor: XPSFlavor, pages: number, thumbnail?: Uint8Array): Uint8Array {
  const { markup, representation } = xpsNamespaces[flavor];
  const page = (index: number) => {
    const top = 96 + index * 40;
    const bottom = top + 64;
    return `<FixedPage xmlns="${markup}" Width="816" Height="1056" xml:lang="en-US">
  <Path Data="M 96,${top} L 720,${top} 720,${bottom} 96,${bottom} Z" Fill="#FF81B7CF"/>
</FixedPage>
`;
  };
  const contents = Array.from(
    { length: pages },
    (_, index) => `  <PageContent Source="Pages/${index + 1}.fpage"/>`,
  ).join('\n');
  const thumbnailType =
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail';
  const thumbnailRelationship = thumbnail
    ? `\n  <Relationship Id="R1" Type="${thumbnailType}" Target="/docProps/thumbnail.jpeg"/>`
    : '';
  const entries: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/>
  <Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>
  <Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
</Types>
`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R0" Type="${representation}" Target="/FixedDocumentSequence.fdseq"/>${thumbnailRelationship}
</Relationships>
`,
    'FixedDocumentSequence.fdseq': `<FixedDocumentSequence xmlns="${markup}">
  <DocumentReference Source="/Documents/1/FixedDocument.fdoc"/>
</FixedDocumentSequence>
`,
    'Documents/1/FixedDocument.fdoc': `<FixedDocument xmlns="${markup}">
${contents}
</FixedDocument>
`,
  };
  for (let index = 0; index < pages; index++)
    entries[`Documents/1/Pages/${index + 1}.fpage`] = page(index);
  if (thumbnail) entries['docProps/thumbnail.jpeg'] = thumbnail;
  return zip(entries);
}

/**
 * Generated containers with the member layout each app writes and the picture it saves: iWork
 * files and a Pages package folder, Krita, OpenRaster, Sketch and XPS. The OpenRaster and XPS
 * files are complete; the iWork, Krita and Sketch files hold no document body their apps open.
 */
export function embeddedSamples(images: EmbeddedImages): Sample[] {
  const folder = 'previews/saved-previews';
  const samples = iWork.map(([extension, application]) =>
    sample(
      `${folder}/Field notes.${extension}`,
      [extension],
      'The saved preview image, labeled as one',
      `Generated ZIP with an iWork file's metadata and preview.jpg; it holds no document body, so ${application} does not open it.`,
      zip({ 'Metadata/Properties.plist': properties, 'preview.jpg': images.jpeg }),
    ),
  );
  // an iWork '09 package: a folder Finder shows as one document
  const bundle = `${folder}/Field notes package.pages`;
  samples.push(
    sample(
      `${bundle}/QuickLook/Thumbnail.jpg`,
      [],
      'The package previews as its document, by this picture',
      'Generated Pages package folder: its saved picture.',
      images.jpeg,
    ),
    sample(
      `${bundle}/buildVersionHistory.plist`,
      [],
      'Not read',
      'Generated Pages package folder: its version history.',
      properties,
    ),
  );
  samples.push(
    sample(
      `${folder}/Field notes.kra`,
      ['kra'],
      'The merged image with its 640 × 480 canvas size',
      'Generated ZIP with a Krita file layout: mimetype, maindoc.xml, mergedimage.png and preview.png; no layer data, so Krita does not open it.',
      zip({
        mimetype: 'application/x-krita',
        'maindoc.xml': kritaDocument,
        'mergedimage.png': images.png,
        'preview.png': images.thumbnail,
      }),
    ),
    sample(
      `${folder}/Field notes.ora`,
      ['ora'],
      'The merged image with its 640 × 480 canvas size',
      'Generated OpenRaster image: one layer, its merged image and thumbnail.',
      zip({
        mimetype: 'image/openraster',
        'stack.xml': openRasterStack,
        'data/background.png': images.png,
        'Thumbnails/thumbnail.png': images.thumbnail,
        'mergedimage.png': images.png,
      }),
    ),
    sample(
      `${folder}/Field notes.sketch`,
      ['sketch'],
      'The saved preview with its two pages',
      'Generated ZIP with a Sketch file layout: document.json, meta.json, two empty pages and previews/preview.png; Sketch may not open it.',
      zip({
        'document.json': JSON.stringify(sketchDocument),
        'meta.json': JSON.stringify(sketchMeta),
        'user.json': '{}',
        ...Object.fromEntries(
          Object.entries(sketchPages).map(([id, name]) => [
            `pages/${id}.json`,
            JSON.stringify({ _class: 'page', do_objectID: id, name, layers: [] }),
          ]),
        ),
        'previews/preview.png': images.png,
      }),
    ),
    sample(
      `${folder}/Field notes.xps`,
      ['xps'],
      'The saved thumbnail with three pages',
      'Generated XPS document: three pages of filled bands and docProps/thumbnail.jpeg.',
      xps('xps', 3, images.jpeg),
    ),
    sample(
      `${folder}/Field notes.oxps`,
      ['oxps'],
      'No preview image in this document, with two pages',
      'Generated OpenXPS document: two pages of filled bands and no thumbnail.',
      xps('oxps', 2),
    ),
  );
  return samples;
}
