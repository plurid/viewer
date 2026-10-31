import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { DXFCorrection } from '../src/domain/fabrication/plan';
import { measureDrawing, rowPitches } from '../src/domain/fabrication/measure';
import { correctedName } from '../src/domain/fabrication/plan';
import { parseDrawing } from '../src/domain/previews/drawings/dxf/geometry';
import { Transforms } from '../src/desktop/transforms/transforms';
import { autocadDXF, jobMismatch, jobParts } from '../tools/playground/samples/fabrication';
import { temporaryRoot } from '../tools/temporary';

const plan: DXFCorrection = {
  kind: 'dxf-correction',
  format: 'dxf',
  from: '8',
  to: '9',
  axis: 'x',
  target: jobMismatch.specified,
  measured: jobMismatch.drawn,
  move: ['11'],
};
const transforms = () =>
  new Transforms(
    'unused',
    async () => {},
    async () => Buffer.alloc(0),
    undefined,
    {},
    undefined,
    async () => {},
  );

it('requires a desktop check authority before a correction can execute', async () => {
  const unreviewed = new Transforms(
    'unused',
    async () => {},
    async () => Buffer.alloc(0),
  );
  await expect(unreviewed.validateReview(plan, ['/unreviewed.dxf'])).rejects.toThrow(
    'Save this correction from its reviewed fabrication check.',
  );
});

it('writes the corrected copy beside the original, measures it again and keeps the original', async () => {
  const root = await temporaryRoot('viewer-fabrication-correction-');
  const source = path.join(root, jobMismatch.file);
  const original = autocadDXF(jobParts.find((part) => part.file === jobMismatch.file)!.entities);
  await writeFile(source, original, { flag: 'wx' });
  const before = await readFile(source);
  const output = path.join(root, correctedName(jobMismatch.file));
  const steps: string[] = [];
  const result = await transforms().execute(
    plan,
    [source],
    output,
    new AbortController().signal,
    (_, detail) => steps.push(detail),
  );
  expect(await readFile(source)).toEqual(before);
  expect(result).toMatchObject({
    correction: { axis: 'x', before: 48, after: 50, target: 50, shift: { x: 2, y: 0 } },
  });
  expect(steps.at(-1)).toBe('Pitch 48.00 mm → 50.00 mm, measured again');
  const copy = measureDrawing(parseDrawing(await readFile(output, 'utf8')));
  expect(copy.status).toBe('measured');
  if (copy.status !== 'measured') return;
  expect(
    rowPitches(copy.measurement)
      .filter((pitch) => pitch.axis === 'x')
      .map((pitch) => pitch.value),
  ).toEqual([50, 50]);

  // An existing output is never replaced, and the original stays as it was.
  const kept = await readFile(output);
  await expect(
    transforms().execute(plan, [source], output, new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(output)).toEqual(kept);
  expect(await readFile(source)).toEqual(before);
});

it('refuses a drawing that changed since its pitch was reviewed and writes nothing', async () => {
  const root = await temporaryRoot('viewer-fabrication-changed-');
  const source = path.join(root, jobMismatch.file);
  await writeFile(
    source,
    autocadDXF(jobParts.find((part) => part.file === jobMismatch.file)!.entities),
    { flag: 'wx' },
  );
  const output = path.join(root, correctedName(jobMismatch.file));
  await expect(
    transforms().execute(
      { ...plan, measured: 47.5 },
      [source],
      output,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(
    'g6-PL60-B2-2buc.dxf changed since it was checked: the pitch is now 48.00 mm, not 47.50 mm.',
  );
  await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
});
