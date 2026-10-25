import { z } from 'zod';
const seconds = z.number().finite().min(0).max(86400);
const source = z.number().int().min(0).max(15);
const dimension = z.number().int().min(1).max(32768);
export const imageTransformSchema = z
  .object({
    kind: z.literal('image'),
    format: z.enum(['jpeg', 'png', 'webp', 'avif']),
    quality: z.number().int().min(1).max(100).default(85),
    optimize: z.boolean().default(false),
    lossless: z.boolean().default(false),
    width: dimension.optional(),
    height: dimension.optional(),
    fit: z.enum(['inside', 'cover', 'fill']).default('inside'),
    crop: z
      .object({
        x: z.number().int().min(0).max(32768),
        y: z.number().int().min(0).max(32768),
        width: dimension,
        height: dimension,
      })
      .strict()
      .optional(),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    metadata: z.enum(['safe', 'strip', 'all']).default('safe'),
    background: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#ffffff'),
  })
  .strict();
export const mediaTransformSchema = z
  .object({
    kind: z.literal('media'),
    format: z.enum(['mp4', 'mov', 'm4a', 'wav', 'flac', 'png', 'jpeg']),
    segments: z
      .array(
        z
          .object({ source, start: seconds, end: seconds })
          .strict()
          .refine((segment) => segment.end > segment.start, 'A segment must end after it starts.'),
      )
      .min(1)
      .max(32),
    cut: z.enum(['exact', 'keyframe']).default('exact'),
    quality: z.enum(['small', 'balanced', 'high']).default('balanced'),
    audio: z
      .object({
        mode: z.enum(['keep', 'mute', 'replace', 'mix']).default('keep'),
        source: source.optional(),
        offset: z.number().finite().min(-86400).max(86400).default(0),
        gain: z.number().finite().min(0).max(4).default(1),
        originalGain: z.number().finite().min(0).max(4).default(1),
      })
      .strict()
      .default({ mode: 'keep', offset: 0, gain: 1, originalGain: 1 }),
  })
  .strict();
