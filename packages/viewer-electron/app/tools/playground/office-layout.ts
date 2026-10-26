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
export const officeLayoutSamples: RemoteSample[] = records.map(
  ([name, original, size, sha256]) => ({
    path: 'previews/documents/' + name,
    formats: [name.split('.').at(-1)!],
    size,
    sha256,
    preview:
      'Bundled local Office layout with pagination; Excel includes named worksheet navigation',
    description:
      'Unmodified application-authored Apache POI reference. Qualifies this sample, not every document feature.',
    source: poi + 'test-data/' + original,
    url: poi + 'test-data/' + original,
    license: 'Apache-2.0; original notices at ' + poi + 'legal/LICENSE',
  }),
);
