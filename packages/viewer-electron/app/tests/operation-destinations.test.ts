import type { OperationRequest } from '../src/domain/contracts';
import { describe, expect, it } from 'vitest';
import { outputName, singleOutput } from '../src/desktop/operations/destinations';
import { transformPlanSchema } from '../src/domain/operations/transforms';

const photo = '/Work/Photo.jpg';
const transform = (plan: object) => transformPlanSchema.parse(plan);
const webp = transform({ kind: 'image', format: 'webp' });
const media = transform({
  kind: 'media',
  format: 'mp4',
  segments: [{ source: 0, start: 0, end: 1 }],
});
const pages = transform({ kind: 'pdf-pages', format: 'pdf', pages: [{ source: 0, page: 1 }] });

describe('an output named from its request', () => {
  it.each<[string, OperationRequest, string, string]>([
    [
      'a new folder',
      { kind: 'mkdir', sources: [], destination: '/Output', name: 'New' },
      '',
      '/Output/New',
    ],
    [
      'a new file',
      { kind: 'mkfile', sources: [], destination: '/Output', name: 'Notes.txt' },
      '',
      '/Output/Notes.txt',
    ],
    [
      'an archive',
      {
        kind: 'compress',
        sources: ['/Work/a', '/Work/b'],
        destination: '/Output',
        name: 'Work.zip',
      },
      '',
      '/Output/Work.zip',
    ],
    [
      'a PDF of images',
      {
        kind: 'convert',
        sources: [photo],
        destination: '/Output',
        name: 'All.pdf',
        conversion: 'pdf',
      },
      '',
      '/Output/All.pdf',
    ],
    [
      'a combined media transform',
      {
        kind: 'convert',
        sources: [photo],
        destination: '/Output',
        name: 'Cut.mp4',
        transform: media,
      },
      '',
      '/Output/Cut.mp4',
    ],
    [
      'a quick action beside its image',
      { kind: 'convert', sources: [photo], conversion: 'png' },
      photo,
      '/Work/Photo.png',
    ],
    [
      'a rotated copy',
      { kind: 'convert', sources: ['/Work/Shot.heic'], conversion: 'rotate-left' },
      '/Work/Shot.heic',
      '/Work/Shot rotated.png',
    ],
    [
      'a converted copy beside its source',
      { kind: 'convert', sources: [photo], transform: webp },
      photo,
      '/Work/Photo converted.webp',
    ],
    [
      'a converted JPEG with its short extension',
      {
        kind: 'convert',
        sources: [photo],
        transform: transform({ kind: 'image', format: 'jpeg' }),
      },
      photo,
      '/Work/Photo converted.jpg',
    ],
    [
      'an optimized image',
      {
        kind: 'convert',
        sources: [photo],
        transform: transform({ kind: 'image', format: 'png', optimize: true }),
      },
      photo,
      '/Work/Photo optimized.png',
    ],
    [
      'an optimized PDF',
      {
        kind: 'convert',
        sources: ['/Work/Scan.pdf'],
        transform: transform({ kind: 'pdf', format: 'pdf' }),
      },
      '/Work/Scan.pdf',
      '/Work/Scan optimized.pdf',
    ],
    [
      'a converted copy in the folder chosen',
      { kind: 'convert', sources: [photo], destination: '/Output', transform: webp },
      photo,
      '/Output/Photo converted.webp',
    ],
    [
      'a converted copy with the name chosen for its single source',
      {
        kind: 'convert',
        sources: [photo],
        destination: '/Output',
        name: 'Chosen.webp',
        transform: webp,
      },
      photo,
      '/Output/Chosen.webp',
    ],
    [
      'each converted copy of several, whatever name was chosen',
      {
        kind: 'convert',
        sources: [photo, '/Work/Other.jpg'],
        name: 'Chosen.webp',
        transform: webp,
      },
      photo,
      '/Work/Photo converted.webp',
    ],
    [
      'a transform at its own source, which keeps both',
      { kind: 'convert', sources: [photo], name: 'Photo.jpg', transform: webp },
      photo,
      photo,
    ],
    [
      'a quick action at its own image, which keeps both',
      { kind: 'convert', sources: ['/Work/Shot.png'], conversion: 'png' },
      '/Work/Shot.png',
      '/Work/Shot.png',
    ],
    ...(
      [
        ['Backup.tar.gz', 'Backup'],
        ['Backup.TGZ', 'Backup'],
        ['Backup.tar', 'Backup'],
        ['Backup.zip', 'Backup'],
        ['Backup.tar.zip', 'Backup.tar'],
        ['Backup.gz', 'Backup.gz'],
        ['.zip', 'Extracted archive'],
      ] as const
    ).map(([archive, folder]): [string, OperationRequest, string, string] => [
      `the folder extracted from ${archive}`,
      { kind: 'extract', sources: ['/Work/' + archive], destination: '/Output' },
      '/Work/' + archive,
      '/Output/' + folder,
    ]),
    [
      'a renamed item beside itself',
      { kind: 'rename', sources: [photo], name: 'Renamed.jpg' },
      photo,
      '/Work/Renamed.jpg',
    ],
    ...(['copy', 'move', 'transfer'] as const).map(
      (kind): [string, OperationRequest, string, string] => [
        `a ${kind} under its own name`,
        { kind, sources: [photo], destination: '/Output' },
        photo,
        '/Output/Photo.jpg',
      ],
    ),
    [
      'a copy under the name chosen',
      { kind: 'copy', sources: [photo], destination: '/Output', name: 'Picture.jpg' },
      photo,
      '/Output/Picture.jpg',
    ],
  ])('names %s', (_case, request, source, expected) => {
    expect(outputName(request, source)).toBe(expected);
  });

  it.each<[string, OperationRequest, string, string]>([
    [
      'a copy into its own folder',
      { kind: 'copy', sources: [photo], destination: '/Work' },
      photo,
      'Source and destination are the same.',
    ],
    [
      'a rename to the same name',
      { kind: 'rename', sources: [photo], name: 'Photo.jpg' },
      photo,
      'Source and destination are the same.',
    ],
    [
      'a rename into another folder',
      { kind: 'rename', sources: [photo], name: 'Other/Photo.jpg' },
      photo,
      'Choose a valid file name without path separators.',
    ],
    [
      'a new folder named for its parent',
      { kind: 'mkdir', sources: [], destination: '/Output', name: '..' },
      '',
      'Choose a valid file name without path separators.',
    ],
  ])('refuses %s', (_case, request, source, message) => {
    expect(() => outputName(request, source)).toThrow(message);
  });

  it.each<[OperationRequest, boolean]>([
    [{ kind: 'mkdir', sources: [], destination: '/Output', name: 'New' }, true],
    [{ kind: 'mkfile', sources: [], destination: '/Output', name: 'New.txt' }, true],
    [{ kind: 'compress', sources: [photo], destination: '/Output', name: 'Work.zip' }, true],
    [{ kind: 'convert', sources: [photo], conversion: 'pdf' }, true],
    [{ kind: 'convert', sources: [photo], transform: media }, true],
    [{ kind: 'convert', sources: [photo], transform: pages }, true],
    [{ kind: 'convert', sources: [photo], conversion: 'png' }, false],
    [{ kind: 'convert', sources: [photo], transform: webp }, false],
    [{ kind: 'copy', sources: [photo], destination: '/Output' }, false],
    [{ kind: 'extract', sources: ['/Work/Backup.zip'], destination: '/Output' }, false],
  ])('makes one output from every source of %o: %s', (request, single) => {
    expect(singleOutput(request)).toBe(single);
  });
});