export const pdfPagesSchema = z
  .object({
    kind: z.literal('pdf-pages'),
    format: z.literal('pdf'),
    pages: z
      .array(
        z
          .object({
            source,
            page: z.number().int().min(1).max(10000),
            rotate: z
              .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
              .default(0),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export const transformPlanSchema = z.discriminatedUnion('kind', [
  pdfPagesSchema,
  imageTransformSchema,
  mediaTransformSchema,
  z
    .object({
      kind: z.literal('pdf'),
      format: z.literal('pdf'),
      preset: z.enum(['lossless', 'balanced', 'small']).default('balanced'),
      recompressImages: z.boolean().default(false),
      maxImageEdge: z.number().int().min(256).max(8192).default(2400),
    })
    .strict(),
]);
export type ImageTransform = z.infer<typeof imageTransformSchema>;
export type MediaTransform = z.infer<typeof mediaTransformSchema>;
export type PDFPagesTransform = z.infer<typeof pdfPagesSchema>;
export type TransformPlan = z.infer<typeof transformPlanSchema>;
export const mediaFormats = [
  'mp4',
  'm4v',
  'mov',
  'm4a',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'aif',
  'aiff',
  'caf',
  'avi',
  'mkv',
  'webm',
  'aac',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
] as const;
export function validateTransform(value: unknown, sources: number): TransformPlan {
  const plan = transformPlanSchema.parse(value);
  if (sources < 1 || (combinedTransform(plan) ? sources > 16 : sources > 1000))
    throw new Error(
      combinedTransform(plan)
        ? 'Choose between 1 and 16 source files.'
        : 'Choose between 1 and 1000 files.',
    );
  if (plan.kind === 'pdf-pages') {
    if (plan.pages.some((page) => page.source >= sources))
      throw new Error('A page refers to a PDF that is no longer in this draft.');
    if (new Set(plan.pages.map((page) => `${page.source}:${page.page}`)).size !== plan.pages.length)
      throw new Error('Include each source page at most once per PDF output.');
  }
  if (plan.kind === 'pdf' && plan.preset === 'lossless' && plan.recompressImages)
    throw new Error('Choose Balanced or Smaller to recompress scanned images.');
  if (plan.kind === 'image' && plan.width && plan.height && plan.width * plan.height > 100_000_000)
    throw new Error('Choose output dimensions below 100 megapixels.');
  if (
    plan.kind === 'image' &&
    plan.lossless &&
    plan.format === 'jpeg' &&
    (plan.width || plan.height || plan.crop || plan.rotate)
  )
    throw new Error(
      'Lossless JPEG optimization keeps the original pixels and dimensions. Choose ordinary image export to resize or crop.',
    );
  if (plan.kind === 'media') {
    if (
      plan.segments.some((segment) => segment.source >= sources) ||
      (plan.audio.source !== undefined && plan.audio.source >= sources)
    )
      throw new Error('A segment refers to a source that is no longer in this draft.');
    if (['replace', 'mix'].includes(plan.audio.mode) && plan.audio.source === undefined)
      throw new Error('Choose an audio source.');
    if (
      plan.cut === 'keyframe' &&
      (plan.segments.length !== 1 ||
        !['keep', 'mute'].includes(plan.audio.mode) ||
        !['mp4', 'mov'].includes(plan.format))
    )
      throw new Error('Fast keyframe cuts support one video segment, with original audio or mute.');
    if (['png', 'jpeg'].includes(plan.format) && plan.segments.length !== 1)
      throw new Error('Choose one segment to extract a frame.');
    if (['png', 'jpeg'].includes(plan.format) && ['mix', 'replace'].includes(plan.audio.mode))
      throw new Error('Frame exports do not accept an audio overlay.');
    if (['m4a', 'wav', 'flac'].includes(plan.format) && plan.audio.mode === 'mute')
      throw new Error('Choose an audio source for an audio-only export.');
  }
  return plan;
}
export function transformDescription(plan: TransformPlan): string {
  if (plan.kind === 'pdf-pages')
    return `PDF · ${plan.pages.length} pages in order: ${plan.pages.map((page) => `${page.source + 1}:${page.page}${page.rotate ? ` (+${page.rotate}°)` : ''}`).join(', ')} · creates a new document; bookmarks, forms and document tags are not retained`;
  if (plan.kind === 'pdf')
    return `Optimize PDF · ${plan.preset === 'lossless' ? 'lossless structure compression' : plan.preset + ' image compression'}${plan.recompressImages ? ` · recompress compatible JPEG scans, maximum edge ${plan.maxImageEdge}px` : ''} · preserve searchable text and vector pages · save only if smaller`;
  if (plan.kind === 'image')
    return `${plan.format.toUpperCase()} · ${[plan.width, plan.height].some(Boolean) ? `${plan.width || 'auto'} × ${plan.height || 'auto'}` : 'original size'}${plan.crop ? ` · crop ${plan.crop.width} × ${plan.crop.height} at ${plan.crop.x}, ${plan.crop.y}` : ''}${plan.rotate ? ` · rotate ${plan.rotate}°` : ''} · ${plan.metadata === 'safe' ? 'keep color and credit, remove GPS' : plan.metadata === 'strip' ? 'remove metadata' : 'keep all metadata including location'}`;
  return `${plan.format.toUpperCase()} · ${plan.segments.map((segment) => `source ${segment.source + 1}: ${mediaTime(segment.start)}–${mediaTime(segment.end)}`).join(', ')} · ${plan.cut === 'exact' ? 'exact cuts' : 'fast keyframe cuts'} · audio ${plan.audio.mode}${plan.audio.source === undefined ? '' : ` from source ${plan.audio.source + 1}, offset ${plan.audio.offset}s, gain ${plan.audio.gain}`}`;
}
export const transformExtension = (format: TransformPlan['format']) =>
  format === 'jpeg' ? 'jpg' : format;
export const combinedTransform = (plan?: TransformPlan): boolean =>
  plan?.kind === 'media' || plan?.kind === 'pdf-pages';
export const mediaTime = (seconds: number) => {
  const total = Math.max(0, seconds);
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, '0')}:${(total % 60).toFixed(3).padStart(6, '0')}`;
};
