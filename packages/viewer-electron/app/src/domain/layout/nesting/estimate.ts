/**
 * Cutting estimates (docs/reference/nesting.md): time is cut length over speed plus a pause per
 * pierce; cost is the sheets' price plus time at the machine rate. Rapid moves, lead-ins and
 * setup are left out.
 */
import type { CuttingSettings } from './plan';

export interface PartDemand {
  cutLength: number;
  pierces: number;
  markLength: number;
  area: number;
  quantity: number;
}
export interface CuttingEstimate {
  /** Millimetres. */
  cutLength: number;
  pierces: number;
  markLength: number;
  minutes: number;
  material: number;
  machine: number;
  total: number;
  /** Kilograms of sheet bought, and of parts cut from it. */
  sheetWeight: number;
  partWeight: number;
}

/** Minutes to cut `length` millimetres with `pierces` pierces. */
export const cuttingMinutes = (length: number, pierces: number, cutting: CuttingSettings) =>
  length / cutting.speed + (pierces * cutting.pierce) / 60;
/** Kilograms of plate: square millimetres × thickness × density in g/cm³. */
export const plateWeight = (area: number, cutting: CuttingSettings) =>
  (area * cutting.thickness * cutting.density) / 1e6;

export function cuttingEstimate(
  parts: readonly PartDemand[],
  sheets: readonly { width: number; height: number; price: number }[],
  cutting: CuttingSettings,
): CuttingEstimate {
  let cutLength = 0,
    pierces = 0,
    markLength = 0,
    area = 0;
  for (const part of parts) {
    cutLength += part.cutLength * part.quantity;
    pierces += part.pierces * part.quantity;
    markLength += part.markLength * part.quantity;
    area += part.area * part.quantity;
  }
  const minutes = cuttingMinutes(cutLength, pierces, cutting);
  const material = sheets.reduce((sum, sheet) => sum + sheet.price, 0);
  const machine = (minutes / 60) * cutting.rate;
  return {
    cutLength,
    pierces,
    markLength,
    minutes,
    material,
    machine,
    total: material + machine,
    sheetWeight: plateWeight(
      sheets.reduce((sum, sheet) => sum + sheet.width * sheet.height, 0),
      cutting,
    ),
    partWeight: plateWeight(area, cutting),
  };
}
