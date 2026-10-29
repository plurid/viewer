import type { RemoteSample } from './types';

export interface ReaderSample extends RemoteSample {
  search: string;
}
const releases = 'https://github.com/IDPF/epub3-samples/releases/download/20230704/';
const idpf = [
  [
    'idpf-wasteland.epub',
    'wasteland.epub',
    101904,
    '1653b9fbe225b89a008f980744d6b89940504a4533b9036821f9d99daf8f6c9c',
    'April',
    'Poetry with a linked note apparatus in the same chapter.',
  ],
  [
    'idpf-moby-dick.epub',
    'moby-dick.epub',
    1628868,
    '81bc079841a38e91a02a7776d04786a2fc311cfd300064e9fc533ce7c54cf7b4',
    'whale',
    'Long publication with 144 content documents, embedded fonts, illustrations and footnotes.',
  ],
  [
    'idpf-internal-links.epub',
    'internallinks.epub',
    663694,
    'deaf03a1843f52cc5e4cedb226ca8659610efe1be5e810fccf615bcb549238aa',
    '目次',
    'Japanese publication with Unicode anchors, screenshots and separate notes outside the main reading order.',
  ],
] as const;

/** Public authored books complement generated fixtures. Changed upstream bytes are refused. */
export const readerSamples: ReaderSample[] = [
  {
    path: 'qualification/readers/gutenberg-alice.epub',
    formats: ['epub'],
    source: 'https://www.gutenberg.org/ebooks/11',
    url: 'https://www.gutenberg.org/ebooks/11.epub3.images',
    license: 'Project Gutenberg eBook 11; publication terms retained inside the EPUB',
    size: 189249,
    sha256: '4f81245d31380ac1d6eafb9a321e3691369bc70985736ae4bccf849a4f784036',
    search: 'rabbit',
    preview: 'Chapter navigation, text search and versioned reading position',
    description:
      'Project Gutenberg EPUB 3 edition of Alice’s Adventures in Wonderland. Its stable URL is checksum-pinned; future revisions require a reviewed pin update.',
  },
  ...idpf.map(([name, file, size, sha256, search, description]) => ({
    path: 'qualification/readers/' + name,
    formats: ['epub'],
    source: 'https://idpf.github.io/epub3-samples/30/samples.html',
    url: releases + file,
    license:
      'CC-BY-SA-3.0; IDPF EPUB 3 Samples attribution and publication metadata retained inside the EPUB',
    size,
    sha256,
    search,
    description,
    preview: 'Safe book content, internal links, bounded search and reading restoration',
  })),
];
