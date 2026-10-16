import type { FileEntry } from './contracts';
import {
  lensGroupTree,
  unsortedName,
  type Lens,
  type LensGroup,
  type LensPoint,
  type LensRect,
  type ResolvedLens,
} from './lenses';

/** Map units are CSS pixels at 100% zoom. Places snap to an 8-unit grid. */
export const mapGrid = 8;
export const mapTile = { width: 96, height: 88 } as const;
export const mapCell = {
  width: mapTile.width + mapGrid,
  height: mapTile.height + mapGrid,
} as const;
export const mapRegionChrome = { header: 32, padding: 12 } as const;
const rootColumns = 16;

export interface MapTile {
  entry: FileEntry;
  group: string | null;
  /** Absolute map position. */
  x: number;
  y: number;
  /** Position inside its region's content, as stored or as laid out. */
  local: LensPoint;
  manual: boolean;
}
export interface MapRegion {
  /** null is Unsorted. */
  id: string | null;
  name: string;
  parent: string | null;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Absolute origin of the region's content, where member places start. */
  contentX: number;
  contentY: number;
  /** Position and size inside the parent's content (or the map), for edits that move it. */
  local: LensRect;
  /** Whether a stored rectangle fixes its place and width. */
  placed: boolean;
  /** Unsorted in a lens without groups is the whole map and draws no frame. */
  bare: boolean;
  count: number;
}
export interface MapLayout {
  regions: MapRegion[];
  tiles: MapTile[];
  width: number;
  height: number;
  byPath: Map<string, MapTile>;
}

export const snap = (value: number) => Math.round(value / mapGrid) * mapGrid;
const overlaps = (a: LensRect, b: LensRect) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** Cell occupancy for one region's content; stored places block the cells they touch. */
class Cells {
  private rows: Uint8Array[] = [];
  constructor(readonly columns: number) {}
  private row(index: number) {
    while (this.rows.length <= index) this.rows.push(new Uint8Array(this.columns));
    return this.rows[index]!;
  }
  block(rect: LensRect) {
    const left = Math.max(0, Math.floor(rect[0] / mapCell.width)),
      right = Math.min(this.columns - 1, Math.ceil((rect[0] + rect[2]) / mapCell.width) - 1),
      top = Math.max(0, Math.floor(rect[1] / mapCell.height)),
      bottom = Math.ceil((rect[1] + rect[3]) / mapCell.height) - 1;
    for (let y = top; y <= bottom; y++) {
      const row = this.row(y);
      for (let x = left; x <= right; x++) row[x] = 1;
    }
  }
  /** Claims the first free span of cells, row by row, and returns its map position. */
  take(width: number, height: number): [number, number] {
    const columns = Math.min(Math.ceil(width / mapCell.width), this.columns),
      rows = Math.ceil(height / mapCell.height);
    for (let y = 0; ; y++)
      for (let x = 0; x + columns <= this.columns; x++) {
        let free = true;
        for (let dy = 0; dy < rows && free; dy++) {
          const row = this.row(y + dy);
          for (let dx = 0; dx < columns && free; dx++) if (row[x + dx]) free = false;
        }
        if (free) {
          for (let dy = 0; dy < rows; dy++) this.row(y + dy).fill(1, x, x + columns);
          return [x * mapCell.width, y * mapCell.height];
        }
      }
  }
}

interface Measured {
  id: string | null;
  name: string;
  parent: string | null;
  depth: number;
  rect: LensRect | undefined;
  bare: boolean;
  count: number;
  width: number;
  height: number;
  /** Positions relative to this region's content. */
  children: { region: Measured; x: number; y: number }[];
  tiles: { entry: FileEntry; x: number; y: number; manual: boolean }[];
}
const autoColumns = (count: number) => Math.min(8, Math.max(3, Math.ceil(Math.sqrt(count * 1.5))));

/**
 * Lays out a resolved lens. Stored places never move; unplaced items and regions fill free cells
 * in order, and a region grows downward to hold them. The result depends only on its inputs, so
 * automatic positions need no storage.
 */
