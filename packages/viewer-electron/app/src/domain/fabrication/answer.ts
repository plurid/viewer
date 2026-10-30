/**
 * A FABRICATION CHECK'S ANSWER: what a model returns after reading a laser job, in a strict schema.
 * The model sees the job as an inventory of opaque refs (S1 the request, S2 a drawing, S3 a photo,
 * S4 a DXF summary) and answers in those refs and the DXF summary's entity ids; it never sees or
 * names a path. Viewer resolves each ref itself and grades every finding against its own
 * measurement (grade.ts, docs/reference/fabrication.md).
 */
import { z } from 'zod';
import type { SourceVersion } from '../files/inspection';
import { pitchAxes } from './plan';

export const inventoryKinds = ['request', 'drawing', 'photo', 'dxf'] as const;
export type InventoryKind = (typeof inventoryKinds)[number];
export const inventoryRefSchema = z
  .string()
  .regex(/^S[1-9]\d{0,2}$/)
  .describe('A ref from the inventory, such as S2.');
export type InventoryRef = z.infer<typeof inventoryRefSchema>;
/** One file of the job as the model reads it. */
export interface InventoryItem {
  ref: InventoryRef;
  kind: InventoryKind;
  /** The file's own name, never its folder. */
  name: string;
  /** Pages of a drawing or request. */
  pages?: number;
}
/** What Viewer keeps beside each ref and never sends: the file it stands for. */
export interface InventorySource extends InventoryItem {
  path: string;
  version: SourceVersion;
}
export interface InventoryFile {
  path: string;
  kind: InventoryKind;
  version: SourceVersion;
  pages?: number;
}
export const inventoryLimit = 200;

/** Refs in reading order: requests, drawings, photos, then DXF parts, each by name. */
export function buildInventory(files: readonly InventoryFile[]): InventorySource[] {
  if (files.length > inventoryLimit)
    throw new Error(`A check reads at most ${inventoryLimit} files; this job has ${files.length}.`);
  const name = (file: InventoryFile) => file.path.split(/[\\/]/).at(-1)!;
  return [...files]
    .sort(
      (a, b) =>
        inventoryKinds.indexOf(a.kind) - inventoryKinds.indexOf(b.kind) ||
        name(a).localeCompare(name(b), 'en', { numeric: true }),
    )
    .map((file, index) => ({
      ref: `S${index + 1}`,
      kind: file.kind,
      name: name(file),
      ...(file.pages === undefined ? {} : { pages: file.pages }),
      path: file.path,
      version: file.version,
    }));
}
/** The inventory as the model reads it. */
export const modelInventory = (sources: readonly InventorySource[]): InventoryItem[] =>
  sources.map(({ ref, kind, name, pages }) => ({
    ref,
    kind,
    name,
    ...(pages === undefined ? {} : { pages }),
  }));

const entity = z
  .string()
  .regex(/^\d{1,6}$/)
  .describe('An entity id from the DXF summary.');
const findingID = z
  .string()
  .regex(/^F[1-9]\d?$/)
  .describe('F1, F2, …');
const page = z.number().int().min(1).max(10_000);
const box = z
  .array(z.number().min(0).max(1))
  .length(4)
  .describe(
    '[left, top, right, bottom] as fractions of the page or photo from its top-left corner.',
  );

export const findingKinds = [
  'pitch',
  'diameter',
  'size',
  'holes',
  'thickness',
  'quantity',
  'material',
  'other',
] as const;
/** What a finding is about: a pitch or diameter between holes, an outline's size, a hole count, or
 * the job's thickness, quantity or material. */
export type FindingKind = (typeof findingKinds)[number];

