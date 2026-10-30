import type { RemoteSample } from './types';
const poi =
  'https://raw.githubusercontent.com/apache/poi/5c44755a2a7569a5884dc8f1f680ca3a86fa245f/';
const records = [
  [
    'FloatingPictures.doc',
    'document/FloatingPictures.doc',
    335360,
    '41cc0cd8f2d7390266f844f5bddbcd29d08ac5338abc33832d9c9a6ed5d0f85d',
  ],
  [
    'ConditionalFormattingSamples.xls',
    'spreadsheet/ConditionalFormattingSamples.xls',
    1402368,
    'd1942d857ffbd4d10ebca1745cd5d70c14af9d9f1388c91ed0a0800e31ad5ce7',
  ],
  [
    'SampleShow.ppt',
    'slideshow/SampleShow.ppt',
    125440,
    '64275a6685b8f267827178037dcc59de927475e56385725916f4c6039c7ce7f6',
  ],
  [
    'ArtisticEffectSample.pptx',
    'slideshow/ArtisticEffectSample.pptx',
    972788,
    '55c9b01d60efc8245f5d28097e702e1921e06aebfab522b6de574dcb435d66b7',
  ],
] as const;
/** Binary Office templates and shows are the same format as their documents: the reference
 * files under those names. */
const renamed = [
  ['FloatingPictures.dot', 0],
  ['ConditionalFormattingSamples.xlt', 1],
  ['SampleShow.pps', 2],
  ['SampleShow.pot', 2],
] as const;
const references: RemoteSample[] = records.map(([name, original, size, sha256]) => ({
  path: 'previews/documents/' + name,
  formats: [name.split('.').at(-1)!],
  size,
  sha256,
  preview: 'Bundled local Office layout with pagination; Excel includes named worksheet navigation',
  description:
    'Unmodified application-authored Apache POI reference. Qualifies this sample, not every document feature.',
  source: poi + 'test-data/' + original,
  url: poi + 'test-data/' + original,
  license: 'Apache-2.0; original notices at ' + poi + 'legal/LICENSE',
}));
/** A Publisher document and Windows metafiles, which the engine lays out as drawing pages. */
const drawings = [
  [
    'SampleBrochure.pub',
    'publisher/SampleBrochure.pub',
    161792,
    'ffed034ac87e679f0bd08ff9cf74ad11c0e0e510a42b1bc1a7502415f6c29c87',
  ],
  [
    'nested_wmf.emf',
    'slideshow/nested_wmf.emf',
    40276,
    '4dd0ea622b0feea6daff6b953bd0fe30cc3deb8dc561828f069f83d5bd5cef75',
  ],
  [
    'santa.wmf',
    'slideshow/santa.wmf',
    28696,
    'fdc312bc0dbea47df16d3e3e98e2777e4aa537d225a703e3cde0177df56a592a',
  ],
] as const;
/** Kept apart from the Word, Excel and PowerPoint references, which Microsoft Office also exports. */
export const officeDrawingSamples: RemoteSample[] = drawings.map(
  ([name, original, size, sha256]) => ({
    ...references[0]!,
    path: 'previews/documents/' + name,
    formats: [name.split('.').at(-1)!],
    size,
    sha256,
    preview: 'Bundled local Office layout, as drawing pages',
    source: poi + 'test-data/' + original,
    url: poi + 'test-data/' + original,
  }),
);
export const officeLayoutSamples: RemoteSample[] = [
  ...references,
  ...renamed.map(([name, index]) => {
    const [original, path, size, sha256] = records[index];
    return {
      ...references[index]!,
      path: 'previews/documents/' + name,
      formats: [name.split('.').at(-1)!],
      size,
      sha256,
      description: `The unmodified Apache POI reference ${original}, under a template or show name.`,
      source: poi + 'test-data/' + path,
      url: poi + 'test-data/' + path,
    };
  }),
];
