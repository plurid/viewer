/**
 * The files a review run shows: generated into the run's own sample home, never the owner's. The
 * names carry the cases that break layouts: a 180-character name, twenty levels of long folder
 * names, spaces and non-Latin scripts.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fieldNotesPDF } from '../docs/sample';
import { modelSamples } from '../playground/samples/models';

/** Relative to the sample home. */
export const sampleFolders = {
  /** The everyday folder most scenes open. */
  samples: 'Review samples',
  /** A second folder, so Recent and the switcher have something to list. */
  projects: 'Projects',
  /** Files named as copies, so the folder shows its insight card. */
  copies: 'Copies',
} as const;

/** File names inside the sample folders. */
export const sampleFiles = {
  picture: 'Forest.jpg',
  pdf: 'Field notes.pdf',
  text: 'Notes.txt',
  model: 'Reference block.stl',
  movie: 'Motion.mp4',
  spaced: 'Plan for the spring exhibition.md',
} as const;

export type SampleKind = keyof typeof sampleFiles;

/** Names in scripts that are not Latin, each with its own file. */
export const scriptNames = [
  '日本語のメモ.txt',
  'Ελληνικές σημειώσεις.txt',
  'Отчёт о проверке.txt',
  'تقرير المراجعة.txt',
] as const;

const longNameLength = 180;

/** A file name of exactly 180 characters with this extension, readable at both ends. */
export function longName(extension: string): string {
  const start = 'Quarterly engineering review of the assembly clearance and manufacturing drawings';
  const end = ' final approved version';
  const filler = ' for the second production batch of the north workshop extension';
  let stem = start;
  while (stem.length + end.length + extension.length + 1 < longNameLength) stem += filler;
  stem = stem.slice(0, longNameLength - end.length - extension.length - 1) + end;
  return stem + '.' + extension;
}

/** Twenty folder levels with long names, ending in the folder a job keeps its models in. */
export const deepLevels: readonly string[] = [
  'Clients and partners',
  'Northwind Engineering Group',
  'Manufacturing contracts 2026',
  'Offer for automated screw feeders',
  'Revision 4 after site visit',
  'Mechanical design package',
  'Assemblies and subassemblies',
  'Feeder frame and supports',
  'Welded structure drawings',
  'Approved by the client',
  'Production release candidates',
  'Workshop north building',
  'Line 3 conveyor section',
  'Tooling and fixtures',
  'Laser cut parts for batch 2',
  'Sheet metal 3 mm aluminium',
  'Checked by quality control',
  'Delivered to the customer',
  'Job 1042',
  '3D',
];

/** The deepest folder, relative to the sample home. */
export const deepFolder = path.join(sampleFolders.samples, ...deepLevels);

/** The everyday files of one folder: one per preview kind the scenes open, plus names that are
 * long, spaced or in other scripts. */
async function fill(folder: string, sources: SampleSources): Promise<void> {
  await mkdir(folder, { recursive: true });
  const write = (name: string, bytes: Uint8Array | string) =>
    writeFile(path.join(folder, name), bytes, { flag: 'wx' });
  await write(sampleFiles.picture, sources.picture);
  await write(sampleFiles.pdf, sources.pdf);
  await write(sampleFiles.text, sources.text);
  await write(sampleFiles.model, sources.model);
  await write(sampleFiles.movie, sources.movie);
  await write(sampleFiles.spaced, '# Spring exhibition\n\n- Print the field notes.\n');
  await write(longName('jpg'), sources.picture);
  await write(longName('pdf'), sources.pdf);
  await write(longName('txt'), sources.text);
  await write(longName('mp4'), sources.movie);
  for (const name of scriptNames) await write(name, sources.text);
}

interface SampleSources {
  picture: Uint8Array;
  pdf: Uint8Array;
  text: string;
  model: Uint8Array | string;
  movie: Uint8Array;
}

/** Creates the sample home. Every file is new; nothing outside `home` is written. */
export async function createSamples(home: string, appRoot: string): Promise<void> {
  const repositoryRoot = path.resolve(appRoot, '../../..');
  // the documentation's public sample photograph, so captures show a real picture
  const picture = await readFile(path.join(repositoryRoot, 'docs/media/source.jpg'));
  const model = (await modelSamples()).find((sample) => sample.path.endsWith('.stl'));
  if (!model) throw new Error('The playground no longer makes an STL sample.');
  const sources: SampleSources = {
    picture,
    pdf: fieldNotesPDF(picture),
    text:
      'Field notes\n\nA short walk, a few photographs and time to look around.\n' +
      'Follow the woodland trail. Photograph the morning light.\n',
    model: model.bytes,
    movie: await readFile(path.join(appRoot, 'tools/playground/assets/motion.mp4')),
  };
  await fill(path.join(home, sampleFolders.samples), sources);
  await fill(path.join(home, deepFolder), sources);
  const projects = path.join(home, sampleFolders.projects);
  await mkdir(projects);
  await copyFile(
    path.join(home, sampleFolders.samples, sampleFiles.text),
    path.join(projects, 'Brief.txt'),
  );
  const copies = path.join(home, sampleFolders.copies);
  await mkdir(copies);
  for (const name of [
    sampleFiles.pdf,
    'Field notes copy.pdf',
    longName('pdf').replace(/\.pdf$/, ' copy.pdf'),
    longName('jpg').replace(/\.jpg$/, ' copy.jpg'),
  ])
    await writeFile(
      path.join(copies, name),
      name.endsWith('.jpg') ? sources.picture : sources.pdf,
      {
        flag: 'wx',
      },
    );
  // the folders macOS gives every home, so the sidebar's Locations lead somewhere
  for (const folder of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'])
    await mkdir(path.join(home, folder));
}
