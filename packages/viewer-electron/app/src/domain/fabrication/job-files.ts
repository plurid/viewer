/**
 * A JOB'S FILES: what a folder holds for a laser-job check, counted by kind, the folders inside it
 * the check reads one level down, and what changed in it since a check listed it. The desktop lists
 * a job by these rules; the window counts with them to offer a check only where there are parts to
 * cut (docs/reference/fabrication.md#what-a-check-reads).
 */
import type { FileEntry } from '../contracts';
import type { InventoryKind } from './answer';
import { countText } from '../layout/nesting/format';
import { checkFileKind } from './check';
import { handoffName } from './handoff';
import { correctedName, listText } from './plan';

/** What a file is to a check: a kind it reads, or a DWG drawing, which it cannot measure. */
export type JobFileKind = InventoryKind | 'dwg';
export function jobFileKind(name: string): JobFileKind | undefined {
  return checkFileKind(name) ?? (/\.dwg$/i.test(name) ? 'dwg' : undefined);
}
const jobFileKinds: readonly JobFileKind[] = ['request', 'drawing', 'photo', 'dxf', 'dwg'];
const email = /\.emlx?$/i;

export const jobLimits = {
  /** A folder holding more folders than this is read without them: a folder of folders. */
  folders: 8,
} as const;

/** A folder in a job's folder, as its listing gives it. */
export interface JobFolder {
  name: string;
  path: string;
  /** Its date, which changes when a file is added to it or taken out. */
  modified: number;
}
/** What files hold for a check, counted by kind, and the folders among them. */
export interface FolderContents extends Record<JobFileKind, number> {
  /** Requests that are mail messages: `.eml` and `.emlx`. */
  email: number;
  folders: JobFolder[];
}
export type ListedEntry = Pick<FileEntry, 'name' | 'path' | 'kind' | 'modified'>;

/** What these files hold for a check; links are not read, and folders are counted apart. */
export function folderContents(entries: readonly ListedEntry[]): FolderContents {
  const contents: FolderContents = {
    request: 0,
    email: 0,
    drawing: 0,
    photo: 0,
    dxf: 0,
    dwg: 0,
    folders: [],
  };
  for (const entry of entries) {
    if (entry.kind === 'directory')
      contents.folders.push({ name: entry.name, path: entry.path, modified: entry.modified });
    if (entry.kind !== 'file') continue;
    const kind = jobFileKind(entry.name);
    if (kind) contents[kind]++;
    if (kind === 'request' && email.test(entry.name)) contents.email++;
  }
  return contents;
}
/** What a folder's listing holds for a check: its hidden files are not read. */
export const listingContents = (entries: readonly (ListedEntry & { hidden: boolean })[]) =>
  folderContents(entries.filter((entry) => !entry.hidden));

/** A handoff a check saved in the job, "Job 1042 handoff", or a copy of one. */
export const isHandoff = (job: string, name: string) =>
  name.toLowerCase().startsWith(handoffName(job).toLowerCase());

/** The folders in a job whose files its check reads too: every one but a saved handoff, when the
 * job holds at most eight. */
export function jobFolders(job: string, contents: FolderContents): JobFolder[] {
  return contents.folders.length > jobLimits.folders
    ? []
    : contents.folders.filter((folder) => !isHandoff(job, folder.name));
}

/** A folder in the job, read one level down, with what it holds. */
export interface ReadFolder {
  name: string;
  contents: FolderContents;
}
/** What a job holds for its check: its own files and those of the folders read in it. */
export interface JobContents extends Record<JobFileKind, number> {
  email: number;
  /** The job's name: its folder's. */
  job: string;
  /** The folders read in it. */
  folders: number;
  /** The one folder in the job that holds every DXF part, when one does: "DXF". */
  partsIn?: string;
  /** The jobs it holds when it is a folder of jobs: then none of them is read. */
  jobs: string[];
}

/** Whether files hold anything a check reads. */
const holdsWork = (contents: FolderContents) => jobFileKinds.some((kind) => contents[kind] > 0);
/** Whether a folder is a job of its own: a request and parts to cut. */
const isJob = (contents: FolderContents) => contents.request > 0 && contents.dxf + contents.dwg > 0;

