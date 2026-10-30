import { z } from 'zod';
import type { FileEntry } from '../contracts';
import {
  evidenceAnchorSchema,
  sourceVersionSchema,
  type EvidenceAnchor,
  type EvidenceNavigation,
  type SourceVersion,
} from '../files/inspection';
import type { DefinitionDocument } from '../definitions';
import { relativeProjectPath } from '../workspaces/project';

/** A tour file's name ends with this; the part before it names the tour. */
export const tourFileSuffix = '.viewer-tour.jsonc';
export const isTourFile = (name: string) =>
  name.endsWith(tourFileSuffix) && name.length > tourFileSuffix.length;
/** `Job.viewer-tour.jsonc` is the tour "Job". */
export const tourFileName = (file: string) =>
  (file.split(/[\\/]/).at(-1) ?? file).slice(0, -tourFileSuffix.length);
/**
 * A tour or project file. Opening one plays the tour or installs the project as a workspace, so a
 * stop never points at one: a tour only shows files.
 */
export const isDefinitionFile = (name: string) =>
  name === 'viewer.project.jsonc' || isTourFile(name);

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/);
const insideFolder = (value: string) =>
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.startsWith('/') &&
  !/^[A-Za-z]:/.test(value) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
/**
 * A file in the tour's folder or below it, relative to the tour file. This checks the words of the
 * path; the desktop's stop lookup also refuses a path that goes through a link.
 */
export const tourPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(insideFolder, "Use a path inside the tour's folder, relative to the tour file.")
  .refine(
    (value) => !isDefinitionFile(value.split('/').at(-1) ?? value),
    'A stop shows a file: it cannot point at a tour or project file.',
  );

export const planePoses = ['dock', 'frame'] as const;
export type PlanePose = (typeof planePoses)[number];
const finite = z.number().finite();
const spaceVector = z.object({ x: finite, y: finite, z: finite }).strict();
/**
 * Plurid's `PluridAnchorPose`: the camera's angles relative to a plane (degrees), its zoom, the
 * point on the plane it turns about (px from the plane's top-left corner) and where that point
 * sits from the view's centre.
 */
export const anchorPoseSchema = z
  .object({
    yaw: finite,
    pitch: finite,
    roll: finite.optional(),
    scale: finite.positive(),
    pivot: spaceVector,
    offset: spaceVector.optional(),
  })
  .strict();
export type AnchorPose = z.infer<typeof anchorPoseSchema>;
/**
 * Plurid's `PluridPlaneAnchor`: a `pose` relative to a plane's own frame. Viewer saves only the
 * pose and binds the plane showing the stop's file when it plays; a `path` or `occurrence` from
 * another Plurid host is read, never used.
 */
export const planeAnchorSchema = z
  .object({
    path: z.string().min(1).max(2000).optional(),
    occurrence: z.number().int().min(0).max(1000).optional(),
    pose: z.union([z.enum(planePoses), anchorPoseSchema]).optional(),
  })
  .strict();
export type PlaneAnchor = z.infer<typeof planeAnchorSchema>;

/** Who made a stop: a person recording, a model's answer, or a check Viewer ran. */
export const tourStopSources = ['recorded', 'model', 'check'] as const;
export type TourStopSource = (typeof tourStopSources)[number];
/** A finding's grade once Viewer measured it. */
export const findingGrades = ['confirmed', 'refuted', 'unverified'] as const;
export type FindingGrade = (typeof findingGrades)[number];
export const findingGradeLabels: Record<FindingGrade, string> = {
  confirmed: 'Confirmed',
  refuted: 'Refuted',
  unverified: 'Unverified',
};
/** Files up to 64 MiB are hashed when a stop is recorded and when it plays; larger ones are not. */
export const tourHashLimit = 64 * 1024 * 1024;
/**
 * A file as a stop recorded it: its version and, when it was no larger than `tourHashLimit`, the
 * SHA-256 of its bytes.
 */
