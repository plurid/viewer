/**
 * RECONCILING A JOB: the request first, a drawing's title block next, the file name last.
 * Disagreements become findings Viewer grades with the exact quotes; a drawing of several separate
 * pieces counts sets or pieces only when the job decides it, and otherwise asks; what the answer
 * leaves unread in the request is said, part by part, with no number of Viewer's own.
 */
import { describe, expect, it } from 'vitest';
import type {
  FabricationAnswer,
  InventorySource,
  RequestPart,
} from '../src/domain/fabrication/answer';
import type { GradeJob } from '../src/domain/fabrication/grade';
import { reconcileJob } from '../src/domain/fabrication/reconcile';
import { partValuesText } from '../src/domain/fabrication/part-values';

const version = { identity: '1:2', modified: 1, size: 1 };
const sources: InventorySource[] = [
  { ref: 'S1', kind: 'request', name: 'Request.eml', pages: 1, path: '/jobs/Request.eml', version },
  { ref: 'S2', kind: 'drawing', name: 'Drawing.pdf', pages: 1, path: '/jobs/Drawing.pdf', version },
  {
    ref: 'S3',
    kind: 'dxf',
    name: 'g6-PL60-B2-2buc.dxf',
    path: '/jobs/g6-PL60-B2-2buc.dxf',
    version,
  },
];
const texts: Record<string, string> = {
  'S1:1': 'Please cut: PL60-B2 base plate, 6 mm, 4 pieces. Thank you.',
  'S2:1': 'Part PL60-B2 Base plate Thickness 5 mm Qty 4',
};
const grading: GradeJob = {
  inventory: sources,
  dxf: (ref) =>
    ref === 'S3'
      ? {
          name: 'g6-PL60-B2-2buc.dxf',
          outcome: { status: 'refused', reason: 'Not measured in this test.' },
        }
      : undefined,
  text: (ref, page) => texts[`${ref}:${page}`],
};
const part = (patch: Partial<RequestPart> = {}): RequestPart => ({
  ref: 'S1',
  part: 'PL60-B2 base plate',
  dxf: 'S3',
  quantity: 4,
  thickness: 6,
  material: null,
  quote: 'PL60-B2 base plate, 6 mm, 4 pieces',
  drawing: null,
  ...patch,
});
const answer = (request: RequestPart[]): FabricationAnswer => ({
  summary: '',
  request,
  findings: [],
  tour: [],
});
const reconcile = (request: RequestPart[], pieces = 1, requestText?: string) =>
  reconcileJob({
    answer: answer(request),
    sources,
    reader: 'Muse Spark',
    grading:
      requestText === undefined
        ? grading
        : {
            ...grading,
            text: (ref, page) => (ref === 'S1' ? requestText : texts[`${ref}:${page}`]),
          },
    pieces: () => pieces,
  });
/** The finding that says the answer has no quantity for the base plate. */
const unreadPlate = {
  unread: 'quantity',
  part: 'S3',
  finding: {
    kind: 'quantity',
    summary:
      'Muse Spark did not read a quantity for PL60-B2 base plate from the request. Check the request or run the check again.',
    drawing: { ref: 'S1', value: null },
    dxf: { ref: 'S3', value: null },
  },
  grade: {
    status: 'unverified',
    reason: 'The answer lists PL60-B2 base plate with no quantity, so nothing was compared.',
  },
};

