import type { RemoteSample } from './types';
const poi =
  'https://raw.githubusercontent.com/apache/poi/5c44755a2a7569a5884dc8f1f680ca3a86fa245f/';
const records = [
  [
    'poi-page-breaks.docx',
    'document/saut_page.docx',
    2959626,
    '748f34f3dc285f4d48474930758b2c37382d17965545a1729cb7400cada793da',
    'Word document with page breaks and embedded media; semantic content preview, not Word layout',
  ],
  [
    'poi-deep-data.xlsx',
    'spreadsheet/deep-data.xlsx',
    964835,
    '382a42a0febe5e79a3053059c81bd8b15486e28e1ed9632b5675cb53980d0c96',
    'Corrupt ZIP reference: directory missing; must fail explicitly without hanging',
  ],
  [
    'poi-conditional-formatting.xlsx',
    'spreadsheet/ConditionalFormattingSamples.xlsx',
    654688,
    '8dfa997a642c00a1da8c0750c371f204553a98c537ca046028b052f9b424a074',
    'Workbook with formatting and other Office features; saved values and structure, not full Excel rendering',
  ],
] as const;
export const qualificationSamples: RemoteSample[] = [
  {
    path: 'qualification/files/poi-large-workbook.xlsx',
    formats: ['xlsx'],
    preview:
      'Large LibreOffice workbook; bounded reader coverage or explicit XML entry-size refusal',
    description:
      'LibreOffice regression workbook: 2.9 MB package, 28 MB expanded, largest XML entry 18 MB. Exercises actual reader limits.',
    source: poi + 'test-data/spreadsheet/LIBRE_OFFICE-116306-0.xlsx',
    url: poi + 'test-data/spreadsheet/LIBRE_OFFICE-116306-0.xlsx',
    license: 'Apache-2.0 and included notices',
    size: 2859963,
    sha256: '44d0f41ed21aec02f9a6bbd22cf73f9bd313b16006fe867e6c5fbe5a0a25e5f1',
  },
  ...records.map(([name, original, size, sha256, description]) => ({
    path: 'qualification/files/' + name,
    formats: [name.split('.').at(-1)!],
    preview: description,
    description,
    source: poi + 'test-data/' + original,
    url: poi + 'test-data/' + original,
    license: 'Apache-2.0 and notices in qualification/licenses/Apache-POI-LICENSE',
    size,
    sha256,
  })),
  {
    path: 'qualification/files/qpdf-12.4.2-manual.pdf',
    formats: ['pdf'],
    preview: '178-page searchable PDF with outline, links and embedded fonts',
    description:
      'Unmodified upstream qpdf 12.4.2 manual, retrieved October 25, 2026. The stable URL is checksum-pinned; changed future downloads are refused.',
    source: 'https://qpdf.readthedocs.io/en/stable/',
    url: 'https://qpdf.readthedocs.io/_/downloads/en/stable/pdf/',
    license: 'Apache-2.0; https://github.com/qpdf/qpdf/blob/v12.4.2/LICENSE.txt',
    size: 758510,
    sha256: 'c3921979be207eb26754437928531c80bcd3f55920fbbfe2707e3c991179d8ca',
  },
  {
    path: 'qualification/licenses/Apache-POI-LICENSE',
    formats: [],
    preview: 'Text',
    description: 'Original Apache POI distribution license and third-party notices',
    source: poi + 'legal/LICENSE',
    url: poi + 'legal/LICENSE',
    license: 'Apache-2.0 with included third-party terms',
    size: 14416,
    sha256: '6e7c918e5a49f677c1b85a9eb2d035cd85c217fc42af6b4a336964a434001a9c',
  },
];
