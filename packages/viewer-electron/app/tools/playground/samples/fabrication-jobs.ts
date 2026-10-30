/**
 * THE LIVE EVALUATION'S JOBS, for tools/fabrication/evaluate-live.ts: eight small laser jobs, each a
 * request message, one or two dimensioned drawings with a parts list and a title block, one to three
 * AutoCAD 2010 DXF parts and, for three of them, a photo of a part. Six jobs have one or two problems
 * planted; two are controls with none. Some name their parts in the `g<mm>-<part>-<n>buc` convention,
 * others plainly ("Bracket B2.dxf"). Each job's truth says what is planted and where its drawings
 * and photos show each feature. Every part, customer and address is fictional.
 */
import { crc32, deflateSync } from 'node:zlib';
import type { CadEntity } from './fabrication';
import { advance, autocadDXF, base64Lines, hole, outline, pdfText, plate } from './fabrication';

type XY = [x: number, y: number];

/** The problems a check is meant to find. */
export const plantedKinds = [
  'pitch',
  'diameter',
  'thickness',
  'quantity',
  'missing-dxf',
  'piece-count',
] as const;
export type PlantedKind = (typeof plantedKinds)[number];
export const plantedLabels: Record<PlantedKind, string> = {
  pitch: 'Hole pitch differs',
  diameter: 'Hole diameter differs',
  thickness: 'Thickness differs',
  quantity: 'Quantity differs',
  'missing-dxf': 'Requested part has no DXF',
  'piece-count': 'Pieces per drawing leave the count open',
};
/** How a job names its DXF files. */
export type JobNaming = 'convention' | 'plain' | 'mixed';
/** `[left, top, right, bottom]` as fractions of a page or photo, from its top-left corner. */
export type FractionBox = [left: number, top: number, right: number, bottom: number];

/** What a region is: text, such as a dimension, a parts list's row or a title block's line, or a
 * feature, such as a piece, a hole or a part in a photo. */
export type TruthRegionKind = 'text' | 'feature';
/** A region's shape in its box: the box itself, or the ellipse it holds, as a hole is. */
export type TruthShape = 'box' | 'ellipse';
/** A feature or text a drawing page or photo shows, where it is. */
export interface TruthRegion {
  file: string;
  /** A drawing's page; a photo has none. */
  page?: number;
  label: string;
  kind: TruthRegionKind;
  shape: TruthShape;
  box: FractionBox;
}
export interface PlantedProblem {
  id: string;
  kind: PlantedKind;
  /** The part's code, as the drawing's parts list gives it: "TP40-A1", "B2". */
  part: string;
  /** The part's DXF; absent when the request names a part without one. */
  dxf?: string;
  /** The request's or drawing's value: millimetres, or pieces. */
  expected: number;
  /** What the other source gives: the DXF, title block or name, or the pieces a drawing holds. */
  found?: number;
  description: string;
}
/** A part as the request asks for it. */
export interface RequestedPart {
  part: string;
  title: string;
  quantity: number;
  thickness: number;
  material: string;
  dxf?: string;
}
export interface LiveJobTruth {
  /** J1 … J8. */
  id: string;
  /** The job's folder: "Job 2101". */
  job: string;
  naming: JobNaming;
  control: boolean;
  requested: RequestedPart[];
  problems: PlantedProblem[];
  regions: TruthRegion[];
}
export interface LiveJob {
  truth: LiveJobTruth;
  files: { name: string; bytes: Uint8Array }[];
}

interface Hole {
  at: XY;
  diameter: number;
}
/** One separate piece: a rectangle with rounded corners, or a polygon, with round holes. */
interface Piece {
  width: number;
  height: number;
  radius?: number;
  points?: XY[];
  holes: Hole[];
}
/** What the DXF draws other than the drawing gives: a hole moved or resized. */
interface Drift {
  piece?: number;
  hole: number;
  at?: XY;
  diameter?: number;
}
interface PartSpec {
  code: string;
  /** Short, as a parts list writes it: "Top plate". */
  title: string;
  thickness: number;
  quantity: number;
  /** The DXF's name; none when the job leaves it out. */
  file?: string;
  pieces: Piece[];
  drift?: Drift[];
}
/** What a drawing's title block and parts list give, where they differ from the request. */
interface DrawingSpec {
  file: string;
  number: string;
  part: string;
  thickness?: number;
  quantity?: number | string;
  note: string;
}
interface PhotoSpec {
  file: string;
  part: string;
}
interface JobSpec {
  id: string;
  number: number;
  naming: JobNaming;
  material: string;
  customer: { name: string; address: string };
  parts: PartSpec[];
  drawings: DrawingSpec[];
  photos: PhotoSpec[];
  /** The request's text, from its parts; written out for styles that need its own words. */
  request: (parts: readonly PartSpec[]) => string;
  problems: Omit<PlantedProblem, 'id'>[];
}

const square = (width: number, height: number, holes: Hole[], radius = 0): Piece => ({
  width,
  height,
  radius,
  holes,
});
const holes = (diameter: number, ...centres: XY[]): Hole[] =>
  centres.map((at) => ({ at, diameter }));
