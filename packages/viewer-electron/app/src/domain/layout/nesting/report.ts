/**
 * The nesting report as a layout plan of rectangles, paths and text: a summary with the parts and
 * sheets tables and the estimate's assumptions, then each sheet drawn to scale with its part
 * numbers. A4 landscape throughout.
 */
import { layoutLimits, type LayoutItem, type LayoutPage, type LayoutTransform } from '../plan';
import type { CuttingEstimate } from './estimate';
import {
  areaText,
  countText,
  durationText,
  gapText,
  lengthText,
  moneyText,
  percentText,
  sizeText,
  weightText,
} from './format';
import { apply, insideRing, placementMatrix } from './geometry';
import { sheetLength, sheetWidth } from './nest';
import type { Part } from './parts';
import {
  processLabels,
  sheetName,
  type CuttingSettings,
  type Placement,
  type SheetSize,
} from './plan';

export interface ReportPart {
  /** Its number on the sheets and in the tables. */
  number: number;
  name: string;
  file: string;
  part: Part;
  requested: number;
  placed: number;
}
export interface ReportSheet {
  size: SheetSize;
  price: number;
  placements: readonly Placement[];
  /** Material area of its parts. */
  area: number;
  /** How far along its length the parts reach. */
  used: number;
}
export interface NestingReport {
  title: string;
  date: string;
  parts: readonly ReportPart[];
  sheets: readonly ReportSheet[];
  estimate: CuttingEstimate;
  cutting: CuttingSettings;
  margin: number;
  spacing: number;
  /** The closest two parts, from the exact check. */
  closest: number;
}

const page = { width: 842, height: 595, margin: 36 } as const;
const ink = '#202733',
  muted = '#546071',
  line = '#d5dbe2',
  accent = '#337396',
  fill = '#dcebf4',
  mark = '#386731';

/** The strip left past a sheet's last part, as long as it can be cut off and kept. */
export const remnantLength = (sheet: ReportSheet, margin: number, spacing: number) =>
  Math.max(0, sheetLength(sheet.size) - margin - sheet.used - spacing);

export function nestingReport(report: NestingReport): LayoutTransform {
  const pages: LayoutPage[] = [...summaryPages(report)];
  report.sheets.forEach((sheet, index) => pages.push(sheetPage(report, sheet, index)));
  return { kind: 'layout', format: 'pdf', dpi: 300, quality: 90, title: report.title, pages };
}

const text = (
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: string;
    bold?: boolean;
    align?: 'start' | 'center' | 'end';
    width?: number;
  } = {},
): LayoutItem => ({
  kind: 'text',
  text: value.slice(0, layoutLimits.textLength) || ' ',
  x,
  y,
  size: options.size ?? 9,
  color: options.color ?? ink,
  align: options.align ?? 'start',
  weight: options.bold ? 'bold' : 'regular',
  ...(options.width ? { maxWidth: options.width } : {}),
});
const rule = (x: number, y: number, width: number, color = line): LayoutItem => ({
  kind: 'rect',
  frame: { x, y, width, height: 0.75 },
  fill: color,
  lineWidth: 0,
});

interface Column {
  title: string;
  width: number;
  align?: 'start' | 'end';
}
/** Rows of a table from `y`; returns the rows that did not fit above `bottom`. */
function table(
  items: LayoutItem[],
  columns: readonly Column[],
  rows: readonly string[][],
  y: number,
  bottom: number,
): { y: number; rest: string[][] } {
  const height = 15;
  let x = page.margin;
  for (const column of columns) {
    const edge = column.align === 'end' ? x + column.width - 6 : x;
    items.push(
      text(column.title, edge, y, {
        size: 8,
        color: muted,
        align: column.align,
        width: column.width - 6,
      }),
    );
    x += column.width;
  }
  y += 5;
  items.push(rule(page.margin, y, page.width - 2 * page.margin));
  let index = 0;
  for (; index < rows.length && y + height <= bottom; index++) {
    y += height;
    x = page.margin;
    rows[index]!.forEach((cell, c) => {
      const column = columns[c]!;
      const edge = column.align === 'end' ? x + column.width - 6 : x;
      items.push(text(cell, edge, y - 4, { align: column.align, width: column.width - 6 }));
      x += column.width;
    });
    items.push(rule(page.margin, y + 2, page.width - 2 * page.margin, '#eef0f4'));
  }
  return { y: y + height, rest: rows.slice(index) };
}

