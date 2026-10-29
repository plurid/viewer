import type { FileEntry } from '../contracts';
import { fileFamily, formatBytes } from '../files/entries';
import { isOfficeFormat } from '../previews/documents/layout';
import { parentPath } from '../workspaces/planes';

/** What a rule reads: the selection, the time, and a few facts about the person's setup. */
export interface SuggestionInput {
  selection: readonly FileEntry[];
  now: number;
  home: string;
  /** A model is set up, so a recipe that asks one can run. */
  modelReady: boolean;
  /** A file's text can be edited in a plane: its preview edits text. */
  editable(entry: FileEntry): boolean;
}

/**
 * A suggestion for a kind of selection. Rules are pure and quick: a menu evaluates them on the
 * entries it already has, while it opens.
 */
export interface SuggestionRule {
  /** Stable, so a person can turn one off by name in the configuration. */
  id: string;
  /** The commands it suggests, best first: the first that applies to the selection is shown. */
  commands: readonly string[];
  weight: number;
  /** Why, shown beside the row; undefined when the rule does not apply. */
  reason(input: SuggestionInput): string | undefined;
}

const megabytes = 1024 * 1024;
const day = 24 * 60 * 60 * 1000;
const files = (input: SuggestionInput) => input.selection.filter((entry) => !entry.directory);
/** Every selected item is a file and passes the test. */
const everyFile = (input: SuggestionInput, test: (entry: FileEntry) => boolean) =>
  input.selection.length > 0 && input.selection.every((entry) => !entry.directory && test(entry));
const extension =
  (...names: string[]) =>
  (entry: FileEntry) =>
    names.includes((entry.extension ?? '').toLowerCase());
/** A zip or tar archive, compressed or not. */
export const archive = (entry: FileEntry) => /\.(?:zip|tar|tar\.gz|tgz)$/i.test(entry.name);
/** A disk image or installer package in Home's Downloads, over a week old. */
export const oldInstaller = (entry: FileEntry, input: Pick<SuggestionInput, 'now' | 'home'>) =>
  extension('dmg', 'pkg')(entry) &&
  // the folder's own name, so a Home on any platform matches
  /[\\/]Downloads$/.test(entry.parent) &&
  parentPath(entry.parent) === input.home &&
  input.now - entry.modified > 7 * day;
/** A name a copy gets: "Report copy.pdf", "Report copy 2.pdf", "Report (1).pdf". */
export const copyName = (entry: FileEntry) =>
  / (?:copy(?: \d+)?|\(\d+\))(?:\.[^.]+)?$/i.test(entry.name);
const family = (name: string) => (entry: FileEntry) => fileFamily(entry) === name;
const total = (entries: readonly FileEntry[]) =>
  entries.reduce((sum, entry) => sum + entry.size, 0);
/** "a.pdf", "3 PDFs": one name, or a count of a kind. */
const count = (entries: readonly FileEntry[], one: string, many: string) =>
  entries.length === 1 ? one : `${entries.length} ${many}`;

