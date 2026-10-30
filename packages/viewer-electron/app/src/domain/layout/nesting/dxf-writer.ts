/**
 * One sheet as an R12 ASCII DXF in millimetres, the version CAM software opens most widely. Each
 * part's own entities are moved into place: lines, arcs, circles and bulged polylines stay exact;
 * ellipses and splines become polylines. Layers separate outer cuts, inner cuts, open cuts and
 * marks, so a CAM program can cut holes before outlines and skip what is only marked.
 */
import { primitivePoints, transformPrimitive, type Primitive } from './drawing';
import { apply, placementMatrix, tau, type Point } from './geometry';
import type { CutRole, Part } from './parts';
import type { Placement } from './plan';

export const sheetLayers = {
  outer: { name: 'CUT-OUTER', color: 1 },
  inner: { name: 'CUT-INNER', color: 5 },
  open: { name: 'CUT-OPEN', color: 6 },
  mark: { name: 'MARK', color: 3 },
  labels: { name: 'LABELS', color: 2 },
  sheet: { name: 'SHEET', color: 8 },
} as const;
const roleLayer: Record<CutRole, string> = {
  outer: sheetLayers.outer.name,
  inner: sheetLayers.inner.name,
  open: sheetLayers.open.name,
  mark: sheetLayers.mark.name,
};
/** How far a written polyline may stray from an ellipse or spline, in millimetres. */
const outputTolerance = 0.01;

export interface SheetDrawing {
  /** Along x. */
  length: number;
  width: number;
  pieces: readonly { part: Part; placement: Placement; number: number }[];
  labels: boolean;
}

const value = (n: number) => {
  const rounded = Number(n.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};
class Writer {
  private lines: string[] = [];
  group(code: number, data: string | number) {
    this.lines.push(String(code), typeof data === 'number' ? value(data) : data);
  }
  point(code: number, x: number, y: number) {
    this.group(code, x);
    this.group(code + 10, y);
    this.group(code + 20, 0);
  }
  text() {
    return this.lines.join('\n') + '\n';
  }
}

/** The header and tables every written drawing starts with, then its ENTITIES section. */
function begin(
  out: Writer,
  units: number,
  extents: { min: Point; max: Point },
  layers: readonly { name: string; color: number }[],
): void {
  out.group(0, 'SECTION');
  out.group(2, 'HEADER');
  out.group(9, '$ACADVER');
  out.group(1, 'AC1009');
  out.group(9, '$INSUNITS');
  out.group(70, units);
  out.group(9, '$EXTMIN');
  out.point(10, extents.min.x, extents.min.y);
  out.group(9, '$EXTMAX');
  out.point(10, extents.max.x, extents.max.y);
  out.group(0, 'ENDSEC');
  out.group(0, 'SECTION');
  out.group(2, 'TABLES');
  out.group(0, 'TABLE');
  out.group(2, 'LTYPE');
  out.group(70, 1);
  out.group(0, 'LTYPE');
  out.group(2, 'CONTINUOUS');
  out.group(70, 0);
  out.group(3, 'Solid line');
  out.group(72, 65);
  out.group(73, 0);
  out.group(40, 0);
  out.group(0, 'ENDTAB');
  out.group(0, 'TABLE');
  out.group(2, 'LAYER');
  out.group(70, layers.length);
  for (const layer of layers) {
    out.group(0, 'LAYER');
    out.group(2, layer.name);
    out.group(70, 0);
    out.group(62, layer.color);
    out.group(6, 'CONTINUOUS');
  }
  out.group(0, 'ENDTAB');
  out.group(0, 'ENDSEC');
  out.group(0, 'SECTION');
  out.group(2, 'ENTITIES');
}
function end(out: Writer): string {
  out.group(0, 'ENDSEC');
  out.group(0, 'EOF');
  return out.text();
}

export function sheetDXF(sheet: SheetDrawing): string {
  const out = new Writer();
  begin(
    out,
    4,
    { min: { x: 0, y: 0 }, max: { x: sheet.length, y: sheet.width } },
    Object.values(sheetLayers),
  );
  polyline(
    out,
    sheetLayers.sheet.name,
    [
      { x: 0, y: 0, bulge: 0 },
      { x: sheet.length, y: 0, bulge: 0 },
      { x: sheet.length, y: sheet.width, bulge: 0 },
      { x: 0, y: sheet.width, bulge: 0 },
    ],
    true,
  );
  for (const { part, placement, number } of sheet.pieces) {
    const m = placementMatrix(placement.rotation, placement.mirror, placement.x, placement.y);
    for (const entity of part.entities)
      write(out, transformPrimitive(entity.primitive, m), roleLayer[entity.role]);
    if (sheet.labels) {
      const at = apply(m, part.label);
      const height = Math.min(20, Math.max(3, Math.min(part.width, part.height) * 0.25));
      out.group(0, 'TEXT');
      out.group(8, sheetLayers.labels.name);
      out.point(10, at.x, at.y);
      out.group(40, height);
      out.group(1, String(number));
      out.group(72, 1);
      out.point(11, at.x, at.y);
      out.group(73, 2);
    }
  }
  return end(out);
}

export interface PartDrawing {
  primitives: readonly Primitive[];
  /** The `$INSUNITS` code its coordinates are in. */
  units: number;
  /** Its layers in order; each primitive stays on its own. */
  layers: readonly string[];
}
/** One drawing as an R12 ASCII DXF in its own units and on its own layers, its entities written as
 * a sheet's are: a corrected part keeps everything a cutter reads. */
export function partDXF(part: PartDrawing): string {
  const out = new Writer();
  const min = { x: Infinity, y: Infinity },
    max = { x: -Infinity, y: -Infinity };
  for (const primitive of part.primitives)
    for (const p of primitive.kind === 'text' ? [primitive.at] : primitivePoints(primitive, 0.01)) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
    }
  const extents = Number.isFinite(min.x)
    ? { min, max }
    : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  begin(
    out,
    part.units,
    extents,
    part.layers.map((name) => ({ name, color: 7 })),
  );
  for (const primitive of part.primitives) write(out, primitive, primitive.layer);
  return end(out);
}

