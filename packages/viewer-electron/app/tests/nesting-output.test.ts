import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutTransformSchema } from '../src/domain/layout/plan';
import { readCutDrawing } from '../src/domain/layout/nesting/drawing';
import { nestingFiles, type NestingSource } from '../src/domain/layout/nesting/output';
import { extractParts, suggestedMarks } from '../src/domain/layout/nesting/parts';
import { cuttingPresets, type NestingTransform } from '../src/domain/layout/nesting/plan';
import { nestProblem } from '../src/domain/layout/nesting/problem';
import { nestSearch, type NestUpdate } from '../src/domain/layout/nesting/search';
import {
  transformDescription,
  transformPlanSchema,
  validateTransform,
} from '../src/domain/operations/transforms';
import { Transforms } from '../src/desktop/transforms/transforms';
import { nestingParts, type NestingPartName } from '../tools/playground/samples/nesting';
import { temporaryRoot } from '../tools/temporary';

const names: NestingPartName[] = ['Bracket with holes', 'Ring', 'Disc'];
const quantities = [4, 2, 2];
const cutting = { ...cuttingPresets[2]!, rate: 90, currency: '€' };

function nested() {
  const sources: NestingSource[] = names.map((name) => {
    const drawing = readCutDrawing(nestingParts[name]());
    const file = extractParts(
      drawing,
      { scale: 1, marks: new Set(suggestedMarks(drawing.layers)), together: false },
      name,
    );
    return { file: `${name}.dxf`, parts: file.parts };
  });
  const problem = nestProblem(
    sources.map((source, index) => ({
      part: source.parts[0]!,
      choice: { quantity: quantities[index]!, rotation: 'quarter', mirror: false, grain: false },
    })),
    [{ width: 1000, height: 2000, price: 120 }],
    { margin: 10, spacing: 5 },
  );
  let last: NestUpdate | undefined;
  for (const update of nestSearch(problem, { budget: 300, now: () => performance.now() }))
    last = update;
  const plan: NestingTransform = {
    kind: 'nesting',
    format: 'dxf',
    title: 'Nesting of 3 parts',
    sources: names.map(() => ({ units: 4, together: false, marks: ['ENGRAVE'] })),
    parts: sources.map((source, index) => ({
      source: index,
      index: 0,
      name: names[index]!,
      quantity: quantities[index]!,
      width: source.parts[0]!.width,
      height: source.parts[0]!.height,
      area: source.parts[0]!.area,
    })),
    formats: [{ width: 1000, height: 2000, price: 120 }],
    sheets: last!.best!.layout.sheets.map((sheet) => ({
      format: sheet.format,
      placements: sheet.placements,
    })),
    margin: 10,
    spacing: 5,
    cutting,
    labels: true,
  };
  return { sources, plan };
}

