/**
 * A LASER JOB'S CHECK: a job folder or selection read as an inventory of opaque refs, sent to a
 * model at the `images` data level, and its answer checked by Viewer: refs and pages validated,
 * every finding graded against Viewer's own measurement, the tour built and confirmed pitch
 * findings turned into reviewed corrections. These are the requests the renderer sends, the
 * replies it shows and the evidence record a handoff saves (docs/reference/fabrication.md).
 */
import { z } from 'zod';
import type { EvidenceMarkKind, EvidenceRegion, SourceVersion } from '../files/inspection';
import type { TourStop } from '../tours/tour';
import type { DXFCorrection } from './plan';
import type { Finding, InventoryKind, RequestPart } from './answer';
import type { Grade } from './grade';
import type { PartPlan } from './reconcile';
import type { RequirementClaim, RequirementVerification } from './requirements';
import { requirementUnits } from './requirements';
import type { CheckChange } from './job-files';
import type { SegmentationSource } from '../models/segmentation';
import { sourceVersionSchema } from '../files/inspection';
import { inventoryLimit, inventoryRefSchema } from './answer';

/** What a job's file is to the check, by its extension; undefined when the check leaves it out. */
const kindsByExtension: Record<string, InventoryKind> = {
  eml: 'request',
  emlx: 'request',
  txt: 'request',
  pdf: 'drawing',
  jpg: 'photo',
  jpeg: 'photo',
  png: 'photo',
  webp: 'photo',
  heic: 'photo',
  heif: 'photo',
  tif: 'photo',
  tiff: 'photo',
  avif: 'photo',
  dxf: 'dxf',
};
export function checkFileKind(name: string): InventoryKind | undefined {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return extension ? kindsByExtension[extension] : undefined;
}

export const checkLimits = {
  /** Drawing pages sent as pictures, across the job. */
  pages: 12,
  /** Photos sent as pictures. */
  photos: 8,
  /** Text items of one page, each with its box. */
  pageItems: 3000,
  /** A rendered page's longest side, in pixels. */
  pageSide: 2048,
  /** A photo's longest side once re-encoded, in pixels. */
  photoSide: 1600,
  /** A request's text sent, in characters. */
  requestCharacters: 20_000,
  /** A file read for the check: a request, photo or DXF. */
  fileBytes: 64_000_000,
  /** How long the model may take to answer, in milliseconds; other requests take 120 s. */
  answerTime: 240_000,
} as const;

const unit = z.number().min(0).max(1);
/** A run of text on a rendered page and its box: `[left, top, right, bottom]` in page fractions. */
export const pageTextSchema = z
  .object({
    text: z.string().max(1000),
    box: z.tuple([unit, unit, unit, unit]),
  })
  .strict();
export type PageText = z.infer<typeof pageTextSchema>;
/** A drawing page as the renderer drew it with pdf.js, for the desktop to check and send. */
export const renderedPageSchema = z
  .object({
    ref: inventoryRefSchema,
    /** The file as the renderer read it; the desktop checks it is still the one listed. */
    version: sourceVersionSchema,
    page: z.number().int().min(1).max(100_000),
    /** The document's page count. */
    pages: z.number().int().min(1).max(100_000),
    width: z.number().int().min(1).max(checkLimits.pageSide),
    height: z.number().int().min(1).max(checkLimits.pageSide),
    image: z
      .instanceof(Uint8Array)
      .refine(
        (bytes) => bytes.byteLength > 0 && bytes.byteLength <= 4_000_000,
        'A rendered page is larger than 4 MB.',
      ),
    text: z.array(pageTextSchema).max(checkLimits.pageItems),
  })
  .strict();
export type RenderedPage = z.infer<typeof renderedPageSchema>;