function summaryPages(report: NestingReport): LayoutPage[] {
  const { estimate, cutting } = report;
  const requested = report.parts.reduce((sum, part) => sum + part.requested, 0),
    placed = report.parts.reduce((sum, part) => sum + part.placed, 0);
  const material = report.sheets.reduce(
    (sum, sheet) => sum + sheet.size.width * sheet.size.height,
    0,
  );
  const area = report.sheets.reduce((sum, sheet) => sum + sheet.area, 0);
  const formats = new Map<string, number>();
  for (const sheet of report.sheets)
    formats.set(sheetName(sheet.size), (formats.get(sheetName(sheet.size)) ?? 0) + 1);
  const items: LayoutItem[] = [];
  let y = page.margin + 18;
  items.push(text(report.title, page.margin, y, { size: 18, bold: true }));
  y += 16;
  items.push(text(`${report.date} · Viewer`, page.margin, y, { color: muted }));
  y += 28;
  const figures: [string, string][] = [
    ['Sheets', [...formats].map(([name, count]) => `${count} × ${name} mm`).join(', ')],
    ['Material used', `${percentText(material ? area / material : 0)} of ${areaText(material)}`],
    ['Parts placed', `${placed.toLocaleString('en')} of ${requested.toLocaleString('en')}`],
    ['Cut length', lengthText(estimate.cutLength)],
    ['Pierces', estimate.pierces.toLocaleString('en')],
    ['Cutting time', durationText(estimate.minutes)],
    [
      'Cost',
      `${moneyText(estimate.total, cutting.currency)} (sheets ${moneyText(estimate.material, cutting.currency)}, machine ${moneyText(estimate.machine, cutting.currency)})`,
    ],
  ];
  if (cutting.density > 0 && cutting.thickness > 0)
    figures.push([
      'Weight',
      `${weightText(estimate.partWeight)} of parts from ${weightText(estimate.sheetWeight)} of sheet`,
    ]);
  for (const [label, value] of figures) {
    items.push(text(label, page.margin, y, { color: muted }));
    items.push(text(value, page.margin + 110, y, { width: page.width - 2 * page.margin - 110 }));
    y += 14;
  }
  y += 16;
  items.push(text('Sheets', page.margin, y, { size: 11, bold: true }));
  y += 18;
  const sheetRows = report.sheets.map((sheet, index) => [
    String(index + 1),
    `${sheetName(sheet.size)} mm`,
    String(sheet.placements.length),
    percentText(sheet.area / (sheet.size.width * sheet.size.height)),
    lengthText(remnantLength(sheet, report.margin, report.spacing)),
  ]);
  const sheetColumns: Column[] = [
    { title: 'Sheet', width: 50 },
    { title: 'Format', width: 140 },
    { title: 'Parts', width: 60, align: 'end' },
    { title: 'Used', width: 60, align: 'end' },
    { title: 'Remnant length', width: 110, align: 'end' },
  ];
  const partColumns: Column[] = [
    { title: 'No.', width: 34 },
    { title: 'Part', width: 170 },
    { title: 'File', width: 150 },
    { title: 'Size', width: 120 },
    { title: 'Requested', width: 62, align: 'end' },
    { title: 'Placed', width: 50, align: 'end' },
    { title: 'Area', width: 64, align: 'end' },
    { title: 'Cut length', width: 62, align: 'end' },
    { title: 'Pierces', width: 58, align: 'end' },
  ];
  const partRows = report.parts.map((part) => [
    String(part.number),
    part.name,
    part.file,
    sizeText(part.part.width, part.part.height),
    String(part.requested),
    String(part.placed),
    areaText(part.part.area),
    lengthText(part.part.cutLength),
    String(part.part.pierces),
  ]);
  const pages: LayoutPage[] = [];
  const bottom = page.height - page.margin;
  let sheetsLeft = sheetRows,
    partsLeft = partRows;
  let current = items;
  const next = () => {
    pages.push({ width: page.width, height: page.height, items: current });
    current = [];
    y = page.margin + 14;
  };
  while (sheetsLeft.length) {
    const done = table(current, sheetColumns, sheetsLeft, y, bottom);
    sheetsLeft = done.rest;
    y = done.y + 16;
    if (sheetsLeft.length) next();
  }
  current.push(text('Parts', page.margin, y, { size: 11, bold: true }));
  y += 18;
  while (partsLeft.length) {
    const done = table(current, partColumns, partsLeft, y, bottom);
    partsLeft = done.rest;
    y = done.y + 16;
    if (partsLeft.length) next();
  }
  const assumptions = [
    `${cutting.material || 'Material'} ${cutting.thickness} mm, ${processLabels[cutting.process].toLowerCase()}: ${cutting.speed.toLocaleString('en')} mm/min, ${cutting.pierce} s per pierce, machine ${moneyText(cutting.rate, cutting.currency)} an hour.`,
    'Cutting time is cut length divided by speed, plus the pierce time for every closed loop and open path.',
    'Rapid moves, lead-ins, marking and setup are not included. The speeds are typical values: check them against your machine.',
    `Parts are at least ${gapText(report.spacing)} apart and ${gapText(report.margin)} from the sheet edge.` +
      (Number.isFinite(report.closest)
        ? ` The exact check found the closest two ${gapText(report.closest)} apart.`
        : ''),
    ...(estimate.markLength
      ? [`Marking lines: ${lengthText(estimate.markLength)}, not timed.`]
      : []),
  ];
  if (y + 18 + assumptions.length * 13 > bottom) next();
  current.push(text('Assumptions', page.margin, y, { size: 11, bold: true }));
  y += 16;
  for (const sentence of assumptions) {
    current.push(
      text(sentence, page.margin, y, { color: muted, width: page.width - 2 * page.margin }),
    );
    y += 13;
  }
  pages.push({ width: page.width, height: page.height, items: current });
  return pages;
}

