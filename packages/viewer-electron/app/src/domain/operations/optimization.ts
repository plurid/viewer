import type { FileEntry } from '../contracts';
import { z } from 'zod';
import { imageTransformSchema, transformPlanSchema, type TransformPlan } from './transforms';
import { optimizationTargetSchema } from './optimization-target';
export const optimizationOptionsSchema = z
  .object({
    preset: z.enum(['lossless', 'balanced', 'small']),
    maximum: z.number().int().min(64).max(32768).optional(),
    pdfImages: z
      .object({ maximum: z.number().int().min(256).max(8192) })
      .strict()
      .optional(),
    targetSize: optimizationTargetSchema.optional(),
  })
  .strict();
export type OptimizationOptions = z.infer<typeof optimizationOptionsSchema>;
export type OptimizationPreset = OptimizationOptions['preset'];
export const optimizationRecipeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    options: optimizationOptionsSchema,
    preserveFolders: z.boolean(),
  })
  .strict();
export type OptimizationRecipe = z.infer<typeof optimizationRecipeSchema>;
/** Optimize budgets use decimal units. Keep byte precision so rounding cannot
 * make a missed target appear smaller than the threshold the person entered. */
export function formatOptimizationSize(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB'] as const;
  const power = Math.min(units.length - 1, Math.floor(Math.log10(Math.max(1, bytes)) / 3));
  return `${(bytes / 1000 ** power).toLocaleString(undefined, { maximumFractionDigits: power * 3 })} ${units[power]}`;
}
export function optimizable(file: Pick<FileEntry, 'kind' | 'extension'>): boolean {
  return (
    file.kind === 'file' &&
    ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'avif'].includes(file.extension.toLowerCase())
  );
}
export function optimizationPlan(
  file: Pick<FileEntry, 'kind' | 'extension'>,
  options: OptimizationOptions,
): TransformPlan {
  const { preset, maximum, pdfImages, targetSize } = optimizationOptionsSchema.parse(options);
  if (!optimizable(file))
    throw new Error('Optimize supports PDFs, JPEGs, PNGs, WebP and AVIF images.');
  if (file.extension.toLowerCase() === 'pdf')
    return transformPlanSchema.parse({
      kind: 'pdf',
      format: 'pdf',
      preset,
      ...(targetSize ? { targetSize, quality: 95 } : {}),
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
    quality: targetSize ? 95 : preset === 'small' ? 65 : 85,
    ...(targetSize ? { targetSize } : {}),
    ...(maximum && preset !== 'lossless' ? { width: maximum, height: maximum } : {}),
  });
}
