import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { measureDrawing, rowPitches } from '../src/domain/fabrication/measure';
import { readJobName } from '../src/domain/fabrication/names';
import { parseDrawing } from '../src/domain/previews/drawings/dxf/geometry';
import { readMessage } from '../src/domain/previews/mail/message';
import { evaluateFabrication } from '../tools/fabrication/evaluate';
import {
  autocadDXF,
  evaluationParts,
  fabricationSamples,
  jobDrawing,
  jobMismatch,
  jobParts,
  jobRequest,
} from '../tools/playground/samples/fabrication';

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
const pdfRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

async function pageText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const task = getDocument({ data: bytes, standardFontDataUrl: pdfRoot + '/standard_fonts/' });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const items = (await page.getTextContent()).items;
    return {
      pages: document.numPages,
      text: items.map((item) => ('str' in item ? item.str : '')).join('\n'),
    };
  } finally {
    await task.destroy();
  }
}

describe('Job 1042', () => {
  it('names five parts in the convention, mixed 3 and 6 mm, 2 to 10 pieces', () => {
    expect(jobParts).toHaveLength(5);
    for (const part of jobParts) {
      const name = readJobName(part.file);
      expect([name.thickness?.value, name.part, name.quantity?.value]).toEqual([
        part.thickness,
        part.part,
        part.quantity,
      ]);
    }
    expect(new Set(jobParts.map((part) => part.thickness))).toEqual(new Set([3, 6]));
    expect(jobParts.every((part) => part.quantity >= 2 && part.quantity <= 10)).toBe(true);
  });

  it('writes AutoCAD 2010 DXF in millimetres: lines, arcs and circles on Visible', () => {
    for (const part of jobParts) {
      const text = autocadDXF(part.entities);
      expect(text).toContain('$ACADVER\r\n  1\r\nAC1024');
      expect(text).toContain('$INSUNITS\r\n 70\r\n     4');
      const drawing = parseDrawing(text);
      expect(new Set(drawing.entities.map((entity) => entity.type))).toEqual(
        new Set(part.entities.map((entity) => entity.kind.toUpperCase())),
      );
      expect(new Set(drawing.entities.map((entity) => entity.layer))).toEqual(new Set(['Visible']));
      expect(drawing.warnings).toEqual([]);
      const outcome = measureDrawing(drawing);
      expect(outcome.status, part.file).toBe('measured');
    }
  });

  it('draws one pitch 48 mm where the drawing and its text give 50 mm', async () => {
    const plate = jobParts.find((part) => part.file === jobMismatch.file)!;
    const outcome = measureDrawing(parseDrawing(autocadDXF(plate.entities)));
    if (outcome.status !== 'measured') throw new Error(outcome.reason);
    const pitches = rowPitches(outcome.measurement).filter((pitch) => pitch.axis === 'x');
    expect(pitches.map((pitch) => pitch.value)).toEqual([48, 48]);
    const { pages, text } = await pageText(jobDrawing());
    expect(pages).toBe(1);
    for (const line of [
      '50',
      '55',
      '160',
      '100',
      '4× Ø10.5',
      'Ø30',
      'JOB 1042 · BASE PLATE PL60-B2',
      'Material: S235JR steel, 6 mm',
      'Laser cut. Remove burrs. Holes 4× Ø10.5 at 50 mm pitch, centre hole Ø30.',
      'CV25-E1',
    ])
      expect(text.split('\n'), line).toContain(line);
  });

  it('asks for every part with its quantity and material, the drawing attached', () => {
    const message = readMessage(new TextEncoder().encode(jobRequest(jobDrawing())));
    expect(message.subject).toBe('Job 1042: laser cut parts, S235JR');
    for (const part of jobParts)
      expect(message.text).toContain(
        `${part.part} ${part.title.toLowerCase()}, ${part.thickness} mm, ${part.quantity} pieces`,
      );
    expect(message.attachments.map((attachment) => attachment.name)).toEqual([
      'Job 1042 drawing.pdf',
    ]);
  });

  it('places the job and the evaluation set in the playground', () => {
    const paths = fabricationSamples().map((sample) => sample.path);
    expect(paths.filter((file) => file.startsWith('fabrication/Job 1042/'))).toHaveLength(7);
    expect(paths.filter((file) => file.startsWith('fabrication/Evaluation/'))).toHaveLength(41);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('evaluation set', () => {
  it('is about forty parts, a quarter with a pitch drawn off, the same every time', () => {
    const parts = evaluationParts();
    expect(parts).toHaveLength(40);
    expect(parts.filter((part) => part.truth.mismatch)).toHaveLength(10);
    expect(evaluationParts().map((part) => part.dxf)).toEqual(parts.map((part) => part.dxf));
    for (const { truth } of parts)
      expect(Math.abs(truth.pitch.drawn - truth.pitch.specified) > 0).toBe(truth.mismatch);
  });

  it('reads, measures, grades and corrects every part as its truth says', () => {
    const report = evaluateFabrication({ budget: 60 });
    expect(report).toMatchObject({
      parts: 40,
      mismatches: 10,
      parsed: 40,
      outlined: 40,
      thickness: { correct: 40, total: 40, unread: 8 },
      quantity: { correct: 40, total: 40, unread: 4 },
      pitch: { correct: 40, total: 40 },
      grades: { correct: 160, total: 160, confirmed: 10, refuted: 70, unverified: 80 },
      corrections: { correct: 10, total: 10 },
    });
    expect(report.holes.correct).toBe(report.holes.total);
    expect(report.nesting.map((group) => group.label)).toEqual([
      '1.5 mm',
      '2 mm',
      '3 mm',
      '4 mm',
      '6 mm',
      '8 mm',
      'Thickness not in name',
    ]);
    for (const group of report.nesting) expect(group.placed).toBe(group.pieces);
    expect(report.lines.at(-1)).toBe(
      'Accuracy: names 100%, measurement 100%, grading 100%, corrections 100%.',
    );
  });

  it('does not grade a mismatch or offer a correction when its independent source text is absent or changed', () => {
    const part = evaluationParts().find((item) => item.truth.mismatch)!;
    for (const text of ['', 'Pitch: 999 mm']) {
      const report = evaluateFabrication({
        budget: 1,
        parts: [{ ...part, requirement: { ...part.requirement, text } }],
      });
      expect(report.parsed).toBe(1);
      expect(report.pitch).toEqual({ correct: 1, total: 1 });
      expect(report.grades).toEqual({
        correct: 2,
        total: 4,
        confirmed: 0,
        refuted: 0,
        unverified: 4,
      });
      expect(report.corrections).toEqual({ correct: 0, total: 0 });
    }
  });
});