function sheetPage(report: NestingReport, sheet: ReportSheet, index: number): LayoutPage {
  const items: LayoutItem[] = [];
  const length = sheetLength(sheet.size),
    width = sheetWidth(sheet.size);
  items.push(
    text(
      `Sheet ${index + 1} of ${report.sheets.length} · ${sheetName(sheet.size)} mm · ${percentText(sheet.area / (length * width))} used · ${countText(sheet.placements.length, 'part')}`,
      page.margin,
      page.margin + 12,
      { size: 12, bold: true },
    ),
  );
  const top = page.margin + 30,
    legendHeight = 60;
  const room = {
    width: page.width - 2 * page.margin,
    height: page.height - top - page.margin - legendHeight,
  };
  const scale = Math.min(room.width / length, room.height / width);
  const left = page.margin + (room.width - length * scale) / 2;
  const toPage = (x: number, y: number): [number, number] => [
    left + x * scale,
    top + (width - y) * scale,
  ];
  items.push({
    kind: 'rect',
    frame: { x: left, y: top, width: length * scale, height: width * scale },
    stroke: ink,
    lineWidth: 0.75,
  });
  if (report.margin > 0)
    items.push(
      polygon(
        [
          toPage(report.margin, report.margin),
          toPage(length - report.margin, report.margin),
          toPage(length - report.margin, width - report.margin),
          toPage(report.margin, width - report.margin),
        ],
        { stroke: '#9fabb9', lineWidth: 0.4, dash: [2, 2] },
      ),
    );
  const byIndex = new Map(report.parts.map((part, at) => [at, part]));
  // A page holds at most 5,000 items: holes go first when a sheet has more.
  const loops = sheet.placements.reduce((sum, p) => {
    const part = byIndex.get(p.part)!.part;
    return sum + part.rings.length + part.paths.length + part.marks.length + 1;
  }, 0);
  const withHoles = loops + 20 < layoutLimits.itemsPerPage;
  for (const placement of sheet.placements) {
    const entry = byIndex.get(placement.part)!,
      part = entry.part;
    const m = placementMatrix(placement.rotation, placement.mirror, placement.x, placement.y);
    const mapped = (values: readonly number[]) => {
      const points: [number, number][] = [];
      for (let i = 0; i < values.length; i += 2) {
        const p = apply(m, { x: values[i]!, y: values[i + 1]! });
        points.push(toPage(p.x, p.y));
      }
      return points;
    };
    // Outlines first, holes on top of them in white.
    const outer = part.rings.filter((ring) => outerRing(ring, part.rings));
    for (const ring of outer)
      items.push(polygon(mapped(ring), { fill, stroke: accent, lineWidth: 0.4 }));
    if (withHoles) {
      for (const ring of part.rings)
        if (!outer.includes(ring))
          items.push(polygon(mapped(ring), { fill: '#ffffff', stroke: accent, lineWidth: 0.4 }));
      for (const path of part.paths)
        items.push(polygon(mapped(path), { stroke: accent, lineWidth: 0.4 }, false));
      for (const path of part.marks)
        items.push(polygon(mapped(path), { stroke: mark, lineWidth: 0.3 }, false));
    }
    const at = apply(m, part.label);
    const [x, y] = toPage(at.x, at.y);
    const size = Math.max(4, Math.min(9, Math.min(part.width, part.height) * scale * 0.35));
    items.push(
      text(String(entry.number), x, y + size * 0.35, { size, align: 'center', color: ink }),
    );
  }
  // The legend: each part's number and name, with its count on this sheet.
  const counts = new Map<number, number>();
  for (const placement of sheet.placements)
    counts.set(placement.part, (counts.get(placement.part) ?? 0) + 1);
  let lx = page.margin,
    ly = page.height - page.margin - legendHeight + 18;
  for (const [part, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    const entry = byIndex.get(part)!;
    const label = `${entry.number}  ${entry.name} × ${count}`;
    const widthGuess = Math.min(250, 8 + label.length * 4.6);
    if (lx + widthGuess > page.width - page.margin) {
      lx = page.margin;
      ly += 12;
      if (ly > page.height - page.margin) break;
    }
    items.push(text(label, lx, ly, { size: 8, color: muted, width: widthGuess }));
    lx += widthGuess + 12;
  }
  if (!withHoles)
    items.push(
      text(
        'Holes and marks are left out of this drawing; the DXF has them all.',
        page.margin,
        page.height - page.margin + 10,
        {
          size: 7,
          color: muted,
        },
      ),
    );
  return { width: page.width, height: page.height, items };
}
/** An outline, not a hole: inside an even number of the part's other rings. */
function outerRing(ring: readonly number[], rings: readonly (readonly number[])[]): boolean {
  let depth = 0;
  for (const other of rings) if (other !== ring && insideRing(ring[0]!, ring[1]!, other)) depth++;
  return depth % 2 === 0;
}
function polygon(
  points: readonly [number, number][],
  style: { fill?: string; stroke?: string; lineWidth: number; dash?: [number, number] },
  closed = true,
): LayoutItem {
  return {
    kind: 'path',
    points: points.flatMap(([x, y]) => [round(x), round(y)]),
    closed,
    ...(style.fill ? { fill: style.fill } : {}),
    ...(style.stroke ? { stroke: style.stroke } : {}),
    lineWidth: style.lineWidth,
    ...(style.dash ? { dash: style.dash } : {}),
  };
}
const round = (value: number) => Math.round(value * 100) / 100;
