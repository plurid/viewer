import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Canvases } from '../src/desktop/canvases/service';
import { prepareCanvasDrawing } from '../src/domain/canvases/drawing';
import { canvasResultName, canvasResultSchema } from '../src/domain/canvases/results';
import { parseDrawing } from '../src/domain/previews/drawings/dxf/geometry';
import { measureDrawing, rowPitches } from '../src/domain/fabrication/measure';
import { temporaryRoot } from '../tools/temporary';

const outline = [
  '0',
  'LWPOLYLINE',
  '8',
  'CUT',
  '90',
  '4',
  '70',
  '1',
  '10',
  '0',
  '20',
  '0',
  '10',
  '120',
  '20',
  '0',
  '10',
  '120',
  '20',
  '80',
  '10',
  '0',
  '20',
  '80',
].join('\n');
const holes = [20, 100]
  .map((x) => ['0', 'CIRCLE', '8', 'CUT', '10', x, '20', '40', '40', '3'].join('\n'))
  .join('\n');
const wrap = (entities: string, units = 4) =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
const plate = wrap(outline + '\n' + holes);
const result = (content = plate) => ({ format: 'dxf' as const, name: 'plate', content });

describe('reviewed cutting drawings', () => {
  it('normalizes and measures a plate without moving the holes', () => {
    const prepared = prepareCanvasDrawing(plate);
    expect(prepared.measurement).toMatchObject({ width: 120, height: 80 });
    expect(prepared.measurement.holes.map((hole) => hole.diameter)).toEqual([6, 6]);
    expect(rowPitches(prepared.measurement).map((pitch) => pitch.value)).toEqual([80]);
    expect(prepared.content).toContain('AC1009');
    expect(prepareCanvasDrawing(prepared.content).content).toBe(prepared.content);
    expect(canvasResultName(canvasResultSchema.parse(result()))).toBe('plate.dxf');
  });
  it.each([
    ['unknown units', wrap(outline, 0)],
    ['inches', wrap(outline, 1)],
    ['unsupported geometry', wrap(outline + '\n0\nTEXT\n1\nlabel')],
    ['open outline', wrap(outline.replace('70\n1', '70\n0'))],
    [
      'small unclosed gap',
      wrap(
        '0\nLWPOLYLINE\n90\n5\n70\n0\n10\n0\n20\n0\n10\n120\n20\n0\n10\n120\n20\n80\n10\n0\n20\n80\n10\n0\n20\n0.02',
      ),
    ],
    ['duplicate cuts', wrap(outline + '\n' + outline)],
    ['loose path', wrap(outline + '\n0\nLINE\n10\n10\n20\n10\n11\n20\n21\n10')],
    ['non-planar', wrap(outline + '\n38\n1')],
    ['hidden entity', wrap(outline + '\n60\n1')],
    ['paper space', wrap(outline + '\n67\n1')],
    ['wide polyline', wrap(outline + '\n43\n2')],
    ['tilted entity', wrap(outline + '\n210\n1')],
    ['non-finite coordinate', plate.replace('10\n120', '10\nNaN')],
    ['out of bounds', plate.replace('10\n120', '10\n10001')],
    ['negative radius', plate.replace('40\n3', '40\n-3')],
    ['trailing section', plate + '0\nSECTION\n2\nOBJECTS\n0\nENDSEC\n'],
    ['truncated document', plate.slice(0, -6)],
    ['too many entities', wrap(holes.repeat(257))],
    ['too much text', plate + ' '.repeat(1_000_000)],
  ])('refuses %s before review', (_name, content) => {
    expect(canvasResultSchema.safeParse(result(content)).success).toBe(false);
  });
  it('saves a reviewed drawing, remeasures it after restart and refuses a stale review', async () => {
    const root = await temporaryRoot('viewer-canvas-drawing-');
    const canvases = new Canvases(root, { changed: () => {} });
    const canvas = await canvases.create(1, randomUUID(), root);
    const destination = path.join(root, 'mounting-plate.dxf');
    await canvases.saveResult(1, canvas.id, 0, 0, result(), async () => destination);
    const saved = await readFile(destination, 'utf8');
    expect(saved).toBe(prepareCanvasDrawing(plate).content);
    const measurement = measureDrawing(parseDrawing(saved));
    expect(measurement.status).toBe('measured');
    if (measurement.status === 'measured') {
      expect(measurement.measurement.width).toBe(120);
      expect(measurement.measurement.holes.map((hole) => hole.centre.x)).toEqual([20, 100]);
    }
    await canvases.flush();
    const reopened = new Canvases(root, { changed: () => {} });
    await reopened.state(1, canvas.id, 0, 0, { width: 140 });
    let prompted = false;
    await expect(
      reopened.saveResult(1, canvas.id, 0, 0, result(), async () => {
        prompted = true;
        return path.join(root, 'stale.dxf');
      }),
    ).rejects.toThrow('changed');
    expect(prompted).toBe(false);
  });
});
