import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { temporaryRoot } from '../tools/temporary';
import { localSamples } from '../tools/playground/catalog';
import { imageTransformSchema, transformPlanSchema } from '../src/domain/operations/transforms';
import { transformImage } from '../src/desktop/transforms/image';
import { Transforms } from '../src/desktop/transforms/transforms';
import { runProcessor } from '../src/desktop/transforms/process';
const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`),
  optimizer = path.resolve('assets', `viewer-optimizers-${process.platform}-${process.arch}`);
const ready = process.platform === 'darwin' && existsSync(path.join(optimizer, 'manifest.json'));
import { optimizationPDF } from './optimization-fixtures';
it.skipIf(!ready)(
  'compresses PDF structure while retaining text/vector content and rejects signed source rewrites',
  async () => {
    const root = await temporaryRoot('viewer-pdf-optimization-'),
      source = path.join(root, 'Source.pdf'),
      output = path.join(root, 'Smaller.pdf');
    const original = optimizationPDF();
    await writeFile(source, original, { flag: 'wx' });
    const transforms = new Transforms(
      processors,
      async () => {},
      (bytes, plan) => transformImage(processors, bytes, plan),
    );
    const result = await transforms.execute(
      transformPlanSchema.parse({ kind: 'pdf', format: 'pdf', preset: 'lossless' }),
      [source],
      output,
      new AbortController().signal,
      () => {},
    );
    expect(result?.outputBytes).toBeLessThan(original.length / 4);
    const handle = await open(output, 'r');
    try {
      const expanded = await runProcessor(
        path.join(optimizer, 'qpdf'),
        ['--qdf', '--object-streams=disable', '--stream-data=uncompress', '/dev/fd/3', '-'],
        [handle.fd],
        new AbortController().signal,
      );
      expect(expanded.toString()).toContain('Searchable Viewer optimization fixture');
      expect(expanded.toString()).toContain('10 10 80 40 re S');
    } finally {
      await handle.close();
    }
    expect(await readFile(source)).toEqual(original);
    const signed = path.join(root, 'Signed.pdf');
    await writeFile(
      signed,
      Buffer.concat([original, Buffer.from('\n% /ByteRange [0 12 34 56]\n')]),
      { flag: 'wx' },
    );
    await expect(
      transforms.execute(
        transformPlanSchema.parse({ kind: 'pdf', format: 'pdf' }),
        [signed],
        path.join(root, 'Signed optimized.pdf'),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('Signed PDFs');
    await transforms.quiesce();
    console.warn('Retained PDF optimization:', root);
  },
);
it.skipIf(!ready)(
  'losslessly optimizes JPEG coefficients and PNG pixels, preserving color/credit and orientation',
  async () => {
    interface Pipeline {
      jpeg(options?: {
        quality: number;
        progressive?: boolean;
        optimiseCoding?: boolean;
      }): Pipeline;
      png(options?: { compressionLevel: number }): Pipeline;
      raw(): Pipeline;
      withExif(values: Record<string, Record<string, string>>): Pipeline;
      withIccProfile(value: string): Pipeline;
      withMetadata(value: { orientation: number }): Pipeline;
      toBuffer(): Promise<Buffer>;
      metadata(): Promise<{ orientation?: number; exif?: Buffer; icc?: Buffer }>;
    }
    const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp')) as (
      input: Buffer,
    ) => Pipeline;
    const root = await temporaryRoot('viewer-lossless-optimization-'),
      sample = (await localSamples()).find((sample) => sample.formats.includes('png'))!;
    const transforms = new Transforms(
      processors,
      async () => {},
      (bytes, plan) => transformImage(processors, bytes, plan),
    );
    const jpeg = await sharp(Buffer.from(sample.bytes))
      .withExif({ IFD0: { Artist: 'Viewer credit', Orientation: '6' } })
      .withMetadata({ orientation: 6 })
      .withIccProfile('srgb')
      .jpeg({ quality: 95, optimiseCoding: false })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);
    const png = await sharp(Buffer.from(sample.bytes)).png({ compressionLevel: 0 }).toBuffer();
    for (const [format, bytes] of [
      ['jpeg', jpeg],
      ['png', png],
    ] as const) {
      const source = path.join(root, 'Source.' + format),
        output = path.join(root, 'Optimized.' + format);
      await writeFile(source, bytes, { flag: 'wx' });
      const result = await transforms.execute(
        imageTransformSchema.parse({ kind: 'image', format, optimize: true, lossless: true }),
        [source],
        output,
        new AbortController().signal,
        () => {},
      );
      const encoded = await readFile(output);
      expect(await sharp(encoded).raw().toBuffer()).toEqual(await sharp(bytes).raw().toBuffer());
      if (format === 'png') expect(result?.outputBytes).toBeLessThan(bytes.length / 2);
      if (format === 'jpeg') {
        const metadata = await sharp(encoded).metadata();
        expect(metadata.orientation).toBe(6);
        expect(metadata.icc?.length).toBeGreaterThan(0);
        expect(metadata.exif?.toString()).toContain('Viewer credit');
      }
      expect(await readFile(source)).toEqual(bytes);
    }
    await transforms.quiesce();
    console.warn('Retained lossless image optimization:', root);
  },
  30000,
);
