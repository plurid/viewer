import type { FileEntry } from '../contracts';
import { fileFamily, formatBytes } from '../files/entries';
import { archive, copyName, oldInstaller } from './rules';
import { extractedFolderName } from '../operations/extract';

/** The insights a folder can show, by the id a dismissal keeps. */
export type InsightID =
  | 'archives.extracted'
  | 'downloads.installers'
  | 'screenshots'
  | 'pdfs.large'
  | 'photos.heic'
  | 'names.copies';
/** The commands an insight's action runs, as the menus name them. */
export type InsightCommand =
  'trash' | 'optimize-files' | 'find-duplicates' | 'new-folder-with-selection' | 'convert-jpeg';
/** What an insight's action runs on: its files, or the folder with nothing selected. */
export type InsightTarget = 'files' | 'folder';

/**
 * Something in a folder that may need attention, with one action. The action runs the command a
 * person would pick from the menu, on exactly the files concerned; nothing applies by itself.
 */
export interface FolderInsight {
  /** Stable: a dismissed insight stays hidden in its folder by it. */
  id: InsightID;
  /** "3 installers older than a week" */
  title: string;
  detail?: string;
  command: InsightCommand;
  /** The action's label. */
  action: string;
  /** The files concerned, in the listing's order. */
  paths: string[];
  target: InsightTarget;
}

/** What insights read: the listing the folder already has, the time and the person's Home. */
export interface InsightInput {
  folder: string;
  entries: readonly FileEntry[];
  now: number;
  home: string;
  /** The ids dismissed in this folder. */
  dismissed?: readonly string[];
  /** How many to return, strongest first. */
  limit?: number;
}

interface InsightRule {
  id: InsightID;
  weight: number;
  command: InsightCommand;
  action: string;
  target: InsightTarget;
  /** The fewest files that make a card. */
  least: number;
  matches(entry: FileEntry, input: InsightInput): boolean;
  /** Checked once the pass has seen every folder: `folders` holds the subfolders' names. */
  confirm?(entry: FileEntry, folders: ReadonlySet<string>): boolean;
  title(files: readonly FileEntry[]): string;
  detail?(files: readonly FileEntry[]): string;
}

export const insightLimit = 3;
const megabytes = 1_000_000;
const screenshot = /^(?:Screenshot|Screen Shot|Screen Recording|CleanShot)/i;
const extension = (entry: FileEntry) => entry.extension.toLowerCase();
const total = (files: readonly FileEntry[]) => files.reduce((sum, file) => sum + file.size, 0);
/** "1 PDF", "3 PDFs" */
const count = (files: readonly FileEntry[], one: string, many: string) =>
  `${files.length} ${files.length === 1 ? one : many}`;
/** "a.zip", "a.zip and b.zip", "a.zip, b.zip and 3 more" */
const names = (files: readonly FileEntry[]) => {
  const shown = files.slice(0, 2).map((file) => file.name);
  const more = files.length - shown.length;
  return more ? `${shown.join(', ')} and ${more} more` : shown.join(' and ');
};
const namesAndSize = (files: readonly FileEntry[]) =>
  `${names(files)} · ${formatBytes(total(files))}`;

const insightRules: readonly InsightRule[] = [
  {
    id: 'downloads.installers',
    weight: 90,
    command: 'trash',
    action: 'Move to Trash',
    target: 'files',
    least: 1,
    matches: oldInstaller,
    title: (files) => `${count(files, 'installer', 'installers')} older than a week`,
    detail: namesAndSize,
  },
  {
    id: 'archives.extracted',
    weight: 85,
    command: 'trash',
    action: 'Move to Trash',
    target: 'files',
    least: 1,
    matches: archive,
    confirm: (entry, folders) => folders.has(extractedFolderName(entry.name)),
    title: (files) => `${count(files, 'archive', 'archives')} already extracted`,
    detail: namesAndSize,
  },
  {
    id: 'pdfs.large',
    weight: 70,
    command: 'optimize-files',
    action: 'Optimize',
    target: 'files',
    least: 1,
    matches: (entry) => extension(entry) === 'pdf' && entry.size > 10 * megabytes,
    title: (files) => `${count(files, 'PDF', 'PDFs')} over 10 MB`,
    detail: namesAndSize,
  },
  {
    id: 'names.copies',
    weight: 60,
    command: 'find-duplicates',
    action: 'Find duplicates',
    target: 'folder',
    least: 2,
    matches: copyName,
    title: (files) => `${count(files, 'file', 'files')} named as copies`,
    detail: names,
  },
  {
    id: 'screenshots',
    weight: 50,
    command: 'new-folder-with-selection',
    action: 'Put in a folder',
    target: 'files',
    least: 5,
    matches: (entry) =>
      screenshot.test(entry.name) && ['image', 'video'].includes(fileFamily(entry)),
    title: (files) => count(files, 'screenshot', 'screenshots'),
    detail: (files) => formatBytes(total(files)),
  },
  {
    id: 'photos.heic',
    weight: 40,
    command: 'convert-jpeg',
    action: 'Convert copies to JPEG',
    target: 'files',
    least: 3,
    matches: (entry) => ['heic', 'heif'].includes(extension(entry)),
    title: (files) => count(files, 'HEIC photo', 'HEIC photos'),
    detail: () => 'HEIC opens in fewer apps',
  },
];

/**
 * A folder's insights, strongest first: pure and quick, from one pass over the listing it already
 * has. Hidden items take no part, and a dismissed insight is left out.
 */
export function folderInsights(input: InsightInput): FolderInsight[] {
  const dismissed = new Set(input.dismissed);
  const rules = insightRules
    .filter((rule) => !dismissed.has(rule.id))
    .sort((a, b) => b.weight - a.weight);
  if (!rules.length) return [];
  const found = rules.map(() => [] as FileEntry[]);
  const folders = new Set<string>();
  for (const entry of input.entries) {
    if (entry.hidden) continue;
    if (entry.directory) folders.add(entry.name);
    if (entry.kind !== 'file') continue;
    rules.forEach((rule, index) => {
      if (rule.matches(entry, input)) found[index]!.push(entry);
    });
  }
  return rules
    .flatMap((rule, index): FolderInsight[] => {
      const files = rule.confirm
        ? found[index]!.filter((entry) => rule.confirm!(entry, folders))
        : found[index]!;
      if (files.length < rule.least) return [];
      return [
        {
          id: rule.id,
          title: rule.title(files),
          ...(rule.detail ? { detail: rule.detail(files) } : {}),
          command: rule.command,
          action: rule.action,
          paths: files.map((file) => file.path),
          target: rule.target,
        },
      ];
    })
    .slice(0, input.limit ?? insightLimit);
}

/** A folder's dismissed insight, latest folder last: two hundred folders, twenty ids each. */
export function rememberDismissal(
  dismissed: Readonly<Record<string, readonly string[]>> | undefined,
  folder: string,
  id: string,
): Record<string, string[]> {
  const { [folder]: earlier = [], ...others } = dismissed ?? {};
  const kept = Object.entries(others).slice(-199);
  return {
    ...Object.fromEntries(kept.map(([path, ids]) => [path, [...ids]])),
    [folder]: [...earlier.filter((item) => item !== id), id].slice(-20),
  };
}