describe('saved nesting', () => {
  it('registers as a transform plan with one source per drawing', () => {
    const { plan } = nested();
    expect(transformPlanSchema.parse(plan)).toEqual(plan);
    expect(validateTransform(plan, 3)).toEqual(plan);
    expect(() => validateTransform(plan, 2)).toThrow(
      'The nesting names a different set of drawings.',
    );
    expect(transformDescription(plan)).toBe(
      `Nesting · 3 parts on ${plan.sheets.length === 1 ? '1 sheet' : `${plan.sheets.length} sheets`} · a DXF per sheet, a PDF report and a CSV parts list`,
    );
    const overplaced = structuredClone(plan);
    overplaced.parts[2]!.quantity = 0;
    expect(() => transformPlanSchema.parse(overplaced)).toThrow('placed more often than requested');
  });

  it('writes a DXF per sheet, a parts list and a report plan of shapes and text', () => {
    const { sources, plan } = nested();
    const written = nestingFiles(plan, sources, '30 October 2026');
    expect(written.files.map((file) => file.name)).toEqual([
      ...plan.sheets.map((_, index) => `Sheet ${index + 1}.dxf`),
      'Parts.csv',
    ]);
    expect(written.verification.ok).toBe(true);
    const csv = written.files.at(-1)!.content;
    expect(csv.startsWith('﻿No.,Part,File,Requested,Placed,')).toBe(true);
    expect(csv).toContain('\r\n1,Bracket with holes,Bracket with holes.dxf,4,4,300,200,58400,');
    expect(csv).toContain('\r\nSheet,Width (mm),Height (mm),Parts,Utilisation (%),');
    const report = layoutTransformSchema.parse(written.report);
    expect(report.pages.length).toBe(1 + plan.sheets.length);
    expect(new Set(report.pages.flatMap((page) => page.items.map((item) => item.kind)))).toEqual(
      new Set(['rect', 'path', 'text']),
    );
    const text = report.pages.flatMap((page) =>
      page.items.flatMap((item) => (item.kind === 'text' ? [item.text] : [])),
    );
    expect(text).toContain('Nesting of 3 parts');
    expect(text).toContain('Cutting time');
    expect(text.some((line) => line.startsWith('Mild steel 3 mm, fiber laser: 4,000 mm/min'))).toBe(
      true,
    );
    expect(written.estimate.pierces).toBe(4 * 5 + 2 * 2 + 2);
  });

  it('refuses a drawing that changed and a layout that fails the exact check', () => {
    const { sources, plan } = nested();
    const changed = structuredClone(plan);
    changed.parts[0]!.width = 301;
    expect(() => nestingFiles(changed, sources, 'today')).toThrow(
      'Bracket with holes.dxf changed since it was nested. Nest again.',
    );
    const crowded = structuredClone(plan);
    const sheet = crowded.sheets[0]!;
    sheet.placements[1] = {
      ...sheet.placements[0]!,
      part: sheet.placements[1]!.part,
      x: sheet.placements[0]!.x + 1,
    };
    expect(() => nestingFiles(crowded, sources, 'today')).toThrow(
      'The nesting failed its final check',
    );
  });
});

const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`);
const qpdf = path.resolve(
  'assets',
  `viewer-optimizers-${process.platform}-${process.arch}`,
  'qpdf',
);

it.skipIf(!(process.platform === 'darwin' && existsSync(qpdf)))(
  'saves the folder through the transform service, the report drawn by the layout writer',
  async () => {
    const root = await temporaryRoot('viewer-nesting-output-');
    const files = names.map((name) => path.join(root, `${name}.dxf`));
    for (const [index, name] of names.entries())
      await writeFile(files[index]!, nestingParts[name](), { flag: 'wx' });
    const { plan } = nested();
    const transforms = new Transforms(
      processors,
      async () => {},
      async () => Buffer.alloc(0),
    );
    const output = path.join(root, 'Nesting of 3 parts');
    const steps: string[] = [];
    await transforms.execute(plan, files, output, new AbortController().signal, (_, detail) =>
      steps.push(detail),
    );
    expect((await readdir(output)).sort()).toEqual(
      [
        ...plan.sheets.map((_, index) => `Sheet ${index + 1}.dxf`),
        'Parts.csv',
        'Report.pdf',
      ].sort(),
    );
    expect((await readFile(path.join(output, 'Report.pdf'))).subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    const sheet = readCutDrawing(await readFile(path.join(output, 'Sheet 1.dxf'), 'utf8'));
    expect(sheet.units).toBe(4);
    expect(steps.at(-1)).toMatch(/^\d+ sheets?, report and parts list ready$/);
    // A source changed after nesting is refused before anything is written.
    await writeFile(files[1]!, nestingParts.Disc());
    await expect(
      transforms.execute(
        plan,
        files,
        path.join(root, 'Again'),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('Ring.dxf changed since it was nested. Nest again.');
    expect(existsSync(path.join(root, 'Again'))).toBe(false);
  },
);
