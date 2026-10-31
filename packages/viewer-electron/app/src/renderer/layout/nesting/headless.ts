/**
 * NESTING WITHOUT A PLANE: drawings nested one thickness at a time as a Layout plane opened on
 * them starts, for a fabrication handoff whose cut sheets are missing. The same parts worker reads
 * them, each part starts with the plane's quantity, turns, sheets and cutting values, the same
 * search runs in the nest worker, and the same exact check decides. Each nesting is then kept as
 * the plane keeps a checked one (prepared.ts), and saved as Save nesting writes it.
 */
import type { FileEntry, Resource } from '../../../domain/contracts';
import type { HandoffNesting } from '../../../domain/fabrication/handoff';
import type { ThicknessGroup } from '../../../domain/fabrication/names';
import type { SourceVersion } from '../../../domain/files/inspection';
import type { NestFormat, NestProblem } from '../../../domain/layout/nesting/nest';
import type { LengthUnit, NestingTransform } from '../../../domain/layout/nesting/plan';
import type { PartChoice } from '../../../domain/layout/nesting/problem';
import type { NestSummary, NestUpdate } from '../../../domain/layout/nesting/search';
import type { NestingChoices } from './NestingSettings';
import type { FilePartsView, NestReply, NestRequest, PartView } from './protocol';
import { errorMessage } from '../../../domain/errors';
import { fileQuantity } from '../../../domain/fabrication/jobs';
import { groupByThickness, thicknessText } from '../../../domain/fabrication/names';
import { listText } from '../../../domain/fabrication/plan';
import { sourceVersion } from '../../../domain/files/inspection';
import { fitsFormat } from '../../../domain/layout/nesting/advice';
import { countText, gapText, sizeText, unitSymbol } from '../../../domain/layout/nesting/format';
import { sheetName } from '../../../domain/layout/nesting/plan';
import { nestProblem } from '../../../domain/layout/nesting/problem';
import { verifyNest } from '../../../domain/layout/nesting/verify';
import { fileName } from '../../../domain/tours/tour';
import { unitInfo } from '../../../domain/previews/drawings/dxf/units';
import { getState } from '../../state/store';
import { defaultChoice, startingChoices } from './NestingPanel';
import { prepareNesting } from './prepared';
import { PartsClient, baseName, defaultUnits } from './useNestingFiles';
import { nestingWorkers } from './workers';

/** What the plane is opened with: pieces and millimetres by path, as a check reconciles them. */
export interface NestOpening {
  quantities?: Readonly<Record<string, number>>;
  thicknesses?: Readonly<Record<string, number>>;
}
export interface HeadlessNesting {
  /** The plane's tab: "6 mm". */
  label: string;
  nesting: HandoffNesting;
  parts: number;
  pieces: number;
  sheets: number;
}
interface Drawing {
  /** The path the plane is opened with, which the handoff matches its cut sheets by. */
  path: string;
  entry: FileEntry;
  version: SourceVersion;
  units: number;
  marks: string[];
  together: boolean;
  parts: FilePartsView;
}
interface Row {
  drawing: Drawing;
  part: PartView;
  choice: PartChoice;
}

/** The thicknesses a plane opened on `paths` would show, as its tabs group them. */
const thicknessGroups = (paths: readonly string[], opening: NestOpening) =>
  groupByThickness(paths, fileName, (path) => opening.thicknesses?.[path]);
/** The units a plane opens in: they choose its starting sheet and how lengths read. */
const planeUnits = (): LengthUnit => getState().saved.ui.layout.units;
/** The sheets a thickness starts on in the plane: "1250 × 2500 mm". */
export const startingSheets = (thickness?: number, units = planeUnits()) =>
  listText(
    startingChoices(thickness, units)
      .formats.filter((format) => format.enabled)
      .map((format) => `${sheetName(format, units)} ${unitSymbol(units)}`),
  );

/**
 * Nests the thicknesses `wanted` names, by their keys, of a plane opened on `paths`: every drawing
 * read first, then one thickness at a time, thinnest first. Each one checked is kept as it is
 * made, so a later export nests only what is left. Throws, naming the drawing or part, when a
 * drawing cannot be read or nested, a part does not fit the sheet, or a layout fails its check.
 */
