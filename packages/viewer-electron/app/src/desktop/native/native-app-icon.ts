import { app, nativeImage } from 'electron';
import type { AppIconSize } from './app-icons';

/**
 * A bundle's own icon, as Finder shows it, from Quick Look's rendering of the bundle: 64 px for list
 * rows (crisp at 2×) and 256 px for grids and the gallery. The system's file icon, the fallback, gave
 * every application the same blank placeholder (2026-10-23).
 */
export async function nativeAppIcon(file: string, size: AppIconSize): Promise<string> {
  const pixels = size === 'large' ? 256 : 64;
  const image = await nativeImage
    .createThumbnailFromPath(file, { width: pixels, height: pixels })
    .catch(() => undefined);
  if (image && !image.isEmpty()) return image.toDataURL();
  return (await app.getFileIcon(file, { size: 'normal' })).toDataURL();
}