/**
 * A job's contents. A folder with a request and parts of its own is a job of its own, never read
 * as part of the folder holding it. A folder holding nothing itself, with a job among its folders,
 * is a folder of jobs, checked one at a time: "fabrication" holding "Job 1042" and an
 * "Evaluation" folder of parts. Otherwise its folders are its job's own, such as "DXF".
 */
export function jobContents(
  job: string,
  own: FolderContents,
  inside: readonly ReadFolder[],
): JobContents {
  // by name, as a listing's order is the filesystem's: jobs first, then folders of parts
  const byName = (a: ReadFolder, b: ReadFolder) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const separate = inside.filter(({ contents }) => isJob(contents)).sort(byName);
  const rest = inside
    .filter(({ contents }) => !isJob(contents) && holdsWork(contents))
    .sort(byName);
  const jobs =
    !holdsWork(own) && separate.length ? [...separate, ...rest].map(({ name }) => name) : [];
  const read = jobs.length ? [] : rest;
  const total: JobContents = {
    job,
    request: own.request,
    email: own.email,
    drawing: own.drawing,
    photo: own.photo,
    dxf: own.dxf,
    dwg: own.dwg,
    folders: read.length,
    jobs,
  };
  for (const { contents } of read) {
    for (const kind of jobFileKinds) total[kind] += contents[kind];
    total.email += contents.email;
  }
  const holding = read.filter(({ contents }) => contents.dxf);
  if (!own.dxf && holding.length === 1) total.partsIn = holding[0]!.name;
  return total;
}

/** "Job 1042, Job 1043 and 2 more". */
const someNames = (names: readonly string[]) =>
  names.length <= 3
    ? listText(names)
    : listText([...names.slice(0, 2), countText(names.length - 2, 'more', 'more')]);

/**
 * Why a job holds nothing to check, in words naming it, or undefined when it holds a DXF part:
 * several jobs, DWG drawings Viewer cannot measure, or no drawing to cut at all.
 */
export function nothingText(contents: JobContents, fromFolder: boolean): string | undefined {
  const { job, jobs, dxf, dwg, folders } = contents;
  if (jobs.length)
    return jobs.length === 1
      ? `${job} holds ${jobs[0]}: check it on its own.`
      : `${job} holds ${someNames(jobs)}. Check one of them.`;
  if (dxf) return undefined;
  const holds = !fromFolder
    ? 'The selection holds'
    : folders
      ? `${job} and its ${folders === 1 ? 'folder' : countText(folders, 'folder')} hold`
      : `${job} holds`;
  return dwg
    ? `${holds} ${countText(dwg, 'DWG file')} and no DXF. Viewer measures DXF only: save ${dwg === 1 ? 'it' : 'them'} as DXF from the CAD app, then check again.`
    : `${holds} no DXF or DWG file, so there is nothing to check.`;
}

/** How a job's file differs from the one its check read. */
export type FileChange = 'changed' | 'added' | 'removed';
export interface CheckChange {
  name: string;
  change: FileChange;
}
const changeWords: Record<FileChange, [one: string, many: string]> = {
  changed: ['changed', 'changed'],
  added: ['is new', 'are new'],
  removed: ['is gone', 'are gone'],
};
/** "g6-PL60-B2-2buc.dxf changed and Bracket B3.dxf is new since the check at 22:14." */
export function changesText(changes: readonly CheckChange[], at: string): string {
  const parts: string[] = [];
  for (const change of ['changed', 'added', 'removed'] as const) {
    const names = changes.filter((item) => item.change === change).map((item) => item.name);
    if (!names.length) continue;
    const named =
      names.length <= 2
        ? listText(names)
        : `${names[0]} and ${countText(names.length - 1, 'more file')}`;
    parts.push(`${named} ${changeWords[change][names.length === 1 ? 0 : 1]}`);
  }
  return `${listText(parts)} since the check at ${at}.`;
}
/** A corrected copy of one of `parts` as a check saves it: "<name> (corrected).dxf", or its copy
 * when that name was taken, "<name> (corrected) copy 2.dxf". */
export function correctedCopy(name: string, parts: readonly string[]): boolean {
  const original = name.replace(/ copy(?: \d+)?(?=\.dxf$)/i, '').toLowerCase();
  return parts.some((part) => correctedName(part).toLowerCase() === original);
}
