import type { RemoteSample } from './types';

const version = 'https://cdn.jsdelivr.net/npm/source-sans@3.52.0/';
const common = {
  source: 'https://github.com/adobe-fonts/source-sans',
  license: 'OFL-1.1; https://cdn.jsdelivr.net/npm/source-sans@3.52.0/LICENSE.md',
};

/** One open-licensed face in each font format the font preview reads. */
export const fontSamples: RemoteSample[] = [
  {
    ...common,
    path: 'previews/fonts/Source Sans 3.ttf',
    formats: ['ttf'],
    preview: 'Sample text, names, glyph count and the characters the face covers.',
    description: 'Adobe Source Sans 3 Regular, TrueType outlines.',
    url: version + 'TTF/SourceSans3-Regular.ttf',
    sha256: '4644c81b86ec9caaa76b634889968ed3c4f4f52f054855933acc7c2b21e53b0f',
    size: 431196,
  },
  {
    ...common,
    path: 'previews/fonts/Source Sans 3.otf',
    formats: ['otf'],
    preview: 'Sample text and details for an OpenType face with CFF outlines.',
    description: 'Adobe Source Sans 3 Regular, CFF outlines.',
    url: version + 'OTF/SourceSans3-Regular.otf',
    sha256: '08df266400933d3178d081a45f94a08814c3e55b4b7dd2e0ff69cb1329f13ab6',
    size: 334924,
  },
  {
    ...common,
    path: 'previews/fonts/Source Sans 3.woff',
    formats: ['woff'],
    preview: 'Sample text and details, its tables inflated before reading.',
    description: 'Adobe Source Sans 3 Regular as a web font.',
    url: version + 'WOFF/TTF/SourceSans3-Regular.ttf.woff',
    sha256: '56413337e96f5764882f3e18eaa654eec27515ec7c3de3520eec9e36b25371b9',
    size: 188176,
  },
  {
    ...common,
    path: 'previews/fonts/Source Sans 3.woff2',
    formats: ['woff2'],
    preview:
      'Sample text drawn by Chromium; details are unavailable because WOFF2 tables use Brotli.',
    description: 'Adobe Source Sans 3 Regular as a compressed web font.',
    url: version + 'WOFF2/TTF/SourceSans3-Regular.ttf.woff2',
    sha256: '53492fb3a0def77354f166a55d09b63a10855e91c206c7620a81cf56e97f8ec3',
    size: 109632,
  },
];
