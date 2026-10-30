/**
 * A CHECK'S TOUR: the stops a model's answer names in inventory refs, turned into a playable tour
 * (domain/tours/tour.ts) of the job's own files. On a drawing page a finding's quoted text is
 * marked by the box of its own runs, and the hole, edge or part it is about by the model's box,
 * which SAM then outlines; a photo's box marks its region; DXF entities become a highlighted set
 * with the pitch Viewer measured drawn on it. The stops of findings one cause explains become one
 * stop. A stop about a finding carries its grade and Viewer's reason, never the model's numbers
 * (docs/reference/fabrication.md).
 */
import type { EvidenceAnchor, EvidenceMark, EvidenceMarkKind } from '../files/inspection';
import type { UnitBox } from '../files/regions';
import type { FabricationAnswer, Finding, InventorySource, ModelTourStop } from './answer';
import type { PageText } from './check';
import type { Grade } from './grade';
import type { Hole, Measurement, PitchAxis } from './measure';
import type { TourStop } from '../tours/tour';
import { boxRegion } from '../files/regions';
import { tourPath } from '../tours/tour';
import { alignedAxis, holeOf } from './measure';
import { quotePassages, runsBox } from './quotes';

export interface CheckTourInput {
  answer: FabricationAnswer;
  sources: readonly InventorySource[];
  grades: readonly Grade[];
  /** The folder the tour file is saved in; every stop's file must be inside it. */
  folder: string;
  /** A DXF part's measurement, by ref. */
  measurement(ref: string): Measurement | undefined;
  /** A file's SHA-256 as the check read it, by ref: a stop then knows its file by its bytes. */
  sha256?(ref: string): string | undefined;
  /** A drawing page's text runs, by ref and page; none for a page without text, such as a scan. */
  runs?(ref: string, page: number): readonly PageText[] | undefined;
  /** Findings one cause explains, each by the ids of its readings, the first leading, with the
   * cause's grade. */
  causes?: readonly { readings: readonly string[]; grade: Grade }[];
}
/** Where a stop's anchor draws a mark: a PDF page's region or one of its marks, or a photo's
 * outline. */
export type StopMarkPlace = 'region' | 'polygon' | number;
/** Who placed a mark's box: the quoted text's own runs on the page, or the model. */
export type StopMarkSource = 'page-text' | 'model-box';
/** An outline a stop draws, and what it is: SAM outlines the features. */
export interface StopMark {
  stop: string;
  ref: string;
  /** A drawing's page; a photo has none. */
  page?: number;
  kind: EvidenceMarkKind;
  at: StopMarkPlace;
  /** The box drawn until SAM outlines it, in fractions of the page or photo. */
  box: UnitBox;
  source: StopMarkSource;
  /** The finding it shows: the first reading of a shared cause. */
  finding?: string;
  quote?: string;
  /** The box the model gave, `[left, top, right, bottom]`, when it gave one. */
  asked?: number[];
}
export interface CheckTour {
  stops: TourStop[];
  /** A sentence for each stop left out. */
  skipped: string[];
  marks: StopMark[];
}

const pictures = /\.(?:png|jpe?g|webp|heic|heif|tiff?|gif|bmp)$/i;
/** Millimetres shown around the entities a DXF stop highlights. */
const viewMargin = 10;
/** A stop's box that overlaps one text run this much is that text. */
const textOverlap = 0.5;
/** Outlines one page anchor draws besides its region (`evidenceMarkSchema`). */
const markLimit = 16;

type Box = readonly number[];
const unitBox = ([left, top, right, bottom]: Box): UnitBox => ({
  x: left!,
  y: top!,
  width: right! - left!,
  height: bottom! - top!,
});
const boxOf = ({ x, y, width, height }: UnitBox): Box => [x, y, x + width, y + height];
function overlap(a: Box, b: Box): number {
  const width = Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!),
    height = Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!);
  if (width <= 0 || height <= 0) return 0;
  const area = (box: Box) => (box[2]! - box[0]!) * (box[3]! - box[1]!);
  return (width * height) / (area(a) + area(b) - width * height);
}