export function layoutLens(lens: Lens, resolved: ResolvedLens): MapLayout {
  const tree = lensGroupTree(lens);
  const children = new Map<string | null, LensGroup[]>();
  for (const { group } of tree) {
    const list = children.get(group.parent ?? null) ?? [];
    list.push(group);
    children.set(group.parent ?? null, list);
  }
  const members = new Map(resolved.sections.map((section) => [section.id, section.entries]));
  const bareMap = !tree.length;
  const measure = (
    id: string | null,
    name: string,
    depth: number,
    parent: string | null,
    rect: LensRect | undefined,
    /** Content width of a parent whose width is fixed; automatic regions stay inside it. */
    available?: number,
  ): Measured => {
    const entries = members.get(id) ?? [];
    const bare = bareMap && id === null;
    const padding = bare ? 0 : mapRegionChrome.padding,
      header = bare ? 0 : mapRegionChrome.header;
    const fixed = rect
      ? Math.ceil(Math.max(mapCell.width, rect[2] - padding * 2) / mapGrid) * mapGrid
      : undefined;
    const nested = (id === null ? [] : (children.get(id) ?? [])).map((group) =>
      measure(group.id, group.name, depth + 1, id, group.rect, fixed),
    );
    const fit = (columns: number) =>
      available === undefined
        ? columns
        : Math.max(1, Math.min(columns, Math.floor((available - padding * 2) / mapCell.width)));
    const placed: { entry: FileEntry; at: LensPoint }[] = [];
    const loose: FileEntry[] = [];
    for (const entry of entries) {
      const at = resolved.placements.get(entry.path)?.at;
      if (at) placed.push({ entry, at: [Math.max(0, at[0]), Math.max(0, at[1])] });
      else loose.push(entry);
    }
    const contentWidth =
      fixed ??
      Math.ceil(
        Math.max(
          fit(bare ? Math.max(6, autoColumns(entries.length)) : autoColumns(entries.length)) *
            mapCell.width,
          ...nested.map((box) => (box.rect ? box.rect[0] : 0) + box.width),
          ...placed.map(({ at }) => at[0] + mapTile.width),
        ) / mapGrid,
      ) * mapGrid;
    const cells = new Cells(Math.max(1, Math.floor(contentWidth / mapCell.width)));
    const childPlaces: Measured['children'] = [];
    const tiles: Measured['tiles'] = [];
    // Stored places first, so automatic ones flow around them.
    for (const box of nested)
      if (box.rect) {
        cells.block([box.rect[0], box.rect[1], box.width, box.height]);
        childPlaces.push({ region: box, x: box.rect[0], y: box.rect[1] });
      }
    for (const { entry, at } of placed) {
      cells.block([at[0], at[1], mapTile.width, mapTile.height]);
      tiles.push({ entry, x: at[0], y: at[1], manual: true });
    }
    for (const box of nested)
      if (!box.rect) {
        const [x, y] = cells.take(box.width + mapGrid, box.height + mapGrid);
        childPlaces.push({ region: box, x, y });
      }
    for (const entry of loose) {
      const [x, y] = cells.take(mapTile.width, mapTile.height);
      tiles.push({ entry, x, y, manual: false });
    }
    const contentHeight = Math.max(
      mapCell.height,
      ...childPlaces.map((child) => child.y + child.region.height),
      ...tiles.map((tile) => tile.y + mapTile.height),
    );
    return {
      id,
      name,
      parent,
      depth,
      rect,
      bare,
      count: entries.length,
      width: contentWidth + padding * 2,
      height: Math.max(rect?.[3] ?? 0, header + padding * 2 + contentHeight),
      children: childPlaces,
      tiles,
    };
  };
  const roots = [
    ...(children.get(null) ?? []).map((group) =>
      measure(group.id, group.name, 0, null, group.rect),
    ),
    measure(null, unsortedName(lens), 0, null, lens.unsorted?.rect),
  ];
  const cells = new Cells(
    Math.max(rootColumns, ...roots.map((box) => Math.ceil(box.width / mapCell.width) + 1)),
  );
  const places: { region: Measured; x: number; y: number }[] = [];
  for (const box of roots)
    if (box.rect) {
      cells.block([box.rect[0], box.rect[1], box.width, box.height]);
      places.push({ region: box, x: box.rect[0], y: box.rect[1] });
    }
  for (const box of roots)
    if (!box.rect) {
      const [x, y] = cells.take(box.width + mapGrid, box.height + mapGrid);
      places.push({ region: box, x, y });
    }
  const regions: MapRegion[] = [];
  const tiles: MapTile[] = [];
  const flatten = (box: Measured, x: number, y: number, originX: number, originY: number) => {
    const padding = box.bare ? 0 : mapRegionChrome.padding,
      header = box.bare ? 0 : mapRegionChrome.header;
    const contentX = x + padding,
      contentY = y + header + padding;
    regions.push({
      id: box.id,
      name: box.name,
      parent: box.parent,
      depth: box.depth,
      x,
      y,
      width: box.width,
      height: box.height,
      contentX,
      contentY,
      local: [x - originX, y - originY, box.width, box.height],
      placed: !!box.rect,
      bare: box.bare,
      count: box.count,
    });
    for (const tile of box.tiles)
      tiles.push({
        entry: tile.entry,
        group: box.id,
        x: contentX + tile.x,
        y: contentY + tile.y,
        local: [tile.x, tile.y],
        manual: tile.manual,
      });
    for (const child of box.children)
      flatten(child.region, contentX + child.x, contentY + child.y, contentX, contentY);
  };
  for (const { region, x, y } of places) flatten(region, x, y, 0, 0);
  return {
    regions,
    tiles,
    width: Math.max(0, ...regions.map((region) => region.x + region.width)),
    height: Math.max(0, ...regions.map((region) => region.y + region.height)),
    byPath: new Map(tiles.map((tile) => [tile.entry.path, tile])),
  };
}