function write(out: Writer, primitive: Primitive, layer: string): void {
  switch (primitive.kind) {
    case 'line':
      out.group(0, 'LINE');
      out.group(8, layer);
      out.point(10, primitive.a.x, primitive.a.y);
      out.point(11, primitive.b.x, primitive.b.y);
      return;
    case 'arc':
      if (primitive.sweep >= tau - 1e-9) {
        out.group(0, 'CIRCLE');
        out.group(8, layer);
        out.point(10, primitive.center.x, primitive.center.y);
        out.group(40, primitive.radius);
        return;
      }
      out.group(0, 'ARC');
      out.group(8, layer);
      out.point(10, primitive.center.x, primitive.center.y);
      out.group(40, primitive.radius);
      out.group(50, degrees(primitive.start));
      out.group(51, degrees(primitive.start + primitive.sweep));
      return;
    case 'polyline':
      polyline(out, layer, primitive.vertices, primitive.closed);
      return;
    case 'ellipse':
    case 'spline': {
      const points = primitivePoints(primitive, outputTolerance);
      const closed =
        points.length > 2 &&
        Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) < 1e-9;
      if (closed) points.pop();
      polyline(
        out,
        layer,
        points.map((p) => ({ ...p, bulge: 0 })),
        closed,
      );
      return;
    }
    case 'text':
      out.group(0, 'TEXT');
      out.group(8, layer);
      out.point(10, primitive.at.x, primitive.at.y);
      out.group(40, primitive.height);
      out.group(1, primitive.value);
      out.group(50, primitive.rotation);
      return;
  }
}
const degrees = (radians: number) => ((((radians * 180) / Math.PI) % 360) + 360) % 360;
function polyline(
  out: Writer,
  layer: string,
  vertices: readonly { x: number; y: number; bulge: number }[],
  closed: boolean,
): void {
  out.group(0, 'POLYLINE');
  out.group(8, layer);
  out.group(66, 1);
  out.point(10, 0, 0);
  out.group(70, closed ? 1 : 0);
  for (const vertex of vertices) {
    out.group(0, 'VERTEX');
    out.group(8, layer);
    out.point(10, vertex.x, vertex.y);
    if (vertex.bulge) out.group(42, vertex.bulge);
  }
  out.group(0, 'SEQEND');
  out.group(8, layer);
}