const convention = (thickness: number, code: string, quantity?: number) =>
  `g${thickness}-${code}${quantity === undefined ? '' : `-${quantity}buc`}.dxf`;
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const jobSpecs: JobSpec[] = [
  {
    id: 'J1',
    number: 2101,
    naming: 'convention',
    material: 'S235JR steel',
    customer: { name: 'Ioana Marin', address: 'ioana.marin@example.invalid' },
    parts: [
      {
        code: 'TP40-A1',
        title: 'Top plate',
        thickness: 5,
        quantity: 4,
        file: convention(5, 'TP40-A1', 4),
        pieces: [
          square(
            130,
            90,
            [...holes(9, [20, 20], [80, 20], [20, 70], [80, 70]), ...holes(25, [108, 45])],
            6,
          ),
        ],
        drift: [
          { hole: 1, at: [78, 20] },
          { hole: 3, at: [78, 70] },
        ],
      },
      {
        code: 'SP12-B1',
        title: 'Spacer',
        thickness: 5,
        quantity: 8,
        file: convention(5, 'SP12-B1', 8),
        pieces: [square(50, 50, holes(12.5, [25, 25]))],
      },
    ],
    drawings: [
      {
        file: 'Job 2101 drawing.pdf',
        number: '2101-01',
        part: 'TP40-A1',
        note: 'Laser cut. Remove burrs. Holes 4× Ø9 at 60 × 50 mm, centre hole Ø25.',
      },
    ],
    photos: [{ file: 'TP40-A1 sample.png', part: 'TP40-A1' }],
    request: (parts) => `Hello,

Please cut the following for job 2101, all in S235JR steel:

${listLines(parts)}

The top plate drawing is attached, with a photo of the sample we have.

Thanks,
Ioana
`,
    problems: [
      {
        kind: 'pitch',
        part: 'TP40-A1',
        dxf: 'g5-TP40-A1-4buc.dxf',
        expected: 60,
        found: 58,
        description:
          'The DXF puts the top plate’s right holes 58 mm from the left ones along x; the drawing gives 60 mm.',
      },
    ],
  },
  {
    id: 'J2',
    number: 2102,
    naming: 'plain',
    material: 'AlMg3 aluminium',
    customer: { name: 'Victor Stan', address: 'victor.stan@example.invalid' },
    parts: [
      {
        code: 'B2',
        title: 'Bracket',
        thickness: 4,
        quantity: 6,
        file: 'Bracket B2.dxf',
        pieces: [square(120, 60, holes(8.5, [20, 30], [60, 30], [100, 30]), 4)],
        drift: [{ hole: 1, diameter: 10 }],
      },
      {
        code: 'S4',
        title: 'Spacer',
        thickness: 4,
        quantity: 12,
        file: 'Spacer S4.dxf',
        pieces: [square(40, 40, holes(10.5, [20, 20]))],
      },
    ],
    drawings: [
      {
        file: 'Bracket B2.pdf',
        number: '2102-01',
        part: 'B2',
        quantity: 8,
        note: 'Laser cut. Remove burrs. Holes 3× Ø8.5 at 40 mm pitch.',
      },
    ],
    photos: [],
    request: () => `Hi,

For job 2102 we need 6 pieces of Bracket B2 in 4 mm AlMg3, and 12 pieces of Spacer S4, also 4 mm AlMg3.

The bracket drawing is attached. Could you quote by Friday?

Regards,
Victor
`,
    problems: [
      {
        kind: 'diameter',
        part: 'B2',
        dxf: 'Bracket B2.dxf',
        expected: 8.5,
        found: 10,
        description: 'The DXF cuts the bracket’s middle hole Ø10; the drawing gives 3× Ø8.5.',
      },
      {
        kind: 'quantity',
        part: 'B2',
        dxf: 'Bracket B2.dxf',
        expected: 6,
        found: 8,
        description: 'The request asks for 6 brackets; the drawing’s title block gives 8 pieces.',
      },
    ],
  },
  {
    id: 'J3',
    number: 2103,
    naming: 'convention',
    material: 'S355 steel',
    customer: { name: 'Elena Radu', address: 'elena.radu@example.invalid' },
    parts: [
      {
        code: 'FL30-C2',
        title: 'Flange plate',
        thickness: 5,
        quantity: 2,
        file: convention(5, 'FL30-C2', 2),
        pieces: [
          square(
            100,
            100,
            [...holes(11, [15, 15], [85, 15], [15, 85], [85, 85]), ...holes(40, [50, 50])],
            10,
          ),
        ],
      },
      {
        code: 'CL10-D1',
        title: 'Clip',
        thickness: 3,
        quantity: 6,
        file: convention(3, 'CL10-D1', 6),
        pieces: [square(60, 25, holes(6.5, [12, 12.5], [48, 12.5]), 2)],
      },
    ],
    drawings: [
      {
        file: 'Job 2103 drawing.pdf',
        number: '2103-01',
        part: 'FL30-C2',
        thickness: 4,
        note: 'Laser cut. Remove burrs. Holes 4× Ø11 on a 70 mm square, centre bore Ø40.',
      },
    ],
    photos: [],
    request: (parts) => `Good morning,

Job 2103, in S355 steel:

${listLines(parts)}

Drawing attached for the flange plate.

Elena
`,
    problems: [
      {
        kind: 'thickness',
        part: 'FL30-C2',
        dxf: 'g5-FL30-C2-2buc.dxf',
        expected: 5,
        found: 4,
        description:
          'The request asks for the flange plate in 5 mm; the drawing’s title block gives 4 mm.',
      },
    ],
  },
  {
    id: 'J4',
    number: 2104,
    naming: 'plain',
    material: 'S235JR steel',
    customer: { name: 'Andrei Toma', address: 'andrei.toma@example.invalid' },
    parts: [
      {
        code: 'B7',
        title: 'Base',
        thickness: 8,
        quantity: 3,
        file: 'Base B7.dxf',
        pieces: [square(130, 90, holes(13, [20, 20], [110, 20], [20, 70], [110, 70]), 8)],
        drift: [{ hole: 3, diameter: 12 }],
      },
      {
        code: 'R3',
        title: 'Rib',
        thickness: 8,
        quantity: 6,
        file: 'Rib R3.dxf',
        pieces: [square(80, 30, holes(8.5, [15, 15], [65, 15]))],
      },
      { code: 'C5', title: 'Cover', thickness: 3, quantity: 2, pieces: [] },
    ],
    drawings: [
      {
        file: 'Base B7.pdf',
        number: '2104-01',
        part: 'B7',
        note: 'Laser cut. Remove burrs. Holes 4× Ø13 at 90 × 50 mm.',
      },
    ],
    photos: [{ file: 'Base B7.png', part: 'B7' }],
    request: (parts) => `Hello,

Job 2104, S235JR steel, as follows:

${colonLines(parts)}

The base drawing and a photo of the last batch are attached.

Andrei
`,
    problems: [
      {
        kind: 'diameter',
        part: 'B7',
        dxf: 'Base B7.dxf',
        expected: 13,
        found: 12,
        description: 'The DXF cuts the base’s top right hole Ø12; the drawing gives 4× Ø13.',
      },
      {
        kind: 'missing-dxf',
        part: 'C5',
        expected: 2,
        description: 'The request asks for 2 covers C5, and the job has no DXF for them.',
      },
    ],
  },
  {
    id: 'J5',
    number: 2105,
    naming: 'convention',
    material: 'S235JR steel',
    customer: { name: 'Mihai Pavel', address: 'mihai.pavel@example.invalid' },
    parts: [
      {
        code: 'SB40-LR',
        title: 'Side brackets L/R',
        thickness: 3,
        quantity: 5,
        file: convention(3, 'SB40-LR'),
        pieces: [
          square(40, 70, holes(8.5, [12, 15], [12, 55]), 3),
          square(40, 70, holes(8.5, [28, 15], [28, 55]), 3),
        ],
      },
      {
        code: 'PL25-E2',
        title: 'Mounting plate',
        thickness: 4,
        quantity: 4,
        file: convention(4, 'PL25-E2', 4),
        pieces: [square(110, 80, holes(10.5, [20, 15], [90, 15], [20, 65], [90, 65]), 5)],
        drift: [
          { hole: 2, at: [20, 63] },
          { hole: 3, at: [90, 63] },
        ],
      },
    ],
    drawings: [
      {
        file: 'SB40-LR drawing.pdf',
        number: '2105-01',
        part: 'SB40-LR',
        quantity: 'as ordered',
        note: 'Laser cut. Left and right brackets, mirrored. Holes Ø8.5.',
      },
      {
        file: 'PL25-E2 drawing.pdf',
        number: '2105-02',
        part: 'PL25-E2',
        note: 'Laser cut. Remove burrs. Holes 4× Ø10.5 at 70 × 50 mm.',
      },
    ],
    photos: [],
    request: () => `Hi,

Job 2105 in S235JR steel:

- SB40-LR side brackets, left and right, 3 mm, 5 pieces
- PL25-E2 mounting plate, 4 mm, 4 pieces

Both drawings are attached.

Mihai
`,
    problems: [
      {
        kind: 'piece-count',
        part: 'SB40-LR',
        dxf: 'g3-SB40-LR.dxf',
        expected: 5,
        found: 2,
        description:
          'The request asks for 5 side brackets; the DXF holds a left and a right, so 5 is not a whole number of sets.',
      },
      {
        kind: 'pitch',
        part: 'PL25-E2',
        dxf: 'g4-PL25-E2-4buc.dxf',
        expected: 50,
        found: 48,
        description:
          'The DXF puts the mounting plate’s top holes 48 mm above the bottom ones; the drawing gives 50 mm.',
      },
    ],
  },
  {
    id: 'J6',
    number: 2106,
    naming: 'mixed',
    material: 'DC01 steel',
    customer: { name: 'Sorina Lupu', address: 'sorina.lupu@example.invalid' },
    parts: [
      {
        code: 'CL15-A1',
        title: 'Cable clamp',
        thickness: 2,
        quantity: 10,
        file: convention(2, 'CL15-A1', 12),
        pieces: [square(70, 30, holes(6.5, [12, 15], [58, 15]), 3)],
      },
      {
        code: 'K2',
        title: 'Gusset',
        thickness: 2,
        quantity: 4,
        file: 'Gusset K2.dxf',
        pieces: [
          {
            width: 80,
            height: 80,
            points: [
              [0, 0],
              [80, 0],
              [80, 15],
              [15, 80],
              [0, 80],
            ],
            holes: holes(8.5, [40, 8], [8, 40]),
          },
        ],
      },
      { code: 'W1', title: 'Washer plate', thickness: 2, quantity: 20, pieces: [] },
    ],
    drawings: [
      {
        file: 'Job 2106 drawing.pdf',
        number: '2106-01',
        part: 'CL15-A1',
        note: 'Laser cut. Remove burrs. Holes 2× Ø6.5 at 46 mm pitch.',
      },
    ],
    photos: [],
    request: () => `Hello,

For job 2106, all in 2 mm DC01 steel, please cut:
10 pieces of CL15-A1 cable clamp,
4 pieces of Gusset K2,
20 pieces of Washer plate W1.

The clamp drawing is attached.

Sorina
`,
    problems: [
      {
        kind: 'quantity',
        part: 'CL15-A1',
        dxf: 'g2-CL15-A1-12buc.dxf',
        expected: 10,
        found: 12,
        description: 'The request asks for 10 cable clamps; the DXF’s name gives 12 (“12buc”).',
      },
      {
        kind: 'missing-dxf',
        part: 'W1',
        expected: 20,
        description: 'The request asks for 20 washer plates W1, and the job has no DXF for them.',
      },
    ],
  },
  {
    id: 'J7',
    number: 2107,
    naming: 'convention',
    material: 'S235JR steel',
    customer: { name: 'Radu Ilie', address: 'radu.ilie@example.invalid' },
    parts: [
      {
        code: 'HP50-A3',
        title: 'Hinge plate',
        thickness: 6,
        quantity: 2,
        file: convention(6, 'HP50-A3', 2),
        pieces: [
          square(
            130,
            70,
            holes(9, [20, 20], [65, 20], [110, 20], [20, 50], [65, 50], [110, 50]),
            5,
          ),
        ],
      },
      {
        code: 'SP20-B3',
        title: 'Spacer',
        thickness: 6,
        quantity: 4,
        file: convention(6, 'SP20-B3', 4),
        pieces: [square(45, 45, holes(14, [22.5, 22.5]))],
      },
    ],
    drawings: [
      {
        file: 'Job 2107 drawing.pdf',
        number: '2107-01',
        part: 'HP50-A3',
        note: 'Laser cut. Remove burrs. Holes 6× Ø9 at 45 × 30 mm.',
      },
    ],
    photos: [{ file: 'HP50-A3 sample.png', part: 'HP50-A3' }],
    request: (parts) => `Hello,

Job 2107, S235JR steel:

${listLines(parts)}

Drawing and a photo of the hinge plate attached.

Radu
`,
    problems: [],
  },
  {
    id: 'J8',
    number: 2108,
    naming: 'plain',
    material: 'AlMg3 aluminium',
    customer: { name: 'Carmen Dobre', address: 'carmen.dobre@example.invalid' },
    parts: [
      {
        code: 'P9',
        title: 'Plate',
        thickness: 3,
        quantity: 5,
        file: 'Plate P9.dxf',
        pieces: [square(100, 60, holes(8.5, [15, 15], [85, 15], [15, 45], [85, 45]), 4)],
      },
      {
        code: 'P4',
        title: 'Tab pair',
        thickness: 3,
        quantity: 4,
        file: 'Tab pair P4.dxf',
        pieces: [
          square(40, 60, holes(6.5, [10, 15], [10, 45])),
          square(40, 60, holes(6.5, [30, 15], [30, 45])),
        ],
      },
    ],
    drawings: [
      {
        file: 'Plate P9.pdf',
        number: '2108-01',
        part: 'P9',
        note: 'Laser cut. Remove burrs. Holes 4× Ø8.5 at 70 × 30 mm.',
      },
    ],
    photos: [],
    request: () => `Hi,

Job 2108, AlMg3 aluminium:

Plate P9: 3 mm, 5 pcs
Tab pair P4, left and right: 3 mm, 4 pcs (2 of each)

Plate drawing attached.

Carmen
`,
    problems: [],
  },
];

