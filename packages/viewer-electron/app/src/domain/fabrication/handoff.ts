/**
 * A JOB'S HANDOFF: one folder for the shop, saved through the operations service as a transform of
 * kind `fabrication-handoff`. It holds `Cut sheets/` (each nesting as the Layout plane saves it),
 * `Evidence/` (copies of the job's files, dates kept), `Job.viewer-tour.jsonc` (the check's tour,
 * its stops pointed at those copies) and `Check record.json` (the check's evidence record). The plan
 * names the check by id: its tour and record stay in the desktop until the handoff writes them.
 */
import { z } from 'zod';
import type { RendererOperationRequest } from '../contracts';
import type { SourceVersion } from '../files/inspection';
import type { NestingTransform } from '../layout/nesting/plan';
import type { TourDefinition, TourStop } from '../tours/tour';
import type { ThicknessGroup } from './names';
import { nestingLimits, nestingTransformSchema } from '../layout/nesting/plan';
import { countText } from '../layout/nesting/format';
import { fileName, resolveTourPath } from '../tours/tour';
import { groupByThickness } from './names';
import { listText } from './plan';

export const handoffLimits = { sources: 200, nestings: 12 } as const;
export const handoffNames = {
  sheets: 'Cut sheets',
  evidence: 'Evidence',
  tour: 'Job.viewer-tour.jsonc',
  record: 'Check record.json',
} as const;
/** "Job 1042 handoff". */
export const handoffName = (job: string) => `${job} handoff`;

const source = z
  .number()
  .int()
  .min(0)
  .max(handoffLimits.sources - 1);
export const handoffTransformSchema = z
  .object({
    kind: z.literal('fabrication-handoff'),
    format: z.literal('folder'),
    /** The check whose tour and record the handoff saves. */
    check: z.uuid(),
    /** Sources copied into Evidence/. */
    evidence: z.array(source).max(handoffLimits.sources),
    /** Nestings saved under Cut sheets/, each read from the sources it names, in its plan's order. */
    nestings: z
      .array(
        z
          .object({
            sources: z.array(source).min(1).max(nestingLimits.sources),
            plan: nestingTransformSchema,
          })
          .strict(),
      )
      .max(handoffLimits.nestings),
  })
  .strict();
export type HandoffTransform = z.infer<typeof handoffTransformSchema>;

/** Why the plan does not fit its sources, or undefined when it does. */
export function handoffProblem(plan: HandoffTransform, sources: number): string | undefined {
  const named = [...plan.evidence, ...plan.nestings.flatMap((nesting) => nesting.sources)];
  if (named.some((index) => index >= sources))
    return 'The handoff names a file that is not among its sources.';
  if (new Set(plan.evidence).size !== plan.evidence.length)
    return 'The handoff copies a file twice.';
  if (plan.nestings.some((nesting) => nesting.plan.sources.length !== nesting.sources.length))
    return 'A nesting names a different set of drawings. Nest again.';
  const titles = plan.nestings.map((nesting) => nesting.plan.title.toLowerCase());
  if (new Set(titles).size !== titles.length) return 'Two nestings have the same name.';
  return undefined;
}

/** The plan in words, for its review. */
export function handoffDescription(plan: HandoffTransform): string[] {
  const sheets = plan.nestings.reduce((sum, nesting) => sum + nesting.plan.sheets.length, 0);
  return [
    'Handoff folder',
    plan.nestings.length
      ? `${countText(plan.nestings.length, 'nesting')} with ${countText(sheets, 'cut sheet')}`
      : 'no cut sheets',
    `${countText(plan.evidence.length, 'file')} copied as evidence`,
    'the tour and the check record',
  ];
}

