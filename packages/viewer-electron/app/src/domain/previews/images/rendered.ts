/** Formats Chromium cannot decode that macOS Quick Look renders: previews show its
 * rendering, decoded in the system's sandboxed service rather than in Viewer. */
export const renderedImageFormats = [
  'tif',
  'tiff',
  'heic',
  'heif',
  'psd',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'raf',
  'orf',
  'rw2',
  'jp2',
  'exr',
  'tga',
  'icns',
] as const;
