/**
 * A JOB'S NESTINGS: one per thickness, as the parts' names give it, each with its quantities, its
 * sheets and the cutting values for that thickness, and one summary across them
 * (docs/reference/fabrication.md).
 */
import type { PartDemand } from '../layout/nesting/estimate';
import type { NestFormat } from '../layout/nesting/nest';
import type { CuttingSettings } from '../layout/nesting/plan';
import { cuttingEstimate } from '../layout/nesting/estimate';
import { cuttingPresets } from '../layout/nesting/plan';
import { packBoxes } from '../layout/nesting/rectangles';
import { readJobName } from './names';

/** Where a file's quantity came from: given when its plane was opened, or read from its name. */
export type QuantitySource = 'given' | 'name';
export interface FileQuantity {
  /** Sets of what the drawing holds: a drawing of two outlines cut 4 times gives 8 pieces. */
  quantity: number;
  source: QuantitySource;
  /** The text of the name it was read from, such as "4buc". */
  text?: string;
}
/** A file's quantity, or undefined when neither the opening nor its name gives one. */
export function fileQuantity(name: string, given?: number): FileQuantity | undefined {
  if (given !== undefined) return { quantity: given, source: 'given' };
  const read = readJobName(name).quantity;
  return read && { quantity: read.value, source: 'name', text: read.text };
}

/** The cutting values for a thickness: the preset of the same material and process at that
 * thickness, or else the nearest one, thicker on a tie and slower for it, given that thickness.
 * `preset` is the preset's index, or -1 when none matches exactly. */
export function cuttingFor(
  thickness: number,
  current: CuttingSettings,
): { preset: number; cutting: CuttingSettings } {
  const candidates = cuttingPresets
    .map((preset, index) => ({ preset, index }))
    .filter(
      ({ preset }) => preset.material === current.material && preset.process === current.process,
    )
    .sort(
      (a, b) =>
        Math.abs(a.preset.thickness - thickness) - Math.abs(b.preset.thickness - thickness) ||
        b.preset.thickness - a.preset.thickness,
    );
  const nearest = candidates[0];
  if (!nearest) return { preset: -1, cutting: { ...current, thickness } };
  return {
    preset: nearest.preset.thickness === thickness ? nearest.index : -1,
    cutting: { ...current, ...nearest.preset, thickness },
  };
}

export interface GroupFigures {
  sheets: number;
  /** Sheets from the box estimate, before a true-shape search. */
  estimated: boolean;
  placed: number;
  pieces: number;
  minutes: number;
  total: number;
}
export interface BoxPart extends PartDemand {
  width: number;
  height: number;
  /** A quarter turn is allowed. */
  turn: boolean;
}
/** A thickness's figures from the box estimate on its cheapest format: fewest pieces left out,
 * then least sheet bought, as the nesting headline chooses. */
export function boxFigures(
  parts: readonly BoxPart[],
  formats: readonly NestFormat[],
  margin: number,
  spacing: number,
  cutting: CuttingSettings,
): GroupFigures {
  const pieces = parts.reduce((sum, part) => sum + part.quantity, 0);
  let chosen: { sheets: number; left: number; format: NestFormat } | undefined;
  for (const format of formats) {
    const estimate = packBoxes(parts, format, margin, spacing);
    const left = estimate.unplaced.reduce((sum, count) => sum + count, 0);
    const sheets = estimate.sheets.length;
    if (
      !chosen ||
      left < chosen.left ||
      (left === chosen.left &&
        sheets * format.width * format.height <
          chosen.sheets * chosen.format.width * chosen.format.height)
    )
      chosen = { sheets, left, format };
  }
  const figures = cuttingEstimate(
    parts,
    chosen ? Array.from({ length: chosen.sheets }, () => chosen.format) : [],
    cutting,
  );
  return {
    sheets: chosen?.sheets ?? 0,
    estimated: true,
    placed: pieces - (chosen?.left ?? pieces),
    pieces,
    minutes: figures.minutes,
    total: figures.total,
  };
}
/** Every thickness together. */
export const combinedFigures = (groups: readonly GroupFigures[]): GroupFigures =>
  groups.reduce<GroupFigures>(
    (sum, group) => ({
      sheets: sum.sheets + group.sheets,
      estimated: sum.estimated || group.estimated,
      placed: sum.placed + group.placed,
      pieces: sum.pieces + group.pieces,
      minutes: sum.minutes + group.minutes,
      total: sum.total + group.total,
    }),
    { sheets: 0, estimated: false, placed: 0, pieces: 0, minutes: 0, total: 0 },
  );
