/**
 * A CHECK'S TOUR: the stops a model's answer names in inventory refs, turned into a playable tour
 * (domain/tours/tour.ts) of the job's own files. A drawing's page and box become an outline on the
 * PDF page, a photo's box a marked region, and DXF entities a highlighted set with the pitch Viewer
 * measured drawn on it. A stop about a finding carries its grade and Viewer's reason, never the
 * model's numbers (docs/reference/fabrication.md).
 */
import type { EvidenceAnchor } from '../files/inspection';
import type { FabricationAnswer, Finding, InventorySource, ModelTourStop } from './answer';
import type { Grade } from './grade';
import type { Hole, Measurement, PitchAxis } from './measure';
import type { TourStop } from '../tours/tour';
import { boxRegion } from '../files/regions';
import { tourPath } from '../tours/tour';
import { alignedAxis, holeOf } from './measure';

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
}

const pictures = /\.(?:png|jpe?g|webp|heic|heif|tiff?|gif|bmp)$/i;
/** Millimetres shown around the entities a DXF stop highlights. */
const viewMargin = 10;

/** The tour's stops, and a sentence for each stop left out. */
export function checkTour(input: CheckTourInput): { stops: TourStop[]; skipped: string[] } {
  const byRef = new Map(input.sources.map((source) => [source.ref, source]));
  const findings = new Map(input.answer.findings.map((finding) => [finding.id, finding]));
  const grades = new Map(input.grades.map((grade) => [grade.finding, grade]));
  const stops: TourStop[] = [];
  const skipped: string[] = [];
  input.answer.tour.forEach((stop, index) => {
    const source = byRef.get(stop.ref);
    const path = source && tourPath(input.folder, source.path);
    if (!source || !path) {
      skipped.push(
        source
          ? `Stop ${index + 1} shows ${source.name}, which is outside the tour’s folder.`
          : `Stop ${index + 1} names ${stop.ref}, which is not in the job.`,
      );
      return;
    }
    const finding = stop.finding ? findings.get(stop.finding) : undefined;
    const grade = finding && grades.get(finding.id);
    const quote = finding?.drawing?.ref === stop.ref ? finding.drawing.quote : null;
    const anchor = anchorOf(stop, source, input.measurement(stop.ref), finding);
    const digest = input.sha256?.(stop.ref);
    const note = grade?.reason ?? stop.note;
    stops.push({
      id: `stop-${index + 1}`,
      caption: stop.caption,
      ...(note ? { note } : {}),
      source: 'model',
      ...(finding
        ? { finding: { id: finding.id, ...(grade ? { grade: grade.status } : {}) } }
        : {}),
      target: {
        kind: 'file',
        path,
        version: { ...source.version, ...(digest ? { sha256: digest } : {}) },
        ...(anchor ? { anchor } : {}),
        ...(quote ? { quote } : {}),
      },
    });
  });
  return { stops, skipped };
}

/** Where in its file a stop opens. */
function anchorOf(
  stop: ModelTourStop,
  source: InventorySource,
  measurement: Measurement | undefined,
  finding: Finding | undefined,
): EvidenceAnchor | undefined {
  // The schema holds a box to exactly four sides.
  const [left, top, right, bottom] = (stop.box ?? []) as number[];
  const box = stop.box && {
    x: left!,
    y: top!,
    width: right! - left!,
    height: bottom! - top!,
  };
  if (source.kind === 'dxf') return measurement && drawingAnchor(stop, measurement, finding);
  if (/\.pdf$/i.test(source.name))
    return {
      kind: 'pdf',
      page: stop.page ?? 1,
      // The outline places the stop; a search for its quote would move the page.
      ...(box ? { region: boxRegion(box), search: false } : {}),
    };
  if (pictures.test(source.name) && box) return { kind: 'image', ...box };
  return undefined;
}

/** The stop's entities highlighted, the drawing framed around them, and a pitch finding's pitch
 * drawn between its two holes as Viewer measures it, in the drawing's own units. */
function drawingAnchor(
  stop: ModelTourStop,
  measurement: Measurement,
  finding: Finding | undefined,
): EvidenceAnchor {
  const scale = measurement.units.millimetres;
  const named = finding?.dxf?.entities ?? [];
  const entities = [...new Set([...stop.entities, ...named])];
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
  const pitch = finding?.kind === 'pitch' ? holesOf(named) : [];
  const measure =
    pitch.length === 2 &&
    pitchLine(pitch[0]!, pitch[1]!, finding?.dxf?.axis ?? alignedAxis(pitch[0]!, pitch[1]!));
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
    ...(measure
      ? { measure: [{ tool: 'distance', points: measure.map(([x, y]) => at(x, y)) }] }
      : {}),
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
