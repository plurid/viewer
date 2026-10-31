import { describe, expect, it } from 'vitest';
import type {
  FabricationAnswer,
  Finding,
  InventorySource,
  RequestPart,
} from '../src/domain/fabrication/answer';
import type {
  RequirementClaim,
  RequirementConfirmation,
} from '../src/domain/fabrication/requirements';
import {
  findingRequirement,
  requestRequirement,
  verifyRequirement,
} from '../src/domain/fabrication/requirements';
import { gradeFinding } from '../src/domain/fabrication/grade';
import { correctionFor } from '../src/domain/fabrication/correction';
import { reconcileJob } from '../src/domain/fabrication/reconcile';
import { measureDrawing } from '../src/domain/fabrication/measure';
import { parseDrawing } from '../src/domain/previews/drawings/dxf/geometry';
import { autocadDXF, jobParts } from '../tools/playground/samples/fabrication';

const version = { identity: '1:2', modified: 1, size: 100 };
const drawing: InventorySource = {
  ref: 'S1',
  kind: 'drawing',
  name: 'Drawing.pdf',
  path: '/job/Drawing.pdf',
  pages: 1,
  version,
};
const dxf: InventorySource = {
  ref: 'S2',
  kind: 'dxf',
  name: 'g6-PL60-B2-2buc.dxf',
  path: '/job/g6-PL60-B2-2buc.dxf',
  version,
};
const request: InventorySource = {
  ref: 'S3',
  kind: 'request',
  name: 'Request.eml',
  path: '/job/Request.eml',
  pages: 1,
  version,
};
const sources = [drawing, dxf, request];
const finding: Finding = {
  id: 'F1',
  kind: 'pitch',
  summary: 'The holes are 48 mm apart; the drawing calls for 50 mm.',
  drawing: { ref: drawing.ref, page: 1, value: 50, quote: '50 mm pitch', box: null, feature: null },
  dxf: { ref: dxf.ref, value: 48, axis: 'x', entities: ['8', '9'] },
  photo: null,
  proposal: { target: 50, move: ['9', '11'] },
};
const outcome = measureDrawing(
  parseDrawing(autocadDXF(jobParts.find((part) => part.file === dxf.name)!.entities)),
);
if (outcome.status !== 'measured') throw new Error(outcome.reason);
const measurement = outcome.measurement;
const job = (text?: string, confirmations?: RequirementConfirmation[]) => ({
  inventory: sources,
  sources,
  dxf: () => ({ name: dxf.name, outcome }),
  text: () => text,
  confirmations,
});
const claim = (patch: Partial<RequirementClaim> = {}): RequirementClaim => ({
  ...findingRequirement(finding)!,
  ...patch,
});
const verify = (quote: string, patch: Partial<RequirementClaim> = {}, text = quote) =>
  verifyRequirement(claim({ quote, ...patch }), { source: drawing, text });
const confirmation = (wanted: RequirementClaim, value = 50): RequirementConfirmation => ({
  key: wanted.key,
  kind: wanted.kind,
  value,
  unit: 'mm',
  part: wanted.part,
  evidence: { ref: wanted.ref, page: wanted.page, quote: wanted.quote, version },
  confirmedAt: 1,
});

