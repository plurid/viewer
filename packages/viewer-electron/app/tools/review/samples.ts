/**
 * The files a review run shows: generated into the run's own sample home, never the owner's. The
 * names carry the cases that break layouts: a 180-character name, twenty levels of long folder
 * names, spaces and non-Latin scripts.
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chooseFilePreview, filePreviewModules } from '../../src/domain/previews/formats';
import type { BuiltInPreviewKind } from '../../src/domain/previews/formats';
import type { FileEntry } from '../../src/domain/contracts';
import type { ActionInput, CustomAction } from '../../src/domain/automation/actions';
import { lensFolder, lensSchema, lensSubfolder, lensSuffix } from '../../src/domain/files/lenses';
import { projectDefinitionSchema } from '../../src/domain/workspaces/project';
import { fieldNotesPDF } from '../docs/sample';
import { localSamples } from '../playground/catalog';
import { modelSamples } from '../playground/samples/models';
import { encodePNG } from './png';

/** Relative to the sample home. */
export const sampleFolders = {
  /** The everyday folder most scenes open. */
  samples: 'Review samples',
  /** A second folder, so Recent and the switcher have something to list. */
  projects: 'Projects',
  /** Files named as copies, so the folder shows its insight card. */
  copies: 'Copies',
  /** One file for each preview kind. */
  kinds: 'Kinds',
  /** A model for each axis convention, and one that cannot be read. */
  models: 'Models',
} as const;

export const workspaceName = 'Field work';
export const lensSample = {
  folder: path.join(sampleFolders.projects, 'Lens sample'),
  name: 'Field notes by kind',
  groupID: 'gnotes',
} as const;
export const gitSample = path.join(sampleFolders.projects, 'Git sample');
export const branchSample = path.join(sampleFolders.projects, 'Branch sample');
export const journalSample = path.join(sampleFolders.projects, 'Journal events');

export function sampleProject(bindings: Record<string, string>) {
  return projectDefinitionSchema.parse({
    version: 1,
    id: '6f1f0f5e-6b1a-4e3c-9d4e-2f6a1c0b7d21',
    name: workspaceName,
    bindings: Object.entries(bindings).map(([name, relative]) => ({
      name,
      label: path.basename(relative),
    })),
    planes: [],
    folders: [],
    layout: { placements: [] },
    arrangements: {},
  });
}

/** The wide picture the preview checklists name: 2400 × 900 pixels. */
export const widePicture = path.join('Pictures', 'Wide picture 2400x900.png');

/** A picture whose name has a 200-character stem, for the output form checklist. */
export const longStemPicture = path.join(
  'Pictures',
  (
    'Wedding party at the lake photographed from the north shore at sunset with the whole family ' +
    'and friends gathered by the boathouse before the evening meal and the fireworks over water'
  )
    .padEnd(200, ' x')
    .slice(0, 200) + '.jpg',
);

/** A system font, copied as the font preview's sample: the playground makes none. */
const systemFont = '/System/Library/Fonts/Supplemental/Arial.ttf';

/** The sample file of each preview kind, by name inside the Kinds folder. */
export type KindSamples = Partial<Record<BuiltInPreviewKind, string>>;

/** Which preview kind the app picks for a file name, as formats.ts decides it. */
function previewKind(name: string): BuiltInPreviewKind {
  const extension = name.includes('.') ? name.split('.').at(-1)! : '';
  const entry: FileEntry = {
    name,
    path: '/' + name,
    parent: '/',
    extension,
    mime: '',
    kind: 'file',
    directory: false,
    size: 1,
    identity: '',
    modified: 0,
    created: 0,
    hidden: false,
  };
  return chooseFilePreview(entry, filePreviewModules).id;
}

/** A picture of the given size: a soft diagonal gradient, so scaling shows. */
function gradient(width: number, height: number): Buffer {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      pixels[index] = 60 + Math.round((150 * x) / width);
      pixels[index + 1] = 90 + Math.round((120 * y) / height);
      pixels[index + 2] = 160;
      pixels[index + 3] = 255;
    }
  return encodePNG({ width, height, pixels });
}

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

function sampleCommand(
  kind: string,
  name: string,
  executor: CustomAction['executor'],
  inputs?: ActionInput[],
): CustomAction {
  return {
    id: 'review-' + kind,
    name,
    aliases: [],
    icon: 'command',
    shortcut: '',
    order: 0,
    pinned: false,
    when: { target: 'any', extensions: [], min: 0, max: 10000 },
    executor,
    ...(inputs ? { inputs } : {}),
  };
}