export const findingSchema = z
  .object({
    id: findingID,
    kind: z.enum(findingKinds),
    summary: z.string().min(1).max(300).describe('The mismatch in one sentence.'),
    drawing: z
      .object({
        ref: inventoryRefSchema.describe('The drawing or request the value is read from.'),
        page: page.nullable(),
        value: z
          .number()
          .finite()
          .nullable()
          .describe('The value it gives: millimetres, or pieces for a quantity.'),
        quote: z.string().max(200).nullable().describe('The exact text the value is read from.'),
        box: box.nullable(),
      })
      .strict()
      .nullable(),
    dxf: z
      .object({
        ref: inventoryRefSchema.describe('The DXF part.'),
        value: z
          .number()
          .finite()
          .nullable()
          .describe('The value the DXF summary gives, in the same unit.'),
        axis: z
          .enum(pitchAxes)
          .nullable()
          .describe('For a pitch or size: along x, along y, or centre to centre.'),
        entities: z.array(entity).max(32),
      })
      .strict()
      .nullable(),
    photo: z
      .object({ ref: inventoryRefSchema.describe('The photo.'), box: box.nullable() })
      .strict()
      .nullable(),
    proposal: z
      .object({
        target: z.number().finite().positive().describe('The value the DXF should have.'),
        move: z
          .array(entity)
          .min(1)
          .max(64)
          .describe('Entities of the holes that move; every other hole stays.'),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;

const pieces = z.number().int().min(0).max(20_000);
const millimetres = z.number().finite().positive().max(300);
export const requestPartSchema = z
  .object({
    ref: inventoryRefSchema.describe('The request.'),
    part: z.string().min(1).max(120).describe('The part as the request names it.'),
    dxf: inventoryRefSchema.nullable().describe('The DXF part it means, when one matches.'),
    quantity: pieces.nullable().describe('Pieces the request asks for.'),
    thickness: millimetres.nullable().describe('Millimetres.'),
    material: z.string().max(80).nullable(),
    quote: z.string().max(200).nullable().describe('The exact request text these are read from.'),
    drawing: z
      .object({
        ref: inventoryRefSchema.describe('The drawing whose title block or parts list names it.'),
        page: page,
        quantity: pieces.nullable(),
        thickness: millimetres.nullable(),
        material: z.string().max(80).nullable(),
        quote: z.string().max(200).nullable().describe('The exact page text these are read from.'),
      })
      .strict()
      .nullable()
      .describe('What a drawing gives for the same part, when it gives anything.'),
  })
  .strict();
export type RequestPart = z.infer<typeof requestPartSchema>;

export const tourStopSchema = z
  .object({
    ref: inventoryRefSchema.describe('The file the stop shows.'),
    caption: z.string().min(1).max(140),
    note: z.string().max(400).nullable(),
    finding: findingID.nullable(),
    page: page.nullable(),
    box: box.nullable(),
    entities: z.array(entity).max(32).describe('DXF entities to highlight; empty otherwise.'),
  })
  .strict();
export type ModelTourStop = z.infer<typeof tourStopSchema>;

export const fabricationAnswerSchema = z
  .object({
    summary: z.string().max(600),
    request: z.array(requestPartSchema).max(100),
    findings: z.array(findingSchema).max(20),
    tour: z.array(tourStopSchema).max(12),
  })
  .strict();
export type FabricationAnswer = z.infer<typeof fabricationAnswerSchema>;

/** What the schema cannot say: refs that exist and are of the right kind, pages that exist, boxes
 * the right way round, finding ids used once. A sentence each; empty when the answer holds. */
export function answerIssues(
  answer: FabricationAnswer,
  inventory: readonly InventoryItem[],
): string[] {
  const issues: string[] = [];
  const byRef = new Map(inventory.map((item) => [item.ref, item]));
  const check = (
    where: string,
    ref: string,
    kinds: readonly InventoryKind[],
    at?: { page: number | null; box: number[] | null },
  ) => {
    const item = byRef.get(ref);
    if (!item) return void issues.push(`${where} names ${ref}, which is not in the inventory.`);
    if (!kinds.includes(item.kind))
      issues.push(`${where} names ${ref}, a ${item.kind}, where it needs a ${kinds.join(' or ')}.`);
    if (at && at.page !== null && item.pages !== undefined && at.page > item.pages)
      issues.push(`${where} names page ${at.page} of ${ref}, which has ${item.pages}.`);
    if (at?.box && (at.box[0]! >= at.box[2]! || at.box[1]! >= at.box[3]!))
      issues.push(`${where} has a box whose sides are the wrong way round.`);
  };
  answer.request.forEach((part, index) => {
    check(`Request part ${index + 1}`, part.ref, ['request']);
    if (part.dxf) check(`Request part ${index + 1}`, part.dxf, ['dxf']);
    if (part.drawing)
      check(`Request part ${index + 1}`, part.drawing.ref, ['drawing'], {
        page: part.drawing.page,
        box: null,
      });
  });
  const ids = new Set<string>();
  for (const finding of answer.findings) {
    if (ids.has(finding.id)) issues.push(`${finding.id} is used for two findings.`);
    ids.add(finding.id);
    if (finding.drawing)
      check(finding.id, finding.drawing.ref, ['drawing', 'request'], finding.drawing);
    if (finding.dxf) check(finding.id, finding.dxf.ref, ['dxf']);
    if (finding.photo)
      check(finding.id, finding.photo.ref, ['photo'], { page: null, ...finding.photo });
    if (finding.proposal && !finding.dxf)
      issues.push(`${finding.id} proposes a change without naming its DXF.`);
  }
  answer.tour.forEach((stop, index) => {
    check(`Tour stop ${index + 1}`, stop.ref, inventoryKinds, stop);
    if (stop.finding && !ids.has(stop.finding))
      issues.push(`Tour stop ${index + 1} names ${stop.finding}, which is not a finding.`);
  });
  return issues;
}
