import type { FileEntry } from '../contracts';
import { archiveStem } from './insights';
import { archive } from './rules';

/**
 * OVERVIEW: what may need a look across the person's files, as searches of the filename index.
 * Each is a query in the search language (docs/reference/search.md) over a known place or every
 * indexed location. The Overview plane counts the matches; Show all opens them as a search, where
 * the person selects and acts with the usual commands. Nothing here changes a file.
 */
export type OverviewPlace = 'downloads' | 'desktop' | 'everywhere';

export interface OverviewQuery {
  /** Stable: the card's key. */
  id: string;
  title: string;
  /** Why it is worth a look, one short line. */
  detail: string;
  query: string;
  place: OverviewPlace;
  /** Which matches a card shows first: the largest, or the latest. */
  order?: 'size' | 'modified';
  /** Matches the index cannot decide alone: archives with their extracted folder beside them,
   * which the card checks one by one. */
  check?: 'extracted';
}

export const overviewQueries: readonly OverviewQuery[] = [
  {
    id: 'downloads.installers',
    title: 'Old installers',
    detail: 'Disk images and packages in Downloads, older than a week',
    query: 'ext:dmg,pkg modified>7d',
    place: 'downloads',
  },
  {
    id: 'archives.extracted',
    title: 'Archives already extracted',
    detail: 'The folder Extract here made is beside them',
    query: 'ext:zip,tar,tgz,gz',
    place: 'everywhere',
    check: 'extracted',
  },
  {
    id: 'files.large',
    title: 'Files over 1 GB',
    detail: 'The quickest space to win back',
    query: 'is:file size>1gb',
    place: 'everywhere',
  },
  {
    id: 'desktop.screenshots',
    title: 'Screenshots on the Desktop',
    detail: 'Captures that could share a folder',
    query: '~"^(Screenshot|Screen Shot|Screen Recording|CleanShot)"',
    place: 'desktop',
  },
  {
    id: 'downloads.stale',
    title: 'Old downloads',
    detail: 'Files in Downloads unchanged for three months',
    query: 'is:file modified>3mo',
    place: 'downloads',
  },
  {
    id: 'pdfs.large',
    title: 'PDFs over 10 MB',
    detail: 'Optimize often makes them much smaller',
    query: 'ext:pdf size>10mb',
    place: 'everywhere',
  },
  {
    id: 'names.copies',
    title: 'Files named as copies',
    detail: 'Names ending " copy" or "(1)"; Find duplicates compares contents',
    query: '~"( copy( [0-9]+)?| \\([0-9]+\\))(\\.[^.]+)?$"',
    place: 'everywhere',
  },
  {
    id: 'photos.heic',
    title: 'HEIC photos',
    detail: 'They open in fewer apps than JPEG',
    query: 'ext:heic,heif',
    place: 'everywhere',
  },
  {
    id: 'files.recent',
    title: 'Changed this week',
    detail: 'Where your work has been',
    query: 'is:file modified<7d',
    place: 'everywhere',
    order: 'modified',
  },
];

/** The folder Extract here makes beside an archive; undefined for a file that is not one. */
export function extractedFolder(entry: FileEntry): string | undefined {
  if (entry.directory || !archive(entry)) return undefined;
  const stem = archiveStem(entry.name);
  if (!stem) return undefined;
  const separator = entry.parent.includes('\\') && !entry.parent.includes('/') ? '\\' : '/';
  return entry.parent.replace(/[\\/]+$/, '') + separator + stem;
}

/** How many archives a card checks for their folder: one look each. */
export const extractedChecks = 200;

/** The folder a place searches; undefined for every indexed location. */
export function overviewRoot(place: OverviewPlace, home: string): string | undefined {
  const separator = home.includes('\\') && !home.includes('/') ? '\\' : '/';
  const base = home.replace(/[\\/]+$/, '');
  if (place === 'downloads') return base + separator + 'Downloads';
  if (place === 'desktop') return base + separator + 'Desktop';
  return undefined;
}

export interface OverviewSummary {
  count: number;
  /** More matched than were read: the count is a lower bound. */
  more: boolean;
  bytes: number;
  /** The matches a card names, in its order. */
  top: FileEntry[];
}

/** A card's numbers from the matches read. */
export function summarize(
  entries: readonly FileEntry[],
  more: boolean,
  order: OverviewQuery['order'] = 'size',
  shown = 4,
): OverviewSummary {
  const files = entries.filter((entry) => !entry.directory);
  return {
    count: entries.length,
    more,
    bytes: files.reduce((sum, entry) => sum + entry.size, 0),
    top: files
      .toSorted((a, b) =>
        order === 'modified' ? b.modified - a.modified : b.size - a.size || b.modified - a.modified,
      )
      .slice(0, shown),
  };
}