function listLines(parts: readonly PartSpec[]) {
  return parts
    .map(
      (part) =>
        `- ${part.code} ${lower(part.title)}, ${part.thickness} mm, ${part.quantity} pieces`,
    )
    .join('\n');
}
function colonLines(parts: readonly PartSpec[]) {
  return parts
    .map((part) => `${part.title} ${part.code}: ${part.thickness} mm, ${part.quantity} pcs`)
    .join('\n');
}

/** A part's pieces as the DXF draws them: side by side, 10 mm apart, its drift applied. */
function partEntities(part: PartSpec): CadEntity[] {
  const entities: CadEntity[] = [];
  let left = 0;
  part.pieces.forEach((piece, index) => {
    const shift = ([x, y]: XY): XY => [x + left, y];
    const body = piece.points
      ? outline(piece.points.map(shift))
      : plate(piece.width, piece.height, piece.radius ?? 0).map((entity) =>
          entity.kind === 'line'
            ? { ...entity, a: shift(entity.a), b: shift(entity.b) }
            : { ...entity, centre: shift(entity.centre) },
        );
    entities.push(...body);
    piece.holes.forEach((drawn, number) => {
      const drift = part.drift?.find((item) => (item.piece ?? 0) === index && item.hole === number);
      entities.push(...hole(shift(drift?.at ?? drawn.at), drift?.diameter ?? drawn.diameter));
    });
    left += piece.width + 10;
  });
  return entities;
}

