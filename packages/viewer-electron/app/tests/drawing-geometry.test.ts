import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readDrawingGeometry } from '../src/desktop/drawing-geometry';
import { drawingGeometryPage, drawingGeometryOptionsSchema } from '../src/domain/drawing-geometry';
import { parseDrawing } from '../src/domain/dxf/geometry';
import { entity, dxf, panelDrawing } from './dxf-fixtures';
import { temporaryRoot, trashTemporary } from '../tools/temporary';
let root: string;
beforeEach(async () => {
  root = await temporaryRoot('viewer-drawing-geometry-');
});
afterEach(async () => {
  await trashTemporary(root);
});
describe('shared source-versioned drawing geometry', () => {
  it('returns exact panel bounds, measurements, declared units, source version and byte hash', async () => {
    const file = path.join(root, 'Panel.dxf');
    await writeFile(file, panelDrawing);
    const result = await readDrawingGeometry(file, { points: true });
    expect(result.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 200, y: 100 } });
    expect(result.units).toMatchObject({ code: 4, symbol: 'mm', millimetres: 1 });
    expect(result.contentHash).toBe(createHash('sha256').update(panelDrawing).digest('hex'));
    expect(result.version.size).toBe(Buffer.byteLength(panelDrawing));
    const circle = result.entities.find((item) => item.type === 'CIRCLE')!;
    expect(circle.radius).toBe(10);
    expect(circle.length).toBeCloseTo(20 * Math.PI);
    expect(circle.area).toBeCloseTo(100 * Math.PI);
    expect(
      result.entities
        .filter((item) => item.type === 'LINE')
        .every((item) => !item.closed && item.area === undefined),
    ).toBe(true);
    expect(result.coverage.points).toBe('complete');
  });
  it('preserves unknown units and pages/layer filters without silently dropping pagination', async () => {
    const file = path.join(root, 'Units.dxf');
    await writeFile(
      file,
      dxf(
        entity('LINE', [8, 'First', 10, 0, 20, 0, 11, 10, 21, 0]) +
          entity('LINE', [8, 'Second', 10, 0, 20, 0, 11, 0, 21, 20]),
        0,
      ),
    );
    const first = await readDrawingGeometry(file, { limit: 1 });
    expect(first.units).toMatchObject({ symbol: 'units', millimetres: null });
    expect(first.nextOffset).toBe(1);
    expect(first.entities[0].points).toBeUndefined();
    const second = await readDrawingGeometry(file, { offset: first.nextOffset, limit: 1 });
    expect(second.entities[0].id).not.toBe(first.entities[0].id);
    expect(second.nextOffset).toBeUndefined();
    expect((await readDrawingGeometry(file, { layer: 'Second' })).entities).toMatchObject([
      { layer: 'Second', length: 20 },
    ]);
  });
  it('bounds point output and exposes unsupported reader coverage without guessing measurements', () => {
    const drawing = parseDrawing(panelDrawing);
    const prototype = drawing.entities[0];
    const page = drawingGeometryPage(
      {
        ...drawing,
        warnings: ['Unsupported fixture entity'],
        entities: Array.from({ length: 3 }, (_, i) => ({
          ...prototype,
          id: String(i),
          approximate: true,
          points: Array.from({ length: 1500 }, (_, x) => ({ x, y: i })),
        })),
      },
      { points: true },
    );
    expect(page.entities.reduce((sum, entity) => sum + (entity.points?.length ?? 0), 0)).toBe(2000);
    expect(page.entities[1].pointsComplete).toBe(false);
    expect(page.coverage).toMatchObject({ geometry: 'partial', points: 'partial' });
    expect(page.coverage.reasons).toContain('Unsupported fixture entity');
    expect(page.entities.every((entity) => entity.approximate)).toBe(true);
  });
  it('rejects unrelated files, symlinks, invalid windows and already cancelled reads', async () => {
    const file = path.join(root, 'Panel.dxf');
    await writeFile(file, panelDrawing);
    await symlink(file, path.join(root, 'Alias.dxf'));
    await expect(readDrawingGeometry(path.join(root, 'Alias.dxf'))).rejects.toThrow('regular DXF');
    await writeFile(path.join(root, 'Text.txt'), 'not a drawing');
    await expect(readDrawingGeometry(path.join(root, 'Text.txt'))).rejects.toThrow('DXF');
    expect(drawingGeometryOptionsSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(drawingGeometryOptionsSchema.safeParse({ offset: -1 }).success).toBe(false);
    const abort = new AbortController();
    abort.abort();
    await expect(readDrawingGeometry(file, {}, abort.signal)).rejects.toThrow();
  });
});