/** A model's stops grouped as they become the tour's: one stop each, except that the stops of a
 * shared cause's readings on one file and page are one. */
interface StopGroup {
  index: number;
  stops: ModelTourStop[];
  /** The findings shown, by their own ids. */
  findings: string[];
  /** The finding the stop is about: a shared cause's first reading. */
  lead?: string;
}
function groupStops(
  tour: readonly ModelTourStop[],
  lead: ReadonlyMap<string, string>,
): StopGroup[] {
  const groups: StopGroup[] = [];
  tour.forEach((stop, index) => {
    const leading = stop.finding ? (lead.get(stop.finding) ?? stop.finding) : undefined;
    const shared =
      stop.finding &&
      lead.has(stop.finding) &&
      groups.find(
        (group) =>
          group.lead === leading &&
          group.stops[0]!.ref === stop.ref &&
          (group.stops[0]!.page ?? 1) === (stop.page ?? 1) &&
          !group.findings.includes(stop.finding!),
      );
    if (shared) {
      shared.stops.push(stop);
      shared.findings.push(stop.finding!);
      return;
    }
    groups.push({
      index,
      stops: [stop],
      findings: stop.finding ? [stop.finding] : [],
      ...(leading ? { lead: leading } : {}),
    });
  });
  return groups;
}

/** The tour's stops, a sentence for each stop left out, and every outline the stops draw. */
export function checkTour(input: CheckTourInput): CheckTour {
  const byRef = new Map(input.sources.map((source) => [source.ref, source]));
  const findings = new Map(input.answer.findings.map((finding) => [finding.id, finding]));
  const grades = new Map(input.grades.map((grade) => [grade.finding, grade]));
  const lead = new Map<string, string>();
  for (const cause of input.causes ?? []) {
    for (const id of cause.readings) lead.set(id, cause.readings[0]!);
    grades.set(cause.readings[0]!, cause.grade);
  }
  const stops: TourStop[] = [];
  const skipped: string[] = [];
  const marks: StopMark[] = [];
  for (const group of groupStops(input.answer.tour, lead)) {
    const [stop] = group.stops as [ModelTourStop];
    const number = group.index + 1;
    const source = byRef.get(stop.ref);
    const path = source && tourPath(input.folder, source.path);
    if (!source || !path) {
      skipped.push(
        source
          ? `Stop ${number} shows ${source.name}, which is outside the tour’s folder.`
          : `Stop ${number} names ${stop.ref}, which is not in the job.`,
      );
      continue;
    }
    const id = `stop-${number}`;
    const shown = group.findings.flatMap((finding) => findings.get(finding) ?? []);
    const grade = group.lead ? grades.get(group.lead) : undefined;
    const quote = shown.find((finding) => finding.drawing?.ref === stop.ref)?.drawing?.quote;
    const placed = anchorOf(group, source, shown, input);
    for (const mark of placed?.marks ?? [])
      marks.push({ ...mark, stop: id, ...(group.lead ? { finding: group.lead } : {}) });
    const digest = input.sha256?.(stop.ref);
    const note = grade?.reason ?? stop.note;
    const captions = [...new Set(group.stops.map((item) => item.caption))];
    stops.push({
      id,
      caption: captions.join(' ').slice(0, 500),
      ...(note ? { note } : {}),
      source: 'model',
      ...(group.lead && findings.has(group.lead)
        ? { finding: { id: group.lead, ...(grade ? { grade: grade.status } : {}) } }
        : {}),
      target: {
        kind: 'file',
        path,
        version: { ...source.version, ...(digest ? { sha256: digest } : {}) },
        ...(placed?.anchor ? { anchor: placed.anchor } : {}),
        ...(quote ? { quote } : {}),
      },
    });
  }
  return { stops, skipped, marks };
}