const page = { width: 842, height: 595 };
/** Points per millimetre at 1:1. */
const k = 72 / 25.4;
/** Millimetres between the pieces of a drawing of several. */
const pieceGap = 55;
const decimals = (value: number) => String(Number(value.toFixed(2)));
const fraction = (value: number) => Number(Math.max(0, Math.min(1, value)).toFixed(4));

/** A page of vector lines and real Helvetica text, and the regions of what it draws. */
function sheet(file: string) {
  const ops: string[] = [];
  const regions: TruthRegion[] = [];
  const n = (value: number) => Number(value.toFixed(2));
  const mark = (
    label: string,
    points: readonly (readonly [number, number])[],
    kind: TruthRegionKind = 'text',
    shape: TruthShape = 'box',
  ) => {
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    regions.push({
      file,
      page: 1,
      label,
      kind,
      shape,
      box: [
        fraction(Math.min(...xs) / page.width),
        fraction(1 - Math.max(...ys) / page.height),
        fraction(Math.max(...xs) / page.width),
        fraction(1 - Math.min(...ys) / page.height),
      ],
    });
  };
  /** The corners of a run of text, from its baseline. */
  const textBox = (x: number, y: number, size: number, value: string) =>
    [
      [x, y - 0.25 * size],
      [x + advance(value) * size, y + 0.75 * size],
    ] as const;
  return {
    ops,
    regions,
    n,
    mark,
    textBox,
    stroke: (width: number) => ops.push(`${n(width)} w`),
    segment: (a: readonly [number, number], b: readonly [number, number]) =>
      ops.push(`${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S`),
    text(x: number, y: number, size: number, value: string, bold = false) {
      ops.push(
        `BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(x)} ${n(y)} Td ${pdfText(value)} Tj ET`,
      );
      return textBox(x, y, size, value);
    },
    arrow(tip: readonly [number, number], dx: number, dy: number) {
      const length = 7,
        half = 2;
      const bx = tip[0] - dx * length,
        by = tip[1] - dy * length;
      ops.push(
        `${n(tip[0])} ${n(tip[1])} m ${n(bx - dy * half)} ${n(by + dx * half)} l ` +
          `${n(bx + dy * half)} ${n(by - dx * half)} l f`,
      );
    },
    circle(x: number, y: number, p: number) {
      const c = p * 0.5523;
      ops.push(
        `${n(x + p)} ${n(y)} m ${n(x + p)} ${n(y + c)} ${n(x + c)} ${n(y + p)} ${n(x)} ${n(y + p)} c ` +
          `${n(x - c)} ${n(y + p)} ${n(x - p)} ${n(y + c)} ${n(x - p)} ${n(y)} c ` +
          `${n(x - p)} ${n(y - c)} ${n(x - c)} ${n(y - p)} ${n(x)} ${n(y - p)} c ` +
          `${n(x + c)} ${n(y - p)} ${n(x + p)} ${n(y - c)} ${n(x + p)} ${n(y)} c S`,
      );
    },
  };
}
type Sheet = ReturnType<typeof sheet>;

