/**
 * TILING: planes laid out face-on in the space's area as tmux lays out a window's panes,
 * by its layouts: even across, even down, a main plane beside or above the rest, or a grid.
 */
import { z } from 'zod';
export type TileSplit =
  { pane: string } | { axis: 'x' | 'y'; ratio: number; first: TileSplit; second: TileSplit };
export const tileSplitSchema = z.custom<TileSplit>((value) => {
  let count = 0;
  const leaves = new Set<string>();
  const valid = (node: unknown, depth: number): boolean => {
    if (++count > 59 || depth > 30 || !node || typeof node !== 'object') return false;
    const item = node as Record<string, unknown>;
    if ('pane' in item) {
      if (
        Object.keys(item).length !== 1 ||
        typeof item.pane !== 'string' ||
        !item.pane.length ||
        item.pane.length > 200 ||
        leaves.has(item.pane)
      )
        return false;
      leaves.add(item.pane);
      return true;
    }
    return (
      Object.keys(item).length === 4 &&
      (item.axis === 'x' || item.axis === 'y') &&
      typeof item.ratio === 'number' &&
      Number.isFinite(item.ratio) &&
      item.ratio >= 0.001 &&
      item.ratio <= 0.999 &&
      valid(item.first, depth + 1) &&
      valid(item.second, depth + 1)
    );
  };
  return valid(value, 0);
}, 'Invalid or oversized tile split tree.');
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
  tree?: TileSplit;
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

/** Presets are slicing layouts; changing a boundary preserves their topology. */
export function tileTree(
  panes: readonly string[],
  layout: TileLayout,
  main = 0.6,
): TileSplit | undefined {
  const sequence = (items: TileSplit[], axis: 'x' | 'y'): TileSplit | undefined => {
    if (items.length < 2) return items[0];
    return {
      axis,
      ratio: 1 / items.length,
      first: items[0]!,
      second: sequence(items.slice(1), axis)!,
    };
  };
  const leaves = panes.map((pane) => ({ pane }));
  if (panes.length < 2) return leaves[0];
  if (layout === 'even-horizontal' || layout === 'even-vertical')
    return sequence(leaves, layout === 'even-horizontal' ? 'x' : 'y');
  if (layout === 'main-horizontal' || layout === 'main-vertical')
    return {
      axis: layout === 'main-vertical' ? 'x' : 'y',
      ratio: main,
      first: leaves[0]!,
      second: sequence(leaves.slice(1), layout === 'main-vertical' ? 'y' : 'x')!,
    };
  const columns = Math.ceil(Math.sqrt(panes.length));
  const rows: TileSplit[] = [];
  for (let i = 0; i < leaves.length; i += columns)
    rows.push(sequence(leaves.slice(i, i + columns), 'x')!);
  return sequence(rows, 'y');
}