type PlacedMark = Omit<StopMark, 'stop' | 'finding'>;
/** Where in its file a stop opens, and what it outlines there. */
function anchorOf(
  group: StopGroup,
  source: InventorySource,
  shown: readonly Finding[],
  input: CheckTourInput,
): { anchor: EvidenceAnchor; marks: PlacedMark[] } | undefined {
  const [stop] = group.stops as [ModelTourStop];
  if (source.kind === 'dxf') {
    const measurement = input.measurement(stop.ref);
    return measurement && { anchor: drawingAnchor(group, shown, measurement), marks: [] };
  }
  if (/\.pdf$/i.test(source.name)) return pageAnchor(group, shown, input);
  if (!pictures.test(source.name)) return undefined;
  // A photo: the finding's region of it, and the part or hole SAM outlines.
  const photo = shown.find((finding) => finding.photo?.ref === stop.ref)?.photo;
  const box = photo?.box ?? photo?.feature ?? stop.box;
  const feature = photo?.feature ?? box;
  if (!box || !feature) return undefined;
  return {
    anchor: { kind: 'image', ...unitBox(box) },
    marks: [
      {
        ref: stop.ref,
        kind: 'feature',
        at: 'polygon',
        box: unitBox(feature),
        source: 'model-box',
        asked: [...feature],
      },
    ],
  };
}

/** A drawing page: each finding's quoted text by the box of its runs, else the model's box, and
 * each feature it is about. A stop about no finding marks its own box: as text when it lies over
 * one text run, otherwise as a feature. */
function pageAnchor(
  group: StopGroup,
  shown: readonly Finding[],
  input: CheckTourInput,
): { anchor: EvidenceAnchor; marks: PlacedMark[] } {
  const [stop] = group.stops as [ModelTourStop];
  const page = stop.page ?? 1;
  const runs = input.runs?.(stop.ref, page) ?? [];
  const texts: PlacedMark[] = [];
  const features: PlacedMark[] = [];
  const at = { ref: stop.ref, page, at: 'region' as const };
  const feature = (box: Box) => {
    if (!features.some((item) => overlap(item.asked!, box) > 0.9))
      features.push({
        ...at,
        kind: 'feature',
        box: unitBox(box),
        source: 'model-box',
        asked: [...box],
      });
  };
  const text = (mark: PlacedMark) => {
    // Readings that quote the same text mark it once.
    if (!texts.some((item) => overlap(boxOf(item.box), boxOf(mark.box)) > 0.9)) texts.push(mark);
  };
  for (const finding of shown) {
    const drawing = finding.drawing;
    if (!drawing || drawing.ref !== stop.ref || (drawing.page ?? 1) !== page) continue;
    const passages = drawing.quote
      ? quotePassages(runs, drawing.quote, drawing.box ?? drawing.feature ?? undefined)
      : undefined;
    for (const passage of passages ?? [])
      text({
        ...at,
        kind: 'text',
        box: unitBox(runsBox(passage)),
        source: 'page-text',
        quote: drawing.quote!,
        ...(drawing.box ? { asked: [...drawing.box] } : {}),
      });
    if (!passages && drawing.box)
      text({
        ...at,
        kind: 'text',
        box: unitBox(drawing.box),
        source: 'model-box',
        ...(drawing.quote ? { quote: drawing.quote } : {}),
        asked: [...drawing.box],
      });
    if (drawing.feature) feature(drawing.feature);
  }
  if (!texts.length && !features.length && stop.box) {
    const run = runs
      .map((item) => ({ item, share: overlap(item.box, stop.box!) }))
      .reduce<{ item: PageText; share: number } | undefined>(
        (best, next) => (next.share > (best?.share ?? 0) ? next : best),
        undefined,
      );
    if (run && run.share >= textOverlap)
      texts.push({
        ...at,
        kind: 'text',
        box: unitBox(run.item.box),
        source: 'page-text',
        quote: run.item.text,
        asked: [...stop.box],
      });
    else feature(stop.box);
  }
  // The first feature is the region the stop is about; the text and other features are its marks.
  const [region, ...rest] = features;
  const others = [...texts, ...rest]
    .slice(0, markLimit)
    .map((mark, index) => ({ ...mark, at: index }));
  const anchor: EvidenceAnchor = {
    kind: 'pdf',
    page,
    ...(region ? { region: boxRegion(region.box) } : {}),
    ...(others.length
      ? {
          marks: others.map((mark): EvidenceMark => ({
            kind: mark.kind,
            region: boxRegion(mark.box),
          })),
        }
      : {}),
    // The outline places the stop; a search for its quote would move the page.
    ...(region || others.length ? { search: false as const } : {}),
  };
  return { anchor, marks: [...(region ? [region] : []), ...others] };
}

