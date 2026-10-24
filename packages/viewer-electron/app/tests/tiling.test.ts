/**
 * TILING (2026-10-23): planes laid out face-on in the space's area as tmux lays out panes, by layout
 * (even across, even down, a main one beside or above the rest, a grid), with gutters between.
 */
import { describe, expect, it } from 'vitest';
import { nextLayout, tileRects, type TileLayout } from '../src/domain/workspaces/tiling';

const area = { width: 1212, height: 812 };
const round = (rects: { x: number; y: number; width: number; height: number }[]) =>
  rects.map(({ x, y, width, height }) => [x, y, width, height].map(Math.round));

describe('tile rectangles', () => {
  it('lays planes across or down in even shares, gutters between', () => {
    expect(round(tileRects(3, 'even-horizontal', area))).toEqual([
      [0, 0, 396, 812],
      [408, 0, 396, 812],
      [816, 0, 396, 812],
    ]);
    expect(round(tileRects(2, 'even-vertical', area))).toEqual([
      [0, 0, 1212, 400],
      [0, 412, 1212, 400],
    ]);
  });
  it('gives the main plane its share and stacks the rest beside or below it', () => {
    expect(round(tileRects(3, 'main-vertical', area, 0.5))).toEqual([
      [0, 0, 600, 812],
      [612, 0, 600, 400],
      [612, 412, 600, 400],
    ]);
    expect(round(tileRects(3, 'main-horizontal', area, 0.5))).toEqual([
      [0, 0, 1212, 400],
      [0, 412, 600, 400],
      [612, 412, 600, 400],
    ]);
  });
  it('makes a grid of the rest, the last row filling its width', () => {
    const rects = round(tileRects(5, 'tiled', area));
    expect(rects).toHaveLength(5);
    expect(rects.slice(0, 3).map((rect) => rect[1])).toEqual([0, 0, 0]);
    // three across, then two sharing the whole width
    expect(rects.slice(3).map((rect) => rect[2])).toEqual([600, 600]);
  });
  it('fills the area with one plane, whatever the layout', () => {
    for (const layout of ['even-horizontal', 'main-vertical', 'tiled'] as TileLayout[])
      expect(round(tileRects(1, layout, area))).toEqual([[0, 0, 1212, 812]]);
  });
  it('steps through the layouts in turn', () => {
    expect(nextLayout('even-horizontal')).toBe('even-vertical');
    expect(nextLayout('tiled')).toBe('even-horizontal');
  });
});
