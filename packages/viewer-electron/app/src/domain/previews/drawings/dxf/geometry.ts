import DxfParser, { type IDxf } from 'dxf-parser';
import type { IEntity } from 'dxf-parser/dist/entities/geomtry';

import {
  DXF_MAX_BYTES,
  distance,
  type Point,
  type Bounds,
  type DrawingEntity,
  type Drawing,
  pathLength,
  polygonArea,
} from './math';
import { extent, splinePoints, validSpline } from '../../../layout/nesting/geometry';
export { angleAt, distance, polygonArea } from './math';
type Raw = IEntity & {
  vertices?: (Point & { bulge?: number })[];
  center?: Point;
  position?: Point;
  startPoint?: Point;
  majorAxisEndPoint?: Point;
  extrusionDirection?: { x: number; y: number; z: number };
  extrusionDirectionX?: number;
  extrusionDirectionY?: number;
  extrusionDirectionZ?: number;
  shape?: boolean;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  axisRatio?: number;
  name?: string;
  block?: string;
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
  degreeOfSplineCurve?: number;
  knotValues?: number[];
  controlPoints?: Point[];
  fitPoints?: Point[];
  closed?: boolean;
};
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const tau = Math.PI * 2;
const supported = new Set([
  'LINE',
  'LWPOLYLINE',
  'POLYLINE',
  'CIRCLE',
  'ARC',
  'ELLIPSE',
  'SPLINE',
  'POINT',
  'TEXT',
  'MTEXT',
  'INSERT',
  'DIMENSION',
  'SOLID',
  '3DFACE',
]);
const maxEntities = 50000,
  maxPoints = 1000000;
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function transform(p: Point, m: Matrix): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
const validPoint = (p: Point) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Math.max(Math.abs(p.x), Math.abs(p.y)) < 1e12;
function boundsOf(points: Point[]): Bounds {
  const min = { x: Infinity, y: Infinity },
    max = { x: -Infinity, y: -Infinity };
  for (const p of points) {
    if (!validPoint(p))
      throw new Error('The drawing contains invalid or excessively large coordinates.');
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}
function sweep(start: number, end: number): number {
  const delta = end - start;
  return Math.abs(delta) >= tau - 1e-10 ? tau : ((delta % tau) + tau) % tau;
}
function curve(center: Point, major: Point, ratio: number, start: number, delta: number): Point[] {
  const point = (t: number) => ({
    x: center.x + major.x * Math.cos(t) - major.y * ratio * Math.sin(t),
    y: center.y + major.y * Math.cos(t) + major.x * ratio * Math.sin(t),
  });
  const steps = Math.max(8, Math.ceil((Math.abs(delta) / tau) * 720));
  const times = Array.from({ length: steps + 1 }, (_, i) => start + (delta * i) / steps);
  // Add analytic extrema; fitting does not depend on header EXTMIN/EXTMAX or tessellation.
  for (const t of [Math.atan2(-major.y * ratio, major.x), Math.atan2(major.x * ratio, major.y)])
    for (const candidate of [t, t + Math.PI]) {
      const offset =
        delta >= 0
          ? (((candidate - start) % tau) + tau) % tau
          : -(((start - candidate) % tau) + tau) % tau;
      if (delta >= 0 ? offset <= delta : offset >= delta) times.push(start + offset);
    }
  times.sort((a, b) => (delta >= 0 ? a - b : b - a));
  return times.map(point);
}
/** Bulge is tan(sweep/4); retain exact endpoints and circular length/area. */
export function bulgeArc(
  a: Point,
  b: Point,
  bulge: number,
): { points: Point[]; length: number; area: number; center?: Point } {
  const chord = distance(a, b);
  if (!bulge || chord < 1e-12) return { points: [a, b], length: chord, area: 0 };
  const delta = 4 * Math.atan(bulge),
    radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const offset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const center = {
    x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * offset,
    y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * offset,
  };
  const points = curve(
    center,
    { x: radius, y: 0 },
    1,
    Math.atan2(a.y - center.y, a.x - center.x),
    delta,
  );
  points[0] = a;
  points[points.length - 1] = b;
  return {
    points,
    length: radius * Math.abs(delta),
    area: (radius * radius * (delta - Math.sin(delta))) / 2,
    center,
  };
}
function plainText(text: string): string {
  return text
    .replace(/\\P/g, '\n')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/\\[{}]/g, '')
    .replace(/[{}]/g, '')
    .slice(0, 4096);
}
export function parseDrawing(source: string): Drawing {
  if (source.startsWith('AutoCAD Binary DXF'))
    throw new Error('Binary DXF is not supported yet. Export an ASCII DXF from your CAD app.');
  if (!source.trim() || !/\bSECTION\b/.test(source) || !/\bEOF\s*$/.test(source))
    throw new Error('This is not a complete ASCII DXF drawing.');
  if (source.length > DXF_MAX_BYTES || source.split('\n').length > 1200000)
    throw new Error('This drawing exceeds the DXF preview limit (32 MB or 600,000 group codes).');
  const parsed = new DxfParser().parseSync(source);
  if (!parsed) throw new Error('The DXF drawing could not be parsed.');
  return drawingFrom(parsed, source);
}
function drawingFrom(data: IDxf, source: string): Drawing {
  const entities: DrawingEntity[] = [],
    warnings = new Set<string>();
  const layerMap = new Map<string, { name: string; visible: boolean; count: number }>();
  const rawLayers = data.tables?.layer?.layers ?? {};
  let pointCount = 0,
    visits = 0;
  // dxf-parser silently skips unknown handlers. Report them rather than imply completeness.
  let section = '';
  let beginsSection = false;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]?.trim() ?? '',
      value = lines[i + 1]?.trim() ?? '';
    if (code === '0' && value === 'SECTION') {
      beginsSection = true;
      continue;
    }
    if (code === '0' && value === 'ENDSEC') {
      section = '';
      continue;
    }
    if (
      beginsSection &&
      code === '2' &&
      ['ENTITIES', 'BLOCKS', 'HEADER', 'TABLES', 'OBJECTS', 'CLASSES'].includes(value)
    ) {
      section = value;
      beginsSection = false;
      continue;
    }
    if (
      code === '0' &&
      ['ENTITIES', 'BLOCKS'].includes(section) &&
      !supported.has(value) &&
      !['ENDSEC', 'EOF', 'VERTEX', 'SEQEND', 'BLOCK', 'ENDBLK'].includes(value)
    )
      warnings.add(`Unsupported entity: ${value}`);
  }
  const visit = (
    raw: Raw,
    parent: Matrix,
    inheritedLayer: string | undefined,
    depth: number,
    ancestry: Set<string>,
  ): void => {
    if (++visits > 100000) throw new Error('Block expansion exceeds the preview limit.');
    if (depth > 16) {
      warnings.add('Block nesting exceeds 16 levels.');
      return;
    }
    if (raw.visible === false) return;
    if (raw.inPaperSpace) {
      warnings.add('Paper-space layouts are omitted; this preview shows model space.');
      return;
    }
    const layer =
      raw.layer === '0' && inheritedLayer ? inheritedLayer : raw.layer || inheritedLayer || '0';
    if (!supported.has(raw.type)) {
      warnings.add(`Unsupported entity: ${raw.type}`);
      return;
    }
    const extrusion = raw.extrusionDirection ?? {
      x: raw.extrusionDirectionX || 0,
      y: raw.extrusionDirectionY || 0,
      z: raw.extrusionDirectionZ ?? 1,
    };
    if (extrusion.x || extrusion.y || (extrusion.z !== 1 && extrusion.z !== -1)) {
      warnings.add('Tilted 3D entities are omitted from this 2D view.');
      return;
    }
    const matrix = extrusion.z === -1 ? multiply(parent, [-1, 0, 0, 1, 0, 0]) : parent;
    if (raw.type === 'INSERT' || raw.type === 'DIMENSION') {
      const name = raw.name || raw.block || '',
        block = data.blocks?.[name];
      if (!block) {
        warnings.add(`Missing block: ${name || raw.type}`);
        return;
      }
      if (ancestry.has(name)) {
        warnings.add(`Recursive block omitted: ${name}`);
        return;
      }
      const next = new Set(ancestry).add(name);
      const angle = ((raw.rotation || 0) * Math.PI) / 180,
        sx = raw.xScale ?? 1,
        sy = raw.yScale ?? 1;
      if (
        !Number.isFinite(angle) ||
        !Number.isFinite(sx) ||
        !Number.isFinite(sy) ||
        sx === 0 ||
        sy === 0
      )
        throw new Error('A block has an invalid transform.');
      const position = raw.type === 'DIMENSION' ? { x: 0, y: 0 } : (raw.position ?? { x: 0, y: 0 });
      const base = block.position ?? { x: 0, y: 0 };
      const rows = raw.rowCount || 1,
        columns = raw.columnCount || 1;
      if (rows * columns > 10000 || rows < 1 || columns < 1)
        throw new Error('A block array exceeds the preview limit.');
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const local: Matrix = [
            Math.cos(angle) * sx,
            Math.sin(angle) * sx,
            -Math.sin(angle) * sy,
            Math.cos(angle) * sy,
            position.x,
            position.y,
          ];
          const offset: Matrix = [
            1,
            0,
            0,
            1,
            -base.x + (column * (raw.columnSpacing || 0)) / sx,
            -base.y + (row * (raw.rowSpacing || 0)) / sy,
          ];
          for (const child of block.entities || [])
            visit(child as Raw, multiply(matrix, multiply(local, offset)), layer, depth + 1, next);
        }
      return;
    }
    let points: Point[] = [],
      closed = false,
      length: number | undefined,
      area: number | undefined,
      radius: number | undefined,
      axes: [number, number] | undefined,
      approximate = false;
    let text: DrawingEntity['text'];
    const snaps: DrawingEntity['snaps'] = [];
    const snap = (point: Point, kind: DrawingEntity['snaps'][number]['kind']) =>
      snaps.push({ point, kind });
    if (['CIRCLE', 'ARC', 'ELLIPSE'].includes(raw.type)) {
      if (!raw.center || !validPoint(raw.center)) throw new Error('A curve has an invalid center.');
      const major = raw.type === 'ELLIPSE' ? raw.majorAxisEndPoint : { x: raw.radius ?? 0, y: 0 };
      const ratio = raw.type === 'ELLIPSE' ? (raw.axisRatio ?? 1) : 1;
      if (
        !major ||
        !validPoint(major) ||
        distance(major, { x: 0, y: 0 }) <= 0 ||
        ratio <= 0 ||
        !Number.isFinite(ratio)
      )
        throw new Error('A curve has invalid dimensions.');
      const start = raw.type === 'CIRCLE' ? 0 : (raw.startAngle ?? 0),
        end = raw.type === 'CIRCLE' ? tau : (raw.endAngle ?? tau);
      if (!Number.isFinite(start) || !Number.isFinite(end))
        throw new Error('A curve has invalid angles.');
      const delta = sweep(start, end);
      closed = Math.abs(delta - tau) < 1e-9;
      points = curve(raw.center, major, ratio, start, delta);
      snap(raw.center, 'Center');
      if (!closed) {
        const [first] = points,
          last = points.at(-1);
        if (first) snap(first, 'Endpoint');
        if (last) snap(last, 'Endpoint');
      } else
        for (let i = 0; i < 4; i++)
          snap(
            {
              x:
                raw.center.x +
                major.x * Math.cos((i * Math.PI) / 2) -
                major.y * ratio * Math.sin((i * Math.PI) / 2),
              y:
                raw.center.y +
                major.y * Math.cos((i * Math.PI) / 2) +
                major.x * ratio * Math.sin((i * Math.PI) / 2),
            },
            'Quadrant',
          );
      const a = Math.hypot(major.x, major.y);
      if (raw.type === 'ELLIPSE') {
        axes = [a, a * ratio];
        approximate = true;
        if (closed) area = Math.PI * a * a * ratio;
      } else {
        radius = a;
        length = a * delta;
        if (closed) area = Math.PI * a * a;
      }
    } else if (['LINE', 'LWPOLYLINE', 'POLYLINE', 'SOLID', '3DFACE'].includes(raw.type)) {
      const vertices = raw.vertices ?? [];
      if (vertices.length < 2) return;
      if (vertices.length > maxPoints) throw new Error('This entity exceeds the vertex limit.');
      closed = !!raw.shape || raw.type === 'SOLID' || raw.type === '3DFACE';
      const ordered =
        raw.type === 'SOLID' && vertices.length === 4
          ? [vertices[0], vertices[1], vertices[3], vertices[2]]
          : vertices;
      length = 0;
      let curvedArea = 0;
      const count = closed ? ordered.length : ordered.length - 1;
      for (let i = 0; i < count; i++) {
        const a = ordered[i],
          b = ordered[(i + 1) % ordered.length];
        if (!a || !b || !validPoint(a) || !validPoint(b) || !Number.isFinite(a.bulge ?? 0))
          throw new Error('A polyline has invalid vertices.');
        const arc = bulgeArc(a, b, a.bulge ?? 0);
        if (pointCount + points.length + arc.points.length > maxPoints)
          throw new Error('Polyline tessellation exceeds the preview vertex limit.');
        points.push(...arc.points.slice(i ? 1 : 0));
        length += arc.length;
        curvedArea += arc.area;
        snap(a, 'Endpoint');
        snap(arc.points[Math.floor(arc.points.length / 2)] ?? a, 'Midpoint');
        const middle = snaps.at(-1);
        if (!a.bulge && middle) middle.point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      const end = ordered.at(-1);
      if (!closed && end) snap(end, 'Endpoint');
      const origin = ordered[0];
      if (closed && origin) {
        let signed = 0;
        for (let i = 0; i < ordered.length; i++) {
          const a = ordered[i],
            b = ordered[(i + 1) % ordered.length];
          if (!a || !b) continue;
          signed += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
        }
        area = Math.abs(signed / 2 + curvedArea);
      }
    } else if (raw.type === 'SPLINE') {
      // as nesting reads one: in chords within 1/10,000 of its size, or else through its fit points
      const spline = {
        degree: raw.degreeOfSplineCurve ?? 3,
        knots: raw.knotValues ?? [],
        controls: (raw.controlPoints ?? []).filter(validPoint),
      };
      if (spline.controls.length > maxPoints)
        throw new Error('This entity exceeds the vertex limit.');
      points = validSpline(spline)
        ? splinePoints(spline, 1e-4 * extent(spline.controls), maxPoints - pointCount)
        : (raw.fitPoints ?? []).filter(validPoint).map((p) => ({ x: p.x, y: p.y }));
      if (points.length < 2) return;
      const first = points[0]!,
        last = points.at(-1)!;
      closed = !!raw.closed || distance(first, last) < 1e-9;
      if (closed && distance(first, last) >= 1e-9) points.push(first);
      length = pathLength(points);
      if (closed) area = polygonArea(points);
      approximate = true;
      if (!closed) {
        snap(first, 'Endpoint');
        snap(last, 'Endpoint');
      }
    } else if (raw.type === 'POINT') {
      if (raw.position) {
        points = [raw.position];
        snap(raw.position, 'Endpoint');
      }
    } else if (raw.type === 'TEXT' || raw.type === 'MTEXT') {
      const p = raw.startPoint || raw.position;
      if (!p) return;
      points = [p];
      text = {
        value: plainText(raw.text || ''),
        height: Math.max(0.01, raw.textHeight || raw.height || 2.5),
        rotation: ((raw.rotation || 0) * Math.PI) / 180,
      };
      warnings.add('Text uses a substitute font; CAD font metrics and formatting may differ.');
    }
    if (!points.length) return;
    const transformed = points.map((p) => transform(p, matrix));
    for (const item of snaps) item.point = transform(item.point, matrix);
    const scaleX = Math.hypot(matrix[0], matrix[1]),
      scaleY = Math.hypot(matrix[2], matrix[3]);
    const uniform =
      Math.abs(scaleX - scaleY) < 1e-8 &&
      Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) < 1e-8;
    if (length !== undefined && uniform) length *= scaleX;
    else if (!text) {
      length = pathLength(transformed);
      approximate = true;
    }
    if (area !== undefined) area *= Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
    if (radius !== undefined) {
      if (uniform) radius *= scaleX;
      else {
        radius = undefined;
        axes = undefined;
      }
    }
    if (axes) {
      if (uniform) axes = [axes[0] * scaleX, axes[1] * scaleX];
      else axes = undefined;
    }
    if (text) {
      text.height *= scaleY;
      text.rotation += Math.atan2(matrix[1], matrix[0]);
    }
    pointCount += transformed.length;
    if (entities.length >= maxEntities || pointCount > maxPoints)
      throw new Error(
        'This drawing exceeds the geometry limit (50,000 entities or 1,000,000 preview vertices).',
      );
    const color =
      raw.colorIndex === 0 || raw.colorIndex === 256
        ? rawLayers[layer]?.color
        : (raw.color ?? rawLayers[layer]?.color);
    entities.push({
      id: String(entities.length),
      type: raw.type,
      layer,
      color: color === undefined ? undefined : `#${color.toString(16).padStart(6, '0')}`,
      points: transformed,
      snaps,
      closed,
      bounds: boundsOf(transformed),
      length,
      area,
      radius,
      axes,
      approximate,
      text,
    });
    const info = layerMap.get(layer) ?? {
      name: layer,
      visible: rawLayers[layer]?.visible !== false && !rawLayers[layer]?.frozen,
      count: 0,
    };
    info.count++;
    layerMap.set(layer, info);
  };
  for (const raw of data.entities || []) visit(raw as Raw, identity, undefined, 0, new Set());
  if (!entities.length)
    throw new Error(
      `No supported model-space geometry was found.${warnings.size ? ` ${[...warnings].slice(0, 4).join('; ')}.` : ''}`,
    );
  const bounds = boundsOf(entities.flatMap((e) => [e.bounds.min, e.bounds.max]));
  return {
    entities,
    layers: [...layerMap.values()],
    bounds,
    units: typeof data.header?.$INSUNITS === 'number' ? data.header.$INSUNITS : 0,
    warnings: [...warnings],
  };
}
