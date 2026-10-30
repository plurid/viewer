/**
 * Generated cutting parts in millimetres: the playground's nesting set, and the fixtures the
 * nesting tests read. Each is an ASCII DXF as CAD apps export it (AC1027, LWPOLYLINE, CIRCLE).
 */
import type { Sample } from '../types';
import { sample } from './documents';

const entity = (type: string, pairs: (string | number)[]) =>
  ['0', type, ...pairs].join('\n') + '\n';
type Vertex = [x: number, y: number, bulge?: number];

export const cad = {
  line: (layer: string, x0: number, y0: number, x1: number, y1: number) =>
    entity('LINE', [8, layer, 10, x0, 20, y0, 30, 0, 11, x1, 21, y1, 31, 0]),
  circle: (layer: string, x: number, y: number, radius: number) =>
    entity('CIRCLE', [8, layer, 10, x, 20, y, 30, 0, 40, radius]),
  /** Degrees, counter-clockwise. */
  arc: (layer: string, x: number, y: number, radius: number, start: number, end: number) =>
    entity('ARC', [8, layer, 10, x, 20, y, 30, 0, 40, radius, 50, start, 51, end]),
  polyline: (layer: string, vertices: readonly Vertex[], closed = true) =>
    entity('LWPOLYLINE', [
      8,
      layer,
      90,
      vertices.length,
      70,
      closed ? 1 : 0,
      ...vertices.flatMap(([x, y, bulge]) => [10, x, 20, y, ...(bulge ? [42, bulge] : [])]),
    ]),
  /** Lines from point to point, back to the first. */
  outline: (layer: string, points: readonly [number, number][]) =>
    points
      .map(([x, y], index) => {
        const [nx, ny] = points[(index + 1) % points.length]!;
        return cad.line(layer, x, y, nx, ny);
      })
      .join(''),
  ellipse: (layer: string, x: number, y: number, major: number, ratio: number) =>
    entity('ELLIPSE', [
      8,
      layer,
      10,
      x,
      20,
      y,
      30,
      0,
      11,
      major,
      21,
      0,
      31,
      0,
      40,
      ratio,
      41,
      0,
      42,
      Math.PI * 2,
    ]),
  text: (layer: string, x: number, y: number, height: number, value: string) =>
    entity('TEXT', [8, layer, 10, x, 20, y, 30, 0, 40, height, 1, value]),
};
/** A drawing in `units` (`$INSUNITS`), or with `null`, one that does not say its units. */
export function drawing(entities: readonly string[], units: number | null = 4): string {
  const header =
    '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n' +
    (units === null ? '' : `9\n$INSUNITS\n70\n${units}\n`) +
    '0\nENDSEC\n';
  return header + '0\nSECTION\n2\nENTITIES\n' + entities.join('') + '0\nENDSEC\n0\nEOF\n';
}
const rectangle = (width: number, height: number): [number, number][] => [
  [0, 0],
  [width, 0],
  [width, height],
  [0, height],
];
/** A rounded rectangle as one closed polyline: quarter-circle bulges at its corners. */
const rounded = (width: number, height: number, r: number): Vertex[] => {
  const b = Math.tan(Math.PI / 8);
  return [
    [r, 0],
    [width - r, 0, b],
    [width, r],
    [width, height - r, b],
    [width - r, height],
    [r, height, b],
    [0, height - r],
    [0, r, b],
  ];
};
const regular = (sides: number, radius: number, inner = radius): Vertex[] =>
  Array.from({ length: sides * (inner === radius ? 1 : 2) }, (_, i) => {
    const step = inner === radius ? sides : sides * 2;
    const r = i % 2 && inner !== radius ? inner : radius;
    const angle = (i / step) * Math.PI * 2 + Math.PI / 2;
    return [radius + r * Math.cos(angle), radius + r * Math.sin(angle)];
  });

