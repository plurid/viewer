/**
 * WHAT A FOLDER HOLDS FOR A CHECK, as this window knows it: the listing a plane shows, else a probe
 * through the folder listing route, one folder at a time, cached by the folder's date. Nothing
 * waits for a probe: whoever asked is told when it arrives, and asks again.
 */
import type { FileEntry } from '../../domain/contracts';
import type { FolderContents, JobContents } from '../../domain/fabrication/job-files';
import { jobContents, jobFolders, listingContents } from '../../domain/fabrication/job-files';
import { fileName } from '../../domain/tours/tour';
import { shownEntries } from '../explorer/useFolder';

/** Where a folder's own files were counted from: a plane showing it, or a probe of its listing. */
export type ContentsSource = 'shown' | 'probed';
export interface KnownJob {
  contents: JobContents;
  source: ContentsSource;
}
interface Probed {
  /** The folder's date when it was asked for; unknown for a folder no listing shows. */
  modified?: number;
  at: number;
  contents: FolderContents;
}

const probeLimits = {
  /** Folders whose counts are kept. */
  kept: 64,
  /** Folders waiting for a probe; the latest asked go first, the oldest are dropped. */
  waiting: 16,
  /** After this a count is read again, still used meanwhile: a file added inside a folder in it
   * does not change the folder's date. In milliseconds. */
  age: 60_000,
} as const;
const probed = new Map<string, Probed>();
const waiting: { path: string; modified?: number }[] = [];
let probing: string | undefined;
const listeners = new Set<() => void>();
/** A shown listing's counts, by its entries: commands are asked at every selection change, and a
 * listing of thousands is counted once. */
const shownCounts = new WeakMap<readonly FileEntry[], FolderContents>();

/** Calls `listener` when a probe brings what a folder holds. */
export function subscribeJobContents(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Forgets what a folder and the folders in it were found to hold: the check found otherwise. */
export function forgetJobContents(path: string): void {
  const inside = path.replace(/\/$/, '') + '/';
  const forgotten = [...probed.keys()].filter((key) => key === path || key.startsWith(inside));
  for (const key of forgotten) probed.delete(key);
  if (forgotten.length) for (const listener of listeners) listener();
}

function ask(path: string, modified?: number): void {
  if (probing === path || waiting.some((item) => item.path === path)) return;
  waiting.push({ path, ...(modified === undefined ? {} : { modified }) });
  waiting.splice(0, Math.max(0, waiting.length - probeLimits.waiting));
  if (probing === undefined) void probeNext();
}
async function probeNext(): Promise<void> {
  const next = waiting.pop();
  if (!next) return;
  probing = next.path;
  let contents: FolderContents;
  try {
    contents = listingContents((await window.viewer.list(next.path)).entries);
  } catch {
    // a folder that cannot be listed holds nothing to check; the check itself would say why
    contents = listingContents([]);
  }
  probing = undefined;
  probed.delete(next.path);
  probed.set(next.path, { modified: next.modified, at: Date.now(), contents });
  for (const key of probed.keys()) {
    if (probed.size <= probeLimits.kept) break;
    probed.delete(key);
  }
  for (const listener of listeners) listener();
  void probeNext();
}

/** One folder's own counts: shown, or probed at the date given; else a probe is asked for. */
function folderKnown(
  path: string,
  modified?: number,
): { contents: FolderContents; source: ContentsSource } | undefined {
  const shown = shownEntries(path);
  if (shown) {
    const contents = shownCounts.get(shown) ?? listingContents(shown);
    shownCounts.set(shown, contents);
    return { contents, source: 'shown' };
  }
  const found = probed.get(path);
  const current = found && (modified === undefined || found.modified === modified);
  if (!current || Date.now() - found.at > probeLimits.age) ask(path, modified);
  return current ? { contents: found.contents, source: 'probed' } : undefined;
}

/**
 * What a job folder holds for its check, its folders one level down included, or undefined until
 * every listing it needs is known. `modified` is the folder's date, from the listing that shows it.
 */
export function knownJob(path: string, modified?: number): KnownJob | undefined {
  const own = folderKnown(path, modified);
  if (!own) return undefined;
  const job = fileName(path) || path;
  const inside = jobFolders(job, own.contents).map((folder) => ({
    name: folder.name,
    known: folderKnown(folder.path, folder.modified),
  }));
  if (inside.some((folder) => !folder.known)) return undefined;
  return {
    contents: jobContents(
      job,
      own.contents,
      inside.map((folder) => ({ name: folder.name, contents: folder.known!.contents })),
    ),
    source: own.source,
  };
}