describe('source requirements', () => {
  it('rejects the original 50 versus quoted 60 regression before a correction is offered', () => {
    const contradicted = {
      ...finding,
      drawing: { ...finding.drawing!, quote: 'Holes 4× Ø10.5 at 60 mm pitch' },
    };
    const grade = gradeFinding(contradicted, job(contradicted.drawing.quote));
    expect(grade).toMatchObject({ status: 'unverified', measured: 48 });
    expect(grade.requirement).toMatchObject({ status: 'unverified' });
    expect(correctionFor(contradicted, grade, measurement)).toBeUndefined();
  });

  it('derives a canonical pitch from the quoted role and retains the captured source version', () => {
    expect(verify('Holes 4× Ø10.5 at 50 mm pitch')).toMatchObject({
      status: 'source-verified',
      value: 50,
      unit: 'mm',
      kind: 'pitch',
      evidence: { ref: 'S1', page: 1, version },
    });
    const grade = gradeFinding(finding, job('50 mm pitch'));
    expect(correctionFor(finding, grade, measurement)?.target).toBe(50);
  });

  it.each([
    ['Holes 4× Ø10.5 at 60 mm pitch', { value: 4 }],
    ['Holes 4× Ø10.5 at 60 mm pitch', { value: 10.5 }],
    ['Part PL50: holes 48 mm apart', { value: 50 }],
    ['50 mm diameter', { value: 50 }],
    ['50', { value: 50 }],
    ['50 mm pitch and 60 mm pitch', { value: 50 }],
    ['-50 mm pitch', { value: 50 }],
    ['50.5 mm pitch', { value: 50 }],
    ['Pitch 50 degrees', { value: 50 }],
    ['Pitch 50 cm', { value: 50 }],
    ['Pitch 50', { value: 50 }],
  ])('does not accept a number with the wrong or uncertain role/unit: %s', (quote, patch) => {
    expect(verify(quote, patch)).toMatchObject({ status: 'unverified' });
  });

  it.each([
    ['5 cm pitch', 50],
    ['Pitch 1 inch', 25.4],
    ['Pitch 50,5 mm', 50.5],
    ['50mm pitch', 50],
  ])('converts explicit source units to canonical millimetres: %s', (quote, value) => {
    expect(verify(quote, { value })).toMatchObject({ status: 'source-verified', value });
  });

  it('uses a stated page unit for a labeled diameter and keeps the hole count separate', () => {
    const text = 'Units: mm\nHoles 4× Ø10.5 at 50 mm pitch';
    expect(verify('4× Ø10.5', { kind: 'diameter', value: 10.5 }, text)).toMatchObject({
      status: 'source-verified',
      value: 10.5,
      unit: 'mm',
    });
    expect(verify('4× Ø10.5', { kind: 'holes', value: 4 }, text)).toMatchObject({
      status: 'source-verified',
      value: 4,
      unit: 'holes',
    });
    expect(verify('4× Ø10.5', { kind: 'holes', value: 10.5 }, text).status).toBe('unverified');
    expect(verify('Ø10.5', { kind: 'diameter', value: 10.5 }).status).toBe('unverified');
  });

  it('requires a real quote, available text, an existing page and captured source identity', () => {
    expect(
      verifyRequirement(claim({ quote: null }), { source: drawing, text: '50 mm pitch' }).status,
    ).toBe('unverified');
    expect(verifyRequirement(claim(), { source: drawing }).status).toBe('unverified');
    expect(verify('50 mm pitch', {}, '60 mm pitch').status).toBe('unverified');
    expect(verify('50 mm pitch', { page: 2 }).status).toBe('unverified');
    expect(gradeFinding(finding, { ...job('50 mm pitch'), sources: undefined }).status).toBe(
      'unverified',
    );
  });

  it('never accepts width as height or pitch', () => {
    expect(verify('Width 160 mm', { kind: 'size', axis: 'x', value: 160 }).status).toBe(
      'source-verified',
    );
    expect(verify('Width 160 mm', { kind: 'size', axis: 'y', value: 160 }).status).toBe(
      'unverified',
    );
    expect(verify('Width 160 mm', { kind: 'pitch', value: 160 }).status).toBe('unverified');
  });
});

it('does not let page units override an explicit wrong unit or dimensionless quantity', () => {
  for (const quote of ['Pitch 50 ft', 'Pitch 50 degrees', 'Diameter 50 m'])
    expect(verify(quote, {}, `Units: mm\n${quote}`).status).toBe('unverified');
  expect(verify('Qty 4 mm', { kind: 'quantity', value: 4 }).status).toBe('unverified');
});

