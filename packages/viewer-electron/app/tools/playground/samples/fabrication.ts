/**
 * A generated laser job and an evaluation set, named as a workshop names its parts
 * (`g<thickness>-<part>-<n>buc.dxf`). Each DXF is written as AutoCAD 2010 exports one: AC1024,
 * millimetres, LINE, ARC and CIRCLE on the layer "Visible". Job 1042 holds five parts, a one-page
 * dimensioned drawing and the request; one hole pitch is drawn 48 mm where the drawing gives 50 mm.
 * Every part is fictional; no workshop file is read or copied.
 */
import type { Sample } from '../types';
import { sample } from './documents';

type XY = [x: number, y: number];
/** Degrees, counter-clockwise, as DXF stores them. */
export type CadEntity =
  | { kind: 'line'; a: XY; b: XY }
  | { kind: 'arc'; centre: XY; radius: number; start: number; end: number }
  | { kind: 'circle'; centre: XY; radius: number };

const layer = 'Visible';
/** AutoCAD writes reals with at least one decimal. */
const real = (value: number) => {
  const text = String(Number(value.toFixed(6)));
  return /[.e]/.test(text) ? text : `${text}.0`;
};
/** An AutoCAD 2010 ASCII DXF in millimetres: header, the layer table, then the entities, each with
 * its handle and subclass markers. */
export function autocadDXF(entities: readonly CadEntity[]): string {
  const lines: string[] = [];
  const group = (code: number, value: string | number) =>
    lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? real(value) : value);
  let handle = 0x100;
  const next = () => (handle++).toString(16).toUpperCase();
  const xs: number[] = [],
    ys: number[] = [];
  for (const entity of entities) {
    const points =
      entity.kind === 'line'
        ? [entity.a, entity.b]
        : [
            [entity.centre[0] - entity.radius, entity.centre[1] - entity.radius] as XY,
            [entity.centre[0] + entity.radius, entity.centre[1] + entity.radius] as XY,
          ];
    for (const [x, y] of points) {
      xs.push(x);
      ys.push(y);
    }
  }
  group(0, 'SECTION');
  group(2, 'HEADER');
  group(9, '$ACADVER');
  group(1, 'AC1024');
  group(9, '$DWGCODEPAGE');
  group(3, 'ANSI_1252');
  group(9, '$INSUNITS');
  lines.push(' 70', '     4');
  group(9, '$EXTMIN');
  group(10, Math.min(...xs));
  group(20, Math.min(...ys));
  group(30, 0);
  group(9, '$EXTMAX');
  group(10, Math.max(...xs));
  group(20, Math.max(...ys));
  group(30, 0);
  group(0, 'ENDSEC');
  group(0, 'SECTION');
  group(2, 'TABLES');
  group(0, 'TABLE');
  group(2, 'LAYER');
  group(5, '2');
  group(100, 'AcDbSymbolTable');
  lines.push(' 70', '     2');
  for (const [name, color] of [
    ['0', 7],
    [layer, 7],
  ] as const) {
    group(0, 'LAYER');
    group(5, next());
    group(100, 'AcDbSymbolTableRecord');
    group(100, 'AcDbLayerTableRecord');
    group(2, name);
    lines.push(' 70', '     0');
    lines.push(' 62', `     ${color}`);
    group(6, 'Continuous');
  }
  group(0, 'ENDTAB');
  group(0, 'ENDSEC');
  group(0, 'SECTION');
  group(2, 'ENTITIES');
  for (const entity of entities) {
    group(0, entity.kind === 'line' ? 'LINE' : entity.kind === 'arc' ? 'ARC' : 'CIRCLE');
    group(5, next());
    group(100, 'AcDbEntity');
    group(8, layer);
    if (entity.kind === 'line') {
      group(100, 'AcDbLine');
      group(10, entity.a[0]);
      group(20, entity.a[1]);
      group(30, 0);
      group(11, entity.b[0]);
      group(21, entity.b[1]);
      group(31, 0);
      continue;
    }
    group(100, 'AcDbCircle');
    group(10, entity.centre[0]);
    group(20, entity.centre[1]);
    group(30, 0);
    group(40, entity.radius);
    if (entity.kind === 'arc') {
      group(100, 'AcDbArc');
      group(50, entity.start);
      group(51, entity.end);
    }
  }
  group(0, 'ENDSEC');
  group(0, 'EOF');
  return lines.join('\r\n') + '\r\n';
}

