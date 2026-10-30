import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { imageDecoder } from '../src/desktop/native/quick-look-render';
import { imageDimensions } from '../src/desktop/previews/image-dimensions';
import { runProcessor } from '../src/desktop/transforms/process';
import { previewSvg } from '../src/desktop/transforms/image';
import { temporaryRoot } from '../tools/temporary';

const helper = path.resolve('assets/viewer-image-preview');
const processors = path.resolve('assets', `viewer-processors-${process.platform}-${process.arch}`);
const ready = process.platform === 'darwin' && existsSync(helper);
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

it.skipIf(!ready)(
  'renders bounded SVG pixels without resolving external file references',
  async () => {
    const base =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="white"/>';
    const plain = await previewSvg(processors, Buffer.from(base + '</svg>'), 64);
    const referenced = await previewSvg(
      processors,
      Buffer.from(
        base +
          `<image href="file://${path.resolve('tools/playground/assets/study.jpg')}" width="200" height="100"/></svg>`,
      ),
      64,
    );
    expect(referenced).toEqual(plain);
    expect(imageDimensions(plain)).toEqual({ width: 64, height: 32 });
    await expect(previewSvg(processors, Buffer.from(base + '</svg>'), 4097)).rejects.toThrow(
      'size',
    );
    await expect(previewSvg(processors, Buffer.from('<svg'), 64)).rejects.toThrow();
    await expect(previewSvg(processors, Buffer.alloc(8_000_001), 64)).rejects.toThrow('8 MB');
  },
);

it.skipIf(!ready)(
  'renders real image formats through private processes and preserves exact sources',
  async () => {
    const root = await temporaryRoot('viewer-isolated-images-');
    const decode = imageDecoder(helper, path.join(processors, 'ffmpeg'));
    const require = createRequire(import.meta.url);
    const sharp = require(path.join(processors, 'node_modules/sharp')) as (data: Buffer) => {
      stats(): Promise<{ channels: { min: number; max: number }[] }>;
    };
    const results: { extension: string; size: number; bytes: number; hash: string }[] = [];
    for (const extension of [
      'png',
      'jpg',
      'webp',
      'avif',
      'gif',
      'bmp',
      'tiff',
      'heic',
      'psd',
      'jp2',
      'exr',
      'tga',
      'icns',
      'ico',
    ]) {
      const file = path.resolve('tools/playground/assets', `study.${extension}`);
      const before = digest(await readFile(file));
      for (const size of [64, 512]) {
        const handle = await open(file, 'r');
        try {
          const output = await decode(
            { file, handle, info: await handle.stat() },
            'image',
            new AbortController().signal,
            size,
          );
          const dimensions = imageDimensions(output.data)!;
          expect(dimensions.width).toBeGreaterThan(0);
          expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(size);
          const statistics = await sharp(output.data).stats();
          expect(
            statistics.channels.slice(0, 3).some((channel) => channel.max - channel.min > 20),
          ).toBe(true);
          await writeFile(path.join(root, `${extension}-${size}.png`), output.data, { flag: 'wx' });
          results.push({ extension, size, bytes: output.data.length, hash: before });
        } finally {
          await handle.close();
        }
      }
      expect(digest(await readFile(file))).toBe(before);
    }
    for (const size of [64, 256]) {
      const icon = await runProcessor(
        helper,
        ['icon', String(size)],
        [],
        new AbortController().signal,
        {
          timeout: 8000,
          outputLimit: 1_000_000,
          input: Buffer.from(JSON.stringify('/System/Applications/Utilities/Terminal.app')),
        },
      );
      expect(imageDimensions(icon)).toEqual({ width: size, height: size });
      expect(icon.length).toBeGreaterThan(1000);
      await writeFile(path.join(root, `terminal-icon-${size}.png`), icon, { flag: 'wx' });
    }
    await writeFile(path.join(root, 'result.json'), JSON.stringify(results, null, 2), {
      flag: 'wx',
    });
    console.log('Private image pixel evidence retained:', root);
  },
  60000,
);

it.skipIf(!ready)(
  'rejects corrupt images and recovers for the next independent image',
  async () => {
    const root = await temporaryRoot('viewer-isolated-image-recovery-');
    const file = path.join(root, 'damaged.heic');
    const bytes = Buffer.from('This is deliberately invalid image content.');
    await writeFile(file, bytes, { flag: 'wx' });
    const handle = await open(file, 'r');
    const decode = imageDecoder(helper);
    try {
      await expect(
        decode(
          { file, handle, info: await handle.stat() },
          'image',
          new AbortController().signal,
          128,
        ),
      ).rejects.toThrow('could not be decoded');
    } finally {
      await handle.close();
    }
    expect(digest(await readFile(file))).toBe(digest(bytes));
    const goodFile = path.resolve('tools/playground/assets/study.tiff');
    const good = await open(goodFile, 'r');
    try {
      const result = await decode(
        { file: goodFile, handle: good, info: await good.stat() },
        'image',
        new AbortController().signal,
        128,
      );
      expect(result.extension).toBe('png');
    } finally {
      await good.close();
    }
  },
);
