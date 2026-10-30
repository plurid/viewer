/**
 * WHAT A CHECK READS: files only as the version listed, rendered pages checked and bounded, photos
 * re-encoded small and without their metadata, and a request read without its addresses.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RenderedPage } from '../src/domain/fabrication/check';
import { renderedPageSchema } from '../src/domain/fabrication/check';
import { entry } from '../src/desktop/files/filesystem';
import { sourceVersion } from '../src/domain/files/inspection';
import { transformImage } from '../src/desktop/transforms/image';
import {
  pagePicture,
  photoPlan,
  preparePhoto,
  readListed,
  requestInput,
  requestText,
} from '../src/desktop/fabrication/inputs';
import { jobDrawing, jobRequest } from '../tools/playground/samples/fabrication';
import { temporaryRoot } from '../tools/temporary';
import { jpeg } from './fabrication-fixtures';

const version = { identity: '1:2', modified: 1, size: 1 };
const page = (patch: Partial<RenderedPage> = {}): RenderedPage => ({
  ref: 'S2',
  version,
  page: 1,
  pages: 1,
  width: 2048,
  height: 1448,
  image: jpeg(2048, 1448),
  text: [],
  ...patch,
});
const access = async () => {};
const signal = () => new AbortController().signal;

describe('rendered pages', () => {
  it('takes a JPEG or PNG of the size it was drawn at, at most 2048 px', () => {
    expect(pagePicture(page(), 'Drawing.pdf')).toEqual({
      type: 'image/jpeg',
      data: jpeg(2048, 1448),
    });
    expect(() => pagePicture(page({ width: 2000 }), 'Drawing.pdf')).toThrow(
      'Page 1 of Drawing.pdf is not the size it was drawn at.',
    );
    expect(() =>
      pagePicture(page({ image: Uint8Array.from([1, 2, 3, 4]) }), 'Drawing.pdf'),
    ).toThrow('was not drawn as a JPEG or PNG picture');
    expect(() =>
      pagePicture(page({ image: jpeg(4096, 2896), width: 4096, height: 2896 }), 'Drawing.pdf'),
    ).toThrow('larger than 2048 px');
    expect(() => pagePicture(page({ page: 3, pages: 2 }), 'Drawing.pdf')).toThrow(
      'Drawing.pdf has 2 pages, not a page 3.',
    );
  });

  it('bounds a page’s picture and its text before it crosses to the desktop', () => {
    expect(renderedPageSchema.safeParse(page()).success).toBe(true);
    expect(renderedPageSchema.safeParse(page({ image: new Uint8Array(4_000_001) })).success).toBe(
      false,
    );
    expect(renderedPageSchema.safeParse(page({ width: 2049 })).success).toBe(false);
    const runs = Array.from({ length: 3001 }, () => ({
      text: 'Ø10.5',
      box: [0, 0, 0.1, 0.1] as [number, number, number, number],
    }));
    expect(renderedPageSchema.safeParse(page({ text: runs })).success).toBe(false);
    expect(
      renderedPageSchema.safeParse(page({ text: [{ text: 'x', box: [0, 0, 1.5, 1] }] })).success,
    ).toBe(false);
  });
});

describe('listed files', () => {
  it('reads a file only while it is the version listed, and only up to its limit', async () => {
    const root = await temporaryRoot('viewer-fabrication-inputs-');
    const file = path.join(root, 'Drawing.pdf');
    await writeFile(file, jobDrawing());
    const listed = sourceVersion(await entry(file));
    expect((await readListed(file, listed, access)).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(readListed(file, listed, access, 100)).rejects.toThrow(
      'Drawing.pdf is larger than 1 kB.',
    );
    await utimes(file, new Date(), new Date(Date.now() + 60_000));
    await expect(readListed(file, listed, access)).rejects.toThrow(
      'Drawing.pdf changed since the check listed it. Check the job again.',
    );
  });

  it('reads a request’s subject, text and attachments, and leaves its addresses out', () => {
    const request = requestInput(
      'S1',
      'Job 1042 request.eml',
      new TextEncoder().encode(jobRequest(jobDrawing())),
    );
    expect(request).toMatchObject({
      ref: 'S1',
      subject: 'Job 1042: laser cut parts, S235JR',
      attachments: ['Job 1042 drawing.pdf'],
    });
    expect(request.text).toContain('- PL60-B2 base plate, 6 mm, 2 pieces');
    expect(JSON.stringify(request)).not.toContain('example.invalid');
    expect(requestText(request).startsWith('Job 1042: laser cut parts, S235JR\nHello,')).toBe(true);
  });
});

describe('photos', () => {
  it('falls back to the preview helper’s rendition for a photo the encoder cannot read', async () => {
    const encoded = jpeg(1600, 1200);
    const asked: string[] = [];
    const photo = await preparePhoto(
      '/jobs/IMG_0001.HEIC',
      Buffer.from('heic'),
      async (bytes) => {
        if (bytes.toString() === 'heic') throw new Error('Unsupported image.');
        return Buffer.from(encoded);
      },
      async (file) => {
        asked.push(file);
        return Buffer.from('rendition');
      },
      signal(),
    );
    expect(asked).toEqual(['/jobs/IMG_0001.HEIC']);
    expect(photo).toEqual({
      image: { type: 'image/jpeg', data: Buffer.from(encoded) },
      width: 1600,
      height: 1200,
    });
    await expect(
      preparePhoto(
        '/jobs/Big.jpg',
        Buffer.alloc(1),
        async () => Buffer.from(jpeg(3000, 2000)),
        undefined,
        signal(),
      ),
    ).rejects.toThrow('Big.jpg was not made small enough to send.');
  });

  const processors = path.resolve(
    'assets',
    `viewer-processors-${process.platform}-${process.arch}`,
  );
  it.skipIf(!existsSync(path.join(processors, 'node_modules/sharp')))(
    're-encodes a photo upright, at most 1600 px, without its camera or location details',
    async () => {
      interface Pipeline {
        withExif(values: Record<string, Record<string, string>>): Pipeline;
        withMetadata(value: { orientation: number }): Pipeline;
        jpeg(options: { quality: number }): Pipeline;
        toBuffer(): Promise<Buffer>;
        metadata(): Promise<{
          width?: number;
          height?: number;
          exif?: Buffer;
          xmp?: Buffer;
          orientation?: number;
        }>;
      }
      const sharp = createRequire(import.meta.url)(path.join(processors, 'node_modules/sharp')) as (
        input:
          Buffer | { create: { width: number; height: number; channels: 3; background: string } },
      ) => Pipeline;
      const camera = await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: '#c03030' },
      })
        .withExif({ IFD0: { Artist: 'A private name', Make: 'Phone', Model: 'Camera 1' } })
        .withMetadata({ orientation: 6 })
        .jpeg({ quality: 90 })
        .toBuffer();
      expect((await sharp(camera).metadata()).exif).toBeDefined();
      const photo = await preparePhoto(
        '/jobs/Plate.jpg',
        camera,
        (bytes) => transformImage(processors, bytes, photoPlan),
        undefined,
        signal(),
      );
      // turned upright as the camera held it, then made 1600 px on its longer side
      expect([photo.width, photo.height]).toEqual([1067, 1600]);
      const sent = await sharp(Buffer.from(photo.image.data)).metadata();
      expect(sent).toMatchObject({ width: 1067, height: 1600 });
      expect(sent.exif).toBeUndefined();
      expect(sent.xmp).toBeUndefined();
      expect(sent.orientation).toBeUndefined();
    },
  );
});