const line = (a: XY, b: XY): CadEntity => ({ kind: 'line', a, b });
const arc = (centre: XY, radius: number, start: number, end: number): CadEntity => ({
  kind: 'arc',
  centre,
  radius,
  start,
  end,
});
/** A hole: one circle, or two half arcs as some CAD exports split them. */
export const hole = (centre: XY, diameter: number, halves = false): CadEntity[] =>
  halves
    ? [arc(centre, diameter / 2, 0, 180), arc(centre, diameter / 2, 180, 360)]
    : [{ kind: 'circle', centre, radius: diameter / 2 }];
/** Lines from point to point, back to the first. */
export const outline = (points: readonly XY[]): CadEntity[] =>
  points.map((point, index) => line(point, points[(index + 1) % points.length]!));
/** A rectangle from the origin with its corners rounded by `radius`, as lines and arcs. */
export function plate(width: number, height: number, radius: number): CadEntity[] {
  if (!radius)
    return outline([
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ]);
  const r = radius;
  return [
    line([r, 0], [width - r, 0]),
    arc([width - r, r], r, 270, 360),
    line([width, r], [width, height - r]),
    arc([width - r, height - r], r, 0, 90),
    line([width - r, height], [r, height]),
    arc([r, height - r], r, 90, 180),
    line([0, height - r], [0, r]),
    arc([r, r], r, 180, 270),
  ];
}
/** A slot of `length` between its arc centres, `width` across, along x. */
const slot = (centre: XY, length: number, width: number): CadEntity[] => {
  const [x, y] = centre,
    half = length / 2,
    r = width / 2;
  return [
    line([x - half, y - r], [x + half, y - r]),
    arc([x + half, y], r, 270, 90),
    line([x + half, y + r], [x - half, y + r]),
    arc([x - half, y], r, 90, 270),
  ];
};

/** One part of Job 1042: how its file is named and what the drawing and request say of it. */
export interface JobPart {
  file: string;
  part: string;
  title: string;
  thickness: number;
  quantity: number;
  entities: CadEntity[];
}
/** The mismatch: the base plate's right holes are drawn at x 103, so their pitch to the left holes
 * is 48 mm; the drawing gives 50 mm. */
export const jobMismatch = {
  file: 'g6-PL60-B2-2buc.dxf',
  axis: 'x',
  drawn: 48,
  specified: 50,
  from: [55, 25] as XY,
  to: [103, 25] as XY,
  /** Holes that move with `to` when it is corrected. */
  with: [[103, 75]] as XY[],
} as const;
const flangeHoles = Array.from({ length: 6 }, (_, index): XY => {
  const angle = (index * Math.PI) / 3;
  return [60 + 45 * Math.cos(angle), 60 + 45 * Math.sin(angle)];
});
export const jobParts: JobPart[] = [
  {
    file: 'g6-PL60-B2-2buc.dxf',
    part: 'PL60-B2',
    title: 'Base plate',
    thickness: 6,
    quantity: 2,
    entities: [
      ...plate(160, 100, 8),
      ...hole([55, 25], 10.5),
      ...hole([103, 25], 10.5),
      ...hole([55, 75], 10.5),
      ...hole([103, 75], 10.5),
      ...hole([80, 50], 30, true),
    ],
  },
  {
    file: 'g6-MB20-A1-4buc.dxf',
    part: 'MB20-A1',
    title: 'Mounting bracket',
    thickness: 6,
    quantity: 4,
    entities: [
      ...outline([
        [0, 0],
        [120, 0],
        [120, 45],
        [105, 60],
        [15, 60],
        [0, 45],
      ]),
      ...hole([20, 20], 8.5),
      ...hole([100, 20], 8.5),
      ...slot([60, 38], 20, 10),
    ],
  },
  {
    file: 'g6-FL80-C1-2buc.dxf',
    part: 'FL80-C1',
    title: 'Flange',
    thickness: 6,
    quantity: 2,
    entities: [
      { kind: 'circle', centre: [60, 60], radius: 60 },
      ...hole([60, 60], 40),
      ...flangeHoles.flatMap((centre) => hole(centre, 9)),
    ],
  },
  {
    file: 'g3-CV25-E1-10buc.dxf',
    part: 'CV25-E1',
    title: 'Cover',
    thickness: 3,
    quantity: 10,
    entities: [
      ...plate(90, 90, 5),
      ...(
        [
          [7, 7],
          [83, 7],
          [7, 83],
          [83, 83],
        ] as XY[]
      ).flatMap((centre) => hole(centre, 4.5)),
    ],
  },
  {
    file: 'g3-GS30-D1-6buc.dxf',
    part: 'GS30-D1',
    title: 'Gusset',
    thickness: 3,
    quantity: 6,
    entities: [
      ...outline([
        [0, 0],
        [100, 0],
        [100, 15],
        [15, 100],
        [0, 100],
      ]),
      ...hole([50, 12], 6.5),
      ...hole([12, 50], 6.5),
    ],
  },
];