export const suggestionRules: readonly SuggestionRule[] = [
  {
    id: 'archive.extract',
    commands: ['extract'],
    weight: 100,
    reason: (input) =>
      everyFile(input, archive)
        ? count(files(input), `${input.selection[0]!.extension.toUpperCase()} archive`, 'archives')
        : undefined,
  },
  {
    id: 'pdf.large.optimize',
    commands: ['optimize-files'],
    weight: 90,
    reason: (input) =>
      everyFile(input, (entry) => extension('pdf')(entry) && entry.size > 10 * megabytes)
        ? count(files(input), `${formatBytes(total(files(input)))} PDF`, 'large PDFs')
        : undefined,
  },
  {
    id: 'heic.jpeg',
    commands: ['convert-jpeg'],
    weight: 85,
    reason: (input) =>
      everyFile(input, extension('heic', 'heif')) ? 'HEIC opens in fewer apps' : undefined,
  },
  {
    id: 'photo.large.web',
    commands: ['export.images-for-web'],
    weight: 80,
    reason: (input) =>
      everyFile(
        input,
        (entry) => extension('jpg', 'jpeg', 'png')(entry) && entry.size > 3 * megabytes,
      )
        ? count(files(input), `${formatBytes(total(files(input)))} image`, 'large images')
        : undefined,
  },
  {
    id: 'downloads.installer',
    commands: ['trash'],
    weight: 75,
    reason: (input) => {
      if (!everyFile(input, (entry) => oldInstaller(entry, input))) return undefined;
      const days = Math.floor((input.now - Math.max(...files(input).map((e) => e.modified))) / day);
      return `Installer from ${days} days ago`;
    },
  },
  {
    id: 'names.copy',
    commands: ['find-duplicates'],
    weight: 70,
    reason: (input) =>
      input.selection.some((entry) => !entry.directory && copyName(entry))
        ? 'Looks like a copy'
        : undefined,
  },
  {
    id: 'images.pdf',
    commands: ['images-to-pdf'],
    weight: 60,
    reason: (input) =>
      input.selection.length > 1 && everyFile(input, family('image'))
        ? `${input.selection.length} images`
        : undefined,
  },
  {
    id: 'media.edit',
    commands: ['edit-media'],
    weight: 60,
    reason: (input) =>
      everyFile(input, family('video'))
        ? count(files(input), 'Video', 'videos')
        : everyFile(input, family('audio'))
          ? count(files(input), 'Audio', 'recordings')
          : undefined,
  },
  {
    id: 'text.edit',
    commands: ['edit-selected'],
    weight: 55,
    reason: (input) =>
      input.selection.length === 1 && everyFile(input, input.editable) ? 'Text file' : undefined,
  },
  {
    id: 'office.pdf',
    commands: ['save-pdf-copy'],
    weight: 50,
    reason: (input) =>
      everyFile(input, (entry) => isOfficeFormat((entry.extension ?? '').toLowerCase()))
        ? 'A PDF opens anywhere'
        : undefined,
  },
  {
    id: 'images.rename',
    commands: ['recipe.batch-rename'],
    weight: 50,
    reason: (input) =>
      input.selection.length > 2 && everyFile(input, family('image'))
        ? `${input.selection.length} photos`
        : undefined,
  },
  {
    id: 'books.rename',
    commands: ['recipe.book-name'],
    weight: 45,
    reason: (input) =>
      input.modelReady && everyFile(input, extension('pdf', 'epub'))
        ? 'Name it from the book itself'
        : undefined,
  },
  {
    id: 'folder.git',
    commands: ['git-changes'],
    weight: 45,
    reason: (input) =>
      input.selection.length === 1 && input.selection[0]!.directory ? 'A repository' : undefined,
  },
  {
    id: 'folder.explore',
    commands: ['explore-folder'],
    weight: 40,
    reason: (input) =>
      input.modelReady && input.selection.length === 1 && input.selection[0]!.directory
        ? 'Ask the model what is here'
        : undefined,
  },
  {
    id: 'video.audio',
    commands: ['export.extract-audio'],
    weight: 40,
    reason: (input) =>
      input.selection.length === 1 && everyFile(input, family('video'))
        ? 'Keep only the sound'
        : undefined,
  },
  {
    id: 'folder.size',
    commands: ['calculate-size'],
    weight: 35,
    reason: (input) =>
      input.selection.length === 1 && input.selection[0]!.directory ? 'Folder' : undefined,
  },
  {
    id: 'items.compress',
    commands: ['compress'],
    weight: 30,
    reason: (input) => (input.selection.length > 1 ? `${input.selection.length} items` : undefined),
  },
];

/** The kind a selection's history is kept under: its extension, or its family, or "mixed". */
export function selectionKind(selection: readonly FileEntry[]): string | undefined {
  if (!selection.length) return undefined;
  const kinds = new Set(
    selection.map((entry) =>
      entry.directory ? 'folder' : (entry.extension ?? '').toLowerCase() || fileFamily(entry),
    ),
  );
  if (kinds.size === 1) return [...kinds][0];
  const families = new Set(selection.map((entry) => fileFamily(entry)));
  return families.size === 1 ? 'family:' + [...families][0] : 'mixed';
}

/** A command chosen for a kind: first in its list, which keeps eight; forty kinds at most. */
export function rememberSuggestion(
  history: Readonly<Record<string, readonly string[]>> | undefined,
  kind: string,
  id: string,
): Record<string, string[]> {
  const { [kind]: earlier = [], ...others } = history ?? {};
  const kept = Object.entries(others).slice(-39);
  return {
    ...Object.fromEntries(kept.map(([key, ids]) => [key, [...ids]])),
    [kind]: [id, ...earlier.filter((item) => item !== id)].slice(0, 8),
  };
}
