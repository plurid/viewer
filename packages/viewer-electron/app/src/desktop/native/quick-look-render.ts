import { nativeImage } from 'electron';
import path from 'node:path';
import { cameraRawFormats } from '../../domain/previews/images/rendered';

/** The longest edge of a rendered preview. */
export const renditionSize = 4096;
let activeRenders = 0;

/**
 * Renders a file through Quick Look, which decodes it in a sandboxed system service; Viewer
 * only receives the resulting bitmap. Opaque renderings are JPEG, others keep alpha as PNG.
 */
export async function quickLookRender(
  file: string,
  size = renditionSize,
  signal?: AbortSignal,
): Promise<{ data: Buffer; extension: 'jpg' | 'png' }> {
  signal?.throwIfAborted();
  if (cameraRawFormats.includes(path.extname(file).slice(1).toLowerCase()))
    throw new Error('Camera RAW previews must use the isolated decoder.');
  if (activeRenders >= 2)
    throw new Error(
      'The macOS image preview service is still busy. Try another preview later or reopen Viewer.',
    );
  activeRenders++;
  let image: Electron.NativeImage;
  try {
    image = await nativeImage.createThumbnailFromPath(file, { width: size, height: size });
  } finally {
    activeRenders--;
  }
  signal?.throwIfAborted();
  if (image.isEmpty()) throw new Error('macOS cannot render a preview of this file.');
  const bitmap = image.toBitmap();
  for (let index = 3; index < bitmap.length; index += 4)
    if (bitmap[index] !== 255) return { data: image.toPNG(), extension: 'png' };
  return { data: image.toJPEG(92), extension: 'jpg' };
}