describe('values the request and the name disagree on', () => {
  it('raises the request against the name, confirmed with the request’s own words', () => {
    const { findings, parts } = reconcile([part()]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      part: 'S3',
      finding: {
        id: 'F1',
        kind: 'quantity',
        summary: 'The request asks for 4 pieces of PL60-B2; its file name gives 2 pieces (“2buc”).',
        drawing: { ref: 'S1', page: 1, value: 4, quote: 'PL60-B2 base plate, 6 mm, 4 pieces' },
        dxf: { ref: 'S3', value: 2 },
      },
      grade: {
        status: 'confirmed',
        reason:
          'The name g6-PL60-B2-2buc.dxf gives 2 pieces (“2buc”); the accepted request requirement is 4 pieces.',
      },
    });
    // the request comes first, and says so; the finding stands beside it
    expect(parts[0]!.quantity).toMatchObject({
      sets: 4,
      pieces: 4,
      source: 'request',
      quote: 'PL60-B2 base plate, 6 mm, 4 pieces',
    });
    expect(parts[0]!.thickness).toMatchObject({ value: 6, source: 'request' });
    expect(partValuesText(parts[0]!)).toBe('4 pieces · 6 mm, both from the request');
  });

  it('sets the request against the drawing’s title block, with both quotes', () => {
    const { findings, parts } = reconcile([
      part({
        quantity: 4,
        drawing: {
          ref: 'S2',
          page: 1,
          quantity: null,
          thickness: 5,
          material: null,
          quote: 'Thickness 5 mm',
        },
      }),
    ]);
    expect(
      findings
        .filter((item) => item.finding.kind === 'thickness')
        .map((item) => item.finding.summary),
    ).toEqual(['The request asks for 6 mm of PL60-B2; Drawing.pdf gives 5 mm.']);
    expect(findings[0]).toMatchObject({
      request: { ref: 'S1', value: 6, quote: 'PL60-B2 base plate, 6 mm, 4 pieces' },
      finding: { kind: 'thickness', drawing: { ref: 'S2', page: 1, value: 5 }, dxf: null },
      grade: {
        status: 'confirmed',
        reason:
          'The request says “PL60-B2 base plate, 6 mm, 4 pieces”; page 1 of Drawing.pdf says “Thickness 5 mm”.',
      },
    });
    expect(parts[0]!.thickness!.source).toBe('request');
  });

  it('leaves a disagreement unverified when a quote is not on its page or does not give its value', () => {
    const elsewhere = reconcile([part({ quote: 'PL60-B2, 4 pieces, urgent' })]);
    expect(elsewhere.findings[0]!.grade).toMatchObject({
      status: 'unverified',
      reason: '“PL60-B2, 4 pieces, urgent” is not on page 1 of Request.eml.',
    });
    const drawn = reconcile([
      part({
        quantity: 2,
        drawing: {
          ref: 'S2',
          page: 1,
          quantity: null,
          thickness: 8,
          material: null,
          quote: 'Thickness 5 mm',
        },
      }),
    ]);
    expect(drawn.findings[0]!.grade).toMatchObject({
      status: 'unverified',
      reason: "The passage gives 5 mm for thickness; the model's value is not supported.",
    });
  });

  it('raises nothing where they agree, and nothing the model already found', () => {
    const agreed = 'PL60-B2 base plate, 6 mm, 2 pieces';
    expect(reconcile([part({ quantity: 2, quote: agreed })], 1, agreed).findings).toEqual([]);
    const said = reconcileJob({
      answer: {
        ...answer([part()]),
        findings: [
          {
            id: 'F1',
            kind: 'quantity',
            summary: 'The request asks for 4; the name gives 2.',
            drawing: { ref: 'S1', page: 1, value: 4, quote: null, box: null, feature: null },
            dxf: { ref: 'S3', value: 2, axis: null, entities: [] },
            photo: null,
            proposal: null,
          },
        ],
      },
      sources,
      grading,
      pieces: () => 1,
    });
    expect(said.findings).toEqual([]);
  });

  it('takes the file name only when nothing else gives a value, and says so', () => {
    const { parts, findings } = reconcile([part({ quantity: null, thickness: null, quote: null })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject(unreadPlate);
    expect(parts[0]).toMatchObject({
      quantity: { sets: 2, pieces: 2, source: 'name' },
      thickness: { value: 6, source: 'name' },
    });
    expect(partValuesText(parts[0]!)).toBe(
      '2 pieces · 6 mm, both from the file name (“2buc”, “g6”)',
    );
  });
});

describe('a drawing of several separate pieces', () => {
  it('shows sets as the default only when nothing else decides', () => {
    const { parts, findings } = reconcile([part({ quantity: null })], 2);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject(unreadPlate);
    expect(parts[0]!.quantity).toEqual({
      sets: 2,
      pieces: 4,
      source: 'name',
      quote: '2buc',
    });
    expect(partValuesText(parts[0]!)).toBe(
      '2 sets × 2 pieces = 4 pieces, from the file name (“2buc”); nothing else in the job says whether it counts sets or pieces · 6 mm, from the request',
    );
  });

  it('lets the request’s count decide between sets and pieces', () => {
    // 4 pieces of a drawing of 2: the name's "2buc" counted sets
    const sets = reconcile([part()], 2);
    expect(sets.findings).toEqual([]);
    expect(sets.parts[0]!.quantity).toMatchObject({
      sets: 2,
      pieces: 4,
      source: 'request',
    });
    expect(partValuesText(sets.parts[0]!)).toBe(
      '2 sets × 2 pieces = 4 pieces · 6 mm, both from the request',
    );
    // 2 pieces of a drawing of 2: the name counted pieces
    const pieces = reconcile(
      [part({ quantity: 2, quote: 'PL60-B2 base plate, 6 mm, 2 pieces' })],
      2,
      'PL60-B2 base plate, 6 mm, 2 pieces',
    );
    expect(pieces.parts[0]!.quantity).toMatchObject({ sets: 1, pieces: 2, source: 'request' });
    // a left and a right listed apart, drawn together
    const halves = reconcile(
      [
        part({ part: 'PL60-B2 left', quantity: 3, quote: 'PL60-B2 left, 6 mm, 3 pieces' }),
        part({ part: 'PL60-B2 right', quantity: 3, quote: 'PL60-B2 right, 6 mm, 3 pieces' }),
      ],
      2,
      'PL60-B2 left, 6 mm, 3 pieces\nPL60-B2 right, 6 mm, 3 pieces',
    );
    expect(halves.parts[0]!.quantity).toMatchObject({ sets: 3, pieces: 6 });
  });

  it('asks instead of giving a number when the request’s count is not whole sets', () => {
    const stated = 'PL60-B2 base plate, 6 mm, 5 pieces';
    const { parts, findings } = reconcile([part({ quantity: 5, quote: stated })], 2, stated);
    expect(parts[0]!.quantity).toBeUndefined();
    expect(parts[0]!.question).toBe(
      'g6-PL60-B2-2buc.dxf holds 2 separate pieces, and the request asks for 5, which is not a whole number of sets. How many sets should be cut?',
    );
    const question = findings.find((item) => item.question);
    expect(question).toMatchObject({
      finding: { kind: 'quantity', summary: parts[0]!.question },
      grade: {
        status: 'unverified',
        reason:
          'Viewer does not choose between sets and pieces: 5 pieces of a drawing of 2 is 2.5 sets.',
      },
    });
    // 5 is neither 2 nor 2 × 2: the request and the name disagree as well, and that is said
    expect(findings.map((item) => item.finding.kind)).toEqual(['quantity', 'quantity']);
  });
});

describe('what the answer leaves unread in the request', () => {
  const spacer: InventorySource = {
    ref: 'S4',
    kind: 'dxf',
    name: 'Spacer S4.dxf',
    path: '/jobs/Spacer S4.dxf',
    version,
  };
  const job = (request: RequestPart[], more: InventorySource[] = [], requestText?: string) =>
    reconcileJob({
      answer: answer(request),
      sources: [...sources, ...more],
      reader: 'Muse Spark',
      grading:
        requestText === undefined
          ? grading
          : {
              ...grading,
              text: (ref, page) => (ref === 'S1' ? requestText : texts[`${ref}:${page}`]),
            },
      pieces: () => 1,
    });

  it('names a DXF part no listed part is, and a listed part not tied to its DXF', () => {
    const stated = 'PL60-B2 base plate, 6 mm, 2 pieces';
    const { findings } = job([part({ quantity: 2, quote: stated })], [spacer], stated);
    expect(findings).toMatchObject([
      {
        unread: 'part',
        part: 'S4',
        finding: {
          summary:
            'Muse Spark did not read Spacer S4 from the request. Check the request or run the check again.',
          dxf: { ref: 'S4', value: null, axis: null, entities: [] },
        },
        grade: {
          status: 'unverified',
          reason:
            'The answer lists no part of the request for Spacer S4.dxf, so nothing was compared.',
        },
      },
    ]);
    const untied = job([part({ dxf: null, quantity: 2, quote: 'PL60-B2 base plate, 2 pieces' })]);
    expect(untied.findings.map((item) => [item.unread, item.finding.summary])).toEqual([
      [
        'part',
        'Muse Spark did not match PL60-B2 base plate in the request to g6-PL60-B2-2buc.dxf. Check the request or run the check again.',
      ],
    ]);
  });

  it('says nothing without a request, and nothing of a part the model found a quantity of', () => {
    const drawingsOnly = reconcileJob({
      answer: answer([]),
      sources: sources.filter((source) => source.kind !== 'request'),
      grading,
      pieces: () => 1,
    });
    expect(drawingsOnly.findings).toEqual([]);
    const found = reconcileJob({
      answer: {
        ...answer([part({ quantity: null })]),
        findings: [
          {
            id: 'F1',
            kind: 'quantity',
            summary: 'The request gives no count for the base plate.',
            drawing: null,
            dxf: { ref: 'S3', value: 2, axis: null, entities: [] },
            photo: null,
            proposal: null,
          },
        ],
      },
      sources,
      grading,
      pieces: () => 1,
    });
    expect(found.findings).toEqual([]);
  });
});
