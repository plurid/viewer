/**
 * Writes a reviewed DXF correction: the drawing is read from the handle the transform service holds,
 * corrected and measured in memory, written to `output`, which must not exist yet, then read back
 * and measured again from disk. The source is only read (docs/reference/fabrication.md).
 */
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CorrectionReport, DXFCorrection } from '../../domain/fabrication/plan';
import { savedPitches } from '../../domain/fabrication/plan';
import type { NestingInput } from './nesting';
import { decodeDXF } from '../../domain/previews/drawings/dxf/decode';
import { readWhole } from './nesting';

export async function writeCorrection(
  plan: DXFCorrection,
  input: NestingInput,
  output: string,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
): Promise<{ correction: CorrectionReport }> {
  const name = path.basename(input.file);
  progress(0.1, `Reading ${name}`);
  // The DXF reader and writer load only when a correction is saved.
  const [{ correctDrawing, measureCorrection }, { millimetreText }] = await Promise.all([
    import('../../domain/fabrication/correction'),
    import('../../domain/fabrication/measure'),
  ]);
  const corrected = correctDrawing(decodeDXF(await readWhole(input)), plan, name);
  signal.throwIfAborted();
  progress(0.6, 'Writing the corrected copy');
  const target = await open(output, 'wx', 0o644);
  try {
    await target.writeFile(corrected.text, 'utf8');
    await target.sync();
  } finally {
    await target.close();
  }
  progress(0.8, 'Measuring the corrected copy again');
  const saved = await readFile(output, 'utf8');
  if (saved !== corrected.text) throw new Error('The corrected copy was not saved as written.');
  const again = measureCorrection(saved, corrected.report, corrected.from);
  const also = (corrected.report.also ?? []).map((pitch, index) => ({
    ...pitch,
    after: again.also[index]!,
  }));
  for (const [after, target] of [
    [again.pitch, plan.target],
    ...also.map((pitch) => [pitch.after, pitch.target]),
  ] as const)
    if (Math.abs(after - target) > 1e-5)
      throw new Error(
        `The saved copy measures ${millimetreText(after)}, not ${millimetreText(target)}.`,
      );
  const report = { ...corrected.report, after: again.pitch, ...(also.length ? { also } : {}) };
  progress(1, `${savedPitches(report)}, measured again`);
  return { correction: report };
}
