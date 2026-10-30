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
/** Explicit raster inputs accepted by the bundled image tools. */
export const transformableImage = (entry: { directory: boolean; extension: string }) =>
  !entry.directory &&
  ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'gif', 'webp', 'avif'].includes(
    entry.extension.toLowerCase(),
  );