/** One piece drawn at 1:1 from `origin`, its outline, holes, dimensions and diameter callouts. */
function drawPiece(s: Sheet, piece: Piece, origin: XY, label: string) {
  const at = (x: number, y: number) => [origin[0] + x * k, origin[1] + y * k] as const;
  const mm = (x1: number, y1: number, x2: number, y2: number) => s.segment(at(x1, y1), at(x2, y2));
  s.stroke(1.2);
  if (piece.points) {
    const [first, ...rest] = piece.points.map(([x, y]) => at(x, y));
    s.ops.push(
      `${s.n(first![0])} ${s.n(first![1])} m ` +
        rest.map(([x, y]) => `${s.n(x)} ${s.n(y)} l`).join(' ') +
        ' h S',
    );
  } else {
    const { width: w, height: h } = piece;
    const r = piece.radius ?? 0,
      c = r * 0.5523;
    const p = (x: number, y: number) => at(x, y).map(s.n).join(' ');
    s.ops.push(
      r
        ? `${p(r, 0)} m ${p(w - r, 0)} l ${p(w - r + c, 0)} ${p(w, r - c)} ${p(w, r)} c ` +
            `${p(w, h - r)} l ${p(w, h - r + c)} ${p(w - r + c, h)} ${p(w - r, h)} c ` +
            `${p(r, h)} l ${p(r - c, h)} ${p(0, h - r + c)} ${p(0, h - r)} c ` +
            `${p(0, r)} l ${p(0, r - c)} ${p(r - c, 0)} ${p(r, 0)} c S`
        : `${p(0, 0)} m ${p(w, 0)} l ${p(w, h)} l ${p(0, h)} l h S`,
    );
  }
  s.mark(label, [at(0, 0), at(piece.width, piece.height)], 'feature');
  for (const [index, { at: centre, diameter }] of piece.holes.entries()) {
    const [x, y] = centre;
    s.circle(...at(x, y), (diameter / 2) * k);
    const size = diameter / 2 + 3;
    s.stroke(0.3);
    mm(x - size, y, x + size, y);
    mm(x, y - size, x, y + size);
    s.stroke(1.2);
    s.mark(
      `${label}, hole ${index + 1} Ø${decimals(diameter)}`,
      [at(x - diameter / 2, y - diameter / 2), at(x + diameter / 2, y + diameter / 2)],
      'feature',
      'ellipse',
    );
  }

  /** A dimension between two points, its line `offset` mm off the edge at `base`. */
  const dimension = (axis: 'x' | 'y', from: number, to: number, base: number, offset: number) => {
    s.stroke(0.4);
    const line = base + offset;
    const value = decimals(Math.abs(to - from));
    const reach = line + Math.sign(offset) * 2;
    let corners: (readonly [number, number])[];
    if (axis === 'x') {
      mm(from, base, from, reach);
      mm(to, base, to, reach);
      const a = at(from, line),
        b = at(to, line);
      s.segment(a, b);
      s.arrow(a, -1, 0);
      s.arrow(b, 1, 0);
      const left = (a[0] + b[0]) / 2 - (advance(value) * 10) / 2;
      corners = [...s.text(left, a[1] + (offset > 0 ? 4 : -12), 10, value)];
    } else {
      mm(base, from, reach, from);
      mm(base, to, reach, to);
      const a = at(line, from),
        b = at(line, to);
      s.segment(a, b);
      s.arrow(a, 0, -1);
      s.arrow(b, 0, 1);
      const width = advance(value) * 10;
      corners = [
        ...s.text(a[0] + (offset > 0 ? 4 : -4 - width), (a[1] + b[1]) / 2 - 3.5, 10, value),
      ];
    }
    const ends = axis === 'x' ? [at(from, base), at(to, reach)] : [at(base, from), at(reach, to)];
    s.mark(`${label}, ${value} mm along ${axis}`, [...ends, ...corners]);
  };
  const xs = [...new Set(piece.holes.map((item) => item.at[0]))].sort((a, b) => a - b);
  const ys = [...new Set(piece.holes.map((item) => item.at[1]))].sort((a, b) => a - b);
  [0, ...xs].forEach((x, index, list) => {
    if (index) dimension('x', list[index - 1]!, x, piece.height, 12);
  });
  [0, ...ys].forEach((y, index, list) => {
    if (index) dimension('y', list[index - 1]!, y, 0, -12);
  });
  dimension('x', 0, piece.width, 0, -16);
  dimension('y', 0, piece.height, piece.width, 14);

  // One callout per diameter, from its top right hole, on the diagonal that crosses the fewest
  // holes and other callouts and stays on the piece, where the dimensions are not.
  const taken = piece.holes.map(({ at: [x, y], diameter }): Box => {
    const reach = diameter / 2 + 3;
    return [x - reach, y - reach, x + reach, y + reach];
  });
  for (const diameter of [...new Set(piece.holes.map((item) => item.diameter))]) {
    const group = piece.holes.filter((item) => item.diameter === diameter);
    const own = [...group].sort((a, b) => b.at[1] - a.at[1] || b.at[0] - a.at[0])[0]!;
    const [x, y] = own.at;
    const value = `${group.length > 1 ? `${group.length}× ` : ''}Ø${decimals(diameter)}`;
    const length = Math.max(14, (advance(value) * 10) / k + 2);
    const inward = [x > piece.width / 2 ? -1 : 1, y > piece.height / 2 ? -1 : 1] as const;
    const placed = [
      inward,
      [-inward[0], inward[1]],
      [inward[0], -inward[1]],
      [-inward[0], -inward[1]],
    ]
      .map(([sx, sy]) => {
        const r = diameter / 2;
        const start: XY = [x + sx! * r * 0.7071, y + sy! * r * 0.7071];
        const elbow: XY = [start[0] + sx! * 8, start[1] + sy! * 8];
        const end: XY = [elbow[0] + sx! * length, elbow[1]];
        const box: Box = [
          Math.min(elbow[0], end[0]),
          Math.min(start[1], elbow[1]),
          Math.max(elbow[0], end[0]),
          Math.max(start[1], elbow[1] + 5),
        ];
        const clash =
          taken.reduce(
            (sum, other, index) => sum + (piece.holes[index] === own ? 0 : overlap(box, other)),
            0,
          ) +
          3 * (area(box) - overlap(box, [0, 0, piece.width, piece.height]));
        return { start, elbow, end, box, clash };
      })
      .reduce((best, next) => (next.clash < best.clash ? next : best));
    const { start, elbow, end } = placed;
    taken.push(placed.box);
    s.stroke(0.4);
    mm(...start, ...elbow);
    mm(...elbow, ...end);
    const corners = s.text(...at(Math.min(elbow[0], end[0]) + 1, elbow[1] + 1.5), 10, value);
    s.mark(`${label}, callout ${value}`, [at(...start), at(...end), ...corners]);
  }
}
/** `[left, bottom, right, top]` in millimetres. */
type Box = [number, number, number, number];
const area = ([left, bottom, right, top]: Box) => (right - left) * (top - bottom);
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