/** PDF text in WinAnsi: the few signs a drawing uses beyond ASCII, as octal escapes. */
const winAnsi: Record<string, string> = {
  '×': '\\327',
  Ø: '\\330',
  '±': '\\261',
  '·': '\\267',
};
export const pdfText = (text: string) =>
  `(${text.replace(/[\\()]/g, (sign) => `\\${sign}`).replace(/[×Ø±·]/g, (sign) => winAnsi[sign]!)})`;
/** Helvetica advances, in thousandths of the size: enough to centre short labels. */
export const advance = (text: string) =>
  [...text].reduce(
    (sum, sign) =>
      sum +
      (/[0-9]/.test(sign)
        ? 556
        : sign === ' ' || sign === '.'
          ? 278
          : /[A-Z]/.test(sign)
            ? 667
            : 520),
    0,
  ) / 1000;

/** The base plate's drawing on one A4 landscape page at 1:1, with the job's parts list and a title
 * block, all as vector lines and real text. */
export function jobDrawing(): Uint8Array {
  const k = 72 / 25.4;
  const origin = { x: 60, y: 200 };
  const at = (x: number, y: number) => [origin.x + x * k, origin.y + y * k] as const;
  const ops: string[] = [];
  const n = (value: number) => Number(value.toFixed(2));
  const stroke = (width: number) => ops.push(`${n(width)} w`);
  const segment = (a: readonly [number, number], b: readonly [number, number]) =>
    ops.push(`${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S`);
  const mm = (x1: number, y1: number, x2: number, y2: number) => segment(at(x1, y1), at(x2, y2));
  const text = (
    x: number,
    y: number,
    size: number,
    value: string,
    options: { bold?: boolean; centre?: boolean } = {},
  ) => {
    const left = options.centre ? x - (advance(value) * size) / 2 : x;
    ops.push(
      `BT /${options.bold ? 'F2' : 'F1'} ${size} Tf ${n(left)} ${n(y)} Td ${pdfText(value)} Tj ET`,
    );
  };
  const circle = (cx: number, cy: number, r: number) => {
    const [x, y] = at(cx, cy),
      p = r * k,
      c = p * 0.5523;
    ops.push(
      `${n(x + p)} ${n(y)} m ${n(x + p)} ${n(y + c)} ${n(x + c)} ${n(y + p)} ${n(x)} ${n(y + p)} c ` +
        `${n(x - c)} ${n(y + p)} ${n(x - p)} ${n(y + c)} ${n(x - p)} ${n(y)} c ` +
        `${n(x - p)} ${n(y - c)} ${n(x - c)} ${n(y - p)} ${n(x)} ${n(y - p)} c ` +
        `${n(x + c)} ${n(y - p)} ${n(x + p)} ${n(y - c)} ${n(x + p)} ${n(y)} c S`,
    );
  };
  const arrow = (tip: readonly [number, number], dx: number, dy: number) => {
    const length = 7,
      half = 2;
    const bx = tip[0] - dx * length,
      by = tip[1] - dy * length;
    ops.push(
      `${n(tip[0])} ${n(tip[1])} m ${n(bx - dy * half)} ${n(by + dx * half)} l ` +
        `${n(bx + dy * half)} ${n(by - dx * half)} l f`,
    );
  };
  /** A dimension between two points of the part, its line `offset` mm off along the other axis. */
  const dimension = (axis: 'x' | 'y', from: number, to: number, base: number, offset: number) => {
    stroke(0.4);
    const line = base + offset;
    const label = String(Math.abs(to - from));
    if (axis === 'x') {
      mm(from, base, from, line + Math.sign(offset) * 2);
      mm(to, base, to, line + Math.sign(offset) * 2);
      const a = at(from, line),
        b = at(to, line);
      segment(a, b);
      arrow(a, -1, 0);
      arrow(b, 1, 0);
      text((a[0] + b[0]) / 2, a[1] + (offset > 0 ? 4 : -12), 10, label, { centre: true });
    } else {
      mm(base, from, line + Math.sign(offset) * 2, from);
      mm(base, to, line + Math.sign(offset) * 2, to);
      const a = at(line, from),
        b = at(line, to);
      segment(a, b);
      arrow(a, 0, -1);
      arrow(b, 0, 1);
      const width = advance(label) * 10;
      text(a[0] + (offset > 0 ? 4 : -4 - width), (a[1] + b[1]) / 2 - 3.5, 10, label);
    }
  };

  // The outline: straight edges and quarter-circle corners.
  stroke(1.2);
  const r = 8,
    c = r * 0.5523;
  const corner = (x: number, y: number) => at(x, y).map(n).join(' ');
  ops.push(
    `${corner(r, 0)} m ${corner(160 - r, 0)} l ${corner(160 - r + c, 0)} ${corner(160, r - c)} ${corner(160, r)} c ` +
      `${corner(160, 100 - r)} l ${corner(160, 100 - r + c)} ${corner(160 - r + c, 100)} ${corner(160 - r, 100)} c ` +
      `${corner(r, 100)} l ${corner(r - c, 100)} ${corner(0, 100 - r + c)} ${corner(0, 100 - r)} c ` +
      `${corner(0, r)} l ${corner(0, r - c)} ${corner(r - c, 0)} ${corner(r, 0)} c S`,
  );
  // As designed: the right holes at x 105, 50 mm from the left ones.
  const holes: XY[] = [
    [55, 25],
    [105, 25],
    [55, 75],
    [105, 75],
  ];
  for (const [x, y] of holes) circle(x, y, 5.25);
  circle(80, 50, 15);
  stroke(0.3);
  for (const [x, y, size] of [
    ...holes.map(([x, y]) => [x, y, 8] as const),
    [80, 50, 19] as const,
  ]) {
    mm(x - size, y, x + size, y);
    mm(x, y - size, x, y + size);
  }
  dimension('x', 0, 160, 0, -16);
  dimension('x', 0, 55, 100, 12);
  dimension('x', 55, 105, 100, 12);
  dimension('y', 0, 100, 160, 14);
  dimension('y', 0, 25, 0, -12);
  dimension('y', 25, 75, 0, -12);
  stroke(0.4);
  mm(105 + 3.7, 75 + 3.7, 118, 88);
  mm(118, 88, 132, 88);
  text(...at(119, 89.5), 10, '4× Ø10.5');
  mm(80 + 14.1, 50 + 5.1, 120, 58);
  mm(120, 58, 130, 58);
  text(...at(121, 59.5), 10, 'Ø30');

  // The job's parts, as the request lists them.
  const right = 600;
  text(right, 540, 12, 'Parts for job 1042', { bold: true });
  const columns = [right, right + 60, right + 150, right + 200];
  ['Part', 'Name', 'Thickness', 'Qty'].forEach((label, index) =>
    text(columns[index]!, 518, 9, label, { bold: true }),
  );
  stroke(0.5);
  segment([right, 512], [right + 222, 512]);
  jobParts.forEach((part, index) => {
    const y = 498 - index * 16;
    text(columns[0]!, y, 9, part.part);
    text(columns[1]!, y, 9, part.title);
    text(columns[2]!, y, 9, `${part.thickness} mm`);
    text(columns[3]!, y, 9, String(part.quantity));
  });

  // The title block.
  stroke(0.8);
  ops.push(`${right - 10} 40 232 122 re S`);
  segment([right - 10, 136], [right + 222, 136]);
  text(right, 143, 13, 'JOB 1042 · BASE PLATE PL60-B2', { bold: true });
  [
    'Material: S235JR steel, 6 mm',
    'Quantity: 2 pieces',
    'Units: mm · Scale 1:1',
    'General tolerance ±0.2 mm',
    'Drawing 1042-01 · Revision A',
  ].forEach((line, index) => text(right, 118 - index * 16, 10, line));
  text(60, 60, 9, 'Laser cut. Remove burrs. Holes 4× Ø10.5 at 50 mm pitch, centre hole Ø30.');

  const stream = ops.join('\n');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Title (Job 1042 drawing) /Producer (Viewer playground) >>',
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

export const base64Lines = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/.{76}/g, '$&\r\n');
/** The customer's request: quantities and material in plain text, the drawing attached. */
export function jobRequest(drawing: Uint8Array): string {
  const list = jobParts
    .map(
      (part) =>
        `- ${part.part} ${part.title.toLowerCase()}, ${part.thickness} mm, ${part.quantity} pieces`,
    )
    .join('\n');
  const body = `Hello,

Please cut the parts for job 1042 in S235JR steel:

${list}

The DXF files are named by thickness and quantity. The base plate drawing
is attached; please check the holes against it before cutting.

Thank you,
Mara
`;
  return `From: Mara Pop <mara.pop@example.invalid>
To: Laser shop <laser@example.invalid>
Subject: Job 1042: laser cut parts, S235JR
Date: Thu, 29 Oct 2026 09:14:00 +0200
Message-ID: <job-1042@viewer.example>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="job-boundary"

--job-boundary
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

${body}
--job-boundary
Content-Type: application/pdf; name="Job 1042 drawing.pdf"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="Job 1042 drawing.pdf"

${base64Lines(drawing)}
--job-boundary--
`.replace(/\r?\n/g, '\r\n');
}