export const recordedVersionSchema = z
  .object({
    ...sourceVersionSchema.shape,
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();
export type RecordedVersion = z.infer<typeof recordedVersionSchema>;
const fileTargetSchema = z
  .object({
    kind: z.literal('file'),
    path: tourPathSchema,
    /** The file as it was recorded: a different hash, or else size or date, marks it changed. */
    version: recordedVersionSchema,
    anchor: evidenceAnchorSchema.optional(),
    quote: z.string().max(10000).optional(),
  })
  .strict();
const viewTargetSchema = z
  .object({ kind: z.literal('view'), bookmark: z.string().min(1).max(100) })
  .strict();
const dwellSchema = z.number().int().min(0).max(600000).nullable();
export const tourStopSchema = z
  .object({
    id,
    caption: z.string().trim().min(1).max(500),
    note: z.string().max(4000).optional(),
    /** How long the stop shows, in ms; `null` waits for Next. */
    dwell: dwellSchema.optional(),
    source: z.enum(tourStopSources),
    finding: z
      .object({ id, grade: z.enum(findingGrades).optional() })
      .strict()
      .optional(),
    view: planeAnchorSchema.optional(),
    target: z.discriminatedUnion('kind', [fileTargetSchema, viewTargetSchema]),
  })
  .strict();
export type TourStop = z.infer<typeof tourStopSchema>;
export type TourTarget = TourStop['target'];
export type FileTarget = Extract<TourTarget, { kind: 'file' }>;
export const tourDefinitionSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(100),
    /** Every stop's dwell, unless the stop sets its own. */
    dwell: dwellSchema.optional(),
    stops: z.array(tourStopSchema).min(1).max(200),
  })
  .strict()
  .superRefine((tour, context) => {
    const ids = new Set(tour.stops.map((stop) => stop.id));
    if (ids.size !== tour.stops.length)
      context.addIssue({ code: 'custom', message: 'Tour stop IDs must be unique.' });
  });
export type TourDefinition = z.infer<typeof tourDefinitionSchema>;
export type TourDocument = DefinitionDocument<TourDefinition>;
export type TourRequest =
  | { kind: 'read'; file: string }
  | { kind: 'save'; file: string; revision: string; definition: TourDefinition }
  /** A stop's file at `path` under `root`, never through a link; `hash` reads its SHA-256. */
  | { kind: 'stat'; root: string; path: string; hash?: boolean };
/**
 * What is at a stop's path: the file (its SHA-256 when asked for and no larger than
 * `tourHashLimit`), nothing, a folder Viewer may not read, or a path through a link.
 */
export type TourLookup =
  { state: 'found'; entry: FileEntry; sha256?: string } | { state: 'missing' | 'denied' | 'link' };
export type TourReply<R extends TourRequest = TourRequest> = R extends { kind: 'stat' }
  ? TourLookup
  : TourDocument;

/** A stop's file, from the folder that holds the tour file. */
export function resolveTourPath(root: string, path: string): string {
  tourPathSchema.parse(path);
  return root.replace(/[\\/]$/, '') + '/' + path;
}
/** `file` relative to the tour's folder, or undefined when it is outside it. */
export function tourPath(root: string, file: string): string | undefined {
  const local = relativeProjectPath(root, file);
  return local && insideFolder(local) ? local : undefined;
}
/** The deepest folder that holds every file: where a tour of them can be saved. */
export function commonFolder(files: readonly string[]): string | undefined {
  const [first, ...rest] = files.map((file) => file.replace(/\\/g, '/').split('/').slice(0, -1));
  if (!first) return;
  let length = first.length;
  for (const parts of rest) {
    let index = 0;
    while (index < length && parts[index] === first[index]) index++;
    length = index;
  }
  return first.slice(0, length).join('/') || '/';
}

export type TourStopState = 'ready' | 'missing' | 'changed';
/** What the player found where a stop points: the file's version now, and the saved views. */
export interface StopLookup {
  file?: RecordedVersion;
  views?: readonly string[];
}
/**
 * Tour files travel with their folder, to another computer or a shop. A copy has a new file
 * identity, so the identity decides nothing. When both sides have the file's SHA-256, the bytes
 * decide. Otherwise its size and date do: copies through Finder, zip and most tools keep them
 * (FAT and zip store dates to 2 s), but a zip without time zones moves them by hours, and a tool
 * that keeps the date can change the bytes at the same size.
 */
export function sameRecordedFile(recorded: RecordedVersion, current: RecordedVersion): boolean {
  if (recorded.sha256 && current.sha256) return recorded.sha256 === current.sha256;
  return recorded.size === current.size && Math.abs(recorded.modified - current.modified) < 2000;
}
export function stopState(stop: TourStop, lookup: StopLookup): TourStopState {
  if (stop.target.kind === 'view')
    return lookup.views?.includes(stop.target.bookmark) ? 'ready' : 'missing';
  if (!lookup.file) return 'missing';
  return sameRecordedFile(stop.target.version, lookup.file) ? 'ready' : 'changed';
}
/** The navigation that opens a ready stop's file at its anchor, bound to the file as it is now. */
export function stopEvidence(
  target: FileTarget,
  path: string,
  current: SourceVersion,
): EvidenceNavigation | undefined {
  if (!target.anchor) return;
  return { path, version: current, anchor: target.anchor, quote: target.quote ?? '' };
}

