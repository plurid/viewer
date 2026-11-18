import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { temporaryRoot } from '../tools/temporary';
import { localSamples } from '../tools/playground/catalog';
import { Transforms } from '../src/desktop/transforms/transforms';
import {
  imageCaptureTime,
  imageCredits,
  jpegQuality,
  transformImage,
} from '../src/desktop/transforms/image';
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
it.skipIf(!ready)(
  'turns a rotated copy, keeping when the photo was taken and dropping where',
  async () => {
    interface Pipeline {
      withExif(value: Record<string, Record<string, string>>): Pipeline;
      jpeg(): Pipeline;
      toBuffer(): Promise<Buffer>;
      metadata(): Promise<{ width: number; height: number; exif?: Buffer }>;
    }
    const require = createRequire(import.meta.url);
    const sharp = require(path.join(processors, 'node_modules/sharp')) as (
      input: Buffer,
    ) => Pipeline;
    const sample = (await localSamples()).find((sample) => sample.formats.includes('png'))!;
    const taken = {
      DateTimeOriginal: '2024:05:06 07:08:09',
      OffsetTimeOriginal: '+02:00',
      SubSecTimeOriginal: '42',
    };
    const source = await sharp(Buffer.from(sample.bytes))
      .withExif({
        IFD0: { Artist: 'Viewer fixture', Make: 'Fixture camera' },
        IFD2: { ...taken, BodySerialNumber: 'SN-0001' },
        IFD3: { GPSLatitudeRef: 'N' },
      })
      .jpeg()
      .toBuffer();
    const before = await sharp(source).metadata();
    expect(imageCaptureTime(before.exif)).toEqual(taken);
    // what Save Rotated Copy and the Rotated Copy quick actions ask for
    const data = await transformImage(
      processors,
      source,
      imageTransformSchema.parse({
        kind: 'image',
        format: 'jpeg',
        rotate: 90,
        quality: 92,
        metadata: 'safe',
      }),
    );
    const root = await temporaryRoot('viewer-image-rotated-');
    await writeFile(path.join(root, 'rotated.jpg'), data, { flag: 'wx' });
    const after = await sharp(data).metadata();
    expect([after.width, after.height]).toEqual([before.height, before.width]);
    expect(imageCaptureTime(after.exif)).toEqual(taken);
    expect(imageCredits(after.exif).Artist).toBe('Viewer fixture');
    const text = after.exif?.toString('latin1') ?? '';
    for (const dropped of ['SN-0001', 'Fixture camera']) expect(text).not.toContain(dropped);
    console.warn('Retained a rotated copy:', root);
  },
  30000,
);
/** A photo-like scene: a sky's gradient, hills with fine texture and a sun's hard edge, under a
 * sensor's noise, as JPEG's tables are made for. */
function scene(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 11;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000 - 0.5;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sky = 180 - (y / height) * 90;
      const hill = y > height * 0.55 + Math.sin(x / 90) * 40;
      const sun = (x - width * 0.7) ** 2 + (y - height * 0.25) ** 2 < (height * 0.08) ** 2;
      const texture = hill ? Math.sin(x / 3.1) * Math.cos(y / 2.7) * 18 : 0;
      const color = sun
        ? [250, 235, 180]
        : hill
          ? [60 + texture, 110 + texture, 50]
          : [sky * 0.6, sky * 0.8, sky + 40];
      const grain = noise() * 10;
      pixels.set(
        color.map((value) => Math.max(0, Math.min(255, Math.round(value + grain)))),
        (y * width + x) * 3,
      );
    }
  return pixels;
}
/** How close two images are, in decibels: above 40 no eye tells them apart. */
function psnr(a: Buffer, b: Buffer): number {
  let error = 0;
  for (let index = 0; index < a.length; index++) error += (a[index]! - b[index]!) ** 2;
  return 10 * Math.log10(255 ** 2 / (error / a.length));
}
it.skipIf(!ready)(
  'turns a JPEG at the quality it was saved at: about its size, and never visibly worse',
  async () => {
    interface Pipeline {
      jpeg(options: { quality: number; chromaSubsampling?: string }): Pipeline;
      rotate(degrees: number): Pipeline;
      raw(): Pipeline;
      toBuffer(): Promise<Buffer>;
      metadata(): Promise<{ chromaSubsampling?: string }>;
    }
    const require = createRequire(import.meta.url);
    const sharp = require(path.join(processors, 'node_modules/sharp')) as (
      input: Buffer,
      options?: { raw: { width: number; height: number; channels: 3 } },
    ) => Pipeline;
    const width = 1200;
    const height = 900;
    const pixels = scene(width, height);
    // what Save Rotated Copy and the Rotated Copy quick actions ask for (bridge.ts)
    const plan = imageTransformSchema.parse({
      kind: 'image',
      format: 'jpeg',
      rotate: 90,
      quality: 92,
      keepQuality: true,
    });
    for (const [quality, subsampling] of [
      [70, '4:2:0'],
      [85, '4:2:0'],
      [92, '4:4:4'],
    ] as const) {
      const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
        .jpeg({ quality, chromaSubsampling: subsampling })
        .toBuffer();
      expect(jpegQuality(source)).toBe(quality);
      const copy = await transformImage(processors, source, plan);
      expect(Math.abs(copy.length / source.length - 1)).toBeLessThan(0.1);
      expect((await sharp(copy).metadata()).chromaSubsampling).toBe(subsampling);
      const turned = await sharp(source).rotate(90).raw().toBuffer();
      expect(psnr(await sharp(copy).raw().toBuffer(), turned)).toBeGreaterThan(40);
    }
  },
  60000,
);
it.skipIf(!ready)('turns a GIF of one frame, and refuses an animated one, saying why', async () => {
  interface Pipeline {
    png(): Pipeline;
    gif(): Pipeline;
    toBuffer(): Promise<Buffer>;
  }
  const require = createRequire(import.meta.url);
  const sharp = require(path.join(processors, 'node_modules/sharp')) as (
    input: unknown,
    options?: unknown,
  ) => Pipeline;
  const frame = (red: number) =>
    sharp({ create: { width: 8, height: 4, channels: 3, background: { r: red, g: 0, b: 0 } } })
      .png()
      .toBuffer();
  const plan = imageTransformSchema.parse({ kind: 'image', format: 'png', rotate: 90 });
  const still = await sharp(await frame(10))
    .gif()
    .toBuffer();
  expect((await transformImage(processors, still, plan)).subarray(1, 4).toString()).toBe('PNG');
  const animated = await sharp([await frame(10), await frame(200)], { join: { animated: true } })
    .gif()
    .toBuffer();
  await expect(transformImage(processors, animated, plan)).rejects.toThrow(
    'Animated or multipage images require an animation-aware export.',
  );
});
