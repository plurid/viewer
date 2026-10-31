/**
 * A saved nesting: which parts of which drawings, where each copy lies on which sheet, and the
 * cutting assumptions behind its estimate. The desktop reads the drawings again, checks the
 * placements and writes one DXF per sheet, a PDF report and a CSV (docs/reference/nesting.md).
 */
import { z } from 'zod';

export const nestingLimits = {
  sources: 200,
  parts: 2000,
  /** Placed copies across every sheet. */
  pieces: 20_000,
  sheets: 500,
  formats: 12,
} as const;

/** How far a part may turn on the sheet. */
export const rotationModes = ['none', 'quarter', 'eighth', 'fine', 'free'] as const;
export type RotationMode = (typeof rotationModes)[number];
export const rotationLabels: Record<RotationMode, string> = {
  none: 'As drawn',
  quarter: '90° steps',
  eighth: '45° steps',
  fine: '15° steps',
  free: 'Free (5° steps)',
};
const rotationSteps: Record<RotationMode, number> = {
  none: 360,
  quarter: 90,
  eighth: 45,
  fine: 15,
  free: 5,
};
/** The turns a part may take, in degrees. A grain lock keeps the part's x axis along the sheet's
 * length, so only a half turn is left. */
export function rotationAngles(mode: RotationMode, grain: boolean): number[] {
  const step = rotationSteps[mode];
  const angles: number[] = [];
  for (let angle = 0; angle < 360; angle += step)
    if (!grain || angle % 180 === 0) angles.push(angle);
  return angles;
}
/** The next freedom up, for advice. */
export const looserRotation: Partial<Record<RotationMode, RotationMode>> = {
  none: 'quarter',
  quarter: 'eighth',
};

export interface SheetSize {
  width: number;
  height: number;
}
/** What lengths read in: millimetres, or inches. Every value is kept in millimetres. */
export const lengthUnits = ['mm', 'in'] as const;
export type LengthUnit = (typeof lengthUnits)[number];
export const millimetresPerInch = 25.4;
/** Common stock sheets in millimetres; 1250 × 2500 is the default. */
export const sheetPresets: readonly SheetSize[] = [
  { width: 1000, height: 2000 },
  { width: 1250, height: 2500 },
  { width: 1500, height: 3000 },
  { width: 2000, height: 4000 },
  { width: 2000, height: 6000 },
];
/** Stock sheets in feet, kept in millimetres: 4' × 8', 4' × 10', 5' × 10' and 5' × 12'. */
export const inchSheetPresets: readonly SheetSize[] = (
  [
    [48, 96],
    [48, 120],
    [60, 120],
    [60, 144],
  ] as const
).map(([width, height]) => ({ width: exactly(width), height: exactly(height) }));
/** Inches in millimetres without the float's last digit: 48 in is 1219.2 mm. */
function exactly(inches: number): number {
  return Number((inches * millimetresPerInch).toFixed(6));
}
export const sheetPresetsIn = (units: LengthUnit) =>
  units === 'in' ? inchSheetPresets : sheetPresets;
/** 1250 × 2500 mm, or 4' × 8'. */
export const defaultSheet = (units: LengthUnit) =>
  units === 'in' ? inchSheetPresets[0]! : sheetPresets[1]!;
/** "1250 × 2500", or in inches "48 × 96": numbers only, the unit follows where it is needed. */
export const sheetName = (size: SheetSize, units: LengthUnit = 'mm') =>
  units === 'in'
    ? `${inchNumber(size.width)} × ${inchNumber(size.height)}`
    : `${size.width} × ${size.height}`;
const inchNumber = (millimetres: number) =>
  Number((millimetres / millimetresPerInch).toFixed(2)).toLocaleString('en');
export const nestingDefaults = { margin: 10, spacing: 5, sheet: sheetPresets[1]! } as const;

/**
 * Where parts gather on a sheet. Compact packs them into a block in one corner and keeps the
 * largest rectangle whole; along the length lays rows down the sheet's long side; along the width
 * fills across it first, leaving a strip at the far end.
 */
export const nestDirections = ['compact', 'length', 'width'] as const;
export type NestDirection = (typeof nestDirections)[number];
export const directionLabels: Record<NestDirection, string> = {
  compact: 'Compact block',
  length: 'Along the length',
  width: 'Along the width',
};

