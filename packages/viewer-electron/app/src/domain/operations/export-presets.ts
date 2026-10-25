import type { FileEntry } from '../contracts';
import { transformableImage } from './image-conversions';
import { imageTransformSchema, mediaFormats } from './transforms';

export type ImageExportPreset = 'images-for-web' | 'batch-convert';
export type PDFExportPreset = 'pdf-for-email';
export function imagePresetPlan(preset?: ImageExportPreset) {
  return imageTransformSchema.parse({
    kind: 'image',
    format: 'webp',
    ...(preset === 'images-for-web' ? { quality: 80, width: 2048, height: 2048 } : {}),
  });
}
export const pdfEmailPreset = { preset: 'small' as const, recompressImages: true, maximum: 1600 };
export const exportPresetCatalog = [
  {
    id: 'export.images-for-web',
    name: 'Images for web…',
    description: 'WebP · quality 80 · maximum 2048 px · remove GPS',
    kind: 'image',
    preset: 'images-for-web',
    minimum: 1,
  },
  {
    id: 'export.batch-convert',
    name: 'Batch convert images…',
    description: 'Choose format, quality and dimensions for the selection',
    kind: 'image',
    preset: 'batch-convert',
    minimum: 2,
  },
  {
    id: 'export.pdf-for-email',
    name: 'PDF for email…',
    description: 'Smaller copies · compatible JPEG scans up to 1600 px',
    kind: 'pdf',
    preset: 'pdf-for-email',
    minimum: 1,
  },
  {
    id: 'export.extract-audio',
    name: 'Extract audio…',
    description: 'Review an M4A export from your selected audio or video',
    kind: 'media',
    preset: 'extract-audio',
    minimum: 1,
  },
] as const;
export function exportPresetAvailable(
  preset: (typeof exportPresetCatalog)[number],
  files: readonly FileEntry[],
): boolean {
  if (files.length < preset.minimum || files.length > (preset.kind === 'media' ? 16 : 1000))
    return false;
  return files.every(
    (file) =>
      file.kind === 'file' &&
      (preset.kind === 'image'
        ? transformableImage(file)
        : preset.kind === 'pdf'
          ? file.extension.toLowerCase() === 'pdf'
          : (mediaFormats as readonly string[]).includes(file.extension.toLowerCase())),
  );
}
