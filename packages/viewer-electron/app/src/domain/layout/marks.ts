/** Captions, crop marks and cut lines, as plan items. */
import { overlaps, roundLength } from './geometry';
import type { Rect } from './geometry';
import { layoutLimits } from './plan';
import type { LayoutItem } from './plan';
import type { TextWeight } from './helvetica';

export function textItem(
  text: string,
  x: number,
  y: number,
  size: number,
  options: {
    align?: 'start' | 'center' | 'end';
    weight?: TextWeight;
    color?: string;
    maxWidth?: number;
  } = {},
): LayoutItem {
  return {
    kind: 'text',
    // the writer shortens a line to its maxWidth, as the preview does (helvetica.ts)
    text: text.slice(0, layoutLimits.textLength),
    x: roundLength(x),
    y: roundLength(y),
    size,
    color: options.color ?? '#000000',
    align: options.align ?? 'start',
    weight: options.weight ?? 'regular',
    ...(options.maxWidth ? { maxWidth: roundLength(options.maxWidth) } : {}),
  };
}

/** A straight line from x1, y1 to x2, y2. */
export type Segment = [number, number, number, number];
export const markColor = '#000000';
export const guideColor = '#8a8a8a';
export function segmentItem(
  segment: Segment,
  options: { stroke?: string; lineWidth?: number; dash?: [number, number] } = {},
): LayoutItem {
  return {
    kind: 'path',
    points: segment.map(roundLength),
    closed: false,
    stroke: options.stroke ?? markColor,
    lineWidth: options.lineWidth ?? 0.25,
    ...(options.dash ? { dash: options.dash } : {}),
  };
}
const segmentBox = ([x1, y1, x2, y2]: Segment): Rect => ({
  x: Math.min(x1, x2),
  y: Math.min(y1, y2),
  width: Math.max(Math.abs(x2 - x1), 0.01),
  height: Math.max(Math.abs(y2 - y1), 0.01),
});
const inside = (segment: Segment, bounds: Rect) =>
  Math.min(segment[0], segment[2]) >= bounds.x - 1e-6 &&
  Math.max(segment[0], segment[2]) <= bounds.x + bounds.width + 1e-6 &&
  Math.min(segment[1], segment[3]) >= bounds.y - 1e-6 &&
  Math.max(segment[1], segment[3]) <= bounds.y + bounds.height + 1e-6;

/**
 * Crop marks: at each corner of each trimmed piece, two short lines `offset` outside it, pointing
 * away. A mark that would cross a piece, its own included, or leave `bounds` is left out, so
 * pieces placed edge to edge keep only the marks in the margin.
 */
export function cropMarks(
  trims: readonly Rect[],
  bounds: Rect,
  offset = 3,
  length = 8,
  keepClear: readonly Rect[] = trims,
): Segment[] {
  const marks: Segment[] = [];
  const seen = new Set<string>();
  for (const trim of trims) {
    const left = trim.x;
    const right = trim.x + trim.width;
    const top = trim.y;
    const bottom = trim.y + trim.height;
    const candidates: Segment[] = [
      [left - offset, top, left - offset - length, top],
      [left, top - offset, left, top - offset - length],
      [right + offset, top, right + offset + length, top],
      [right, top - offset, right, top - offset - length],
      [left - offset, bottom, left - offset - length, bottom],
      [left, bottom + offset, left, bottom + offset + length],
      [right + offset, bottom, right + offset + length, bottom],
      [right, bottom + offset, right, bottom + offset + length],
    ];
    for (const segment of candidates) {
      const key = segment.map((value) => value.toFixed(2)).join(',');
      if (
        seen.has(key) ||
        !inside(segment, bounds) ||
        keepClear.some((rect) => overlaps(segmentBox(segment), rect))
      )
        continue;
      seen.add(key);
      marks.push(segment);
    }
  }
  return marks;
}

/** Cut lines for pieces cut with shared edges: a tick in the margin, beyond the block of pieces,
 * at every edge a cut follows. */
export function cutTicks(trims: readonly Rect[], page: Rect, offset = 3, length = 12): Segment[] {
  if (!trims.length) return [];
  const left = Math.min(...trims.map((trim) => trim.x));
  const top = Math.min(...trims.map((trim) => trim.y));
  const right = Math.max(...trims.map((trim) => trim.x + trim.width));
  const bottom = Math.max(...trims.map((trim) => trim.y + trim.height));
  const unique = (values: number[]) =>
    [...new Map(values.map((value) => [value.toFixed(2), value])).values()].sort((a, b) => a - b);
  const xs = unique(trims.flatMap((trim) => [trim.x, trim.x + trim.width]));
  const ys = unique(trims.flatMap((trim) => [trim.y, trim.y + trim.height]));
  const clamp = (start: number, end: number, low: number, high: number): [number, number] => [
    Math.max(low, Math.min(high, start)),
    Math.max(low, Math.min(high, end)),
  ];
  const ticks: Segment[] = [];
  const add = (segment: Segment) => {
    if (Math.hypot(segment[2] - segment[0], segment[3] - segment[1]) >= 2) ticks.push(segment);
  };
  for (const x of xs) {
    const [aboveStart, aboveEnd] = clamp(top - offset, top - offset - length, page.y + 2, top);
    const [belowStart, belowEnd] = clamp(
      bottom + offset,
      bottom + offset + length,
      bottom,
      page.y + page.height - 2,
    );
    add([x, aboveStart, x, aboveEnd]);
    add([x, belowStart, x, belowEnd]);
  }
  for (const y of ys) {
    const [beforeStart, beforeEnd] = clamp(left - offset, left - offset - length, page.x + 2, left);
    const [afterStart, afterEnd] = clamp(
      right + offset,
      right + offset + length,
      right,
      page.x + page.width - 2,
    );
    add([beforeStart, y, beforeEnd, y]);
    add([afterStart, y, afterEnd, y]);
  }
  return ticks;
}
export function frameItem(rect: Rect, stroke = guideColor, lineWidth = 0.25): LayoutItem {
  return {
    kind: 'rect',
    frame: {
      x: roundLength(rect.x),
      y: roundLength(rect.y),
      width: roundLength(rect.width),
      height: roundLength(rect.height),
    },
    stroke,
    lineWidth,
  };
}
