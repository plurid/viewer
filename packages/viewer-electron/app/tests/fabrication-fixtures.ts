/** Fixtures the fabrication check's tests share: Job 1042 on disk, its drawing page as the
 * renderer sends it, a Meta provider and the answer a model gives. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { CheckOpening, RenderedPage } from '../src/domain/fabrication/check';
import type { FabricationAnswer, InventoryItem } from '../src/domain/fabrication/answer';
import type { ModelDataLevel } from '../src/domain/models/permissions';
import type { ModelProvider } from '../src/domain/services';
import { modelEndpoint } from '../src/domain/models/permissions';
import { fabricationSamples, jobMismatch, jobParts } from '../tools/playground/samples/fabrication';

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
const pdfRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/** A JPEG as small as `imageDimensions` reads: a start, a frame header, padding and an end. */
export function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    ...new Array<number>(8).fill(0),
    0xff,
    0xd9,
  ]);
}
/**
 * A real SAM 3.1 reply, from the Meta Model API, for a 64 × 64 PNG: a red square from (16, 16) to
 * (47, 47) on white. Its 32 × 32 mask lies over the box it found, every cell set.
 */
export const samReply =
  '<0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64;c=0.8904109597206116|><|mask;x=0;y=0;c=0.8904109597206116;data=32,32,!!!!!(y:SRo?iX|>';

export const meta: ModelProvider = {
  id: 'meta',
  name: 'Meta',
  kind: 'meta',
  endpoint: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  allowContent: false,
};
export const allowed = (level: ModelDataLevel) => ({
  providerID: meta.id,
  kind: meta.kind,
  endpoint: modelEndpoint(meta),
  level,
});

/** Job 1042 as the playground writes it, a photo and a file the check leaves out, in `folder`. */
export async function writeJob(folder: string): Promise<void> {
  await mkdir(folder);
  for (const sample of fabricationSamples().filter((item) =>
    item.path.startsWith('fabrication/Job 1042/'),
  ))
    await writeFile(path.join(folder, path.basename(sample.path)), sample.bytes);
  await writeFile(path.join(folder, 'Plate.jpg'), jpeg(4032, 3024));
  await writeFile(path.join(folder, 'Notes.json'), '{}');
}
export async function drawingPage(opening: CheckOpening): Promise<RenderedPage> {
  const source = opening.sources.find((item) => item.kind === 'drawing')!;
  const task = getDocument({
    data: new Uint8Array(await readFile(source.path)),
    standardFontDataUrl: pdfRoot + '/standard_fonts/',
  });
  const document = await task.promise;
  const items = (await (await document.getPage(1)).getTextContent()).items;
  await task.destroy();
  return {
    ref: source.ref,
    version: source.version,
    page: 1,
    pages: 1,
    width: 2048,
    height: 1448,
    image: jpeg(2048, 1448),
    text: items.flatMap((item) =>
      'str' in item && item.str.trim()
        ? [{ text: item.str, box: [0.1, 0.1, 0.9, 0.12] as [number, number, number, number] }]
        : [],
    ),
  };
}
/** A job's files by ref and name: a check's opening, or the inventory a model reads. */
export interface NamedSources {
  sources: readonly Pick<InventoryItem, 'ref' | 'name'>[];
}
export const refOf = (opening: NamedSources, name: string) =>
  opening.sources.find((source) => source.name === name)!.ref;

/** The answer for Job 1042; its tour shows Plate.jpg when the job has it. */
export function jobAnswer(opening: NamedSources): FabricationAnswer {
  const request = refOf(opening, 'Job 1042 request.eml');
  const drawing = refOf(opening, 'Job 1042 drawing.pdf');
  const plate = refOf(opening, jobMismatch.file);
  const photo = opening.sources.find((source) => source.name === 'Plate.jpg');
  return {
    summary:
      'The base plate’s DXF puts its right holes 48 mm from the left ones; the drawing gives 50 mm.',
    request: jobParts.map((part) => ({
      ref: request,
      part: `${part.part} ${part.title.toLowerCase()}`,
      dxf: refOf(opening, part.file),
      quantity: part.quantity,
      thickness: part.thickness,
      material: 'S235JR',
      quote: `${part.part} ${part.title.toLowerCase()}, ${part.thickness} mm, ${part.quantity} pieces`,
      drawing: null,
    })),
    findings: [
      {
        id: 'F1',
        kind: 'pitch',
        summary: 'The bottom holes are 48 mm apart in the DXF; the drawing gives 50 mm.',
        drawing: {
          ref: drawing,
          page: 1,
          value: 50,
          quote: 'Holes 4× Ø10.5 at 50 mm pitch',
          box: [0.08, 0.86, 0.6, 0.9],
          // the hole that moves, Ø10.5 at (105, 25) mm on the drawing: jobDrawing sets the part at
          // 1:1 from (60, 200) pt on its 842 × 595 pt page, so 342.8 to 372.5 pt across and 255.98
          // to 285.75 pt up, rounded outward
          feature: [0.407, 0.519, 0.443, 0.57],
        },
        dxf: { ref: plate, value: 48, axis: 'x', entities: ['8', '9'] },
        photo: null,
        proposal: { target: 50, move: ['9', '11'] },
      },
    ],
    tour: [
      {
        ref: request,
        caption: 'The request asks for two base plates.',
        note: null,
        finding: null,
        page: null,
        box: null,
        entities: [],
      },
      {
        ref: drawing,
        caption: 'The drawing gives 50 mm between the holes.',
        note: null,
        finding: 'F1',
        page: 1,
        box: [0.08, 0.86, 0.6, 0.9],
        entities: [],
      },
      {
        ref: plate,
        caption: 'The DXF puts them 48 mm apart.',
        note: null,
        finding: 'F1',
        page: null,
        box: null,
        entities: ['8', '9'],
      },
      ...(photo
        ? [
            {
              ref: photo.ref,
              caption: 'The sample plate.',
              note: null,
              finding: null,
              page: null,
              box: [0.2, 0.2, 0.8, 0.8],
              entities: [],
            },
          ]
        : []),
    ],
  };
}