/** Each copied file's name in Evidence/: its own, or numbered when an earlier copy has it. */
export function evidenceNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let count = 2; taken.has(candidate.toLowerCase()); count++)
      candidate = `${stem} ${count}${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * The check's tour as the handoff saves it: each stop's file is its copy in Evidence/, so the tour
 * plays wherever the folder goes. A stop whose file was not copied is left out, and said.
 */
export function handoffTour(
  tour: TourDefinition,
  root: string,
  copies: ReadonlyMap<string, string>,
): { definition: TourDefinition | undefined; skipped: string[] } {
  const stops: TourStop[] = [];
  const skipped: string[] = [];
  for (const stop of tour.stops) {
    if (stop.target.kind !== 'file') {
      stops.push(stop);
      continue;
    }
    const copy = copies.get(resolveTourPath(root, stop.target.path));
    if (!copy) {
      skipped.push(`${stop.caption}: ${fileName(stop.target.path)} is not in the handoff.`);
      continue;
    }
    stops.push({
      ...stop,
      target: { ...stop.target, path: `${handoffNames.evidence}/${copy}` },
    });
  }
  return { definition: stops.length ? { ...tour, stops } : undefined, skipped };
}

export interface HandoffFile {
  path: string;
  version: SourceVersion;
}
/** A nesting as the Layout plane checked it: its drawings, in its plan's order, and the plan. */
export interface HandoffNesting {
  title: string;
  sources: HandoffFile[];
  plan: NestingTransform;
}
export interface HandoffNestings {
  nestings: HandoffNesting[];
  notes: string[];
  /** The thicknesses no nesting covers, grouped as the Layout plane groups them. */
  missing: ThicknessGroup<string>[];
}
/**
 * The nestings a handoff saves: those whose every drawing is a part the job cuts, the newest of
 * those nesting one drawing, so no part is cut twice. A nesting of a drawing since corrected is
 * left out, and said. `thickness` groups a drawing as the Layout plane was opened with, before its
 * name.
 */
export function chooseNestings(
  prepared: readonly HandoffNesting[],
  cut: readonly string[],
  corrected: ReadonlyMap<string, string>,
  thickness?: (file: string) => number | undefined,
): HandoffNestings {
  const parts = new Set(cut);
  const covered = new Set<string>();
  const titles = new Set<string>();
  const chosen: HandoffNesting[] = [];
  const notes: string[] = [];
  for (const nesting of [...prepared].reverse()) {
    const paths = nesting.sources.map((source) => source.path);
    if (!paths.every((file) => parts.has(file))) {
      const stale = paths.find((file) => corrected.has(file));
      if (stale)
        notes.push(
          `“${nesting.title}” nests ${fileName(stale)}, not its corrected copy, so it is left out.`,
        );
      continue;
    }
    const title = nesting.title.toLowerCase();
    if (titles.has(title) || paths.some((file) => covered.has(file))) continue;
    titles.add(title);
    for (const file of paths) covered.add(file);
    chosen.push(nesting);
  }
  const missing = groupByThickness(cut, fileName, thickness).filter(
    (group) => !group.items.every((file) => covered.has(file)),
  );
  return { nestings: chosen.reverse(), notes: notes.reverse(), missing };
}

/** A part as the cut sheets nest it: the drawing cut, a corrected copy in its original's place. */
export interface CutPart {
  cut: string;
  quantity?: unknown;
  question?: string;
}
/** What keeps a part from being nested for the export: what the job leaves to the person. */
type HoldReason = 'open' | 'quantity' | 'thickness' | 'both';
const holdTexts: Record<HoldReason, (names: string) => string> = {
  open: (names) => `How many sets of ${names} to cut is open`,
  quantity: (names) => `Nothing in the job gives the quantity of ${names}`,
  thickness: (names) => `Nothing in the job gives the thickness of ${names}`,
  both: (names) => `Nothing in the job gives the quantity or thickness of ${names}`,
};
function holdReason(part: CutPart, unknown: boolean): HoldReason | undefined {
  if (part.question) return 'open';
  if (!part.quantity) return unknown ? 'both' : 'quantity';
  return unknown ? 'thickness' : undefined;
}
/**
 * Why Viewer cannot nest the thicknesses no nesting covers for the export by itself, naming the
 * parts, or undefined when it can. A quantity the job leaves open or does not give, and a
 * thickness it does not give, are the person's to choose in the Layout plane: nesting them as the
 * plane starts would choose for them.
 */
export function nestingHold(
  parts: readonly CutPart[],
  missing: readonly ThicknessGroup<string>[],
): string | undefined {
  const unknown = new Set(
    missing.filter((group) => group.thickness === undefined).flatMap((group) => group.items),
  );
  const waiting = new Set(missing.flatMap((group) => group.items));
  const held = new Map<HoldReason, string[]>();
  for (const part of parts) {
    if (!waiting.has(part.cut)) continue;
    const reason = holdReason(part, unknown.has(part.cut));
    if (reason) held.set(reason, [...(held.get(reason) ?? []), fileName(part.cut)]);
  }
  if (!held.size) return undefined;
  const reasons = [...held].map(([reason, names]) => holdTexts[reason](listText(names)));
  const one = [...held.values()].flat().length === 1;
  return (
    `${reasons.join('. ')}, so Viewer does not nest ${one ? 'it' : 'them'} for the export. ` +
    `Prepare the cut sheets and set ${one ? 'it' : 'them'} in the Layout plane, then export once ${missing.length === 1 ? 'its tab says' : 'each tab says'} Checked.`
  );
}

/** The operation that saves a check's handoff in the job's folder, every file version-checked. */
export function handoffOperation(input: {
  check: string;
  folder: string;
  job: string;
  files: readonly HandoffFile[];
  nestings: readonly HandoffNesting[];
}): RendererOperationRequest & { transform: HandoffTransform } {
  const files = new Map<string, HandoffFile>();
  for (const file of [...input.files, ...input.nestings.flatMap((nesting) => nesting.sources)])
    if (!files.has(file.path)) files.set(file.path, file);
  const sources = [...files.keys()];
  const index = (file: string) => sources.indexOf(file);
  return {
    kind: 'convert',
    sources,
    destination: input.folder,
    name: handoffName(input.job),
    transform: {
      kind: 'fabrication-handoff',
      format: 'folder',
      check: input.check,
      evidence: input.files.map((file) => index(file.path)),
      nestings: input.nestings.map((nesting) => ({
        sources: nesting.sources.map((source) => index(source.path)),
        plan: nesting.plan,
      })),
    },
    expectedSources: [...files.values()].map((file) => ({
      path: file.path,
      version: file.version,
    })),
  };
}
