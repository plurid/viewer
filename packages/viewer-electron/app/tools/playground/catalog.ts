import { gzipSync } from 'node:zlib';
import { textLanguages } from '../../src/domain/editing/languages';
import { cameraRawSamples } from './camera-raw';
import { assetBytes } from './files';
import { documentSamples, sample } from './samples/documents';
import { officeSamples } from './samples/office';
import { modelSamples } from './samples/models';
import { packageSamples } from './samples/packages';
import { projectSamples } from './samples/project';
import { structuredTextSamples } from './samples/structured-text';
import { textSamples } from './samples/text';
import type { RemoteSample, Sample } from './types';
import { officeLayoutSamples } from './office-layout';
import { fontSamples } from './fonts';

export const remoteSamples: RemoteSample[] = [
  ...cameraRawSamples,
  ...officeLayoutSamples,
  ...fontSamples,
  {
    path: 'previews/video/Big Buck Bunny trailer.ogv',
    formats: ['ogv'],
    preview:
      'Theora/Vorbis playback if the Chromium build supports these codecs; otherwise an explicit playback error.',
    description:
      'Unmodified 33-second trailer. Copyright 2008 Blender Foundation / www.bigbuckbunny.org.',
    source: 'https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_Trailer_400p.ogv',
    license: 'CC-BY-3.0; https://creativecommons.org/licenses/by/3.0/',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Big_Buck_Bunny_Trailer_400p.ogv',
    sha256: 'dcbe6f2ea404a52d4b2f6fc91f274874e69be1671a1097eb3dc19f28f7c6e40f',
    size: 4360399,
  },
];

function drawing(): string {
  const entity = (type: string, pairs: (string | number)[]) =>
    ['0', type, ...pairs].join('\n') + '\n';
  const points = [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ];
  const lines = points
    .map(([x, y], index) => {
      const [nextX, nextY] = points[(index + 1) % points.length];
      return entity('LINE', [8, 'CUT', 10, x, 20, y, 11, nextX, 21, nextY]);
    })
    .join('');
  const circles = [30, 170]
    .map((x) => entity('CIRCLE', [8, 'HOLES', 10, x, 20, 50, 40, 8]))
    .join('');
  return (
    '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n' +
    lines +
    circles +
    '0\nENDSEC\n0\nEOF\n'
  );
}