/** The innermost region containing a map point. */
export function regionAt(layout: MapLayout, x: number, y: number): MapRegion | undefined {
  let found: MapRegion | undefined;
  for (const region of layout.regions)
    if (
      x >= region.x &&
      x < region.x + region.width &&
      y >= region.y &&
      y < region.y + region.height &&
      (!found || region.depth >= found.depth)
    )
      found = region;
  return found;
}
/** Whether group `id` is `ancestor` or nested inside it. */
export function withinGroup(lens: Lens, id: string | null, ancestor: string): boolean {
  const groups = new Map(lens.groups.map((group) => [group.id, group]));
  let steps = 0;
  for (let current = id ?? undefined; current !== undefined && steps++ < 16;) {
    if (current === ancestor) return true;
    current = groups.get(current)?.parent;
  }
  return false;
}
/** A place inside `region`'s content for an item whose top-left lands at (x, y). */
export function placeIn(region: MapRegion, x: number, y: number): LensPoint {
  return [Math.max(0, snap(x - region.contentX)), Math.max(0, snap(y - region.contentY))];
}

export type MapDirection = 'left' | 'right' | 'up' | 'down';
/** The nearest tile in a direction; distance along the other axis counts double. */
export function nearestTile(
  layout: MapLayout,
  from: string | undefined,
  direction: MapDirection,
): MapTile | undefined {
  const origin = from ? layout.byPath.get(from) : undefined;
  if (!origin) {
    const ordered = layout.tiles.toSorted((a, b) => a.y - b.y || a.x - b.x);
    return direction === 'up' || direction === 'left' ? ordered.at(-1) : ordered[0];
  }
  let best: MapTile | undefined,
    score = Infinity;
  for (const tile of layout.tiles) {
    if (tile === origin) continue;
    const dx = tile.x - origin.x,
      dy = tile.y - origin.y;
    const [along, across] =
      direction === 'left'
        ? [-dx, dy]
        : direction === 'right'
          ? [dx, dy]
          : direction === 'up'
            ? [-dy, dx]
            : [dy, dx];
    if (along <= 0) continue;
    const value = along + Math.abs(across) * 2;
    if (value < score) {
      score = value;
      best = tile;
    }
  }
  return best;
}

/** Tiles in fixed-size buckets, so a viewport only touches nearby ones. */
export class MapIndex {
  private buckets = new Map<string, MapTile[]>();
  constructor(
    readonly layout: MapLayout,
    private size = 512,
  ) {
    for (const tile of layout.tiles)
      for (const key of this.keys([tile.x, tile.y, mapTile.width, mapTile.height])) {
        const list = this.buckets.get(key) ?? [];
        list.push(tile);
        this.buckets.set(key, list);
      }
  }
  private *keys(rect: LensRect) {
    const right = Math.floor((rect[0] + rect[2]) / this.size),
      bottom = Math.floor((rect[1] + rect[3]) / this.size);
    for (let x = Math.floor(rect[0] / this.size); x <= right; x++)
      for (let y = Math.floor(rect[1] / this.size); y <= bottom; y++) yield `${x},${y}`;
  }
  /** Tiles overlapping `rect`, each once. */
  query(rect: LensRect): MapTile[] {
    const seen = new Set<MapTile>();
    for (const key of this.keys(rect))
      for (const tile of this.buckets.get(key) ?? [])
        if (overlaps(rect, [tile.x, tile.y, mapTile.width, mapTile.height])) seen.add(tile);
    return [...seen];
  }
}
