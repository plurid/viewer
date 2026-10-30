/**
 * RECONCILING A JOB: the request first, a drawing's title block next, the file name last.
 * Disagreements become findings Viewer grades with the exact quotes; a drawing of several separate
 * pieces counts sets or pieces only when the job decides it, and otherwise asks.
 */
import { describe, expect, it } from 'vitest';
import type {
  FabricationAnswer,
  InventorySource,
  RequestPart,
} from '../src/domain/fabrication/answer';
import type { GradeJob } from '../src/domain/fabrication/grade';
import { reconcileJob } from '../src/domain/fabrication/reconcile';

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
const reconcile = (request: RequestPart[], pieces = 1) =>
  reconcileJob({ answer: answer(request), sources, grading, pieces: () => pieces });

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
        reason: 'The name g6-PL60-B2-2buc.dxf gives 2 pieces (“2buc”); the request gives 4 pieces.',
      },
    });
    // the request comes first, and says so; the finding stands beside it
    expect(parts[0]!.quantity).toEqual({
      sets: 4,
      pieces: 4,
      source: 'request',
      text: '4, from the request',
      quote: 'PL60-B2 base plate, 6 mm, 4 pieces',
    });
    expect(parts[0]!.thickness).toMatchObject({ value: 6, text: '6 mm, from the request' });
  });

  it('sets the request against the drawing’s title block, with both quotes', () => {
    const { findings, parts } = reconcile([
      part({
        quantity: 2,
        drawing: {
          ref: 'S2',
          page: 1,
          quantity: 2,
          thickness: 5,
          material: null,
          quote: 'Thickness 5 mm',
        },
      }),
    ]);
    expect(findings.map((item) => item.finding.summary)).toEqual([
      'The request asks for 6 mm of PL60-B2; Drawing.pdf gives 5 mm.',
    ]);
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
      reason:
        '“PL60-B2, 4 pieces, urgent” is not on page 1 of Request.eml, so the request value is unconfirmed.',
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
      reason: '“Thickness 5 mm” does not give 8 mm.',
    });
  });

  it('raises nothing where they agree, and nothing the model already found', () => {
    expect(reconcile([part({ quantity: 2 })]).findings).toEqual([]);
    const said = reconcileJob({
      answer: {
        ...answer([part()]),
        findings: [
          {
            id: 'F1',
            kind: 'quantity',
            summary: 'The request asks for 4; the name gives 2.',
            drawing: { ref: 'S1', page: 1, value: 4, quote: null, box: null },
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
    expect(findings).toEqual([]);
    expect(parts[0]).toMatchObject({
      quantity: { sets: 2, pieces: 2, source: 'name', text: '2, from the file name (“2buc”)' },
      thickness: { value: 6, source: 'name', text: '6 mm, from the file name' },
    });
  });
});

describe('a drawing of several separate pieces', () => {
  it('shows sets as the default only when nothing else decides', () => {
    const { parts, findings } = reconcile([part({ quantity: null, quote: null })], 2);
    expect(findings).toEqual([]);
    expect(parts[0]!.quantity).toEqual({
      sets: 2,
      pieces: 4,
      source: 'name',
      text: '2 sets × 2 pieces = 4 pieces, from the file name (“2buc”); nothing else in the job says whether it counts sets or pieces',
      quote: '2buc',
    });
  });

  it('lets the request’s count decide between sets and pieces', () => {
    // 4 pieces of a drawing of 2: the name's "2buc" counted sets
    const sets = reconcile([part()], 2);
    expect(sets.findings).toEqual([]);
    expect(sets.parts[0]!.quantity).toMatchObject({
      sets: 2,
      pieces: 4,
      source: 'request',
      text: '2 sets × 2 pieces = 4 pieces, from the request',
    });
    // 2 pieces of a drawing of 2: the name counted pieces
    const pieces = reconcile(
      [part({ quantity: 2, quote: 'PL60-B2 base plate, 6 mm, 4 pieces' })],
      2,
    );
    expect(pieces.parts[0]!.quantity).toMatchObject({ sets: 1, pieces: 2, source: 'request' });
    // a left and a right listed apart, drawn together
    const halves = reconcile(
      [
        part({ part: 'PL60-B2 left', quantity: 3, quote: null }),
        part({ part: 'PL60-B2 right', quantity: 3, quote: null }),
      ],
      2,
    );
    expect(halves.parts[0]!.quantity).toMatchObject({ sets: 3, pieces: 6 });
  });

  it('asks instead of giving a number when the request’s count is not whole sets', () => {
    const { parts, findings } = reconcile([part({ quantity: 5, quote: null })], 2);
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