const checkID = z.uuid();
const path = z.string().min(1).max(4096);
export const fabricationRequestSchema = z.discriminatedUnion('kind', [
  /** A job folder, or the selected files of one. */
  z
    .object({
      kind: z.literal('open'),
      paths: z.array(path).min(1).max(inventoryLimit),
    })
    .strict(),
  z
    .object({
      kind: z.literal('run'),
      id: checkID,
      providerID: z.string().min(1).max(200),
      pages: z.array(renderedPageSchema).max(checkLimits.pages),
    })
    .strict(),
  z.object({ kind: z.literal('cancel'), id: checkID }).strict(),
  /** What changed in a kept check's job since it listed the job. */
  z.object({ kind: z.literal('changes'), id: checkID }).strict(),
  z.object({ kind: z.literal('close'), id: checkID }).strict(),
  z.object({ kind: z.literal('read'), id: checkID }).strict(),
  z
    .object({ kind: z.literal('list'), paths: z.array(path).min(1).max(inventoryLimit).optional() })
    .strict(),
  z.object({ kind: z.literal('validate'), id: checkID }).strict(),
  z
    .object({
      kind: z.literal('correct'),
      id: checkID,
      finding: z.string().regex(/^F[1-9]\d{0,2}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('confirm'),
      id: checkID,
      key: z.string().min(1).max(200),
      value: z.number().finite().nonnegative().max(100_000),
      unit: z.enum(requirementUnits),
    })
    .strict(),
]);
export type FabricationRequest = z.infer<typeof fabricationRequestSchema>;
export type FabricationRequestKind = FabricationRequest['kind'];

/** How a file reaches the model: its text, its pages or itself as pictures, or Viewer's
 * measurement of it, never the drawing itself. */
export type CheckSending = 'text' | 'pages' | 'picture' | 'measurement';
export const checkSendingLabels: Record<CheckSending, string> = {
  text: 'its text',
  pages: 'its pages as pictures, with their text',
  picture: 'a picture, 1600 px, without location or camera details',
  measurement: 'Viewer’s measurement: holes, pitches and size, not the drawing',
};
export interface CheckSource {
  ref: string;
  kind: InventoryKind;
  name: string;
  path: string;
  version: SourceVersion;
  sending: CheckSending;
}
/** A provider the check can ask, with what it may receive now. */
export interface CheckProvider {
  id: string;
  name: string;
  model: string;
  /** It takes pictures in a Chat Completions message. */
  pictures: boolean;
  /** Its data permission covers pictures. */
  allowed: boolean;
}
export interface CheckOpening {
  kind: 'opened';
  id: string;
  /** The job's folder: where its tour, corrections and handoff are saved. */
  folder: string;
  /** The folder's name: "Job 1042". */
  job: string;
  sources: CheckSource[];
  /** Files left out, with why. */
  skipped: { name: string; reason: string }[];
  providers: CheckProvider[];
  /** The provider the check asks unless another is chosen. */
  providerID?: string;
}
/** A folder or selection with nothing to check: no DXF part, or several jobs. */
export interface CheckNothing {
  kind: 'nothing';
  folder: string;
  job: string;
  /** Why, naming the folder: "Pictures holds no DXF or DWG file, so there is nothing to check." */
  text: string;
}
/** What changed in a check's job since it listed the job; none when the check is current. */
export interface CheckChanges {
  kind: 'changes';
  id: string;
  changes: CheckChange[];
}

/** A confirmed pitch finding's correction, for the person to review and save. */
export interface CheckCorrection {
  plan: DXFCorrection;
  /** The DXF it corrects and the version reviewed. */
  source: string;
  version: SourceVersion;
  /** `<name> (corrected).dxf`, beside the original. */
  name: string;
}
/** Who drew an outline: SAM, the box the model gave, or the box of the quoted text's own runs. */
export type CheckOutlineSource = SegmentationSource | 'page-text';
/** "the text on the drawing": a quote outlined by the box of its runs on the page. */
export const pageTextLabel = 'the text on the drawing';
/** What a stop outlines: the text a value is read from, or the hole, edge or part it is about. */
export interface CheckOutline {
  /** The tour stop the outline marks. */
  stop: string;
  kind: EvidenceMarkKind;
  source: CheckOutlineSource;
  /** "the text on the drawing", "outline from SAM 3.1" or "box from Muse Spark". */
  label: string;
  /** What is drawn, in fractions of the page or photo. */
  region: EvidenceRegion;
  /** The box the model gave for it, `[left, top, right, bottom]`, when it gave one. */
  box?: number[];
  /** The quote a text outline marks. */
  quote?: string;
  confidence?: number;
  /** Why SAM's outline was not used. */
  note?: string;
}
/** Who raised a finding: the model reading the job, or Viewer comparing what it read. */
export type FindingOrigin = 'model' | 'viewer';
/** What the model's answer leaves unread in the request: a part's quantity, or a part itself. */
export type UnreadValue = 'quantity' | 'part';
/** One reading of a finding that shares its cause with others, with its own grade and quote. */
export interface CheckReading {
  finding: Finding;
  grade: Grade;
}
export interface CheckFinding {
  /** The finding; for a shared cause, its first reading with the cause as its summary. */
  finding: Finding;
  /** The grade; for a shared cause, confirmed with every reading's reason. */
  grade: Grade;
  origin: FindingOrigin;
  /** The readings one cause explains, each with its grade and quote, when there are several. */
  readings?: CheckReading[];
  /** What the model did not read from the request, which Viewer asks to be checked. */
  unread?: UnreadValue;
  /** What the request says, when Viewer sets it against a drawing. */
  request?: { ref: string; value: number; quote: string | null };
  /** A question the job leaves open, asked in place of a number. */
  question?: string;
  /** Where the drawing, DXF and photo of the finding are, by name. */
  names: { drawing?: string; dxf?: string; photo?: string };
  correction?: CheckCorrection;
  outlines: CheckOutline[];
}
export interface CheckResult {
  kind: 'result';
  id: string;
  /** The provider and model asked. */
  provider: { name: string; model: string };
  summary: string;
  request: RequestPart[];
  findings: CheckFinding[];
  /** What the answer names that the job does not have, a sentence each. */
  issues: string[];
  tour: {
    name: string;
    /** The job's folder; every stop's path is relative to it. */
    root: string;
    stops: TourStop[];
    skipped: string[];
  };
  /** Each DXF part's quantity and thickness, and where each comes from. */
  parts: PartPlan[];
  /** Files not sent, with why: past the picture limit, or changed. */
  notSent: string[];
  seconds: number;
  /** Each source claim and its independent verification, including human confirmations. */
  requirements?: { claim: RequirementClaim; verification: RequirementVerification }[];
}
export const checkStatuses = [
  'ready',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type CheckStatus = (typeof checkStatuses)[number];
export interface CheckSummary {
  id: string;
  job: string;
  folder: string;
  status: CheckStatus;
  updated: number;
  summary?: string;
}
/** A private saved check reopens without making a provider request. */
export interface CheckSaved {
  kind: 'saved';
  paths: string[];
  opening: CheckOpening;
  status: CheckStatus;
  updated: number;
  result?: CheckResult;
  error?: string;
  changes: CheckChange[];
  corrections: Record<string, string>;
  handoffs: string[];
}
export type FabricationReply =
  | CheckOpening
  | CheckNothing
  | CheckChanges
  | CheckResult
  | CheckSaved
  | { kind: 'checks'; checks: CheckSummary[] }
  | { kind: 'operation'; id: string }
  | { kind: 'done' };

/** The current step, or notice that the final result/status has been saved. */
export type CheckStep = 'reading' | 'outlining' | 'settled';
/** A check's step, sent to every window with an attached view. */
export interface CheckProgress {
  /** The check. */
  id: string;
  step: CheckStep;
  /** "Muse Spark is reading the request, 2 drawing pages and 1 photo". */
  text: string;
}

/** One file as it was sent, by hash; the record names files, never their folders. */
export interface RecordInput {
  ref: string;
  kind: InventoryKind;
  name: string;
  size: number;
  modified: number;
  /** The file's bytes. */
  sha256: string;
  sending: CheckSending | 'not sent';
  /** Pictures made of it: rendered pages or the re-encoded photo. */
  pictures: RecordPicture[];
  note?: string;
}
export interface RecordPicture {
  /** Its number in the message, from 1. */
  image: number;
  page?: number;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}
/**
 * THE CHECK RECORD: what was asked and what came back, kept in memory and written only when a
 * handoff is exported, as `Check record.json`.
 */
export interface CheckRecord {
  version: 1;
  job: string;
  started: string;
  provider: { kind: string; name: string; endpoint: string; model: string };
  level: 'images';
  instructions: string;
  schema: Record<string, unknown>;
  inputs: RecordInput[];
  /** The model's reply as it parsed, before Viewer checked it. */
  output?: unknown;
  validation: { valid: boolean; error?: string; issues: string[] };
  grades: Grade[];
  segmentation: (CheckOutline & { ref: string; page?: number })[];
  /** Findings one cause explains: the finding shown, its readings and the cause in words. */
  causes: { finding: string; readings: string[]; summary: string }[];
  corrections: { finding: string; plan: DXFCorrection }[];
  tour: { stops: number; skipped: string[] };
  timings: { prepare: number; model: number; check: number; total: number };
  error?: string;
}
