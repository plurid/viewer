import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import { emptyLens, resolveLens, type Lens } from '../src/domain/lenses';
import {
  dropRegion,
  layoutLens,
  MapIndex,
  mapTile,
  nearestTile,
  placeIn,
  regionAt,
  withinGroup,
  type MapLayout,
} from '../src/domain/lens-layout';

const entry = (name: string): FileEntry => ({
  path: `/Part/${name}`,
  name,
  parent: '/Part',
  extension: 'step',
  kind: 'file',
  directory: false,
  size: 1,
  modified: 1,
  created: 1,
  hidden: false,
  mime: '',
  identity: `1:${name}`,
});
const names = (count: number) => Array.from({ length: count }, (_, index) => `part-${index}`);
const layout = (lens: Lens, items: string[]) =>
  layoutLens(lens, resolveLens(lens, items.map(entry)));
const base = emptyLens('0b6c3f3e-2a5e-4a8e-9a43-0d1c2b3a4f5e', 'Assembly');
function overlapping(map: MapLayout) {
  const boxes = map.tiles.map((tile) => [tile.x, tile.y]);
  for (const [index, [x, y]] of boxes.entries())
    for (const [ax, ay] of boxes.slice(index + 1))
      if (Math.abs(ax! - x!) < mapTile.width && Math.abs(ay! - y!) < mapTile.height) return true;
  return false;
}

describe('map layout', () => {
  it('fills a lens without groups as a bare map with no overlaps', () => {
    const map = layout(base, names(40));
    expect(map.regions).toHaveLength(1);
    expect(map.regions[0]).toMatchObject({ id: null, bare: true, x: 0, y: 0 });
    expect(map.tiles).toHaveLength(40);
    expect(overlapping(map)).toBe(false);
  });
  it('keeps stored places and flows new items around them', () => {
    const lens: Lens = {
      ...base,
      members: [
        { name: 'part-0', at: [0, 0] },
        { name: 'part-1', at: [208, 96] },
      ],
    };
    const before = layout(lens, names(6));
    const after = layout(lens, names(30));
    for (const name of ['part-0', 'part-1'])
      expect(after.byPath.get(`/Part/${name}`)).toMatchObject(before.byPath.get(`/Part/${name}`)!);
    expect(after.byPath.get('/Part/part-1')?.local).toEqual([208, 96]);
    expect(overlapping(after)).toBe(false);
  });
  it('puts places relative to their region, so moving a region carries its items', () => {
    const lens = (rect: [number, number, number, number]): Lens => ({
      ...base,
      groups: [{ id: 'gaaaaa', name: 'Frame', order: 0, rect }],
      members: [{ name: 'part-0', group: 'gaaaaa', at: [16, 16] }],
    });
    const a = layout(lens([0, 0, 400, 300]), names(3));
    const b = layout(lens([800, 400, 400, 300]), names(3));
    const tileA = a.byPath.get('/Part/part-0')!,
      tileB = b.byPath.get('/Part/part-0')!;
    expect(tileB.x - tileA.x).toBe(800);
    expect(tileB.y - tileA.y).toBe(400);
    expect(tileB.local).toEqual([16, 16]);
    const region = b.regions.find((item) => item.id === 'gaaaaa')!;
    expect(region.local).toEqual([800, 400, 400, 300]);
    expect(regionAt(b, tileB.x + 1, tileB.y + 1)?.id).toBe('gaaaaa');
    expect(placeIn(region, tileB.x, tileB.y)).toEqual([16, 16]);
  });
  it('nests regions, grows them to fit, and puts Unsorted after the groups', () => {
    const lens: Lens = {
      ...base,
      groups: [
        { id: 'gaaaaa', name: 'Frame', order: 0, rect: [0, 0, 240, 120] },
        { id: 'gbbbbb', name: 'Bolts', order: 0, parent: 'gaaaaa' },
      ],
      members: names(12).map((name, index) => ({
        name,
        group: index < 8 ? 'gbbbbb' : 'gaaaaa',
      })),
    };
    const map = layout(lens, [...names(12), 'loose']);
    const frame = map.regions.find((item) => item.id === 'gaaaaa')!;
    const bolts = map.regions.find((item) => item.id === 'gbbbbb')!;
    expect(bolts.depth).toBe(1);
    expect(bolts.x).toBeGreaterThanOrEqual(frame.contentX);
    expect(frame.height).toBeGreaterThan(120);
    expect(bolts.y + bolts.height).toBeLessThanOrEqual(frame.y + frame.height);
    expect(regionAt(map, bolts.x + 4, bolts.y + 4)?.id).toBe('gbbbbb');
    expect(withinGroup(lens, 'gbbbbb', 'gaaaaa')).toBe(true);
    expect(withinGroup(lens, 'gaaaaa', 'gbbbbb')).toBe(false);
    expect(map.regions.at(-1)?.id).toBeNull();
    expect(map.regions.at(-1)?.count).toBe(1);
    expect(overlapping(map)).toBe(false);
  });
  it('finds neighbours by direction and indexes thousands of tiles', () => {
    const map = layout(base, names(5000));
    const index = new MapIndex(map);
    const visible = index.query([0, 0, 1200, 800]);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(200);
    const first = map.tiles.find((tile) => tile.x === 0 && tile.y === 0)!;
    const right = nearestTile(map, first.entry.path, 'right')!;
    expect(right.y).toBe(first.y);
    expect(right.x).toBeGreaterThan(first.x);
    expect(nearestTile(map, first.entry.path, 'up')).toBeUndefined();
  });
});
describe('dropping tiles (2026-10-20)', () => {
  it('places a drop beyond a bare map’s tiles on the map, and finds no group in a grouped map’s gaps', () => {
    // A drop outside every region was silently ignored.
    const bare = layout(base, names(3));
    expect(dropRegion(bare, bare.width + 100, 10)?.id).toBeNull();
    const grouped = layout(
      { ...base, groups: [{ id: 'gaaaaa', name: 'Bolts', order: 0 }] },
      names(3),
    );
    expect(dropRegion(grouped, grouped.width + 100, 10)).toBeUndefined();
    const unsorted = grouped.regions.find((region) => region.id === null)!;
    expect(dropRegion(grouped, unsorted.x + 4, unsorted.y + 4)?.id).toBeNull();
  });
});
