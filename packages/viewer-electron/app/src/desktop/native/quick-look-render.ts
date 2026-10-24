import { nativeImage } from 'electron';

/** The longest edge of a rendered preview. */
export const renditionSize = 4096;

/**
 * Renders a file through Quick Look, which decodes it in a sandboxed system service; Viewer
 * only receives the resulting bitmap. Opaque renderings are JPEG, others keep alpha as PNG.
 */
export async function quickLookRender(
  file: string,
  size = renditionSize,
): Promise<{ data: Buffer; extension: 'jpg' | 'png' }> {
  const image = await nativeImage.createThumbnailFromPath(file, { width: size, height: size });
  if (image.isEmpty()) throw new Error('macOS cannot render a preview of this file.');
  const bitmap = image.toBitmap();
  for (let index = 3; index < bitmap.length; index += 4)
    if (bitmap[index] !== 255) return { data: image.toPNG(), extension: 'png' };
  return { data: image.toJPEG(92), extension: 'jpg' };
}