export async function nestWithoutPlane(
  paths: readonly string[],
  opening: NestOpening,
  wanted: ReadonlySet<string>,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<HeadlessNesting[]> {
  const groups = thicknessGroups(paths, opening);
  const chosen = groups.filter((group) => wanted.has(group.key));
  const files = chosen.flatMap((group) => group.items);
  progress(`Reading ${countText(files.length, 'drawing')}…`);
  const reader = new PartsClient();
  try {
    // every read ends, releasing its file, before the worker closes
    const reads = await Promise.allSettled(files.map((path) => readDrawing(reader, path)));
    const failed = reads.find((item) => item.status === 'rejected');
    if (failed) throw failed.reason;
    signal.throwIfAborted();
    const read = new Map(
      reads.flatMap((item) => (item.status === 'fulfilled' ? [[item.value.path, item.value]] : [])),
    );
    const made: HeadlessNesting[] = [];
    for (const group of chosen) {
      const item = await nestGroup(
        group,
        group.items.map((path) => read.get(path)!),
        groups.length > 1,
        opening,
        signal,
        progress,
      );
      prepareNesting(item.nesting);
      made.push(item);
    }
    return made;
  } finally {
    reader.close();
  }
}

/** A drawing read as the plane first reads it: in its own units, else millimetres, with the layers
 * whose names suggest marking marked, and its parts apart. */
async function readDrawing(reader: PartsClient, path: string): Promise<Drawing> {
  let resource: Resource | undefined;
  try {
    resource = await window.viewer.resource(path);
    const entry = resource.entry;
    const drawing = await reader.read(path, resource.url);
    const units = drawing.units && unitInfo(drawing.units).mm ? drawing.units : defaultUnits;
    const options = { units, marks: drawing.suggested, together: false };
    const parts = await reader.parts(path, {
      scale: unitInfo(units).mm ?? 1,
      marks: options.marks,
      together: options.together,
      name: baseName(entry),
    });
    return { path, entry, version: sourceVersion(entry), ...options, parts };
  } catch (error) {
    throw new Error(`${fileName(path)} could not be read for nesting: ${errorMessage(error)}`);
  } finally {
    if (resource) void window.viewer.release(resource.id).catch(() => {});
  }
}

async function nestGroup(
  group: ThicknessGroup<string>,
  drawings: readonly Drawing[],
  grouped: boolean,
  opening: NestOpening,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<HeadlessNesting> {
  for (const drawing of drawings) {
    if (drawing.parts.problem)
      throw new Error(`${drawing.entry.name} cannot be nested: ${drawing.parts.problem}`);
    if (!drawing.parts.parts.length)
      throw new Error(`${drawing.entry.name} holds no outline to nest.`);
  }
  const rows: Row[] = drawings
    .flatMap((drawing) => {
      const sets = fileQuantity(drawing.entry.name, opening.quantities?.[drawing.path]);
      return drawing.parts.parts.map((part) => ({
        drawing,
        part,
        choice: defaultChoice(part, sets?.quantity),
      }));
    })
    .filter((row) => row.choice.quantity > 0);
  const units = planeUnits();
  const settings = startingChoices(group.thickness, units);
  const formats: NestFormat[] = settings.formats
    .filter((format) => format.enabled)
    .map((format) => ({
      width: format.width,
      height: format.height,
      price: format.price,
      ...(format.stock === undefined ? {} : { stock: format.stock }),
    }));
  const pieces = rows.reduce((sum, row) => sum + row.choice.quantity, 0);
  const counts = `${countText(rows.length, 'part')}, ${countText(pieces, 'piece')}`;
  if (!rows.length) throw new Error(`${group.label} has no part to nest: every quantity is 0.`);
  if (!formats.length) throw new Error(`${group.label} has no sheet to nest on.`);
  progress(`Nesting ${group.label}: ${counts}…`);
  // the tab's own settings, whatever of them the problem takes
  const problem = nestProblem(
    rows.map((row) => ({ part: row.part, choice: row.choice })),
    formats,
    settings,
  );
  let update: NestUpdate;
  try {
    update = await search(problem, settings.budget * 1000, signal);
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(`Nesting ${group.label} stopped: ${errorMessage(error)}`);
  }
  const best = update.best;
  if (!best) throw new Error(`Nesting ${group.label} found no layout for ${counts}.`);
  const left = leftOut(problem, rows, best, settings.margin, units);
  if (left) throw new Error(`Nesting ${group.label}: ${left}`);
  const verification = verifyNest(problem, best.layout.sheets);
  if (!verification.ok)
    throw new Error(
      `Nesting ${group.label} did not pass its check: ${verification.problems[0] ?? 'a part is out of place.'}`,
    );
  const title =
    `Nesting of ${countText(rows.length, 'part')}` +
    (grouped && group.thickness !== undefined ? `, ${thicknessText(group.thickness)}` : '');
  const used = drawings.filter((drawing) => rows.some((row) => row.drawing === drawing));
  return {
    label: group.label,
    nesting: {
      title,
      sources: used.map((drawing) => ({ path: drawing.path, version: drawing.version })),
      plan: nestingPlan(title, used, rows, formats, settings, best, units),
    },
    parts: rows.length,
    pieces,
    sheets: best.sheets,
  };
}

/** The plan Save nesting writes for these rows, as the plane builds it. */
function nestingPlan(
  title: string,
  used: readonly Drawing[],
  rows: readonly Row[],
  formats: readonly NestFormat[],
  settings: NestingChoices,
  best: NestSummary,
  units: LengthUnit,
): NestingTransform {
  return {
    kind: 'nesting',
    format: 'dxf',
    title,
    sources: used.map((drawing) => ({
      units: drawing.units,
      together: drawing.together,
      marks: drawing.marks,
    })),
    parts: rows.map((row) => ({
      source: used.indexOf(row.drawing),
      index: row.part.index,
      name: row.part.name,
      quantity: row.choice.quantity,
      width: row.part.width,
      height: row.part.height,
      area: row.part.area,
    })),
    formats: formats.map((format) => ({
      width: format.width,
      height: format.height,
      price: format.price,
    })),
    sheets: best.layout.sheets.map((sheet) => ({
      format: sheet.format,
      placements: sheet.placements,
    })),
    margin: settings.margin,
    spacing: settings.spacing,
    cutting: settings.cutting,
    labels: settings.labels,
    units,
  };
}

/** The parts the layout leaves off, each by name with why, or undefined when every piece is on. */
function leftOut(
  problem: NestProblem,
  rows: readonly Row[],
  best: NestSummary,
  margin: number,
  units: LengthUnit,
): string | undefined {
  const texts = rows.flatMap((row, index) => {
    const count = best.layout.unplaced[index] ?? 0;
    if (!count) return [];
    const part = problem.parts[index]!;
    const name = row.part.name;
    const fits = problem.formats.some((format) => fitsFormat(part, part.angles, format, margin));
    return [
      fits
        ? `${countText(count, 'piece')} of ${name} found no place on the sheets`
        : `${name} (${sizeText(part.width, part.height, units)}) does not fit ${listText(problem.formats.map((format) => `a ${sheetName(format, units)} ${unitSymbol(units)} sheet`))} inside its ${gapText(margin, units)} margin`,
    ];
  });
  return texts.length
    ? `${listText(texts)}. Choose a larger sheet or more turns in the Layout plane.`
    : undefined;
}

/** One true-shape search in the nest worker, as the plane runs it: its last update. */
function search(problem: NestProblem, budget: number, signal: AbortSignal): Promise<NestUpdate> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = nestingWorkers.nest();
    const end = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      end();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<NestReply>) => {
      const reply = event.data;
      if (reply.kind === 'error') {
        end();
        reject(new Error(reply.error));
      } else if (reply.update.done) {
        end();
        resolve(reply.update);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      end();
      reject(new Error('Nesting stopped unexpectedly.'));
    };
    worker.postMessage({ problem, budget, seed: 1 } satisfies NestRequest);
  });
}