export async function localSamples(): Promise<Sample[]> {
  const result: Sample[] = [
    ...textSamples(),
    ...documentSamples(await assetBytes('study.jpg')),
    ...officeSamples(),
    ...(await modelSamples()),
    ...projectSamples(),
    ...packageSamples(),
    ...structuredTextSamples(),
  ];
  const imageSpecs = [
    ['png', 'png'],
    ['jpg', 'jpg'],
    ['jpeg', 'jpg'],
    ['gif', 'gif'],
    ['webp', 'webp'],
    ['avif', 'avif'],
    ['bmp', 'bmp'],
    ['ico', 'ico'],
    ['tif', 'tiff'],
    ['tiff', 'tiff'],
    ['heic', 'heic'],
    ['heif', 'heic'],
    ['psd', 'psd'],
    ['jp2', 'jp2'],
    ['exr', 'exr'],
    ['tga', 'tga'],
    ['icns', 'icns'],
    ['apng', 'apng'],
    ['jpe', 'jpg'],
    ['jfif', 'jpg'],
    ['pbm', 'pbm'],
    ['pgm', 'pgm'],
    ['ppm', 'ppm'],
    ['pnm', 'ppm'],
    ['ktx', 'ktx'],
    ['astc', 'astc'],
  ];
  const systemImages = new Set([
    ...['tif', 'tiff', 'heic', 'heif', 'psd', 'jp2', 'exr', 'tga', 'icns'],
    ...['pbm', 'pgm', 'ppm', 'pnm', 'ktx', 'astc'],
  ]);
  for (const [format, asset] of imageSpecs)
    result.push(
      sample(
        `previews/images/Image study.${format}`,
        [format],
        systemImages.has(format)
          ? 'System-rendered bitmap; OS decoder dependent'
          : 'Image zoom and controls',
        'Synthetic geometric study. Aliases share the same genuine encoding; PSD contains a flattened RGB composite.',
        await assetBytes(`study.${asset}`),
      ),
    );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#192833"/>
  <rect x="52" y="56" width="536" height="368" rx="24" fill="#263c49" stroke="#81b7cf" stroke-width="3"/>
  <path d="M172 322 320 108 468 322Z" fill="#81b7cf"/>
  <circle cx="320" cy="254" r="28" fill="#d7a56b"/>
  <text x="80" y="382" fill="#e2edf2" font-family="sans-serif" font-size="22">VIEWER / VECTOR STUDY</text>
</svg>
`;
  result.push(
    sample(
      'previews/images/Image study.svg',
      ['svg'],
      'Vector image and source',
      'Self-contained SVG; no scripts, fonts or linked assets.',
      svg,
    ),
  );
  result.push(
    sample(
      'previews/images/Image study.svgz',
      ['svgz'],
      'Vector image, expanded before drawing',
      'The same SVG, gzip-compressed.',
      gzipSync(svg),
    ),
  );
  for (const [format, asset] of [
    ...['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus'].map((format) => [format, format]),
    ...[
      ['aiff', 'aiff'],
      ['aif', 'aiff'],
      ['caf', 'caf'],
      ['wma', 'wma'],
      ['mka', 'mka'],
      ['ac3', 'ac3'],
      ['wv', 'wv'],
    ],
  ])
    result.push(
      sample(
        `previews/audio/Soft tone.${format}`,
        [format],
        'Audio playback; codec dependent, or a compatibility copy',
        'Two-second, low-amplitude 440 Hz tone with fade-in/out.',
        await assetBytes(`tone.${asset}`),
      ),
    );
  for (const [format, asset] of [
    ['mp4', 'mp4'],
    ['mov', 'mov'],
    ['m4v', 'm4v'],
    ['webm', 'webm'],
    ['avi', 'avi'],
    ['mkv', 'mkv'],
    ['mpg', 'mpg'],
    ['mpeg', 'mpg'],
    ['m2ts', 'm2ts'],
    ['wmv', 'wmv'],
    ['asf', 'wmv'],
    ['flv', 'flv'],
    ['3gp', '3gp'],
    ['3g2', '3g2'],
    ['vob', 'vob'],
    ['mxf', 'mxf'],
  ])
    result.push(
      sample(
        `previews/video/Motion study.${format}`,
        [format],
        'Video playback; codec dependent',
        'Two-second synthetic motion pattern. MP4/MOV/M4V/MKV/M2TS contain H.264, WebM VP8; the others hold MPEG-4, MPEG-2, WMV or Flash video for a compatibility copy.',
        await assetBytes(`motion.${asset}`),
      ),
    );
  for (const format of ['sqlite', 'sqlite3', 'db3', 'db'])
    result.push(
      sample(
        `previews/data/Library.${format}`,
        [format],
        'Tables and rows, read-only',
        'Two tables, an index and a view; the view is listed, never run.',
        await assetBytes('library.sqlite'),
      ),
    );
  result.push(
    sample(
      'previews/drawings/Panel 200x100 mm.dxf',
      ['dxf'],
      '2D drawing, layers and measurements',
      'Millimeter panel outline on CUT and two holes on HOLES.',
      drawing(),
    ),
  );
  const edges = {
    'edge-cases/malformed/Broken.json': '{"materials": [',
    'edge-cases/malformed/Broken.png': 'This intentionally is not a PNG.\n',
    'edge-cases/malformed/Broken.pdf': '%PDF-1.4\ntruncated on purpose\n',
    'edge-cases/malformed/Broken.glb': 'Intentionally invalid GLB.\n',
    'edge-cases/malformed/Broken.zip': 'Intentionally invalid ZIP.\n',
    'edge-cases/empty/Empty.txt': '',
    'edge-cases/names/București 東京 café.txt':
      'Unicode names and UTF-8 content: Știință · 東京 · café.\n',
    'edge-cases/names/--leading-dash.txt': 'Filename arguments must remain literal.\n',
    'edge-cases/names/A long filename with spaces and repeated words for testing truncation and tooltips.txt':
      'Keep the complete filename accessible.\n',
    'scratch/README.md':
      '# Your experiments\n\nCopy samples here before editing, renaming or comparing them.\nThe generator preserves all existing files and does not clean this folder.\n',
    'licenses/README.md': `# Sample provenance

Generated text, diagrams, Office/EPUB/PDF/archive/mesh files and synthetic
image/media content are dedicated to CC0 1.0 by the Viewer playground authors.
The asset regeneration script is versioned with the recipes.

CAD solids come from the installed, lockfile-pinned occt-import-js test suite.
Its LGPL 2.1 notice is included in occt-import-js.txt. Package/source:
https://github.com/kovacsv/occt-import-js

The eight original RAW photographs are CC0 1.0 samples from raw.pixls.us,
mirrored without modification by RevelRaw release v1. Each source, exact byte
size and SHA-256 is pinned in manifest.json. No user photographs are copied.
https://github.com/tellodaniel/revelraw-sample-raw-files
https://creativecommons.org/publicdomain/zero/1.0/

Big Buck Bunny trailer: copyright 2008 Blender Foundation | www.bigbuckbunny.org.
Unmodified OGV from Wikimedia Commons, CC BY 3.0. Source and checksum are pinned
in manifest.json. License: https://creativecommons.org/licenses/by/3.0/
`,
  };
  for (const [name, bytes] of Object.entries(edges))
    result.push(
      sample(
        name,
        [],
        name.includes('/malformed/') ? 'Expected bounded error' : 'Text/source',
        'Manual edge-case or scratch sample; excluded from positive format coverage.',
        bytes,
      ),
    );
  return result;
}

export const playgroundReadme = `# Viewer playground

This is a stable, editable manual playground. The recipes and manifest are
versioned in the Viewer repository; these files live beside it.

## Start here

1. Open this folder in Viewer and add it to Favorites.
2. Browse previews by family. Space opens Quick Preview; open a linked plane
   to compare files and keep their source folder visible.
3. Open git/main and run **Open worktree…**. Put main and feature beside each
   other, enable Git status if wanted, and follow a changed file into a diff.
4. Open projects/static-website/index.html. Run **Start local server** on its
   containing folder, open the URL and inspect request logs in the server plane.
5. Open a Journal plane to inspect the activity you generate.
6. Copy reference files into scratch before editing or renaming them.

manifest.json records one entry per sample: format, expected preview, provenance,
license and SHA-256. reports contains an immutable result for each generator run.
previews contains positive samples; edge-cases contains explicitly broken/empty
files and awkward names. A sample's presence does not prove its decoding on this
machine: RAW/extended images depend on macOS, and media depends on Chromium codecs.

## Regenerate safely

Run pnpm playground from the Viewer repository. Initial RAW/video downloads total
about 215 MiB and are bounded and checksum-pinned. Subsequent runs reuse them.
Use pnpm playground --offline to populate only locally bundled/generated samples.
Use --directory /absolute/path to create another playground.

Reruns fill missing reference files and compare existing bytes. They preserve
modified files and write differences to a new report. Git scenarios initialize
only when git does not exist; their working files, commits and indices are never
repaired or reset. No process/server starts, no Viewer preferences change, and
no files or folders are removed by this command.

See git/README.md for the clean, divergent, staged and conflicted work areas.
See licenses/README.md for attribution and source details.
`;

/** Filename variants are tracked separately from extension coverage. */
export const conventionalNames = [
  ...new Set(textLanguages.flatMap((language) => language.names ?? [])),
  'README',
  'LICENSE',
  '.env',
  '.env.local',
  '.gitignore',
].sort();
