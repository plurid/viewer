import { app, nativeImage } from 'electron';
import type { AppIconSize } from './app-icons';

/** Small icons come from NSWorkspace, as Finder's list shows them (32 px is the largest it
 * offers on macOS). Large icons use Quick Look's rendering of the bundle, which is its icon
 * at full resolution, and fall back to the small one. */
export async function nativeAppIcon(file: string, size: AppIconSize): Promise<string> {
  if (size === 'large') {
    const image = await nativeImage
      .createThumbnailFromPath(file, { width: 128, height: 128 })
      .catch(() => undefined);
    if (image && !image.isEmpty()) return image.toDataURL();
  }
  return (await app.getFileIcon(file, { size: 'normal' })).toDataURL();
}