/** What an evaluation part is, known before it is read. */
export interface EvaluationTruth {
  name: string;
  part: string;
  /** What the name says beyond doubt; absent when it says nothing or two things. */
  thickness?: number;
  quantity?: number;
  outlines: number;
  holes: number;
  /** A pitch the drawing gives and the DXF has: the same unless `mismatch`. */
  pitch: { axis: 'x' | 'y'; from: XY; to: XY; specified: number; drawn: number };
  mismatch: boolean;
}
export interface EvaluationPart {
  truth: EvaluationTruth;
  dxf: string;
  /** A labeled synthetic requirement, kept separately from the expected measurement and grade. */
  requirement: { text: string; quote: string };
}
/** Name forms the reader must handle: the convention, its variants, and three it must not guess. */
const nameStyles: ((
  code: string,
  thickness: number,
  quantity: number,
) => {
  name: string;
  /** The part as the name writes it, when not `code` itself. */
  part?: string;
  thickness?: number;
  quantity?: number;
})[] = [
  (code, t, q) => ({ name: `g${t}-${code}-${q}buc.dxf`, thickness: t, quantity: q }),
  (code, t, q) => ({
    name: `g${String(t).replace('.', ',')}_${code.replace('-', '_')}_${q}buc.dxf`,
    part: code.replace('-', '_'),
    thickness: t,
    quantity: q,
  }),
  (code, t, q) => ({ name: `${code}-${t}mm-${q}pcs.dxf`, thickness: t, quantity: q }),
  (code, t, q) => ({ name: `t${t}-${code}-x${q}.dxf`, thickness: t, quantity: q }),
  (code, t, q) => ({ name: `g${t}mm-${code}-${q} buc.dxf`, thickness: t, quantity: q }),
  (code, t, q) => ({ name: `${code}_${q}x_g${t}.dxf`, thickness: t, quantity: q }),
  (code, _t, q) => ({ name: `${code}-${q}buc.dxf`, quantity: q }),
  (code, t) => ({ name: `g${t}-${code}.dxf`, thickness: t }),
  (code, t, q) => ({ name: `g${t}-${code}-g${t + 2}-${q}buc.dxf`, quantity: q }),
  (code, t, q) => ({ name: `${code} ${t}mm ${q}pcs.dxf`, thickness: t, quantity: q }),
];
const prefixes = ['PL', 'BR', 'CV', 'FL', 'GS', 'MB', 'SP', 'RB'];

