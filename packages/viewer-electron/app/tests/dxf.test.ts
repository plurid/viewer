import { describe, expect, it } from 'vitest';
import {
  angleAt,
  bulgeArc,
  distance,
  parseDrawing,
  polygonArea,
} from '../src/domain/previews/drawings/dxf/geometry';
import {
  convertUnits,
  measurementValue,
  unitInfo,
} from '../src/domain/previews/drawings/dxf/units';
import { dxf, entity, panelDrawing } from './dxf-fixtures';
import {
  primitiveLength,
  primitivePoints,
  readCutDrawing,
} from '../src/domain/layout/nesting/drawing';
import { decodeDXF } from '../src/domain/previews/drawings/dxf/decode';

describe('DXF geometry and measurements', () => {
  it('loads a millimetre drawing and computes geometry bounds instead of stale header bounds', () => {
    const drawing = parseDrawing(panelDrawing);
    expect(drawing.units).toBe(4);
    expect(drawing.entities).toHaveLength(6);
    expect(drawing.layers.map((l) => [l.name, l.count])).toEqual([
      ['CUT', 4],
      ['HOLES', 1],
      ['CURVES', 1],
    ]);
    expect(drawing.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 200, y: 100 } });
    expect(drawing.entities[4].radius).toBe(10);
    expect(drawing.entities[4].area).toBeCloseTo(Math.PI * 100);
    expect(drawing.warnings).toEqual([]);
  });
  it('decodes modern UTF-8 with inherited codepages and Windows codepage text', () => {
    const source =
      panelDrawing.replace('0\nENDSEC', '9\n$DWGCODEPAGE\n3\nANSI_1252\n0\nENDSEC') + 'é 中文';
    expect(decodeDXF(new TextEncoder().encode(source))).toBe(source);
    const r2000 = source.replace('AC1027', 'AC1015').split('é')[0];
    const bytes = new Uint8Array([...new TextEncoder().encode(r2000), 0xe9]);
    expect(decodeDXF(bytes)).toBe(r2000 + 'é');
  });
  it('uses radian ellipse parameters and preserves exact rotated endpoints', () => {
    const e = parseDrawing(
      dxf(entity('ELLIPSE', [10, 0, 20, -420, 11, 0, 21, 70, 40, 0.5, 41, 0, 42, Math.PI / 2])),
    ).entities[0];
    expect(e.points[0]).toEqual({ x: 0, y: -350 });
    expect(e.points.at(-1)!.x).toBeCloseTo(-35);
    expect(e.points.at(-1)!.y).toBeCloseTo(-420);
    expect(e.bounds.min.x).toBeCloseTo(-35);
    expect(e.bounds.max.y).toBeCloseTo(-350);
    expect(e.length).toBeCloseTo(84.77, 1);
    expect(e.approximate).toBe(true);
    expect(e.snaps.filter((s) => s.kind === 'Endpoint')).toHaveLength(2);
  });
  it('wraps circular arc angles and measures circular arc length exactly', () => {
    const arc = parseDrawing(dxf(entity('ARC', [10, 0, 20, 0, 40, 10, 50, 350, 51, 10])))
      .entities[0];
    expect(arc.length).toBeCloseTo((10 * Math.PI) / 9);
    expect(arc.bounds.max.x).toBeCloseTo(10);
    expect(arc.radius).toBe(10);
  });
  it('handles both bulge directions and exact closed contour area', () => {
    for (const b of [1, -1]) {
      const arc = bulgeArc({ x: 0, y: 0 }, { x: 20, y: 0 }, b);
      expect(arc.length).toBeCloseTo(10 * Math.PI);
      expect(arc.area).toBeCloseTo(b * 50 * Math.PI);
      expect(arc.points[0]).toEqual({ x: 0, y: 0 });
      expect(arc.points.at(-1)).toEqual({ x: 20, y: 0 });
    }
    const poly = parseDrawing(
      dxf(entity('LWPOLYLINE', [70, 1, 90, 2, 10, 0, 20, 0, 42, 1, 10, 20, 20, 0, 42, 0])),
    ).entities[0];
    expect(poly.closed).toBe(true);
    expect(poly.area).toBeCloseTo(50 * Math.PI);
    expect(poly.length).toBeCloseTo(20 + 10 * Math.PI);
  });
  it('expands block base points, inherited layers, scaled lengths and rotations', () => {
    const block =
      entity('BLOCK', [2, 'PART', 10, 5, 20, 0]) +
      entity('LINE', [8, '0', 10, 5, 20, 0, 11, 15, 21, 0]) +
      entity('ENDBLK', []);
    const drawing = parseDrawing(
      dxf(
        entity('INSERT', [2, 'PART', 8, 'ASSEMBLY', 10, 100, 20, 200, 41, 2, 42, 2, 50, 90]),
        4,
        block,
      ),
    );
    const line = drawing.entities[0];
    expect(line.layer).toBe('ASSEMBLY');
    expect(line.points[0].x).toBeCloseTo(100);
    expect(line.points[0].y).toBeCloseTo(200);
    expect(line.points[1].x).toBeCloseTo(100);
    expect(line.points[1].y).toBeCloseTo(220);
    expect(line.length).toBeCloseTo(20);
  });
  it('omits recursive blocks and reports unsupported entities alongside valid geometry', () => {
    const block =
      entity('BLOCK', [2, 'LOOP', 10, 0, 20, 0]) +
      entity('INSERT', [2, 'LOOP', 10, 0, 20, 0]) +
      entity('ENDBLK', []);
    const drawing = parseDrawing(
      dxf(
        entity('LINE', [10, 0, 20, 0, 11, 1, 21, 1]) +
          entity('HATCH', [2, 'SOLID']) +
          entity('INSERT', [2, 'LOOP', 10, 0, 20, 0]),
        4,
        block,
      ),
    );
    expect(drawing.entities).toHaveLength(1);
    expect(drawing.warnings).toContain('Unsupported entity: HATCH');
    expect(drawing.warnings).toContain('Recursive block omitted: LOOP');
  });
  it('draws a spline as nesting reads it, and one given by fit points alone', () => {
    // a cubic Bézier arch from (0, 0) to (10, 0), its top at (5, 7.5)
    const controls = [0, 0, 0, 10, 10, 10, 10, 0];
    const arch = entity('SPLINE', [
      8,
      'CURVES',
      70,
      8,
      71,
      3,
      72,
      8,
      73,
      4,
      ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap((knot) => [40, knot]),
      ...Array.from({ length: 4 }, (_, i) => [
        10,
        controls[2 * i]!,
        20,
        controls[2 * i + 1]!,
        30,
        0,
      ]).flat(),
    ]);
    // closed, through three fit points, with no control points
    const loop = entity('SPLINE', [
      8,
      'CURVES',
      70,
      1,
      71,
      3,
      74,
      3,
      ...[20, 0, 25, 5, 30, 0].flatMap((value, i) => [
        i % 2 ? 21 : 11,
        value,
        ...(i % 2 ? [31, 0] : []),
      ]),
    ]);
    const source = dxf(arch + loop);
    const drawing = parseDrawing(source);
    expect(drawing.warnings).not.toContain('Unsupported entity: SPLINE');
    const [curve, fitted] = drawing.entities;
    expect(curve).toMatchObject({
      type: 'SPLINE',
      layer: 'CURVES',
      closed: false,
      approximate: true,
    });
    expect(curve!.points[0]).toEqual({ x: 0, y: 0 });
    expect(curve!.points.at(-1)).toEqual({ x: 10, y: 0 });
    expect(curve!.bounds.max.y).toBeCloseTo(7.5, 3);
    expect(curve!.snaps.map((snap) => snap.kind)).toEqual(['Endpoint', 'Endpoint']);
    // the same chords nesting cuts along, within 1e-4 of the spline's size
    const [spline] = readCutDrawing(source).primitives;
    expect(spline?.kind).toBe('spline');
    expect(curve!.points).toEqual(primitivePoints(spline!, 1e-3));
    expect(curve!.length).toBeCloseTo(primitiveLength(spline!), 9);
    expect(fitted).toMatchObject({ type: 'SPLINE', closed: true });
    expect(fitted!.points.at(-1)).toEqual(fitted!.points[0]);
    expect(fitted!.area).toBeCloseTo(25);
  });
  it('rejects binary, malformed, nonfinite coordinates and unsupported-only drawings', () => {
    expect(() => parseDrawing('AutoCAD Binary DXF\r\n')).toThrow('Binary DXF');
    expect(() => parseDrawing('0\nSECTION\n')).toThrow('complete ASCII');
    expect(() => parseDrawing(dxf(entity('LINE', [10, 'NaN', 20, 0, 11, 2, 21, 0])))).toThrow(
      'invalid',
    );
    expect(() => parseDrawing(dxf(entity('3DSOLID', [])))).toThrow('No supported');
    expect(() => parseDrawing(dxf(''))).toThrow('No supported');
  });
  it('keeps distances, angles and polygon area in model space and converts square units correctly', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeUndefined();
    const points = [
      { x: 1e9, y: 1e9 },
      { x: 1e9 + 20, y: 1e9 },
      { x: 1e9 + 20, y: 1e9 + 10 },
      { x: 1e9, y: 1e9 + 10 },
    ];
    expect(polygonArea(points)).toBe(200);
    expect(measurementValue({ id: 1, tool: 'area', points })).toBe(200);
    expect(convertUnits(25.4, 4, 1)).toBeCloseTo(1);
    expect(convertUnits(645.16, 4, 1, true)).toBeCloseTo(1);
    expect(unitInfo(0).symbol).toBe('units');
    expect(convertUnits(5, 0, 4)).toBe(5);
  });
});
