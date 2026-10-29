import { gzipSync } from 'node:zlib';
import type { Sample } from '../types';
import { sample } from './documents';

const notes = `Field notes

A short walk, a few photographs and time to look around.
Bring a camera, water and a little extra time.
`;
const materials = {
  project: 'Field notes',
  materials: [
    { name: 'Aluminum', count: 12 },
    { name: 'Nylon', count: 24 },
  ],
};
const budget = 'Item,Count,Cost\nNotebook,2,7.50\nCamera strap,1,18.00\nWater bottle,2,12.40\n';
const access = [
  '127.0.0.1 - - [01/Nov/2026:08:00:01 +0000] "GET / HTTP/1.1" 200 512',
  '127.0.0.1 - - [01/Nov/2026:08:00:02 +0000] "GET /notes.html HTTP/1.1" 200 2048',
  '127.0.0.1 - - [01/Nov/2026:08:00:04 +0000] "GET /missing.png HTTP/1.1" 404 128',
].join('\n');

/** Single gzip-compressed files, shown with the preview of the file each holds, an image that is
 * described instead, and one that expands past the preview limit. */
export function compressedSamples(image: Uint8Array): Sample[] {
  const texts: [path: string, description: string, text: string][] = [
    ['previews/compressed/Field notes.txt.gz', 'Plain text, gzip-compressed.', notes],
    [
      'previews/compressed/Materials.json.gz',
      'A small JSON document, gzip-compressed.',
      JSON.stringify(materials, null, 2) + '\n',
    ],
    ['previews/compressed/Budget.csv.gz', 'Three CSV rows, gzip-compressed.', budget],
    ['previews/compressed/access.log.gz', 'Three web server log lines.', access + '\n'],
    [
      'previews/compressed/access.log.2.gz',
      'A rotated log, read as the log it was.',
      access.replaceAll('Nov', 'Oct') + '\n',
    ],
  ];
  return [
    ...texts.map(([path, description, text]) =>
      sample(path, ['gz'], 'Expanded text, read-only', description, gzipSync(text)),
    ),
    sample(
      'previews/compressed/Image study.png.gz',
      ['gz'],
      'Inner name and expanded size',
      'The playground PNG, gzip-compressed: an image is described, not expanded.',
      gzipSync(image),
    ),
    sample(
      'edge-cases/malformed/Expands too far.log.gz',
      [],
      'Expected bounded error',
      'Nine megabytes of zeros in a few kilobytes, past the 8 MB expansion limit.',
      gzipSync(Buffer.alloc(9 * 1024 * 1024)),
    ),
  ];
}
