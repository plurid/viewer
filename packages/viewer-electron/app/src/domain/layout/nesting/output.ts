/**
 * What a saved nesting writes: `Sheet 1.dxf` … for each sheet, `Parts.csv` with a parts table and
 * a sheets table, and the report plan the desktop draws as `Report.pdf`.
 */
import type { LayoutTransform } from '../plan';
import { sheetDXF } from './dxf-writer';
import { cuttingEstimate, cuttingMinutes, type CuttingEstimate } from './estimate';
import { sheetLength, sheetWidth } from './nest';
import type { Part } from './parts';
import { nestingTolerances } from './parts';
import type { NestingTransform, Placement } from './plan';
import { placementMatrix } from './geometry';
import { nestingReport, remnantLength, type ReportSheet } from './report';
import { verifyNest, type Verification } from './verify';

export interface NestingSource {
  /** The drawing's file name. */
  file: string;
  /** Its parts as read with the plan's units, layers and grouping. */
  parts: readonly Part[];
}
export interface NestingFiles {
  files: { name: string; content: string }[];
  report: LayoutTransform;
  estimate: CuttingEstimate;
  verification: Verification;
}

/** Matches the plan's parts with the drawings as read now, refusing any that changed. */
export function planParts(
  plan: NestingTransform,
  sources: readonly NestingSource[],
): { part: Part; file: string }[] {
  if (sources.length !== plan.sources.length)
    throw new Error('The nesting names a different set of drawings. Nest again.');
  return plan.parts.map((entry) => {
    const source = sources[entry.source]!;
    const part = source.parts[entry.index];
    const close = (a: number, b: number) =>
      Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) + 1e-6;
    if (
      !part ||
      !close(part.width, entry.width) ||
      !close(part.height, entry.height) ||
      !close(part.area, entry.area)
    )
      throw new Error(`${source.file} changed since it was nested. Nest again.`);
    return { part, file: source.file };
  });
}

export function nestingFiles(
  plan: NestingTransform,
  sources: readonly NestingSource[],
  date: string,
): NestingFiles {
  const parts = planParts(plan, sources);
  const verification = verifyNest(
    {
      parts: parts.map(({ part }) => part),
      formats: plan.formats,
      margin: plan.margin,
      spacing: plan.spacing,
      tolerance: nestingTolerances.flatten,
    },
    plan.sheets,
  );
  if (!verification.ok)
    throw new Error(`The nesting failed its final check: ${verification.problems[0]} Nest again.`);
  const placed = parts.map(() => 0);
  for (const sheet of plan.sheets) for (const p of sheet.placements) placed[p.part]!++;
  const sheets: ReportSheet[] = plan.sheets.map((sheet) => {
    const size = plan.formats[sheet.format]!;
    let area = 0,
      used = 0;
    for (const placement of sheet.placements) {
      const part = parts[placement.part]!.part;
      area += part.area;
      used = Math.max(used, reachOf(part, placement));
    }
    return { size, price: size.price, placements: sheet.placements, area, used };
  });
  const estimate = cuttingEstimate(
    parts.map(({ part }, index) => ({ ...part, quantity: placed[index]! })),
    sheets.map((sheet) => ({ ...sheet.size, price: sheet.price })),
    plan.cutting,
  );
  const numbered = parts.map(({ part, file }, index) => ({
    number: index + 1,
    name: plan.parts[index]!.name,
    file,
    part,
    requested: plan.parts[index]!.quantity,
    placed: placed[index]!,
  }));
  const files = plan.sheets.map((sheet, index) => ({
    name: `Sheet ${index + 1}.dxf`,
    content: sheetDXF({
      length: sheetLength(plan.formats[sheet.format]!),
      width: sheetWidth(plan.formats[sheet.format]!),
      labels: plan.labels,
      pieces: sheet.placements.map((placement) => ({
        part: parts[placement.part]!.part,
        placement,
        number: placement.part + 1,
      })),
    }),
  }));
  files.push({
    name: 'Parts.csv',
    content: partsCSV(plan, numbered, sheets),
  });
  return {
    files,
    report: nestingReport({
      title: plan.title,
      date,
      parts: numbered,
      sheets,
      estimate,
      cutting: plan.cutting,
      margin: plan.margin,
      spacing: plan.spacing,
      closest: verification.closest,
    }),
    estimate,
    verification,
  };
}
/** How far along the sheet a placed part reaches. */
function reachOf(part: Part, placement: Placement): number {
  const m = placementMatrix(placement.rotation, placement.mirror, placement.x, placement.y);
  let reach = -Infinity;
  for (const ring of [...part.rings, ...part.paths])
    for (let i = 0; i < ring.length; i += 2)
      reach = Math.max(reach, m[0] * ring[i]! + m[2] * ring[i + 1]! + m[4]);
  return reach;
}

const cell = (value: string | number) => {
  const textValue = typeof value === 'number' ? String(Number(value.toFixed(3))) : value;
  return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
};
const row = (values: readonly (string | number)[]) => values.map(cell).join(',');
/** Two tables, parts then sheets, with a blank line between; plain numbers in millimetres. */
export function partsCSV(
  plan: NestingTransform,
  parts: readonly {
    number: number;
    name: string;
    file: string;
    part: Part;
    requested: number;
    placed: number;
  }[],
  sheets: readonly ReportSheet[],
): string {
  const lines = [
    row([
      'No.',
      'Part',
      'File',
      'Requested',
      'Placed',
      'Width (mm)',
      'Height (mm)',
      'Area (mm²)',
      'Cut length (mm)',
      'Pierces',
      'Cutting time each (min)',
    ]),
    ...parts.map((entry) =>
      row([
        entry.number,
        entry.name,
        entry.file,
        entry.requested,
        entry.placed,
        entry.part.width,
        entry.part.height,
        entry.part.area,
        entry.part.cutLength,
        entry.part.pierces,
        cuttingMinutes(entry.part.cutLength, entry.part.pierces, plan.cutting),
      ]),
    ),
    '',
    row([
      'Sheet',
      'Width (mm)',
      'Height (mm)',
      'Parts',
      'Utilisation (%)',
      'Remnant length (mm)',
      'Cut length (mm)',
      'Pierces',
      'Cutting time (min)',
      'Price',
    ]),
    ...sheets.map((sheet, index) => {
      let length = 0,
        pierces = 0;
      for (const placement of sheet.placements) {
        const part = parts[placement.part]!.part;
        length += part.cutLength;
        pierces += part.pierces;
      }
      return row([
        index + 1,
        sheet.size.width,
        sheet.size.height,
        sheet.placements.length,
        (100 * sheet.area) / (sheet.size.width * sheet.size.height),
        remnantLength(sheet, plan.margin, plan.spacing),
        length,
        pierces,
        cuttingMinutes(length, pierces, plan.cutting),
        sheet.price,
      ]);
    }),
  ];
  // A byte order mark tells spreadsheet apps the file is UTF-8.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
