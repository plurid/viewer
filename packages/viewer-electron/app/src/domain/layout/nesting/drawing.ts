/**
 * A DXF drawing as the entities a cutter follows. Lines, arcs, circles and bulged polylines stay
 * exact; ellipses and splines keep their defining geometry and are flattened only where a polygon
 * is needed. Block references are expanded. Coordinates stay in the drawing's own units.
 */
import DxfParser, { type IDxf } from 'dxf-parser';
import type { IEntity } from 'dxf-parser/dist/entities/geomtry';
import { DXF_MAX_BYTES } from '../../previews/drawings/dxf/math';
import {
  apply,
  arcPoints,
  bulgeArc,
  determinant,
  extent,
  identity,
  multiply,
  similarity,
  splinePoints,
  tau,
  validSpline,
  type Matrix,
  type Point,
} from './geometry';

export interface Vertex extends Point {
  bulge: number;
}
export type Primitive =
  | { kind: 'line'; layer: string; a: Point; b: Point }
  /** Counter-clockwise from `start` through `sweep` radians; a circle sweeps a whole turn. */
  | { kind: 'arc'; layer: string; center: Point; radius: number; start: number; sweep: number }
  /** center + u cos t + v sin t, for t from `start` through `sweep`. */
  | {
      kind: 'ellipse';
      layer: string;
      center: Point;
      u: Point;
      v: Point;
      start: number;
      sweep: number;
    }
  | { kind: 'spline'; layer: string; degree: number; knots: number[]; controls: Point[] }
  | { kind: 'polyline'; layer: string; vertices: Vertex[]; closed: boolean }
  | { kind: 'text'; layer: string; at: Point; height: number; rotation: number; value: string };
export type PrimitiveKind = Primitive['kind'];
export interface DrawingLayer {
  name: string;
  count: number;
  /** Turned off or frozen in the drawing: its entities are left out. */
  hidden: boolean;
}
export interface CutDrawing {
  primitives: Primitive[];
  /** `$INSUNITS`; 0 when the drawing does not say. */
  units: number;
  layers: DrawingLayer[];
  /** Entities a cutter does not follow, by type: dimensions, hatches, points, images. */
  skipped: Record<string, number>;
}

type Raw = IEntity & {
  vertices?: (Point & {
    bulge?: number;
    splineControlPoint?: boolean;
    threeDPolylineMesh?: boolean;
    polyfaceMeshVertex?: boolean;
  })[];
  center?: Point;
  position?: Point;
  startPoint?: Point;
  endPoint?: Point;
  majorAxisEndPoint?: Point;
  extrusionDirection?: { x: number; y: number; z: number };
  extrusionDirectionX?: number;
  extrusionDirectionY?: number;
  extrusionDirectionZ?: number;
  shape?: boolean;
  is3dPolyline?: boolean;
  is3dPolygonMesh?: boolean;
  isPolyfaceMesh?: boolean;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  axisRatio?: number;
  name?: string;
  rotation?: number;
  xScale?: number;
  yScale?: number;
  rowCount?: number;
  columnCount?: number;
  rowSpacing?: number;
  columnSpacing?: number;
  text?: string;
  height?: number;
  textHeight?: number;
  halign?: number;
  valign?: number;
  degreeOfSplineCurve?: number;
  knotValues?: number[];
  controlPoints?: Point[];
  fitPoints?: Point[];
  closed?: boolean;
};