/** About forty parts, the same every time: plates and brackets with hole grids, a quarter of them
 * with one pitch drawn 1 to 2 mm off what their drawing gives. */
export function evaluationParts(count = 40): EvaluationPart[] {
  let seed = 1042;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  return Array.from({ length: count }, (_, index) => {
    const thickness = pick([1.5, 2, 3, 4, 6, 8]);
    const quantity = 1 + Math.floor(random() * 12);
    const code = `${pick(prefixes)}${10 + index}-${pick(['A', 'B', 'C', 'D'])}${1 + Math.floor(random() * 3)}`;
    const named = nameStyles[index % nameStyles.length]!(code, thickness, quantity);
    const columns = 2 + Math.floor(random() * 3),
      rows = 1 + Math.floor(random() * 3);
    const diameter = pick([6.5, 8.5, 10.5, 13]);
    const edge = 15 + diameter;
    const pitchX = pick([30, 40, 45, 50, 60, 75]),
      pitchY = pick([30, 40, 50]);
    const width = 2 * edge + pitchX * (columns - 1),
      height = 2 * edge + pitchY * (rows - 1);
    const radius = pick([0, 5, 8]);
    const halves = index % 4 === 3;
    // One part in four has a pitch drawn off; along y when it has rows to spare.
    const mismatch = index % 4 === 1;
    const offAxis: 'x' | 'y' = mismatch && rows > 1 && index % 8 === 5 ? 'y' : 'x';
    const off = mismatch ? pick([-2, -1.5, -1, 1, 2]) : 0;
    const centres: XY[] = [];
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const last = offAxis === 'x' ? column === columns - 1 : row === rows - 1;
        centres.push([
          edge + column * pitchX + (offAxis === 'x' && last ? off : 0),
          edge + row * pitchY + (offAxis === 'y' && last ? off : 0),
        ]);
      }
    const pair: [XY, XY] =
      offAxis === 'x'
        ? [centres[columns - 2]!, centres[columns - 1]!]
        : [centres[(rows - 2) * columns]!, centres[(rows - 1) * columns]!];
    const pitch = offAxis === 'x' ? pitchX : pitchY;
    const entities = [
      ...plate(width, height, radius),
      ...centres.flatMap((centre) => hole(centre, diameter, halves)),
    ];
    return {
      dxf: autocadDXF(entities),
      requirement: {
        text: `Part: ${code}\nPitch: ${pitch} mm\nAxis: ${offAxis}\n`,
        quote: `Pitch: ${pitch} mm`,
      },
      truth: {
        name: named.name,
        part: named.part ?? code,
        ...(named.thickness === undefined ? {} : { thickness: named.thickness }),
        ...(named.quantity === undefined ? {} : { quantity: named.quantity }),
        outlines: 1,
        holes: centres.length,
        pitch: {
          axis: offAxis,
          from: pair[0],
          to: pair[1],
          specified: pitch,
          drawn: pitch + off,
        },
        mismatch,
      },
    };
  });
}