const columnName = (column: number) => {
  let name = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};
const clock = (seconds: number) => {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours
    ? `${hours}:${pad(minutes % 60)}:${pad(whole % 60)}`
    : `${minutes}:${pad(whole % 60)}`;
};
const count = (value: number, one: string, many: string) =>
  `${value.toLocaleString()} ${value === 1 ? one : many}`;
/** Where in its file an anchor points, as a reader says it: "the outline on page 2". */
export function describeAnchor(anchor: EvidenceAnchor): string {
  switch (anchor.kind) {
    case 'text':
      return `line ${anchor.line.toLocaleString()}`;
    case 'pdf':
      return anchor.region
        ? `the outline on page ${anchor.page}`
        : anchor.marks
          ? `the marked text on page ${anchor.page}`
          : `page ${anchor.page}`;
    case 'epub':
      return `chapter ${anchor.chapter + 1}`;
    case 'document':
      return `passage ${anchor.block + 1}`;
    case 'cells':
      return (anchor.sheet ? `${anchor.sheet} ` : '') + columnName(anchor.column) + anchor.row;
    case 'image':
      return anchor.polygon ? 'the outlined region' : 'the marked region';
    case 'media':
      return clock(anchor.seconds);
    case 'dxf': {
      const parts = [
        anchor.entities.length
          ? count(anchor.entities.length, 'highlighted entity', 'highlighted entities')
          : anchor.view
            ? 'the marked part of the drawing'
            : '',
        anchor.measure?.length ? count(anchor.measure.length, 'measurement', 'measurements') : '',
      ].filter(Boolean);
      return parts.join(' and ') || 'the drawing';
    }
    case 'model':
      return 'the recorded camera view';
  }
}
/** The file's name and folder, from a stop path or a full path. */
export const fileName = (path: string) => path.split(/[\\/]/).at(-1) || path;

/** A stop's file as its path names it, or its view by name: what a notice says the stop shows. */
export function stopSubject(stop: TourStop): string {
  return stop.target.kind === 'view' ? `The view “${stop.target.bookmark}”` : stop.target.path;
}
/**
 * What the tour bar says about a stop that is not as recorded: which file or view, and what that
 * means for this stop. Ready stops have nothing to say. A changed stop's bar is headed "Changed
 * since recorded", so its sentence says only what opens.
 */
export function stopNotice(
  stop: TourStop,
  state: TourStopState | Exclude<TourLookup['state'], 'found'>,
  folder?: string,
): string | undefined {
  if (state === 'ready') return;
  const target = stop.target;
  if (target.kind === 'view')
    return `The view “${target.bookmark}” is not saved in this workspace. Skipping this stop.`;
  const name = target.path;
  const place = folder ? `“${folder}”` : 'the tour’s folder';
  if (state === 'missing') return `${name} is not in ${place}. Skipping this stop.`;
  if (state === 'denied')
    return `Viewer has no access to ${place}, so it cannot show ${name}. Allow the folder in the folder picker, then play the tour again.`;
  if (state === 'link')
    return `${name} is reached through a link, and a tour shows only files stored in ${place}. Skipping this stop.`;
  return target.anchor
    ? `${fileName(name)} opens as it is now; this stop pointed at ${describeAnchor(target.anchor)}.`
    : `${fileName(name)} opens as it is now.`;
}

/** The Tour settings: each view's dwell, each flight's duration, and whether it starts again. */
export interface TourTiming {
  dwell: number;
  duration: number;
  loop: boolean;
}
/**
 * How long a stop shows: its own dwell, else the tour's, else long enough to read its caption and
 * note (about 15 characters a second, up to 30 s), and never less than the Tour setting. `null`
 * waits for Next.
 */
export function stopDwell(
  stop: Pick<TourStop, 'dwell' | 'caption' | 'note'>,
  tour: number | null | undefined,
  timing: Pick<TourTiming, 'dwell'>,
): number | null {
  if (stop.dwell !== undefined) return stop.dwell;
  if (tour !== undefined) return tour;
  const characters = stop.caption.length + (stop.note?.length ?? 0);
  return Math.max(timing.dwell, Math.min(30000, 1200 + characters * 65));
}
