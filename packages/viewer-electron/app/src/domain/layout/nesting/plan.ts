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
/** Common stock sheets in millimetres; 1250 × 2500 is the default. */
export const sheetPresets: readonly SheetSize[] = [
  { width: 1000, height: 2000 },
  { width: 1250, height: 2500 },
  { width: 1500, height: 3000 },
  { width: 2000, height: 4000 },
  { width: 2000, height: 6000 },
];
export const sheetName = (size: SheetSize) => `${size.width} × ${size.height}`;
export const nestingDefaults = { margin: 10, spacing: 5, sheet: sheetPresets[1]! } as const;

export const cuttingProcesses = ['fiber', 'co2', 'plasma'] as const;
export type CuttingProcess = (typeof cuttingProcesses)[number];
export const processLabels: Record<CuttingProcess, string> = {
  fiber: 'Fiber laser',
  co2: 'CO2 laser',
  plasma: 'Plasma',
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
}
/** Typical values to adjust for a machine: about 3 kW fiber, 100 W CO2 and 65 A plasma. */
export const cuttingPresets: readonly CuttingPreset[] = [
  ...(
    [
      [1, 15000, 0.1],
      [2, 7000, 0.2],
      [3, 4000, 0.4],
      [6, 2200, 1],
      [10, 1300, 2],
    ] as const
  ).map(([thickness, speed, pierce]) =>
    preset('Mild steel', 'fiber', thickness, speed, pierce, 7.85),
  ),
  ...(
    [
      [3, 5000, 0.3],
      [6, 3000, 0.5],
      [10, 1800, 0.8],
      [20, 800, 1.5],
    ] as const
  ).map(([thickness, speed, pierce]) =>
    preset('Mild steel', 'plasma', thickness, speed, pierce, 7.85),
  ),
  ...(
    [
      [1, 20000, 0.1],
      [2, 9000, 0.2],
      [3, 5000, 0.3],
      [5, 2000, 0.6],
    ] as const
  ).map(([thickness, speed, pierce]) =>
    preset('Stainless steel', 'fiber', thickness, speed, pierce, 8),
  ),
  ...(
    [
      [1, 18000, 0.1],
      [2, 8000, 0.2],
      [3, 5000, 0.3],
      [5, 2000, 0.6],
    ] as const
  ).map(([thickness, speed, pierce]) =>
    preset('Aluminium', 'fiber', thickness, speed, pierce, 2.7),
  ),
  ...(
    [
      [3, 1500, 0.1],
      [6, 600, 0.3],
      [9, 300, 0.5],
    ] as const
  ).map(([thickness, speed, pierce]) => preset('Plywood', 'co2', thickness, speed, pierce, 0.6)),
  ...(
    [
      [3, 900, 0.2],
      [5, 500, 0.4],
      [8, 250, 0.8],
    ] as const
  ).map(([thickness, speed, pierce]) => preset('Acrylic', 'co2', thickness, speed, pierce, 1.19)),
];
function preset(
  material: string,
  process: CuttingProcess,
  thickness: number,
  speed: number,
  pierce: number,
  density: number,
): CuttingPreset {
  return { material, process, thickness, speed, pierce, density };
}
export const presetName = (preset: CuttingPreset) =>
  `${preset.material} ${preset.thickness} mm · ${processLabels[preset.process]}`;

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