interface DrawnJob {
  spec: JobSpec;
  drawing: DrawingSpec;
}
/** A drawing on one A4 landscape page at 1:1: its part's pieces dimensioned, the job's parts list
 * and a title block. */
function drawingPDF({ spec, drawing }: DrawnJob): { bytes: Uint8Array; regions: TruthRegion[] } {
  const s = sheet(drawing.file);
  const part = spec.parts.find((item) => item.code === drawing.part)!;
  const name = (item: PartSpec) =>
    spec.naming === 'plain' ? `${item.title} ${item.code}` : item.code;

  // The pieces, centred in the drawing area left of the parts list.
  const width =
    part.pieces.reduce((sum, piece) => sum + piece.width, 0) + pieceGap * (part.pieces.length - 1);
  const height = Math.max(...part.pieces.map((piece) => piece.height));
  const area = { left: 50, right: 560, bottom: 120, top: 560 };
  let left = area.left + (area.right - area.left - width * k) / 2;
  const bottom = area.bottom + (area.top - area.bottom - height * k) / 2;
  part.pieces.forEach((piece, index) => {
    const label = part.pieces.length > 1 ? `${name(part)}, piece ${index + 1}` : `${name(part)}`;
    drawPiece(s, piece, [left, bottom], label);
    left += (piece.width + pieceGap) * k;
  });

  // The job's parts, as the drawing gives them.
  const right = 600;
  s.text(right, 540, 12, `Parts for job ${spec.number}`, true);
  const columns = [right, right + 60, right + 150, right + 200];
  ['Part', 'Name', 'Thickness', 'Qty'].forEach((label, index) =>
    s.text(columns[index]!, 518, 9, label, true),
  );
  s.stroke(0.5);
  s.segment([right, 512], [right + 222, 512]);
  spec.parts.forEach((item, index) => {
    const y = 498 - index * 16;
    const drawn = item === part;
    const quantity =
      drawn && typeof drawing.quantity === 'number' ? drawing.quantity : item.quantity;
    const thickness = drawn ? (drawing.thickness ?? item.thickness) : item.thickness;
    const row = [item.code, item.title, `${decimals(thickness)} mm`, String(quantity)];
    const corners = row.flatMap((value, column) => [...s.text(columns[column]!, y, 9, value)]);
    s.mark(`parts list: ${item.code}`, corners);
  });

  // The title block.
  const thickness = drawing.thickness ?? part.thickness;
  const quantity =
    typeof drawing.quantity === 'string'
      ? drawing.quantity
      : `${drawing.quantity ?? part.quantity} pieces`;
  s.stroke(0.8);
  s.ops.push(`${right - 10} 40 232 122 re S`);
  s.segment([right - 10, 136], [right + 222, 136]);
  const title = `JOB ${spec.number} · ${part.title.toUpperCase()} ${part.code}`;
  s.text(right, 143, Math.min(13, Math.floor((212 / advance(title)) * 10) / 10), title, true);
  [
    ['material', `Material: ${spec.material}, ${decimals(thickness)} mm`],
    ['quantity', `Quantity: ${quantity}`],
    ['units', 'Units: mm · Scale 1:1'],
    ['tolerance', 'General tolerance ±0.2 mm'],
    ['drawing number', `Drawing ${drawing.number} · Revision A`],
  ].forEach(([label, line], index) =>
    s.mark(`title block: ${label}`, s.text(right, 118 - index * 16, 10, line!)),
  );
  s.mark('title block', [
    [right - 10, 40],
    [right + 222, 162],
  ]);
  s.mark('note', s.text(60, 60, 9, drawing.note));
  return {
    bytes: pdfBytes(s.ops.join('\n'), `Job ${spec.number}, drawing ${drawing.number}`),
    regions: s.regions,
  };
}

