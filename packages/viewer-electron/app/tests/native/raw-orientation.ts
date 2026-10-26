/** Pixel regression for all eight TIFF orientation values. Every input stays kept. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runProcessor } from '../../src/desktop/transforms/process';
export async function verifyRawOrientation(resources: string, root: string, original: string) {
  const directory = path.join(root, 'orientation');
  await mkdir(directory);
  const require = createRequire(import.meta.url),
    sharp = require(
      path.join(resources, `viewer-processors-darwin-${process.arch}/node_modules/sharp`),
    );
  const bytes = await readFile(original),
    le = bytes.toString('ascii', 0, 2) === 'II';
  const u16 = (o: number) => (le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o)),
    u32 = (o: number) => (le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
  const ifd = u32(4);
  let address: number | undefined;
  for (let i = 0; i < u16(ifd); i++) {
    const at = ifd + 2 + i * 12;
    if (u16(at) === 274) {
      assert.equal(u16(at + 2), 3);
      assert.equal(u32(at + 4), 1);
      address = at + 8;
    }
  }
  assert.ok(address);
  const baselines = new Map<string, Buffer>(),
    results = [];
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const copy = Buffer.from(bytes);
    if (le) copy.writeUInt16LE(orientation, address);
    else copy.writeUInt16BE(orientation, address);
    const file = path.join(directory, `orientation-${orientation}.dng`);
    await writeFile(file, copy, { flag: 'wx' });
    for (const mode of ['camera', 'raw']) {
      const handle = await open(file);
      let output: Buffer;
      try {
        output = await runProcessor(
          path.join(resources, `viewer-raw-v3-darwin-${process.arch}/viewer-raw`),
          [mode],
          [handle.fd],
          new AbortController().signal,
          { timeout: 30000, outputLimit: 32 * 1024 * 1024 + 128 },
        );
      } finally {
        await handle.close();
      }
      const image = output.subarray(output.indexOf(10) + 1);
      await writeFile(file + `.${mode}.jpg`, image, { flag: 'wx' });
      if (orientation === 1) {
        baselines.set(mode, image);
        continue;
      }
      const tagged = await sharp(baselines.get(mode))
        .withMetadata({ orientation })
        .jpeg({ quality: 95 })
        .toBuffer();
      const target: Buffer = await sharp(tagged)
        .autoOrient()
        .resize(120, 80, { fit: 'fill' })
        .raw()
        .toBuffer();
      const actual: Buffer = await sharp(image).resize(120, 80, { fit: 'fill' }).raw().toBuffer();
      assert.equal(actual.length, target.length);
      let difference = 0;
      for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i]! - target[i]!);
      const meanAbsoluteError = difference / actual.length;
      assert.ok(
        meanAbsoluteError < 6,
        `${mode} orientation ${orientation}: pixel error ${meanAbsoluteError}`,
      );
      results.push({ mode, orientation, meanAbsoluteError });
    }
  }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(results, null, 2), {
    flag: 'wx',
  });
  return results;
}
