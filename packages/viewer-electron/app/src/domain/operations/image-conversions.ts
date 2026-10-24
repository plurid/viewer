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
