import { expect, it } from 'vitest';
import { pdfPageRange, pdfOutput, type PDFInput } from '../src/domain/operations/pdf-pages';
import { validateTransform, combinedTransform } from '../src/domain/operations/transforms';
import { optimizationPlan } from '../src/domain/operations/optimization';
it('preserves range order, supports reverse ranges and rejects executable syntax and oversized selections', () => {
  expect(pdfPageRange('3-1, 5, 2', 8)).toEqual([3, 2, 1, 5]);
  for (const value of ['0', '9', '1-z', '1; --replace-input', '1,,2', ''])
    expect(() => pdfPageRange(value, 8)).toThrow();
  expect(() => pdfPageRange('1-1001', 1001)).toThrow('1,000');
});
it('remaps only included PDF sources and retains rotation for their new output order', () => {
  const sources = [{ pages: 3 }, { pages: 1 }, { pages: 2 }] as PDFInput[];
  expect(
    pdfOutput(
      [
        { id: '2:2', source: 2, page: 2, rotate: 90, included: true },
        { id: '0:1', source: 0, page: 1, rotate: 0, included: false },
        { id: '1:1', source: 1, page: 1, rotate: 270, included: true },
      ],
      sources,
    ),
  ).toEqual({
    sources: [sources[2], sources[1]],
    plan: {
      kind: 'pdf-pages',
      format: 'pdf',
      pages: [
        { source: 0, page: 2, rotate: 90 },
        { source: 1, page: 1, rotate: 270 },
      ],
    },
  });
});
it('bounds typed PDF plans, refuses duplicate references and does not allow lossless scan recompression', () => {
  const plan = { kind: 'pdf-pages', format: 'pdf', pages: [{ source: 0, page: 1 }] };
  expect(combinedTransform(validateTransform(plan, 1))).toBe(true);
  for (const value of [
    { ...plan, args: ['--replace-input'] },
    { ...plan, pages: [{ source: 1, page: 1 }] },
    { ...plan, pages: [{ source: 0, page: 0 }] },
    { ...plan, pages: [plan.pages[0], plan.pages[0]] },
  ])
    expect(() => validateTransform(value, 1)).toThrow();
  expect(() => validateTransform(plan, 17)).toThrow('16');
  expect(() =>
    validateTransform(
      { kind: 'pdf', format: 'pdf', preset: 'lossless', recompressImages: true },
      1,
    ),
  ).toThrow('Balanced');
  expect(
    optimizationPlan(
      { kind: 'file', extension: 'pdf' },
      { preset: 'small', pdfImages: { maximum: 1600 } },
    ),
  ).toMatchObject({ recompressImages: true, maxImageEdge: 1600 });
  expect(
    optimizationPlan(
      { kind: 'file', extension: 'pdf' },
      { preset: 'lossless', pdfImages: { maximum: 1600 } },
    ),
  ).toMatchObject({ recompressImages: false });
});
