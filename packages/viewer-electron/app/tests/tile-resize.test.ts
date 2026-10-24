import { describe, expect, it } from 'vitest';
import {
  resizeTile,
  tileLayouts,
  tileSplitSchema,
  tileTree,
  tilingRects,
  type Tiling,
} from '../src/domain/workspaces/tiling';

describe('individual tile resize', () => {
  it('grows a secondary tile toward either neighboring boundary without changing the outside edges', () => {
    const tiling: Tiling = { panes: ['a', 'b', 'c'], layout: 'main-vertical', main: 0.6 };
    const area = { width: 1200, height: 800 };
    const initial = tilingRects(tiling, area);
    const left = tilingRects(resizeTile(tiling, 'c', 'left'), area);
    expect(left[2]!.width).toBeGreaterThan(initial[2]!.width);
    expect(left[2]!.x + left[2]!.width).toBeCloseTo(1200);
    const up = tilingRects(resizeTile(tiling, 'c', 'up'), area);
    expect(up[2]!.height).toBeGreaterThan(initial[2]!.height);
    expect(up[2]!.y + up[2]!.height).toBeCloseTo(800);
    expect(resizeTile(tiling, 'a', 'left')).toBe(tiling);
    expect(resizeTile(tiling, 'a', 'up')).toBe(tiling);
  });

  it('keeps every preset and 30-plane split tree bounded and serializable after repeated resizing', () => {
    for (const layout of tileLayouts) {
      let tiling: Tiling = {
        panes: Array.from({ length: 30 }, (_, index) => String(index)),
        layout,
        main: 0.6,
      };
      expect(tileSplitSchema.safeParse(tileTree(tiling.panes, layout)).success).toBe(true);
      for (let index = 0; index < 50; index++) tiling = resizeTile(tiling, '15', 'left');
      expect(tileSplitSchema.safeParse(tiling.tree ?? tileTree(tiling.panes, layout)).success).toBe(
        true,
      );
      const rectangles = tilingRects(tiling, { width: 1600, height: 1000 });
      for (const rect of rectangles) {
        expect(rect.width).toBeGreaterThanOrEqual(0);
        expect(rect.height).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(1600.001);
        expect(rect.y + rect.height).toBeLessThanOrEqual(1000.001);
      }
    }
  });
});