/** Parts named as a workshop would name them. */
export const nestingParts = {
  'Bracket with holes': () =>
    drawing([
      cad.polyline('CUT', rounded(300, 200, 20)),
      ...[
        [40, 40],
        [260, 40],
        [40, 160],
        [260, 160],
      ].map(([x, y]) => cad.circle('CUT', x!, y!, 10)),
      cad.text('ENGRAVE', 120, 95, 10, 'BRK-1'),
    ]),
  Ring: () => drawing([cad.circle('0', 150, 150, 150), cad.circle('0', 150, 150, 100)]),
  Disc: () => drawing([cad.circle('0', 75, 75, 75)]),
  'L-shape': () =>
    drawing([
      cad.polyline('CUT', [
        [0, 0],
        [400, 0],
        [400, 100],
        [100, 100],
        [100, 300],
        [0, 300],
      ]),
    ]),
  Triangle: () =>
    drawing([
      cad.outline('CUT', [
        [0, 0],
        [300, 0],
        [150, 260],
      ]),
    ]),
  Hexagon: () => drawing([cad.polyline('CUT', regular(6, 100))]),
  Gusset: () =>
    drawing([
      cad.outline('CUT', [
        [0, 0],
        [250, 0],
        [0, 250],
      ]),
      cad.circle('CUT', 60, 60, 15),
    ]),
  Flange: () =>
    drawing([
      cad.circle('CUT', 125, 125, 125),
      cad.circle('CUT', 125, 125, 50),
      ...Array.from({ length: 6 }, (_, i) =>
        cad.circle(
          'CUT',
          125 + 90 * Math.cos((i * Math.PI) / 3),
          125 + 90 * Math.sin((i * Math.PI) / 3),
          9,
        ),
      ),
    ]),
  Strip: () => drawing([cad.outline('CUT', rectangle(800, 60))]),
  'T-shape': () =>
    drawing([
      cad.polyline('CUT', [
        [110, 0],
        [190, 0],
        [190, 220],
        [300, 220],
        [300, 300],
        [0, 300],
        [0, 220],
        [110, 220],
      ]),
    ]),
  'U-channel': () =>
    drawing([
      cad.polyline('CUT', [
        [0, 0],
        [400, 0],
        [400, 200],
        [340, 200],
        [340, 60],
        [60, 60],
        [60, 200],
        [0, 200],
      ]),
    ]),
  Star: () => drawing([cad.polyline('CUT', regular(5, 150, 60))]),
  Washer: () => drawing([cad.circle('CUT', 40, 40, 40), cad.circle('CUT', 40, 40, 20)]),
  Tab: () => drawing([cad.outline('CUT', rectangle(60, 40)), cad.line('MARK', 10, 20, 50, 20)]),
  'Arc segment': () =>
    drawing([
      cad.arc('CUT', 0, 0, 300, 0, 90),
      cad.arc('CUT', 0, 0, 200, 0, 90),
      cad.line('CUT', 200, 0, 300, 0),
      cad.line('CUT', 0, 200, 0, 300),
    ]),
  Cross: () =>
    drawing([
      cad.polyline('CUT', [
        [90, 0],
        [160, 0],
        [160, 90],
        [250, 90],
        [250, 160],
        [160, 160],
        [160, 250],
        [90, 250],
        [90, 160],
        [0, 160],
        [0, 90],
        [90, 90],
      ]),
    ]),
  'Slotted plate': () =>
    drawing([
      cad.outline('CUT', rectangle(500, 150)),
      cad.polyline('CUT', [
        [150, 60],
        [350, 60, 1],
        [350, 90],
        [150, 90, 1],
      ]),
    ]),
  Trapezoid: () =>
    drawing([
      cad.outline('CUT', [
        [0, 0],
        [400, 0],
        [300, 150],
        [100, 150],
      ]),
    ]),
  Oval: () => drawing([cad.ellipse('CUT', 150, 75, 150, 0.5)]),
  'Corner plate': () =>
    drawing([cad.polyline('CUT', rounded(180, 180, 30)), cad.circle('CUT', 90, 90, 40)]),
} satisfies Record<string, () => string>;
export type NestingPartName = keyof typeof nestingParts;

/** Four parts for Layout › Nesting: a bracket with holes and a mark, a ring whose hole takes the
 * disc, and an L-shape that interlocks with itself. */
export function nestingSamples(): Sample[] {
  const names: NestingPartName[] = ['Bracket with holes', 'Ring', 'Disc', 'L-shape'];
  return names.map((name) =>
    sample(
      `layout/nesting/${name}.dxf`,
      ['dxf'],
      'Layout plane, Nesting mode',
      'A millimetre cutting part for nesting on stock sheets.',
      nestingParts[name](),
    ),
  );
}