/** A one-page PDF with Helvetica and Helvetica-Bold in WinAnsi. */
function pdfBytes(stream: string, title: string): Uint8Array {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${pdfText(title)} /Producer (Viewer playground) >>`,
  ];
  let bytes = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of bodies.entries()) {
    offsets.push(Buffer.byteLength(bytes, 'latin1'));
    bytes += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(bytes, 'latin1');
  bytes += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  bytes += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  bytes += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(bytes, 'latin1'));
}

/** The request as the customer sends it: its text, and the drawings attached. */
function requestMessage(spec: JobSpec, drawings: readonly { file: string; bytes: Uint8Array }[]) {
  const boundary = `job-${spec.number}-boundary`;
  const attachments = drawings.map(
    ({ file, bytes }) => `--${boundary}
Content-Type: application/pdf; name="${file}"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="${file}"

${base64Lines(bytes)}
`,
  );
  return `From: ${spec.customer.name} <${spec.customer.address}>
To: Laser shop <laser@example.invalid>
Subject: Job ${spec.number}: laser cut parts, ${spec.material.split(' ')[0]}
Date: Fri, 30 Oct 2026 ${String(8 + (spec.number % 8)).padStart(2, '0')}:20:00 +0200
Message-ID: <job-${spec.number}@viewer.example>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"

--${boundary}
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

${spec.request(spec.parts)}
${attachments.join('')}--${boundary}--
`.replace(/\r?\n/g, '\r\n');
}

/** A PNG of RGB pixels, row by row from the top. */
function png(width: number, height: number, rgb: Uint8Array) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Whether a point of a piece, in millimetres from its corner, is steel: in its outline, outside
 * its holes. */
function solid(piece: Piece, x: number, y: number): boolean {
  for (const { at, diameter } of piece.holes)
    if ((x - at[0]) ** 2 + (y - at[1]) ** 2 < (diameter / 2) ** 2) return false;
  if (piece.points) {
    let inside = false;
    const points = piece.points;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]!,
        [xj, yj] = points[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const { width: w, height: h } = piece;
  const r = piece.radius ?? 0;
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = Math.min(Math.max(x, r), w - r),
    cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** A photo of a cut piece from above: grey steel with a soft shadow on a pale bench, 1600 × 1200,
 * and where the piece and each of its holes lie in it. */
function piecePhoto(piece: Piece, file: string, label: string) {
  const width = 1600,
    height = 1200;
  const scale = Math.min((0.62 * width) / piece.width, (0.62 * height) / piece.height);
  const left = (width - piece.width * scale) / 2 + 30,
    top = (height - piece.height * scale) / 2 - 20;
  const shadow = 2.2;
  // Two samples a side smooth the edges.
  const offsets = [0.25, 0.75];
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let steel = 0,
        shade = 0;
      for (const dx of offsets)
        for (const dy of offsets) {
          const mx = (x + dx - left) / scale,
            my = (top + piece.height * scale - (y + dy)) / scale;
          if (solid(piece, mx, my)) steel++;
          else if (solid(piece, mx - shadow, my + shadow)) shade++;
        }
      const bench = 226 - Math.round((Math.abs(x - width / 2) + Math.abs(y - height / 2)) / 60);
      const metal = 128 + Math.round((22 * x) / width) + ((x * 7 + y * 13) % 5);
      const ground = bench - shade * 9;
      const mix = (a: number, b: number) => Math.round((a * steel + b * (4 - steel)) / 4);
      const at = (y * width + x) * 3;
      rgb[at] = mix(metal, ground);
      rgb[at + 1] = mix(metal + 3, ground - 2);
      rgb[at + 2] = mix(metal + 8, ground - 7);
    }
  const bytes = png(width, height, rgb);
  // Millimetres from the piece's corner, y up, as fractions of the photo.
  const box = (x1: number, y1: number, x2: number, y2: number): FractionBox => [
    fraction((left + x1 * scale) / width),
    fraction((top + (piece.height - y2) * scale) / height),
    fraction((left + x2 * scale) / width),
    fraction((top + (piece.height - y1) * scale) / height),
  ];
  const regions: TruthRegion[] = [
    {
      file,
      label,
      kind: 'feature',
      shape: 'box',
      box: box(0, 0, piece.width, piece.height),
    },
    ...piece.holes.map(({ at: [x, y], diameter }, index): TruthRegion => ({
      file,
      label: `${label}, hole ${index + 1} Ø${decimals(diameter)}`,
      kind: 'feature',
      shape: 'ellipse',
      box: box(x - diameter / 2, y - diameter / 2, x + diameter / 2, y + diameter / 2),
    })),
  ];
  return { bytes, regions };
}

/** The eight jobs and their truth, the same every time. */
export function liveJobs(): LiveJob[] {
  return jobSpecs.map((spec) => {
    const drawings = spec.drawings.map((drawing) => ({
      file: drawing.file,
      ...drawingPDF({ spec, drawing }),
    }));
    const photos = spec.photos.map((photo) => {
      const part = spec.parts.find((item) => item.code === photo.part)!;
      return {
        file: photo.file,
        ...piecePhoto(part.pieces[0]!, photo.file, `photo: ${part.code}`),
      };
    });
    const files = [
      {
        name: `Job ${spec.number} request.eml`,
        bytes: new TextEncoder().encode(requestMessage(spec, drawings)),
      },
      ...drawings.map(({ file, bytes }) => ({ name: file, bytes })),
      ...photos.map(({ file, bytes }) => ({ name: file, bytes })),
      ...spec.parts.flatMap((part) =>
        part.file
          ? [{ name: part.file, bytes: new TextEncoder().encode(autocadDXF(partEntities(part))) }]
          : [],
      ),
    ];
    return {
      files,
      truth: {
        id: spec.id,
        job: `Job ${spec.number}`,
        naming: spec.naming,
        control: !spec.problems.length,
        requested: spec.parts.map((part) => ({
          part: part.code,
          title: part.title,
          quantity: part.quantity,
          thickness: part.thickness,
          material: spec.material,
          ...(part.file ? { dxf: part.file } : {}),
        })),
        problems: spec.problems.map((problem, index) => ({
          id: `${spec.id}-P${index + 1}`,
          ...problem,
        })),
        regions: [
          ...drawings.flatMap(({ regions }) => regions),
          ...photos.flatMap(({ regions }) => regions),
        ],
      },
    };
  });
}