export const cuttingProcesses = ['fiber', 'co2', 'plasma', 'waterjet'] as const;
export type CuttingProcess = (typeof cuttingProcesses)[number];
export const processLabels: Record<CuttingProcess, string> = {
  fiber: 'Fiber laser',
  co2: 'CO2 laser',
  plasma: 'Plasma',
  waterjet: 'Water jet',
};
export interface CuttingPreset {
  material: string;
  process: CuttingProcess;
  /** Millimetres. */
  thickness: number;
  /** Millimetres a minute. */
  speed: number;
  /** Seconds per pierce. */
  pierce: number;
  /** Grams per cubic centimetre. */
  density: number;
  /** Width of the cut in millimetres; the machine offsets its path by half. */
  kerf: number;
}
type Row = readonly [thickness: number, speed: number, pierce: number, kerf: number];
const rows = (
  material: string,
  process: CuttingProcess,
  density: number,
  values: readonly Row[],
): CuttingPreset[] =>
  values.map(([thickness, speed, pierce, kerf]) => ({
    material,
    process,
    thickness,
    speed,
    pierce,
    density,
    kerf,
  }));
/**
 * Typical values to adjust for a machine: about 3 kW fiber, 100 W CO2, 65 A plasma, and an
 * abrasive water jet at 4,100 bar (60,000 psi) with a 0.30 mm orifice, a 1.0 mm focusing tube
 * and 80-mesh garnet, cutting at a medium edge quality. The water-jet figures sit inside the
 * published reference ranges cited in docs/reference/nesting.md.
 */
export const cuttingPresets: readonly CuttingPreset[] = [
  ...rows('Mild steel', 'fiber', 7.85, [
    [1, 15000, 0.1, 0.1],
    [2, 7000, 0.2, 0.15],
    [3, 4000, 0.4, 0.2],
    [6, 2200, 1, 0.3],
    [10, 1300, 2, 0.4],
  ]),
  ...rows('Mild steel', 'plasma', 7.85, [
    [3, 5000, 0.3, 1.5],
    [6, 3000, 0.5, 1.7],
    [10, 1800, 0.8, 1.9],
    [20, 800, 1.5, 2.3],
  ]),
  ...rows('Stainless steel', 'fiber', 8, [
    [1, 20000, 0.1, 0.1],
    [2, 9000, 0.2, 0.15],
    [3, 5000, 0.3, 0.2],
    [5, 2000, 0.6, 0.3],
  ]),
  ...rows('Aluminium', 'fiber', 2.7, [
    [1, 18000, 0.1, 0.1],
    [2, 8000, 0.2, 0.15],
    [3, 5000, 0.3, 0.2],
    [5, 2000, 0.6, 0.3],
  ]),
  ...rows('Plywood', 'co2', 0.6, [
    [3, 1500, 0.1, 0.2],
    [6, 600, 0.3, 0.25],
    [9, 300, 0.5, 0.3],
  ]),
  ...rows('Acrylic', 'co2', 1.19, [
    [3, 900, 0.2, 0.15],
    [5, 500, 0.4, 0.2],
    [8, 250, 0.8, 0.25],
  ]),
  ...rows('Mild steel', 'waterjet', 7.85, [
    [3, 750, 2, 0.9],
    [6, 400, 4, 1],
    [10, 240, 8, 1],
    [20, 110, 18, 1.1],
    [30, 70, 30, 1.2],
  ]),
  ...rows('Stainless steel', 'waterjet', 8, [
    [3, 520, 3, 0.9],
    [6, 300, 6, 1],
    [10, 180, 12, 1],
    [20, 80, 25, 1.1],
  ]),
  ...rows('Aluminium', 'waterjet', 2.7, [
    [3, 1000, 1.5, 0.9],
    [6, 600, 3, 1],
    [10, 380, 6, 1],
    [20, 180, 14, 1.1],
    [30, 120, 22, 1.2],
  ]),
];
export const presetName = (preset: CuttingPreset) =>
  `${preset.material} ${preset.thickness} mm · ${processLabels[preset.process]}`;
/** The preset for a process: the same material at the nearest thickness, thicker on a tie, or
 * else the process's nearest thickness in any material. */
export function presetFor(process: CuttingProcess, material: string, thickness: number): number {
  const ranked = cuttingPresets
    .map((preset, index) => ({ preset, index }))
    .filter(({ preset }) => preset.process === process)
    .sort(
      (a, b) =>
        Number(b.preset.material === material) - Number(a.preset.material === material) ||
        Math.abs(a.preset.thickness - thickness) - Math.abs(b.preset.thickness - thickness) ||
        b.preset.thickness - a.preset.thickness ||
        a.index - b.index,
    );
  return ranked[0]?.index ?? -1;
}
/**
 * The part spacing and edge margin a process needs at a thickness, in millimetres. A water jet
 * leaves room for the lead-in and the pierce crater between parts, more in thick plate; the
 * others keep the nesting defaults.
 */