describe('human confirmation', () => {
  it('uses the person’s canonical value without relabeling a scan as machine verified', () => {
    const scanned = { ...finding, drawing: { ...finding.drawing!, quote: null } };
    const wanted = findingRequirement(scanned)!;
    const grade = gradeFinding(scanned, job(undefined, [confirmation(wanted, 60)]));
    expect(grade).toMatchObject({
      status: 'confirmed',
      requirement: { status: 'human-confirmed', value: 60, confirmedAt: 1 },
    });
    expect(correctionFor(scanned, grade, measurement)?.target).toBe(60);
  });

  it.each(['key', 'kind', 'part', 'page', 'version', 'quote', 'unit'] as const)(
    'rejects a confirmation for another %s',
    (changed) => {
      const wanted = claim();
      const review = confirmation(wanted);
      if (changed === 'key') review.key = 'finding:F2';
      if (changed === 'kind') review.kind = 'diameter';
      if (changed === 'part') review.part = 'S4';
      if (changed === 'page') review.evidence.page = 2;
      if (changed === 'version') review.evidence.version = { ...version, modified: 2 };
      if (changed === 'quote') review.evidence.quote = '60 mm pitch';
      if (changed === 'unit') review.unit = 'pieces';
      expect(verifyRequirement(wanted, { source: drawing, confirmation: review }).status).toBe(
        'unverified',
      );
    },
  );
});

const part = (patch: Partial<RequestPart> = {}): RequestPart => ({
  ref: 'S3',
  part: 'PL60-B2 base plate',
  dxf: 'S2',
  quantity: 4,
  thickness: 6,
  material: null,
  quote: 'PL60-B2 base plate, 6 mm, 4 pieces',
  drawing: null,
  ...patch,
});
function reconcile(parts: RequestPart[], text?: string, confirmations?: RequirementConfirmation[]) {
  const answer: FabricationAnswer = { summary: '', request: parts, findings: [], tour: [] };
  return reconcileJob({ answer, sources, grading: job(text, confirmations), pieces: () => 1 });
}

describe('requirements used in cut sheets', () => {
  it('does not place invented quantities or thicknesses into the plan', () => {
    const result = reconcile([part({ quantity: 6, thickness: 4 })], part().quote!);
    expect(result.parts[0]!.quantity).toBeUndefined();
    expect(result.parts[0]!.thickness).toBeUndefined();
    expect(result.parts[0]!.question).toContain('review');
    expect(result.findings.every((item) => item.grade.status === 'unverified')).toBe(true);
  });

  it('accepts only the thickness of the exact named request row', () => {
    const result = reconcile([part()], part().quote!);
    expect(result.parts[0]).toMatchObject({
      quantity: {
        sets: 4,
        requirements: [{ status: 'source-verified', kind: 'quantity', value: 4 }],
      },
      thickness: {
        value: 6,
        requirements: [{ status: 'source-verified', kind: 'thickness', value: 6 }],
      },
    });
    expect(
      reconcile([part({ part: 'Another part' })], part().quote!).parts[0]!.thickness,
    ).toBeUndefined();
  });

  it('keeps missing or scanned source values unresolved, with filename defaults only when no source value was claimed', () => {
    const result = reconcile([part()]);
    expect(result.parts[0]!.quantity).toBeUndefined();
    expect(result.parts[0]!.thickness).toBeUndefined();
    expect(reconcile([part({ quantity: null, thickness: null })]).parts[0]).toMatchObject({
      quantity: { sets: 2, source: 'name' },
      thickness: { value: 6, source: 'name' },
    });
  });

  it('validates every row before summing quantities, and refuses a repeated source row', () => {
    const first = part({ part: 'left', quantity: 2, thickness: null, quote: 'left, 2 pieces' });
    const second = part({ part: 'right', quantity: 3, thickness: null, quote: 'right, 3 pieces' });
    const text = `${first.quote}\n${second.quote}\nTotal 99 pieces`;
    expect(reconcile([first, second], text).parts[0]!.quantity).toMatchObject({ sets: 5 });
    expect(
      reconcile([first, { ...second, quantity: 99 }], text).parts[0]!.quantity,
    ).toBeUndefined();
    expect(reconcile([first, first], text).parts[0]!.quantity).toBeUndefined();
  });

  it('uses an explicit quantity confirmation with its own provenance', () => {
    const row = part({ thickness: null, quote: null });
    const wanted = requestRequirement(row, 0, 'request', 'quantity')!;
    const review = { ...confirmation(wanted, 3), unit: 'pieces' as const };
    expect(reconcile([row], undefined, [review]).parts[0]!.quantity).toMatchObject({
      sets: 3,
      requirements: [{ status: 'human-confirmed', value: 3, part: 'S2' }],
    });
  });
});
