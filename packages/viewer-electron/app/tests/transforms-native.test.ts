import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { localSamples } from '../tools/playground/catalog';
import { Transforms } from '../src/desktop/transforms/transforms';
import { transformImage, imageCredits } from '../src/desktop/transforms/image';
import { imageTransformSchema, mediaTransformSchema } from '../src/domain/operations/transforms';
const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`);
const ready = process.platform === 'darwin' && existsSync(path.join(processors, 'manifest.json'));
const hash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
it.skipIf(!ready)(
  'cuts, joins, mixes, extracts and probes real output while preserving source bytes',
  async () => {
    const root = await temporaryRoot('viewer-transform-native-');
    const samples = await localSamples();
    const video = path.join(root, 'source.mp4'),
      audio = path.join(root, 'source.wav');
    await writeFile(video, samples.find((sample) => sample.formats.includes('mp4'))!.bytes, {
      flag: 'wx',
    });
    await writeFile(audio, samples.find((sample) => sample.formats.includes('wav'))!.bytes, {
      flag: 'wx',
    });
    const before = [await hash(video), await hash(audio)];
    const transforms = new Transforms(
      processors,
      async () => {},
      (bytes, plan) => transformImage(processors, bytes, plan),
    );
    const info = await transforms.probe(video);
    expect(info.video).toBe(true);
    const joined = path.join(root, 'joined.mp4');
    await transforms.execute(
      mediaTransformSchema.parse({
        kind: 'media',
        format: 'mp4',
        segments: [
          { source: 0, start: 0.1, end: 0.5 },
          { source: 0, start: 1, end: 1.4 },
        ],
        audio: { mode: 'mute' },
      }),
      [video],
      joined,
      new AbortController().signal,
      () => {},
    );
    const joinedInfo = await transforms.probe(joined);
    expect(Math.abs(joinedInfo.duration - 0.8)).toBeLessThan(0.1);
    expect(joinedInfo.audio).toBe(false);
    const mixed = path.join(root, 'mixed.mp4');
    await transforms.execute(
      mediaTransformSchema.parse({
        kind: 'media',
        format: 'mp4',
        segments: [{ source: 0, start: 0, end: 1 }],
        audio: { mode: 'mix', source: 1, gain: 0.5, offset: 0.1 },
      }),
      [video, audio],
      mixed,
      new AbortController().signal,
      () => {},
    );
    expect((await transforms.probe(mixed)).audio).toBe(true);
    expect(
      (await transforms.frame(video, 0.5, new AbortController().signal))
        .subarray(0, 4)
        .toString('hex'),
    ).toBe('89504e47');
    const waveform = await transforms.waveform(
      audio,
      (await transforms.probe(audio)).duration,
      new AbortController().signal,
    );
    expect(waveform.length).toBeGreaterThan(0);
    expect(waveform.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect([await hash(video), await hash(audio)]).toEqual(before);
    await transforms.quiesce();
    console.warn('Retained real transform outputs:', root);
  },
  60000,
);
it.skipIf(!ready)(
  'encodes WebP/AVIF, resizes, normalizes orientation and keeps descriptive EXIF',
  async () => {
    interface Pipeline {
      withExif(value: Record<string, Record<string, string>>): Pipeline;
      withIccProfile(value: string): Pipeline;
      withMetadata(value: { orientation: number }): Pipeline;
      jpeg(): Pipeline;
      toBuffer(): Promise<Buffer>;
      metadata(): Promise<{
        width: number;
        height: number;
        exif: Buffer;
        icc?: Buffer;
        orientation?: number;
      }>;
    }
    const require = createRequire(import.meta.url);
    const sharp = require(path.join(processors, 'node_modules/sharp')) as (
      input: Buffer,
    ) => Pipeline;
    const sample = (await localSamples()).find((sample) => sample.formats.includes('png'))!;
    const source = await sharp(Buffer.from(sample.bytes))
      .withExif({
        IFD0: { Artist: 'Viewer fixture', Copyright: 'Generated CC0', Orientation: '6' },
      })
      .withMetadata({ orientation: 6 })
      .withIccProfile('srgb')
      .jpeg()
      .toBuffer();
    const root = await temporaryRoot('viewer-image-native-');
    for (const format of ['webp', 'avif'] as const) {
      const data = await transformImage(
        processors,
        source,
        imageTransformSchema.parse({ kind: 'image', format, width: 48, metadata: 'safe' }),
      );
      await writeFile(path.join(root, `result.${format}`), data, { flag: 'wx' });
      const metadata = await sharp(data).metadata();
      expect(metadata.width).toBeLessThanOrEqual(48);
      expect(metadata.orientation === undefined || metadata.orientation === 1).toBe(true);
      expect(imageCredits(metadata.exif).Artist).toBe('Viewer fixture');
      expect(metadata.icc?.length).toBeGreaterThan(0);
    }
    console.warn('Retained converted images:', root);
  },
  30000,
);
