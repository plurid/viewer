import { nativeImage, type NativeImage } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { imagesToPDF, rotateBitmap, type ImageConverter } from '../operations/image-convert';

const maximumPixels = 100_000_000;

function decode(file: string): {
  image: NativeImage;
  width: number;
  height: number;
  scale: number;
} {
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error(`${path.basename(file)} is not an image this Mac can read.`);
  const scale = image.getScaleFactors()[0] ?? 1;
  const { width, height } = image.getSize(scale);
  if (width * height > maximumPixels)
    throw new Error(`${path.basename(file)} is larger than 100 megapixels.`);
  return { image, width, height, scale };
}

/** Quick actions decode with the system image reader in this process, so they work in the
 * App Store sandbox too. Outputs are re-encoded; image metadata is not copied. */
export const nativeImageConverter: ImageConverter = {
  async convert(conversion, sources, output, signal) {
    signal.throwIfAborted();
    let data: Buffer;
    if (conversion === 'pdf') {
      const pages: { jpeg: Uint8Array; width: number; height: number }[] = [];
      for (const file of sources) {
        signal.throwIfAborted();
        const { image, width, height } = decode(file);
        pages.push({ jpeg: image.toJPEG(92), width, height });
      }
      data = imagesToPDF(pages);
    } else {
      const [source] = sources;
      if (!source) throw new Error('Choose an image.');
      const { image, width, height, scale } = decode(source);
      if (conversion === 'jpeg') data = image.toJPEG(92);
      else if (conversion === 'png') data = image.toPNG({ scaleFactor: scale });
      else {
        const pixels = rotateBitmap(
          image.toBitmap({ scaleFactor: scale }),
          width,
          height,
          conversion === 'rotate-right',
        );
        const rotated = nativeImage.createFromBitmap(Buffer.from(pixels.buffer), {
          width: height,
          height: width,
        });
        data = /\.jpe?g$/i.test(output) ? rotated.toJPEG(92) : rotated.toPNG();
      }
    }
    signal.throwIfAborted();
    await writeFile(output, data, { flag: 'wx', mode: 0o644 });
  },
};
