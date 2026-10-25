import type { FileEntry } from '../contracts';
import { imageTransformSchema, transformPlanSchema, type TransformPlan } from './transforms';
export type OptimizationPreset = 'lossless' | 'balanced' | 'small';
export function optimizable(file: Pick<FileEntry, 'kind' | 'extension'>): boolean {
  return (
    file.kind === 'file' &&
    ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'avif'].includes(file.extension.toLowerCase())
  );
}
export function optimizationPlan(
  file: Pick<FileEntry, 'kind' | 'extension'>,
  preset: OptimizationPreset,
  maximum?: number,
  pdfImages?: { maximum: number },
): TransformPlan {
  if (!optimizable(file))
    throw new Error('Optimize supports PDFs, JPEGs, PNGs, WebP and AVIF images.');
  if (file.extension.toLowerCase() === 'pdf')
    return transformPlanSchema.parse({
      kind: 'pdf',
      format: 'pdf',
      preset,
      ...(pdfImages && preset !== 'lossless'
        ? { recompressImages: true, maxImageEdge: pdfImages.maximum }
        : {}),
    });
  const format = ['jpg', 'jpeg'].includes(file.extension.toLowerCase())
    ? 'jpeg'
    : file.extension.toLowerCase();
  return imageTransformSchema.parse({
    kind: 'image',
    format,
    optimize: true,
    lossless: preset === 'lossless',
    quality: preset === 'small' ? 65 : 85,
    ...(maximum && preset !== 'lossless' ? { width: maximum, height: maximum } : {}),
  });
}
