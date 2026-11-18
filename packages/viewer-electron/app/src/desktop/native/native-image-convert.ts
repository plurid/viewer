import { nativeImage, type NativeImage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { imagesToPDF, rotateBitmap, type ImageConverter } from '../operations/image-convert';
import { exifSegment, heicExif, withSegment } from '../operations/photo-metadata';
import { imageCaptureTime, imageCredits } from '../transforms/image';

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

/** The quality a HEIC photo's JPEG copy is encoded at: a HEIC holds about twice what a JPEG does
 * in a byte, so 90 keeps it as it looked. */
const photoQuality = 90;
/**
 * `jpeg`, a copy of the HEIC photo `source`, with what the default policy keeps of its EXIF: who
 * made it and when it was taken. The system decoder hands back pixels only.
 */
async function withPhotoDetails(jpeg: Buffer, source: string): Promise<Buffer> {
  if (!/\.(?:heic|heif)$/i.test(source)) return jpeg;
  const exif = heicExif(await readFile(source));
  const segment = exifSegment({ IFD0: imageCredits(exif), IFD2: imageCaptureTime(exif) });
  return segment ? withSegment(jpeg, segment) : jpeg;
}

/** Quick actions decode with the system image reader in this process, so they work in the
 * App Store sandbox too. Outputs are re-encoded; of a HEIC photo's details a JPEG copy keeps who
 * made it and when it was taken, and nothing else. */
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
      const photo = /\.(?:heic|heif)$/i.test(source);
      if (conversion === 'jpeg')
        data = await withPhotoDetails(image.toJPEG(photo ? photoQuality : 92), source);
      else if (conversion === 'png') data = image.toPNG({ scaleFactor: scale });
      else {
        // a half turn is two quarters, the picture as wide as it was
        const half = conversion === 'rotate-180';
        let pixels = rotateBitmap(
          image.toBitmap({ scaleFactor: scale }),
          width,
          height,
          conversion !== 'rotate-left',
        );
        if (half) pixels = rotateBitmap(pixels, height, width, true);
        const rotated = nativeImage.createFromBitmap(Buffer.from(pixels.buffer), {
          width: half ? width : height,
          height: half ? height : width,
        });
        data = /\.jpe?g$/i.test(output)
          ? await withPhotoDetails(rotated.toJPEG(photo ? photoQuality : 92), source)
          : rotated.toPNG();
      }
    }
    signal.throwIfAborted();
    await writeFile(output, data, { flag: 'wx', mode: 0o644 });
  },
};
