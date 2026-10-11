import { describe, expect, it } from 'vitest';
import { projectedLocalX, type Point } from '../src/renderer/ui/projectedResize';

describe('sidebar resize in plane coordinates', () => {
  it('keeps the same local drag under scale, rotation and perspective', () => {
    for (const [a, b, c, d, e, f, g, h] of [
      [210, 0, 40, 0, 400, 20, 0, 0],
      [73.5, -50, 40, 40, 140, 20, 0, 0],
      [170, -20, 400, 10, 360, 100, 0.4, -0.1],
      [-160, 20, 800, 70, 200, 60, -0.2, 0.2],
    ]) {
      const project = (u: number, v: number): Point => ({
        x: (a * u + b * v + c) / (g * u + h * v + 1),
        y: (d * u + e * v + f) / (g * u + h * v + 1),
      });
      const localX = projectedLocalX(
        [project(0, 0), project(1, 0), project(1, 1), project(0, 1)],
        210,
      );
      expect(localX(project(0.5, 0.7))).toBeCloseTo(105);
      expect(localX(project(1.2, 0.4))! - localX(project(0.9, 0.4))!).toBeCloseTo(63);
    }
  });
  it('does not return an invalid width for an edge-on plane', () => {
    expect(
      projectedLocalX(
        [
          { x: 1, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 100 },
          { x: 1, y: 100 },
        ],
        210,
      )({ x: 1, y: 50 }),
    ).toBeUndefined();
  });
});
