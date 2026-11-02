import { readCutDrawing, primitivePoints } from '../layout/nesting/drawing';
import { partDXF } from '../layout/nesting/dxf-writer';
import { extractParts } from '../layout/nesting/parts';
import { parseDrawing } from '../previews/drawings/dxf/geometry';
import { measureDrawing } from '../fabrication/measure';

const entityTypes = new Set([
  'LINE',
  'ARC',
  'CIRCLE',
  'LWPOLYLINE',
  'POLYLINE',
  'VERTEX',
  'SEQEND',
]);
const sections = new Set(['HEADER', 'TABLES', 'ENTITIES']);

/** Restrict generated drawings before the general-purpose DXF readers allocate geometry. */
function checkGroups(content: string): number {
  if (new TextEncoder().encode(content).length > 1_000_000)
    throw new Error('Keep this drawing within 1 MB.');
  const lines = content.trimEnd().split(/\r?\n/);
  if (lines.length % 2 || lines.length > 30_000)
    throw new Error('Use a complete ASCII DXF with at most 15,000 groups.');
  const seen = new Set<string>();
  let section = '';
  let entity = '';
  let entities = 0;
  let vertices = 0;
  let ended = false;
  for (let index = 0; index < lines.length; index += 2) {
    const codeText = lines[index]!.trim();
    const code = Number(codeText);
    const value = lines[index + 1]!.trim();
    if (!/^\d+$/.test(codeText) || code > 1071 || ended)
      throw new Error('Use a complete ASCII DXF without trailing data.');
    if (code === 0) {
      if (value === 'SECTION') {
        const name = lines[index + 3]?.trim() ?? '';
        if (section || lines[index + 2]?.trim() !== '2' || !sections.has(name) || seen.has(name))
          throw new Error('Use HEADER, TABLES and ENTITIES only, with no blocks or embedded data.');
        seen.add(name);
        section = name;
        entity = '';
        index += 2;
        continue;
      }
      if (value === 'ENDSEC') {
        if (!section) throw new Error('The DXF has an unmatched ENDSEC.');
        section = '';
        continue;
      }
      if (value === 'EOF') {
        if (section || !seen.has('ENTITIES')) throw new Error('The DXF is incomplete.');
        ended = true;
        continue;
      }
      if (!section) throw new Error('The DXF has data outside a section.');
      if (section === 'ENTITIES') {
        if (!entityTypes.has(value))
          throw new Error(
            `Use lines, arcs, circles and polylines for cuts. ${value} is not supported.`,
          );
        entity = value;
        if (value !== 'VERTEX' && value !== 'SEQEND' && ++entities > 256)
          throw new Error('Keep this drawing within 256 cut entities.');
      }
    }
    if (section !== 'ENTITIES') continue;
    if (code === 10 && ++vertices > 2048)
      throw new Error('Keep this drawing within 2,048 vertices.');
    if (code >= 10 && code <= 59) {
      const number = Number(value);
      if (!value || !Number.isFinite(number) || Math.abs(number) > 10_000)
        throw new Error('Use finite drawing coordinates within 10,000 mm of the origin.');
      if (code >= 30 && code <= 39 && number !== 0)
        throw new Error('Put every cut in the XY plane with zero thickness and elevation.');
      if ((entity === 'CIRCLE' || entity === 'ARC') && code === 40 && number <= 0)
        throw new Error('Use a positive radius for every circle and arc.');
      if (
        (entity === 'LWPOLYLINE' || entity === 'POLYLINE' || entity === 'VERTEX') &&
        (code === 40 || code === 41 || code === 43) &&
        number !== 0
      )
        throw new Error('Use zero-width polylines for cutting paths.');
    }
    if ((code === 60 || code === 67) && Number(value) !== 0)
      throw new Error('Use visible model-space cut entities only.');
    if (
      ((code === 210 || code === 220) && Number(value) !== 0) ||
      (code === 230 && Number(value) !== 1)
    )
      throw new Error('Use the XY plane for every cut.');
    if (
      code === 70 &&
      (entity === 'POLYLINE' || entity === 'LWPOLYLINE' || entity === 'VERTEX') &&
      (!Number.isInteger(Number(value)) || (Number(value) & ~129) !== 0)
    )
      throw new Error('Use planar polylines without mesh or spline flags.');
  }
  if (!ended || !seen.has('HEADER') || !entities)
    throw new Error('Include a DXF header, cut entities and EOF.');
  return entities;
}

/** Save only the geometry we can show and measure; never silently discard unsupported entities. */
export function prepareCanvasDrawing(content: string) {
  const entities = checkGroups(content);
  const cuts = readCutDrawing(content);
  if (cuts.units !== 4) throw new Error('Set DXF $INSUNITS to 4 (millimetres).');
  if (
    cuts.primitives.length !== entities ||
    Object.keys(cuts.skipped).length ||
    cuts.layers.some((layer) => layer.hidden)
  )
    throw new Error('Remove hidden or unsupported entities before exporting the drawing.');
  let points = 0;
  const ends: { x: number; y: number }[] = [];
  for (const primitive of cuts.primitives) {
    const path = primitivePoints(primitive, 0.01);
    points += path.length;
    if (points > 8192) throw new Error('Simplify the drawing to at most 8,192 preview points.');
    if (
      path.length < 2 ||
      path.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          Math.abs(p.x) > 10_000 ||
          Math.abs(p.y) > 10_000,
      )
    )
      throw new Error('Keep every cutting path within 10,000 mm of the origin.');
    const closed =
      (primitive.kind === 'polyline' && primitive.closed) ||
      (primitive.kind === 'arc' && Math.abs(primitive.sweep - Math.PI * 2) < 1e-9);
    if (!closed) ends.push(path[0]!, path.at(-1)!);
  }
  // The fabrication reader tolerates small joins. An export must not silently bridge them.
  if (
    ends.some(
      (point, index) =>
        ends.filter(
          (other, otherIndex) =>
            index !== otherIndex && Math.hypot(point.x - other.x, point.y - other.y) <= 1e-6,
        ).length !== 1,
    )
  )
    throw new Error('Join each cut endpoint exactly to one other endpoint.');
  const parts = extractParts(cuts, { scale: 1, marks: new Set(), together: false }, 'Drawing');
  if (parts.problem || parts.notes.length || !parts.parts.length)
    throw new Error('Use closed cutting outlines without gaps, duplicates or loose paths.');
  const canonical = partDXF({
    primitives: cuts.primitives,
    units: 4,
    layers: cuts.layers.map((layer) => layer.name),
  });
  const drawing = parseDrawing(canonical);
  const measured = measureDrawing(drawing);
  if (drawing.warnings.length || measured.status === 'refused')
    throw new Error('The drawing could not be fully measured. Check its outlines and units.');
  return { content: canonical, drawing, measurement: measured.measurement };
}
