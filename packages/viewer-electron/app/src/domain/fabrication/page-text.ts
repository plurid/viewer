/**
 * A DRAWING PAGE AS A CHECK SENDS IT: its scale for a picture of a given size, and its text runs
 * with their boxes. pdf.js reads the page; the renderer (renderer/layout/pdf.ts) and the live
 * evaluation (tools/fabrication/evaluate-live.ts) share this arithmetic, so both send the same
 * boxes.
 */
import type { PageText } from './check';

/** An affine matrix, `[a, b, c, d, e, f]`, as pdf.js gives it. */
type Matrix = readonly number[];
/** A page's viewport at scale 1. */
export interface TextViewport {
  width: number;
  height: number;
  transform: Matrix;
}
/** A pdf.js text item; marked-content items have no `str` and are passed over. */
export interface TextRunItem {
  str: string;
  transform: Matrix;
  width: number;
  height: number;
}
const isRun = (item: object): item is TextRunItem => 'str' in item;

/** Two matrices composed, as pdf.js's `Util.transform` composes them. */
const compose = (m1: Matrix, m2: Matrix): number[] => [
  m1[0]! * m2[0]! + m1[2]! * m2[1]!,
  m1[1]! * m2[0]! + m1[3]! * m2[1]!,
  m1[0]! * m2[2]! + m1[2]! * m2[3]!,
  m1[1]! * m2[2]! + m1[3]! * m2[3]!,
  m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
  m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
];

/** A page picture's JPEG quality, from 0 to 1: lines and small dimension text stay legible. */
export const pagePictureQuality = 0.86;
/** The scale that draws a page with its longer side `longest` pixels. */
export const pageScale = (page: { width: number; height: number }, longest: number) =>
  longest / Math.max(page.width, page.height);

/**
 * A page's text runs with their boxes as fractions of the page as shown, from its top-left corner:
 * each run's baseline, length and font height carried through the page's own transform, so a
 * rotated page or run gives the box a reader sees.
 */
export function pageTextRuns(
  viewport: TextViewport,
  items: readonly object[],
  limit: number,
): PageText[] {
  const unit = (value: number) => Math.max(0, Math.min(1, Number(value.toFixed(4))));
  const runs: PageText[] = [];
  for (const item of items) {
    if (runs.length >= limit) break;
    if (!isRun(item) || !item.str.trim()) continue;
    const [a, b, c, d, x, y] = compose(viewport.transform, item.transform);
    const angle = Math.atan2(b!, a!);
    const height = Math.hypot(c!, d!) || item.height;
    const along = [Math.cos(angle), Math.sin(angle)] as const;
    // up from the baseline, in a picture whose y runs down
    const up = [Math.sin(angle), -Math.cos(angle)] as const;
    const corners = [
      [0, -0.25],
      [item.width, -0.25],
      [0, 1],
      [item.width, 1],
    ].map(([length, rise]) => [
      x! + along[0] * length! + up[0] * rise! * height,
      y! + along[1] * length! + up[1] * rise! * height,
    ]);
    const xs = corners.map(([px]) => px! / viewport.width),
      ys = corners.map(([, py]) => py! / viewport.height);
    runs.push({
      text: item.str.slice(0, 1000),
      box: [
        unit(Math.min(...xs)),
        unit(Math.min(...ys)),
        unit(Math.max(...xs)),
        unit(Math.max(...ys)),
      ],
    });
  }
  return runs;
}