export function sheetAllowance(
  process: CuttingProcess,
  thickness: number,
): { spacing: number; margin: number } {
  if (process !== 'waterjet')
    return { spacing: nestingDefaults.spacing, margin: nestingDefaults.margin };
  const [, spacing, margin] = [...waterjetAllowances].sort(
    (a, b) => Math.abs(a[0] - thickness) - Math.abs(b[0] - thickness) || b[0] - a[0],
  )[0]!;
  return { spacing, margin };
}
const waterjetAllowances: readonly (readonly [
  thickness: number,
  spacing: number,
  margin: number,
])[] = [
  [3, 3, 10],
  [6, 4, 10],
  [10, 5, 15],
  [20, 8, 15],
  [30, 10, 20],
];

const millimetres = z.number().finite().min(0).max(100_000);
const coordinate = z.number().finite().min(-100_000).max(200_000);
const index = (limit: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(limit - 1);
const layerName = z.string().min(1).max(255);
export const cuttingSchema = z
  .object({
    material: z.string().max(100),
    process: z.enum(cuttingProcesses),
    thickness: z.number().finite().min(0).max(1000),
    speed: z.number().finite().positive().max(1_000_000),
    pierce: z.number().finite().min(0).max(600),
    density: z.number().finite().min(0).max(30),
    /** Machine cost per hour. */
    rate: z.number().finite().min(0).max(1_000_000),
    currency: z.string().max(8),
    /** Width of the cut in millimetres, for the report; absent in plans made before it. */
    kerf: z.number().finite().min(0).max(50).optional(),
  })
  .strict();
export type CuttingSettings = z.infer<typeof cuttingSchema>;
export const placementSchema = z
  .object({
    part: index(nestingLimits.parts),
    /** Where the part's own origin lands, in sheet millimetres with y up. */
    x: coordinate,
    y: coordinate,
    /** Degrees counter-clockwise, after any mirroring. */
    rotation: z.number().finite().min(0).lt(360),
    mirror: z.boolean(),
  })
  .strict();
export type Placement = z.infer<typeof placementSchema>;
export const nestingTransformSchema = z
  .object({
    kind: z.literal('nesting'),
    format: z.literal('dxf'),
    title: z.string().min(1).max(200),
    /** One entry per source drawing, in order. */
    sources: z
      .array(
        z
          .object({
            /** The `$INSUNITS` code the drawing is read in. */
            units: z.number().int().min(1).max(24),
            together: z.boolean(),
            marks: z.array(layerName).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(nestingLimits.sources),
    parts: z
      .array(
        z
          .object({
            source: index(nestingLimits.sources),
            index: index(nestingLimits.parts),
            name: z.string().min(1).max(255),
            quantity: z.number().int().min(0).max(nestingLimits.pieces),
            /** The part as it was nested; the desktop refuses a drawing that has changed. */
            width: millimetres,
            height: millimetres,
            area: z.number().finite().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(nestingLimits.parts),
    formats: z
      .array(
        z
          .object({
            width: millimetres.min(1),
            height: millimetres.min(1),
            price: z.number().finite().min(0).max(1e9),
          })
          .strict(),
      )
      .min(1)
      .max(nestingLimits.formats),
    sheets: z
      .array(
        z
          .object({
            format: index(nestingLimits.formats),
            placements: z.array(placementSchema).max(nestingLimits.pieces),
          })
          .strict(),
      )
      .min(1)
      .max(nestingLimits.sheets),
    margin: millimetres.max(1000),
    spacing: millimetres.max(1000),
    cutting: cuttingSchema,
    /** Part numbers on a layer of their own, never cut. */
    labels: z.boolean().default(true),
    /** What the report and the parts list measure in; the sheet DXFs stay in millimetres. */
    units: z.enum(lengthUnits).optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (plan.parts.some((part) => part.source >= plan.sources.length))
      issue('A part refers to a drawing that is not in this nesting.');
    if (plan.sheets.some((sheet) => sheet.format >= plan.formats.length))
      issue('A sheet refers to a format that is not in this nesting.');
    const placed = new Array<number>(plan.parts.length).fill(0);
    let total = 0;
    for (const sheet of plan.sheets)
      for (const placement of sheet.placements) {
        total++;
        if (placement.part >= plan.parts.length) issue('A placement refers to a missing part.');
        else placed[placement.part]!++;
      }
    if (total > nestingLimits.pieces) issue('A nesting holds at most 20,000 placed parts.');
    if (plan.parts.some((part, index) => placed[index]! > part.quantity))
      issue('A part is placed more often than requested.');
  });
export type NestingTransform = z.infer<typeof nestingTransformSchema>;
