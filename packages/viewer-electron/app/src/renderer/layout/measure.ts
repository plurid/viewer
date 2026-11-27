/**
 * Reads what the planner needs from the selection: each photo's pixels as displayed, and each PDF's
 * page sizes. A photo's header gives its pixels; its thumbnail, drawn upright from its EXIF
 * orientation, says whether they are turned.
 */
import type { FileEntry } from '../../domain/contracts';
import type { Size } from '../../domain/layout/geometry';
import { layoutFileKind, sourceLimits } from '../../domain/layout/sources';
import type { ImageSource, LayoutSource } from '../../domain/layout/sources';
import { errorMessage } from '../../domain/errors';
import { openLayoutDocument } from './pdf';
import type { LayoutDocument } from './pdf';

export interface ReadSelection {
  /** Photos and PDFs, in selection order. */
  sources: LayoutSource[];
  /** Each source's file, by path: its version is checked again when the layout is saved. */
  entries: Map<string, FileEntry>;
  drawings: FileEntry[];
  /** Open PDFs, by path, for page pictures. */
  documents: Map<string, LayoutDocument>;
  /** Small upright thumbnails, by path. */
  thumbnails: Map<string, string>;
  skipped: { name: string; reason: string }[];
}
export const smallThumbnail = 128;

/** A PNG data URL's width and height, from its header. */
export function pngSize(url: string): Size | undefined {
  const prefix = 'data:image/png;base64,';
  if (!url.startsWith(prefix)) return undefined;
  const bytes = Uint8Array.from(atob(url.slice(prefix.length, prefix.length + 44)), (character) =>
    character.charCodeAt(0),
  );
  if (bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width && height ? { width, height } : undefined;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
async function readImage(entry: FileEntry, thumbnails: Map<string, string>): Promise<ImageSource> {
  const [inspection, thumbnail] = await Promise.all([
    window.viewer.inspect(entry.path, true).catch(() => undefined),
    window.viewer.thumbnail(entry.path, smallThumbnail).catch(() => ''),
  ]);
  if (thumbnail) thumbnails.set(entry.path, thumbnail);
  const upright = thumbnail ? pngSize(thumbnail) : undefined;
  const width = Number(inspection?.facts.width?.value) || 0;
  const height = Number(inspection?.facts.height?.value) || 0;
  const base = {
    kind: 'image' as const,
    path: entry.path,
    name: entry.name,
    date: dateFormat.format(entry.modified),
  };
  if (width && height) {
    // a header's pixels are as stored; the thumbnail shows which way up they are seen
    const turned =
      !!upright &&
      Math.abs(width - height) > 1 &&
      width > height !== upright.width > upright.height;
    return {
      ...base,
      width: turned ? height : width,
      height: turned ? width : height,
      measured: true,
    };
  }
  if (upright) return { ...base, ...upright, measured: false };
  throw new Error('Its size could not be read.');
}

/** Runs `work` on each item, a few at a time, in order of the items. */
async function eachLimited<Item>(
  items: readonly Item[],
  limit: number,
  work: (item: Item, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await work(items[index]!, index);
      }
    }),
  );
}

export async function readSelection(
  paths: readonly string[],
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<ReadSelection> {
  const read: ReadSelection = {
    sources: [],
    entries: new Map(),
    drawings: [],
    documents: new Map(),
    thumbnails: new Map(),
    skipped: [],
  };
  const found: (LayoutSource | undefined)[] = new Array(paths.length);
  let done = 0;
  try {
    await eachLimited(paths, 6, async (path, index) => {
      signal.throwIfAborted();
      try {
        const entry = await window.viewer.stat(path);
        const kind = layoutFileKind(entry);
        read.entries.set(path, entry);
        if (kind && kind !== 'drawing' && entry.size > sourceLimits.each)
          throw new Error('It is larger than 256 MB.');
        if (kind === 'drawing') read.drawings.push(entry);
        else if (kind === 'image') found[index] = await readImage(entry, read.thumbnails);
        else if (kind === 'pdf') {
          const opened = await openLayoutDocument(path, signal);
          read.documents.set(path, opened);
          found[index] = { kind: 'pdf', path, name: entry.name, pages: opened.pages };
        } else read.skipped.push({ name: entry.name, reason: 'Not a photo, PDF or DXF file.' });
      } catch (error) {
        if (signal.aborted) throw error;
        read.skipped.push({ name: path.split('/').pop() ?? path, reason: errorMessage(error) });
      }
      progress(++done, paths.length);
    });
  } catch (error) {
    for (const opened of read.documents.values()) opened.close();
    throw error;
  }
  read.sources = found.filter((source): source is LayoutSource => !!source);
  // drawings keep their selection order too
  read.drawings.sort((a, b) => paths.indexOf(a.path) - paths.indexOf(b.path));
  return read;
}
