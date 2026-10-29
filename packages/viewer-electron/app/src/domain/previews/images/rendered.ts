/** Camera formats use a bounded independent helper, not the system thumbnail service. */
export const cameraRawFormats: readonly string[] = [
  'dng',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'raf',
  'orf',
  'rw2',
];
export interface ImageRenditionRequest {
  requestID: string;
  mode: 'camera' | 'raw';
}
/** Formats Chromium cannot decode, rendered outside the renderer. */
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
  // ImageIO also reads these, which Chromium does not; JPEG XL, DDS and cursors failed its check
  'pbm',
  'pgm',
  'ppm',
  'pnm',
  'ktx',
  'astc',
  // gzip around SVG, expanded before the private SVG decoder
  'svgz',
] as const;
