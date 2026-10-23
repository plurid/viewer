/**
 * TILING (2026-10-23): planes laid out face-on in the space's area as tmux lays out a window's panes,
 * by its layouts: even across, even down, a main plane beside or above the rest, or a grid.
 */
export const tileLayouts = [
  'even-horizontal',
  'even-vertical',
  'main-vertical',
  'main-horizontal',
  'tiled',
] as const;
export type TileLayout = (typeof tileLayouts)[number];
export const tileLayoutLabels: Record<TileLayout, string> = {
  'even-horizontal': 'Side by side',
  'even-vertical': 'Stacked',
  'main-vertical': 'Main beside the rest',
  'main-horizontal': 'Main above the rest',
  tiled: 'Grid',
};
/** A workspace's tiling: its planes in order, the layout, and the main plane's share. */
export interface Tiling {
  panes: string[];
  layout: TileLayout;
  /** The main plane's share of the width or height, for the main layouts: 0.2–0.8. */
  main: number;
}
export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const nextLayout = (layout: TileLayout): TileLayout =>
  tileLayouts[(tileLayouts.indexOf(layout) + 1) % tileLayouts.length]!;
/** `count` shares of `length`, `gap` apart. */
const shares = (length: number, count: number, gap: number) => {
  const size = (length - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({ at: index * (size + gap), size }));
};
/** Each plane's rectangle in the area, from its top left, in the tiling's order. */
export function tileRects(
  count: number,
  layout: TileLayout,
  area: { width: number; height: number },
  main = 0.6,
  gap = 12,
): TileRect[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0, width: area.width, height: area.height }];
  if (layout === 'even-horizontal')
    return shares(area.width, count, gap).map(({ at, size }) => ({
      x: at,
      y: 0,
      width: size,
      height: area.height,
    }));
  if (layout === 'even-vertical')
    return shares(area.height, count, gap).map(({ at, size }) => ({
      x: 0,
      y: at,
      width: area.width,
      height: size,
    }));
  if (layout === 'main-vertical') {
    const width = (area.width - gap) * main;
    return [
      { x: 0, y: 0, width, height: area.height },
      ...shares(area.height, count - 1, gap).map(({ at, size }) => ({
        x: width + gap,
        y: at,
        width: area.width - width - gap,
        height: size,
      })),
    ];
  }
  if (layout === 'main-horizontal') {
    const height = (area.height - gap) * main;
    return [
      { x: 0, y: 0, width: area.width, height },
      ...shares(area.width, count - 1, gap).map(({ at, size }) => ({
        x: at,
        y: height + gap,
        width: size,
        height: area.height - height - gap,
      })),
    ];
  }
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const heights = shares(area.height, rows, gap);
  return Array.from({ length: rows }).flatMap((_, row) => {
    const inRow = Math.min(columns, count - row * columns);
    return shares(area.width, inRow, gap).map(({ at, size }) => ({
      x: at,
      y: heights[row]!.at,
      width: size,
      height: heights[row]!.size,
    }));
  });
}