/** Harmless commands for Settings. The scenes open editors and parameter forms. */
export const reviewActions = [
  sampleCommand('refresh', 'Refresh Files', { kind: 'builtin', command: 'refresh' }),
  sampleCommand('sequence', 'Refresh and Select', {
    kind: 'sequence',
    commands: ['refresh', 'select-all'],
  }),
  sampleCommand('workflow', 'Review Workflow', {
    kind: 'workflow',
    steps: [
      { kind: 'command', line: 'refresh' },
      { kind: 'action', actionID: 'review-program' },
    ],
  }),
  sampleCommand('recipe', 'Rename Field Notes', { kind: 'recipe', recipeID: 'batch-rename' }),
  sampleCommand('terminal', 'Open Login Shell', { kind: 'terminal', profileID: 'login' }),
  sampleCommand('program', 'Print a Caption', {
    kind: 'executable',
    executable: '/usr/bin/printf',
    args: ['%s\\n', 'Field work'],
    perItem: false,
  }),
  sampleCommand(
    'shell',
    'Print a Folder Label',
    {
      kind: 'shell',
      executable: '/bin/zsh',
      script: 'printf "%s\\n" "$VIEWER_INPUT_LABEL"',
      perItem: false,
    },
    [{ name: 'label', label: 'Folder label', kind: 'text', required: true, initial: 'Field work' }],
  ),
];

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
  await writeFile(
    path.join(projects, workspaceName + '.viewer-project'),
    JSON.stringify(sampleProject({})),
    { flag: 'wx' },
  );
  const lensDirectory = path.join(home, lensSample.folder, lensFolder, lensSubfolder);
  await mkdir(lensDirectory, { recursive: true });
  await writeFile(
    path.join(lensDirectory, 'field-notes' + lensSuffix),
    JSON.stringify(
      lensSchema.parse({
        version: 1,
        kind: 'viewer-lens',
        id: '3c0afc67-cc91-499d-8736-c176cf8bce58',
        name: lensSample.name,
        order: 0,
        groups: [
          {
            id: lensSample.groupID,
            name: 'Notes',
            order: 0,
            rules: [{ kind: 'extension', values: ['txt'] }],
          },
        ],
        members: [],
      }),
    ),
    { flag: 'wx' },
  );
  await writeFile(path.join(home, lensSample.folder, sampleFiles.text), sources.text, {
    flag: 'wx',
  });
  const git = path.join(home, gitSample, '.git');
  // A repository with an unborn branch is enough to list its worktree and open the commit form.
  await mkdir(path.join(git, 'objects'), { recursive: true });
  await mkdir(path.join(git, 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(git, 'HEAD'), 'ref: refs/heads/main\n', { flag: 'wx' });
  await writeFile(path.join(home, gitSample, sampleFiles.text), sources.text, { flag: 'wx' });
  // An empty committed tree gives the branch form a base without relying on a user's Git setup.
  const branchGit = path.join(home, branchSample, '.git');
  const object = async (kind: string, body: string) => {
    const bytes = Buffer.from(kind + ' ' + Buffer.byteLength(body) + '\0' + body);
    const hash = createHash('sha1').update(bytes).digest('hex');
    const folder = path.join(branchGit, 'objects', hash.slice(0, 2));
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, hash.slice(2)), deflateSync(bytes), { flag: 'wx' });
    return hash;
  };
  const tree = await object('tree', '');
  const author = 'Viewer Review <review@example.invalid> 1700000000 +0000';
  const commit = await object(
    'commit',
    ['tree ' + tree, 'author ' + author, 'committer ' + author, '', 'Sample', ''].join('\n'),
  );
  await mkdir(path.join(branchGit, 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(branchGit, 'HEAD'), 'ref: refs/heads/main\n', { flag: 'wx' });
  await writeFile(path.join(branchGit, 'refs', 'heads', 'main'), commit + '\n', { flag: 'wx' });
  for (const color of ['red', 'blue']) {
    await writeFile(
      path.join(home, branchSample, color + '.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" fill="' + color + '"/></svg>\n',
      { flag: 'wx' },
    );
  }
  await mkdir(path.join(home, journalSample));
  await writeFile(path.join(home, journalSample, sampleFiles.text), sources.text, { flag: 'wx' });
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
  await writeFile(path.join(home, widePicture), gradient(2400, 900), { flag: 'wx' });
  await writeFile(path.join(home, longStemPicture), picture, { flag: 'wx' });
  const models = path.join(home, sampleFolders.models);
  await mkdir(models);
  for (const sample of await modelSamples())
    if (/Reference block\.(stl|gltf|obj|mtl)$|reference-block\.bin$/.test(sample.path))
      await writeFile(path.join(models, path.basename(sample.path)), sample.bytes, { flag: 'wx' });
  await writeFile(path.join(models, 'Broken model.stl'), 'solid broken\nfacet normal x\n', {
    flag: 'wx',
  });
  // the review run's own Trash: a QA build lists only this one (src/desktop/operations/trash.ts)
  const trash = path.join(home, '.Trash');
  await mkdir(path.join(trash, 'Project archive'), { recursive: true });
  await writeFile(path.join(trash, 'Project archive', 'Brief.txt'), sources.text, { flag: 'wx' });
  await writeFile(path.join(trash, sampleFiles.text), sources.text, { flag: 'wx' });
  await writeFile(path.join(trash, longName('txt')), sources.text, { flag: 'wx' });
}

/** The run's file of each preview kind, filled in by createKindSamples before any scene runs. */
export const kindSamples: KindSamples = {};

/** One sample file for each preview kind, from the playground, in `Kinds`. */
export async function createKindSamples(home: string): Promise<KindSamples> {
  const folder = path.join(home, sampleFolders.kinds);
  await mkdir(folder, { recursive: true });
  const chosen = kindSamples;
  // the playground's first file of a kind is its plainest; nested and malformed ones are skipped
  for (const sample of await localSamples()) {
    if (!sample.path.startsWith('previews/') || sample.path.split('/').length !== 3) continue;
    const name = path.basename(sample.path);
    const kind = previewKind(name);
    if (chosen[kind]) continue;
    await writeFile(path.join(folder, name), sample.bytes, { flag: 'wx' });
    chosen[kind] = name;
  }
  const font = await readFile(systemFont).catch(() => undefined);
  if (font && !chosen.font) {
    await writeFile(path.join(folder, 'Arial.ttf'), font, { flag: 'wx' });
    chosen.font = 'Arial.ttf';
  }
  return chosen;
}