const limits = { entities: 50_000, visits: 200_000, depth: 16, vertices: 1_000_000 } as const;
/** Entity types whose coordinates are in the object coordinate system of their extrusion. */
const planar = new Set(['LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'TEXT', 'INSERT']);
const drawn = new Set([
  'LINE',
  'ARC',
  'CIRCLE',
  'ELLIPSE',
  'SPLINE',
  'LWPOLYLINE',
  'POLYLINE',
  'TEXT',
  'MTEXT',
  'INSERT',
]);
/** Types dxf-parser reads; the others it passes over without a trace. */
const parsed = new Set([...drawn, 'POINT', 'SOLID', '3DFACE', 'DIMENSION', 'ATTDEF']);
const valid = (p: Point | undefined): p is Point =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Math.max(Math.abs(p.x), Math.abs(p.y)) < 1e12;
const point = (p: Point): Point => ({ x: p.x, y: p.y });

export function readCutDrawing(source: string): CutDrawing {
  if (source.startsWith('AutoCAD Binary DXF'))
    throw new Error('Binary DXF is not supported. Export an ASCII DXF from your CAD app.');
  if (!/\bSECTION\b/.test(source) || !/\bEOF\s*$/.test(source))
    throw new Error('This is not a complete ASCII DXF drawing.');
  if (source.length > DXF_MAX_BYTES) throw new Error('This drawing is larger than 32 MB.');
  const parsed = new DxfParser().parseSync(source);
  if (!parsed) throw new Error('The DXF drawing could not be read.');
  return drawingFrom(parsed, unknownTypes(source));
}

/** dxf-parser passes over entity types it has no reader for; count them from the text. */
function unknownTypes(source: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const lines = source.split(/\r?\n/);
  let section = '';
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim(),
      value = lines[i + 1]!.trim();
    if (code === '2' && lines[i - 1]?.trim() === 'SECTION') section = value;
    else if (code === '0' && value === 'ENDSEC') section = '';
    else if (
      code === '0' &&
      (section === 'ENTITIES' || section === 'BLOCKS') &&
      !parsed.has(value) &&
      !['VERTEX', 'SEQEND', 'BLOCK', 'ENDBLK', 'ENDSEC', 'EOF', 'SECTION'].includes(value)
    )
      counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function drawingFrom(data: IDxf, skipped: Record<string, number>): CutDrawing {
  const primitives: Primitive[] = [];
  const table = (data.tables?.layer?.layers ?? {}) as Record<
    string,
    { visible?: boolean; frozen?: boolean }
  >;
  const layers = new Map<string, DrawingLayer>();
  const hidden = (name: string) => table[name]?.visible === false || !!table[name]?.frozen;
  let visits = 0,
    vertices = 0;
  const skip = (type: string) => {
    skipped[type] = (skipped[type] ?? 0) + 1;
  };
  const add = (primitive: Primitive) => {
    if (primitives.length >= limits.entities)
      throw new Error('This drawing has more than 50,000 entities.');
    const layer = layers.get(primitive.layer) ?? {
      name: primitive.layer,
      count: 0,
      hidden: hidden(primitive.layer),
    };
    layer.count++;
    layers.set(primitive.layer, layer);
    if (!layer.hidden) primitives.push(primitive);
  };
  const visit = (
    raw: Raw,
    parent: Matrix,
    inherited: string | undefined,
    depth: number,
    ancestry: ReadonlySet<string>,
  ): void => {
    if (++visits > limits.visits)
      throw new Error('Block references expand beyond 200,000 entities.');
    if (raw.visible === false || raw.inPaperSpace) return;
    if (!drawn.has(raw.type)) return skip(raw.type);
    const layer = raw.layer === '0' && inherited ? inherited : raw.layer || inherited || '0';
    const extrusion = raw.extrusionDirection ?? {
      x: raw.extrusionDirectionX ?? 0,
      y: raw.extrusionDirectionY ?? 0,
      z: raw.extrusionDirectionZ ?? 1,
    };
    if (Math.abs(extrusion.x) > 1e-9 || Math.abs(extrusion.y) > 1e-9) return skip('tilted');
    const matrix =
      planar.has(raw.type) && extrusion.z < 0 ? multiply(parent, [-1, 0, 0, 1, 0, 0]) : parent;
    if (raw.type === 'INSERT') {
      const name = raw.name ?? '',
        block = data.blocks?.[name];
      if (!block || ancestry.has(name) || depth >= limits.depth) return skip('INSERT');
      const angle = ((raw.rotation ?? 0) * Math.PI) / 180,
        sx = raw.xScale ?? 1,
        sy = raw.yScale ?? 1;
      if (![angle, sx, sy].every(Number.isFinite) || !sx || !sy)
        throw new Error('A block reference has an invalid scale or rotation.');
      const at = raw.position ?? { x: 0, y: 0 },
        base = block.position ?? { x: 0, y: 0 };
      const rows = raw.rowCount || 1,
        columns = raw.columnCount || 1;
      if (rows * columns > 10_000) throw new Error('A block array has more than 10,000 copies.');
      const next = new Set(ancestry).add(name);
      const local: Matrix = [
        Math.cos(angle) * sx,
        Math.sin(angle) * sx,
        -Math.sin(angle) * sy,
        Math.cos(angle) * sy,
        at.x,
        at.y,
      ];
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const offset: Matrix = [
            1,
            0,
            0,
            1,
            -base.x + (column * (raw.columnSpacing ?? 0)) / sx,
            -base.y + (row * (raw.rowSpacing ?? 0)) / sy,
          ];
          const placed = multiply(matrix, multiply(local, offset));
          for (const child of block.entities ?? [])
            visit(child as Raw, placed, layer, depth + 1, next);
        }
      return;
    }
    const primitive = primitiveOf(raw, layer);
    if (!primitive) return;
    if (primitive.kind === 'polyline') vertices += primitive.vertices.length;
    if (primitive.kind === 'spline') vertices += primitive.controls.length;
    if (vertices > limits.vertices)
      throw new Error('This drawing has more than 1,000,000 vertices.');
    add(transformPrimitive(primitive, matrix));
  };
  for (const raw of data.entities ?? []) visit(raw as Raw, identity, undefined, 0, new Set());
  const units = data.header?.$INSUNITS;
  return {
    primitives,
    units: typeof units === 'number' ? units : 0,
    layers: [...layers.values()],
    skipped,
  };
}

function primitiveOf(raw: Raw, layer: string): Primitive | undefined {
  switch (raw.type) {
    case 'LINE': {
      const [a, b] = raw.vertices ?? [];
      return valid(a) && valid(b) ? { kind: 'line', layer, a: point(a), b: point(b) } : undefined;
    }
    case 'CIRCLE':
    case 'ARC': {
      const radius = raw.radius ?? 0;
      if (!valid(raw.center) || !(radius > 0) || !Number.isFinite(radius)) return undefined;
      const start = raw.type === 'CIRCLE' ? 0 : (raw.startAngle ?? 0),
        end = raw.type === 'CIRCLE' ? tau : (raw.endAngle ?? tau);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
      const sweep = raw.type === 'CIRCLE' ? tau : (((end - start) % tau) + tau) % tau || tau;
      return { kind: 'arc', layer, center: point(raw.center), radius, start, sweep };
    }
    case 'ELLIPSE': {
      const major = raw.majorAxisEndPoint,
        ratio = raw.axisRatio ?? 1;
      if (!valid(raw.center) || !valid(major) || !(ratio > 0) || !Number.isFinite(ratio))
        return undefined;
      const start = raw.startAngle ?? 0,
        end = raw.endAngle ?? tau;
      const delta = end - start;
      const sweep = Math.abs(delta) >= tau - 1e-10 ? tau : ((delta % tau) + tau) % tau || tau;
      return {
        kind: 'ellipse',
        layer,
        center: point(raw.center),
        u: point(major),
        v: { x: -major.y * ratio, y: major.x * ratio },
        start,
        sweep,
      };
    }
    case 'SPLINE': {
      const controls = (raw.controlPoints ?? []).filter(valid).map(point);
      const knots = raw.knotValues ?? [];
      const degree = raw.degreeOfSplineCurve ?? 3;
      if (validSpline({ degree, knots, controls }))
        return { kind: 'spline', layer, degree, knots: [...knots], controls };
      const fit = (raw.fitPoints ?? []).filter(valid);
      return fit.length > 1
        ? {
            kind: 'polyline',
            layer,
            vertices: fit.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
            closed: !!raw.closed,
          }
        : undefined;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (raw.is3dPolygonMesh || raw.isPolyfaceMesh) return undefined;
      const vertices = (raw.vertices ?? [])
        .filter((v) => !v.splineControlPoint && valid(v))
        .map((v) => ({ x: v.x, y: v.y, bulge: Number.isFinite(v.bulge) ? (v.bulge ?? 0) : 0 }));
      return vertices.length > 1
        ? { kind: 'polyline', layer, vertices, closed: !!raw.shape }
        : undefined;
    }
    case 'TEXT':
    case 'MTEXT': {
      const aligned = (raw.halign || raw.valign) && raw.endPoint;
      const at = raw.type === 'TEXT' ? (aligned ? raw.endPoint : raw.startPoint) : raw.position;
      const value = plain(raw.text ?? '');
      if (!valid(at) || !value) return undefined;
      return {
        kind: 'text',
        layer,
        at: point(at),
        height: Math.max(0.01, raw.textHeight ?? raw.height ?? 2.5),
        rotation: raw.rotation ?? 0,
        value,
      };
    }
    default:
      return undefined;
  }
}
const plain = (text: string) =>
  text
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim()
    .slice(0, 200);

/** The same entity under an affine map. Arcs stay arcs under maps that keep circles round. */
export function transformPrimitive(primitive: Primitive, m: Matrix): Primitive {
  const linear = (p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });
  const scale = similarity(m),
    reflected = determinant(m) < 0;
  switch (primitive.kind) {
    case 'line':
      return { ...primitive, a: apply(m, primitive.a), b: apply(m, primitive.b) };
    case 'arc': {
      if (scale === undefined) {
        const { center, radius, start, sweep, layer } = primitive;
        return transformPrimitive(
          {
            kind: 'ellipse',
            layer,
            center,
            u: { x: radius, y: 0 },
            v: { x: 0, y: radius },
            start,
            sweep,
          },
          m,
        );
      }
      const direction = (angle: number) => {
        const d = linear({ x: Math.cos(angle), y: Math.sin(angle) });
        return Math.atan2(d.y, d.x);
      };
      const full = primitive.sweep >= tau - 1e-12;
      const start = full
        ? 0
        : reflected
          ? direction(primitive.start + primitive.sweep)
          : direction(primitive.start);
      return {
        ...primitive,
        center: apply(m, primitive.center),
        radius: primitive.radius * scale,
        start: ((start % tau) + tau) % tau,
      };
    }
    case 'ellipse':
      return {
        ...primitive,
        center: apply(m, primitive.center),
        u: linear(primitive.u),
        v: linear(primitive.v),
      };
    case 'spline':
      return { ...primitive, controls: primitive.controls.map((p) => apply(m, p)) };
    case 'polyline': {
      if (scale !== undefined || primitive.vertices.every((v) => !v.bulge))
        return {
          ...primitive,
          vertices: primitive.vertices.map((v) => ({
            ...apply(m, v),
            bulge: reflected ? -v.bulge : v.bulge,
          })),
        };
      // A stretched bulge is an elliptical arc; it is drawn as the points of its circle.
      const points = polylinePoints(primitive, 1e-4 * extent(primitive.vertices));
      if (primitive.closed) points.pop();
      return {
        ...primitive,
        vertices: points.map((p) => ({ ...apply(m, p), bulge: 0 })),
      };
    }
    case 'text': {
      const radians = (primitive.rotation * Math.PI) / 180;
      const d = linear({ x: Math.cos(radians), y: Math.sin(radians) });
      return {
        ...primitive,
        at: apply(m, primitive.at),
        height: primitive.height * Math.sqrt(Math.abs(determinant(m))),
        rotation: (Math.atan2(d.y, d.x) * 180) / Math.PI,
      };
    }
  }
}

/** The points a cutter passes, with chords within `tolerance` of each curve. A closed path ends
 * where it starts. Text has no path. */
export function primitivePoints(primitive: Primitive, tolerance: number): Point[] {
  switch (primitive.kind) {
    case 'line':
      return [primitive.a, primitive.b];
    case 'arc':
      return arcPoints(
        primitive.center,
        primitive.radius,
        primitive.start,
        primitive.sweep,
        tolerance,
      );
    case 'ellipse':
      return ellipsePoints(primitive, tolerance);
    case 'spline':
      return splinePoints(primitive, tolerance);
    case 'polyline':
      return polylinePoints(primitive, tolerance);
    case 'text':
      return [];
  }
}
function ellipsePoints(e: Extract<Primitive, { kind: 'ellipse' }>, tolerance: number): Point[] {
  const reach = Math.hypot(e.u.x, e.u.y, e.v.x, e.v.y);
  const step = tolerance < reach ? 2 * Math.acos(1 - tolerance / reach) : Math.PI / 2;
  const count = Math.min(8192, Math.max(8, Math.ceil(Math.abs(e.sweep) / step)));
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const t = e.start + (e.sweep * i) / count;
    points.push({
      x: e.center.x + e.u.x * Math.cos(t) + e.v.x * Math.sin(t),
      y: e.center.y + e.u.y * Math.cos(t) + e.v.y * Math.sin(t),
    });
  }
  return points;
}
function polylinePoints(p: Extract<Primitive, { kind: 'polyline' }>, tolerance: number): Point[] {
  const { vertices, closed } = p;
  const points: Point[] = [{ x: vertices[0]!.x, y: vertices[0]!.y }];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vertices[i]!,
      b = vertices[(i + 1) % vertices.length]!;
    const arc = bulgeArc(a, b, a.bulge);
    if (!arc) points.push({ x: b.x, y: b.y });
    else {
      const along = arcPoints(arc.center, arc.radius, arc.start, arc.sweep, tolerance);
      along[along.length - 1] = { x: b.x, y: b.y };
      points.push(...along.slice(1));
    }
  }
  return points;
}
/** The length a cutter travels along an entity; exact for lines, arcs and bulges. */
export function primitiveLength(primitive: Primitive): number {
  switch (primitive.kind) {
    case 'line':
      return Math.hypot(primitive.b.x - primitive.a.x, primitive.b.y - primitive.a.y);
    case 'arc':
      return primitive.radius * primitive.sweep;
    case 'polyline': {
      const { vertices, closed } = primitive;
      let total = 0;
      const count = closed ? vertices.length : vertices.length - 1;
      for (let i = 0; i < count; i++) {
        const a = vertices[i]!,
          b = vertices[(i + 1) % vertices.length]!;
        const arc = bulgeArc(a, b, a.bulge);
        total += arc ? arc.radius * Math.abs(arc.sweep) : Math.hypot(b.x - a.x, b.y - a.y);
      }
      return total;
    }
    case 'ellipse':
    case 'spline': {
      const size =
        primitive.kind === 'ellipse'
          ? Math.hypot(primitive.u.x, primitive.u.y, primitive.v.x, primitive.v.y)
          : extent(primitive.controls);
      const points = primitivePoints(primitive, 1e-4 * size);
      let total = 0;
      for (let i = 1; i < points.length; i++)
        total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
      return total;
    }
    case 'text':
      return 0;
  }
}
/** Whether an entity returns to where it starts: a circle, a whole ellipse, a closed polyline. */
export function closedPrimitive(primitive: Primitive): boolean {
  switch (primitive.kind) {
    case 'arc':
    case 'ellipse':
      return primitive.sweep >= tau - 1e-9;
    case 'polyline':
      return primitive.closed;
    case 'spline':
    case 'line':
    case 'text':
      return false;
  }
}
/**
 * Half of ∫ x dy − y dx along an entity, about `origin`: the signed area its path sweeps. Summed
 * around a closed loop it is the loop's area, exact for lines, arcs, bulges and ellipses.
 */