/** The stop's entities highlighted, the drawing framed around them, and each pitch finding's pitch
 * drawn between its two holes as Viewer measures it, in the drawing's own units. */
function drawingAnchor(
  group: StopGroup,
  shown: readonly Finding[],
  measurement: Measurement,
): EvidenceAnchor {
  const [stop] = group.stops as [ModelTourStop];
  const scale = measurement.units.millimetres;
  const own = shown.filter((finding) => finding.dxf?.ref === stop.ref);
  const entities = [
    ...new Set([
      ...group.stops.flatMap((item) => item.entities),
      ...own.flatMap((finding) => finding.dxf!.entities),
    ]),
  ];
  const holesOf = (ids: readonly string[]) =>
    [...new Set(ids.map((id) => holeOf(measurement, id)).filter((hole) => !!hole))] as Hole[];
  const holes = holesOf(entities);
  const outlines = measurement.outlines.filter((outline) =>
    outline.entities.some((id) => entities.includes(id)),
  );
  const min = { x: Infinity, y: Infinity },
    max = { x: -Infinity, y: -Infinity };
  const extend = (x: number, y: number) => {
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
  };
  for (const hole of holes) {
    const r = hole.diameter / 2;
    extend(hole.centre.x - r, hole.centre.y - r);
    extend(hole.centre.x + r, hole.centre.y + r);
  }
  for (const outline of outlines) {
    extend(outline.bounds.min.x, outline.bounds.min.y);
    extend(outline.bounds.max.x, outline.bounds.max.y);
  }
  const at = (x: number, y: number): [number, number] => [x / scale, y / scale];
  const measures = own.flatMap((finding) => {
    if (finding.kind !== 'pitch') return [];
    const pitch = holesOf(finding.dxf!.entities);
    if (pitch.length !== 2) return [];
    const [a, b] = pitch as [Hole, Hole];
    const line = pitchLine(a, b, finding.dxf!.axis ?? alignedAxis(a, b));
    return [{ tool: 'distance' as const, points: line.map(([x, y]) => at(x, y)) }];
  });
  return {
    kind: 'dxf',
    entities,
    ...(Number.isFinite(min.x)
      ? {
          view: {
            min: at(min.x - viewMargin, min.y - viewMargin),
            max: at(max.x + viewMargin, max.y + viewMargin),
          },
        }
      : {}),
    ...(measures.length ? { measure: measures } : {}),
  };
}
/** The line a pitch is measured along: across x or y from the first hole, or centre to centre. */
function pitchLine(a: Hole, b: Hole, axis: PitchAxis): [number, number][] {
  const end =
    axis === 'x'
      ? { x: b.centre.x, y: a.centre.y }
      : axis === 'y'
        ? { x: a.centre.x, y: b.centre.y }
        : b.centre;
  return [
    [a.centre.x, a.centre.y],
    [end.x, end.y],
  ];
}