/** Job 1042 and the evaluation set, under fabrication/ in the playground. */
export function fabricationSamples(): Sample[] {
  const drawing = jobDrawing();
  const evaluation = evaluationParts();
  return [
    ...jobParts.map((part) =>
      sample(
        `fabrication/Job 1042/${part.file}`,
        ['dxf'],
        'DXF preview; Nest for cutting reads its thickness and quantity from the name',
        `${part.title} ${part.part}: ${part.thickness} mm, ${part.quantity} pieces, AutoCAD 2010 DXF in millimetres.`,
        autocadDXF(part.entities),
      ),
    ),
    sample(
      'fabrication/Job 1042/Job 1042 drawing.pdf',
      ['pdf'],
      'PDF page with searchable dimensions',
      'The base plate at 1:1 with its dimensions, the job’s parts list and a title block. Its hole pitch is 50 mm; the DXF has 48 mm.',
      drawing,
    ),
    sample(
      'fabrication/Job 1042/Job 1042 request.eml',
      ['eml'],
      'Message with the parts, quantities and material, and the drawing attached',
      'A plain-text request naming each part with its thickness and quantity.',
      jobRequest(drawing),
    ),
    ...evaluation.map(({ truth, dxf }) =>
      sample(
        `fabrication/Evaluation/${truth.name}`,
        ['dxf'],
        'DXF preview',
        `Evaluation part ${truth.part}${truth.mismatch ? ', with one pitch drawn off' : ''}.`,
        dxf,
      ),
    ),
    sample(
      'fabrication/Evaluation/Truth.json',
      ['json'],
      'JSON tree',
      'What each evaluation part is: its name’s thickness and quantity, holes and a pitch.',
      JSON.stringify(
        evaluation.map(({ truth }) => truth),
        null,
        2,
      ) + '\n',
    ),
  ];
}