export function sweptArea(primitive: Primitive, origin: Point): number {
  const arc = (cx: number, cy: number, r: number, start: number, sweep: number) => {
    const end = start + sweep;
    return (
      (r * cx * (Math.sin(end) - Math.sin(start)) -
        r * cy * (Math.cos(end) - Math.cos(start)) +
        r * r * sweep) /
      2
    );
  };
  switch (primitive.kind) {
    case 'line': {
      const { a, b } = primitive;
      return ((a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y)) / 2;
    }
    case 'arc':
      return arc(
        primitive.center.x - origin.x,
        primitive.center.y - origin.y,
        primitive.radius,
        primitive.start,
        primitive.sweep,
      );
    case 'polyline': {
      const { vertices, closed } = primitive;
      let total = 0;
      const count = closed ? vertices.length : vertices.length - 1;
      for (let i = 0; i < count; i++) {
        const a = vertices[i]!,
          b = vertices[(i + 1) % vertices.length]!;
        const bulge = bulgeArc(a, b, a.bulge);
        total += bulge
          ? arc(
              bulge.center.x - origin.x,
              bulge.center.y - origin.y,
              bulge.radius,
              bulge.start,
              bulge.sweep,
            )
          : ((a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y)) / 2;
      }
      return total;
    }
    case 'ellipse': {
      const { u, v, start, sweep } = primitive;
      const cx = primitive.center.x - origin.x,
        cy = primitive.center.y - origin.y;
      const end = start + sweep;
      const dc = Math.cos(end) - Math.cos(start),
        ds = Math.sin(end) - Math.sin(start);
      return (
        (cx * (u.y * dc + v.y * ds) -
          cy * (u.x * dc + v.x * ds) +
          (u.x * v.y - u.y * v.x) * sweep) /
        2
      );
    }
    case 'spline':
      return chordArea(splinePoints(primitive, 1e-4 * extent(primitive.controls)), origin);
    case 'text':
      return 0;
  }
}
/** The signed area swept by straight chords through `points`, about `origin`. */
export function chordArea(points: readonly Point[], origin: Point): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    total += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return total / 2;
}
