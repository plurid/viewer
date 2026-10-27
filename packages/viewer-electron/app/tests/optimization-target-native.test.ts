import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { optimizationPlan } from '../src/domain/operations/optimization';
import { optimizationAttemptLimit } from '../src/domain/operations/optimization-target';
import { imageTransformSchema } from '../src/domain/operations/transforms';
import { Transforms } from '../src/desktop/transforms/transforms';
import { transformImage } from '../src/desktop/transforms/image';
import { runProcessor } from '../src/desktop/transforms/process';
import { temporaryRoot } from '../tools/temporary';
import { workbenchPDF } from './pdf-fixtures';

const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`);
const qpdf = path.resolve(
  'assets',
  `viewer-optimizers-${process.platform}-${process.arch}`,
  'qpdf',
);
const ready = process.platform === 'darwin' && existsSync(qpdf);
interface ImageEncoder {
  jpeg(options: { quality: number }): ImageEncoder;
  toBuffer(): Promise<Buffer>;
}

it.skipIf(!ready)(
  'meets measured image and scan-PDF budgets without rewriting either source',
  async () => {
    const root = await temporaryRoot('viewer-size-targets-');
    const width = 960;
    const height = 720;
    const pixels = Buffer.alloc(width * height * 3);
    for (let index = 0; index < pixels.length; index++)
      pixels[index] = ((index * 17) ^ (index >> 10)) & 255;
    const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp')) as (
      bytes: Buffer,
      options: { raw: { width: number; height: number; channels: number } },
    ) => ImageEncoder;
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 99 })
      .toBuffer();
    const transforms = new Transforms(
      processors,
      async () => {},
      (bytes, plan) => transformImage(processors, bytes, plan),
    );
    try {
      for (const extension of ['jpg', 'pdf']) {
        const original =
          extension === 'jpg'
            ? jpeg
            : workbenchPDF(['Searchable target-size scan'], { bytes: jpeg, width, height });
        const source = path.join(root, 'Original.' + extension);
        await writeFile(source, original, { flag: 'wx' });
        const samples: number[] = [];
        for (const quality of [40, 95]) {
          const base = optimizationPlan(
            { kind: 'file', extension },
            { preset: 'balanced', pdfImages: { maximum: 2400 } },
          );
          if (base.kind !== 'image' && base.kind !== 'pdf')
            throw new Error('Unexpected fixture plan');
          const output = path.join(root, `Quality ${quality}.${extension}`);
          const result = await transforms.execute(
            { ...base, quality },
            [source],
            output,
            new AbortController().signal,
            () => {},
          );
          samples.push(result!.outputBytes);
        }
        const bytes = Math.max(1024, Math.floor((samples[0]! + samples[1]!) / 2));
        const output = path.join(root, 'Target.' + extension);
        const plan = optimizationPlan(
          { kind: 'file', extension },
          {
            preset: 'balanced',
            pdfImages: { maximum: 2400 },
            targetSize: { bytes, minimumQuality: 40 },
          },
        );
        const result = await transforms.execute(
          plan,
          [source],
          output,
          new AbortController().signal,
          () => {},
        );
        expect(result!.outputBytes).toBe((await readFile(output)).length);
        expect(result!.outputBytes).toBeLessThanOrEqual(bytes);
        expect(result!.targetSize?.met).toBe(true);
        expect(result!.targetSize?.attempts).toBeLessThanOrEqual(optimizationAttemptLimit);
        expect(await readFile(source)).toEqual(original);
        if (extension === 'pdf') {
          const expanded = await runProcessor(
            qpdf,
            ['--qdf', '--object-streams=disable', '--stream-data=uncompress', output, '-'],
            [],
            new AbortController().signal,
            { outputLimit: 16 * 1024 * 1024 },
          );
          expect(expanded.toString()).toContain('(Searchable target-size scan)');
          expect(expanded.toString()).toContain('10 10 80 40 re S');
        }
      }
      const original = path.join(root, 'Original.jpg');
      const impossible = await transforms.execute(
        imageTransformSchema.parse({
          kind: 'image',
          format: 'jpeg',
          quality: 95,
          optimize: true,
          targetSize: { bytes: 1024, minimumQuality: 60 },
        }),
        [original],
        path.join(root, 'Unmet.jpg'),
        new AbortController().signal,
        () => {},
      );
      expect(impossible!.targetSize?.met).toBe(false);
      expect(impossible!.targetSize?.quality).toBeGreaterThanOrEqual(60);
      expect(await readFile(original)).toEqual(jpeg);
    } finally {
      await transforms.quiesce();
    }
  },
  60_000,
);
