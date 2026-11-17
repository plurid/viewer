import type { ImageConversion } from '../contracts';

/** Formats the system image decoder reads on macOS, which quick actions accept. */
export const convertibleExtensions: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'tif',
  'tiff',
  'heic',
  'heif',
  'gif',
  'bmp',
  'webp',
]);
export const convertibleImage = (entry: { directory: boolean; extension: string }) =>
  !entry.directory && convertibleExtensions.has(entry.extension.toLowerCase());
/** The extensions of the formats quick actions convert to. */
const conversionFormats: Partial<Record<ImageConversion, readonly string[]>> = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
};
/** Whether `entry` is already in the format `conversion` makes. */
export const inConversionFormat = (entry: { extension: string }, conversion: ImageConversion) =>
  !!conversionFormats[conversion]?.includes(entry.extension.toLowerCase());
/** How far each rotated copy turns, clockwise in degrees. */
export const conversionTurns: Partial<Record<ImageConversion, 90 | 180 | 270>> = {
  'rotate-right': 90,
  'rotate-180': 180,
  'rotate-left': 270,
};
/** The rotated copy that turns a picture `turn` degrees clockwise. */
export function turnConversion(turn: 90 | 180 | 270): ImageConversion {
  return turn === 90 ? 'rotate-right' : turn === 180 ? 'rotate-180' : 'rotate-left';
}
/**
 * Pictures a rotated copy is made from: what the system decoder reads, but not GIF or TIFF, which
 * can hold several frames or pages that a rotated copy would drop.
 */
export const rotatableImage = (entry: { directory: boolean; extension: string }) =>
  convertibleImage(entry) && !['gif', 'tif', 'tiff'].includes(entry.extension.toLowerCase());
/** Explicit raster inputs accepted by the bundled image tools. */
export const transformableImage = (entry: { directory: boolean; extension: string }) =>
  !entry.directory &&
  ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'gif', 'webp', 'avif'].includes(
    entry.extension.toLowerCase(),
  );
