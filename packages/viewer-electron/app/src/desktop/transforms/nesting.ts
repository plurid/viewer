/**
 * Writes a saved nesting as a folder: the drawings are read again from the handles the transform
 * service holds, the placements are checked exactly, and then `Sheet 1.dxf` …, `Parts.csv` and
 * `Report.pdf` are written into `output`, which must not exist yet (docs/reference/nesting.md).
 */
import { mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { LayoutTransform } from '../../domain/layout/plan';
import type { NestingTransform } from '../../domain/layout/nesting/plan';
import type { NestingSource } from '../../domain/layout/nesting/output';
import { decodeDXF } from '../../domain/previews/drawings/dxf/decode';
import { DXF_MAX_BYTES } from '../../domain/previews/drawings/dxf/math';
import { unitInfo } from '../../domain/previews/drawings/dxf/units';
import { countText } from '../../domain/layout/nesting/format';

export interface NestingInput {
  file: string;
  handle: FileHandle;
  size: number;
}
/** Draws the report plan as a new PDF at `output`. */
export type DrawReport = (
  plan: LayoutTransform,
  output: string,
  signal: AbortSignal,
) => Promise<void>;

async function readWhole(source: NestingInput): Promise<Uint8Array> {
  if (source.size > DXF_MAX_BYTES)
    throw new Error(`${path.basename(source.file)} is larger than 32 MB.`);
  const bytes = Buffer.alloc(source.size);
  for (let offset = 0; offset < bytes.length;) {
    const { bytesRead } = await source.handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) throw new Error(`${path.basename(source.file)} changed while it was read.`);
    offset += bytesRead;
  }
  return bytes;
}

export async function writeNesting(
  plan: NestingTransform,
  inputs: readonly NestingInput[],
  output: string,
  signal: AbortSignal,
  progress: (fraction: number, detail: string) => void,
  draw: DrawReport,
): Promise<void> {
  if (inputs.length !== plan.sources.length)
    throw new Error('The nesting names a different set of drawings. Nest again.');
  // The DXF reader and the writers load only when a nesting is saved.
  const [{ readCutDrawing }, { extractParts }, { nestingFiles }] = await Promise.all([
    import('../../domain/layout/nesting/drawing'),
    import('../../domain/layout/nesting/parts'),
    import('../../domain/layout/nesting/output'),
  ]);
  const sources: NestingSource[] = [];
  for (const [index, input] of inputs.entries()) {
    signal.throwIfAborted();
    progress((0.3 * index) / inputs.length, `Reading ${path.basename(input.file)}`);
    const options = plan.sources[index]!;
    const file = path.basename(input.file);
    const drawing = readCutDrawing(decodeDXF(await readWhole(input)));
    const parts = extractParts(
      drawing,
      {
        scale: unitInfo(options.units).mm ?? 1,
        marks: new Set(options.marks),
        together: options.together,
      },
      file.replace(/\.dxf$/i, ''),
    );
    if (parts.problem) throw new Error(parts.problem);
    sources.push({ file, parts: parts.parts });
  }
  progress(0.35, 'Checking spacing and margins');
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const written = nestingFiles(plan, sources, date);
  signal.throwIfAborted();
  await mkdir(output);
  for (const [index, entry] of written.files.entries()) {
    signal.throwIfAborted();
    progress(0.4 + (0.3 * index) / written.files.length, `Writing ${entry.name}`);
    const target = await open(path.join(output, entry.name), 'wx', 0o644);
    try {
      await target.writeFile(entry.content, 'utf8');
      await target.sync();
    } finally {
      await target.close();
    }
  }
  progress(0.75, 'Drawing Report.pdf');
  await draw(written.report, path.join(output, 'Report.pdf'), signal);
  const folder = await open(output, 'r');
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
  progress(1, `${countText(plan.sheets.length, 'sheet')}, report and parts list ready`);
}