export function pruneTileTree(tree: TileSplit, panes: ReadonlySet<string>): TileSplit | undefined {
  if ('pane' in tree) return panes.has(tree.pane) ? tree : undefined;
  const first = pruneTileTree(tree.first, panes),
    second = pruneTileTree(tree.second, panes);
  return first && second ? { ...tree, first, second } : (first ?? second);
}
export function tilingRects(
  tiling: Tiling,
  area: { width: number; height: number },
  gap = 12,
): TileRect[] {
  let tree = tiling.tree && pruneTileTree(tiling.tree, new Set(tiling.panes));
  const members = (node: TileSplit): string[] =>
    'pane' in node ? [node.pane] : [...members(node.first), ...members(node.second)];
  if (tree && members(tree).length !== tiling.panes.length) tree = undefined;
  if (!tree) return tileRects(tiling.panes.length, tiling.layout, area, tiling.main, gap);
  interface Requirement {
    width: number;
    height: number;
    horizontalGaps: number;
    verticalGaps: number;
  }
  const requirements = new Map<TileSplit, Requirement>();
  const measure = (node: TileSplit): Requirement => {
    if ('pane' in node) {
      const leaf = { width: 120, height: 72, horizontalGaps: 0, verticalGaps: 0 };
      requirements.set(node, leaf);
      return leaf;
    }
    const first = measure(node.first);
    const second = measure(node.second);
    const value =
      node.axis === 'x'
        ? {
            width: first.width + second.width,
            height: Math.max(first.height, second.height),
            horizontalGaps: first.horizontalGaps + second.horizontalGaps + 1,
            verticalGaps: Math.max(first.verticalGaps, second.verticalGaps),
          }
        : {
            width: Math.max(first.width, second.width),
            height: first.height + second.height,
            horizontalGaps: Math.max(first.horizontalGaps, second.horizontalGaps),
            verticalGaps: first.verticalGaps + second.verticalGaps + 1,
          };
    requirements.set(node, value);
    return value;
  };
  const minimum = measure(tree);
  // Crowded layouts reduce their minimums and gutters together, preserving every outside edge.
  const scale = Math.max(
    0,
    Math.min(
      1,
      area.width / (minimum.width + minimum.horizontalGaps * gap),
      area.height / (minimum.height + minimum.verticalGaps * gap),
    ),
  );
  const gutter = gap * scale;
  const result = new Map<string, TileRect>();
  const visit = (node: TileSplit, rect: TileRect) => {
    if ('pane' in node) {
      result.set(node.pane, rect);
      return;
    }
    const a = requirements.get(node.first)!;
    const b = requirements.get(node.second)!;
    const horizontal = node.axis === 'x';
    const gapsA = horizontal ? a.horizontalGaps : a.verticalGaps;
    const gapsB = horizontal ? b.horizontalGaps : b.verticalGaps;
    const extent = horizontal ? rect.width : rect.height;
    const content = Math.max(0, extent - gutter * (gapsA + gapsB + 1));
    const minimumA = (horizontal ? a.width : a.height) * scale + gapsA * gutter;
    const minimumB = (horizontal ? b.width : b.height) * scale + gapsB * gutter;
    const first = Math.max(
      minimumA,
      Math.min(extent - gutter - minimumB, content * node.ratio + gapsA * gutter),
    );
    const second = Math.max(0, extent - gutter - first);
    visit(node.first, { ...rect, ...(node.axis === 'x' ? { width: first } : { height: first }) });
    visit(node.second, {
      ...rect,
      ...(node.axis === 'x'
        ? { x: rect.x + first + gutter, width: second }
        : { y: rect.y + first + gutter, height: second }),
    });
  };
  visit(tree, { x: 0, y: 0, width: area.width, height: area.height });
  return tiling.panes.map((id) => result.get(id) ?? { x: 0, y: 0, width: 0, height: 0 });
}

/** Keep controls usable inside each plane; the camera fits the larger arrangement. */
export function readableTiling(tiling: Tiling, area: { width: number; height: number }) {
  const initial = tilingRects(tiling, area);
  const expansion = Math.max(
    1,
    ...initial.map((rect) =>
      Math.max(420 / Math.max(1, rect.width), 260 / Math.max(1, rect.height)),
    ),
  );
  const size = { width: area.width * expansion, height: area.height * expansion };
  return { rects: tilingRects(tiling, size), scale: 1 / expansion };
}
/** Grow the active tile toward a neighbor; outside edges stay fixed. */
export function resizeTile(
  tiling: Tiling,
  pane: string,
  direction: 'left' | 'right' | 'up' | 'down',
  amount = 1 / 12,
): Tiling {
  if (!tiling.panes.includes(pane)) return tiling;
  const tree = tiling.tree ?? tileTree(tiling.panes, tiling.layout, tiling.main);
  if (!tree) return tiling;
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const growFirst = direction === 'right' || direction === 'down';
  const contains = (node: TileSplit): boolean =>
    'pane' in node ? node.pane === pane : contains(node.first) || contains(node.second);
  const change = (node: TileSplit): TileSplit | undefined => {
    if ('pane' in node) return undefined;
    const first = contains(node.first),
      child = change(first ? node.first : node.second);
    if (child) return { ...node, ...(first ? { first: child } : { second: child }) };
    if (node.axis !== axis || first !== growFirst) return undefined;
    const ratio = Math.max(0.1, Math.min(0.9, node.ratio + (first ? amount : -amount)));
    return ratio === node.ratio ? undefined : { ...node, ratio };
  };
  const next = change(tree);
  return next ? { ...tiling, tree: next } : tiling;
}
