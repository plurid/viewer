/**
 * Writes a job's handoff folder into `output`, which must not exist yet: each evidence file copied
 * from the handle the transform service holds, its date kept so the tour finds it unchanged; the
 * check's tour pointed at those copies; the check record; and each nesting under `Cut sheets/`
 * through the nesting writer the Layout plane saves with (docs/reference/fabrication.md).
 */
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { HandoffTransform } from '../../domain/fabrication/handoff';
import type { TourDefinition } from '../../domain/tours/tour';
import type { DrawReport, NestingInput } from '../transforms/nesting';
import { evidenceNames, handoffNames, handoffTour } from '../../domain/fabrication/handoff';
import { countText } from '../../domain/layout/nesting/format';
import { validName } from '../files/filesystem';
import { writeNesting } from '../transforms/nesting';
import { tourText } from '../workspaces/tours';

export interface HandoffInput extends NestingInput {
  modified: number;
}
/** What an open check gives its handoff: its tour, in the job's folder, and its record as text. */
export interface HandoffCheck {
  tour?: { root: string; definition: TourDefinition };
  record: string;
}
export type HandoffChecks = (check: string) => HandoffCheck | undefined;

const copyChunk = 1024 * 1024;

async function copyInput(input: HandoffInput, target: string, signal: AbortSignal) {
  const output = await open(target, 'wx', 0o644);
  try {
    const buffer = Buffer.alloc(Math.min(copyChunk, Math.max(1, input.size)));
    for (let offset = 0; offset < input.size;) {
      signal.throwIfAborted();
      const { bytesRead } = await input.handle.read(
        buffer,
        0,
        Math.min(buffer.length, input.size - offset),
        offset,
      );
      if (!bytesRead) throw new Error(`${path.basename(input.file)} changed while it was copied.`);
      await output.write(buffer, 0, bytesRead);
      offset += bytesRead;
    }
    // A tour stop knows its file by size and date; the copy keeps both.
    await output.utimes(new Date(), new Date(input.modified));
    await output.sync();
  } finally {
    await output.close();
  }
}
async function writeText(file: string, text: string) {
  const output = await open(file, 'wx', 0o644);
  try {
    await output.writeFile(text, 'utf8');
    await output.sync();
  } finally {
    await output.close();
  }
}
async function syncFolder(folder: string) {
  const handle = await open(folder, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * `inputs` are the opened sources and `requested` the paths the operation named for them, in the
 * same order: the check's tour names its files by those paths, before links are resolved.
 */
export async function writeHandoff(
  plan: HandoffTransform,
  inputs: readonly HandoffInput[],
  requested: readonly string[],
  output: string,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
  checks: HandoffChecks | undefined,
  draw: DrawReport,
): Promise<void> {
  const check = checks?.(plan.check);
  if (!check)
    throw new Error('This check is no longer open. Check the job again, then export its handoff.');
  await mkdir(output);
  const evidence = path.join(output, handoffNames.evidence);
  await mkdir(evidence);
  const names = evidenceNames(plan.evidence.map((index) => path.basename(requested[index]!)));
  const copies = new Map<string, string>();
  for (const [order, index] of plan.evidence.entries()) {
    progress((0.4 * order) / plan.evidence.length, `Copying ${names[order]}`);
    await copyInput(inputs[index]!, path.join(evidence, names[order]!), signal);
    copies.set(requested[index]!, names[order]!);
  }
  await syncFolder(evidence);
  signal.throwIfAborted();
  if (check.tour) {
    const { definition } = handoffTour(check.tour.definition, check.tour.root, copies);
    if (definition) await writeText(path.join(output, handoffNames.tour), tourText(definition));
  }
  await writeText(path.join(output, handoffNames.record), check.record);
  if (plan.nestings.length) {
    const sheets = path.join(output, handoffNames.sheets);
    await mkdir(sheets);
    for (const [order, nesting] of plan.nestings.entries())
      await writeNesting(
        nesting.plan,
        nesting.sources.map((index) => inputs[index]!),
        path.join(sheets, validName(nesting.plan.title)),
        signal,
        (fraction, detail) =>
          progress(0.45 + (0.5 * (order + fraction)) / plan.nestings.length, detail),
        draw,
      );
    await syncFolder(sheets);
  }
  await syncFolder(output);
  progress(
    1,
    `${countText(plan.evidence.length, 'file')}${plan.nestings.length ? `, ${countText(plan.nestings.length, 'nesting')}` : ''}, the tour and the check record ready`,
  );
}
