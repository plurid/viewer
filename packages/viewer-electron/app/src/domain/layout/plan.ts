/**
 * A resolved layout: pages of placed items. Lengths are PDF points (1/72 inch), measured from each
 * page's top-left corner with y down. The renderer plans it; the desktop draws it as one PDF, or as
 * one PNG or JPEG image of a single page.
 */
import { z } from 'zod';

export const pointsPerMillimetre = 72 / 25.4;
export const millimetres = (value: number) => value * pointsPerMillimetre;
export const toMillimetres = (points: number) => points / pointsPerMillimetre;

/** PDF readers refuse pages over 14,400 points (200 inches). */
export const layoutLimits = {
  sources: 500,
  pages: 1000,
  itemsPerPage: 5000,
  /** Path coordinates across the whole plan, two per point. */
  pathNumbers: 2_000_000,
  textLength: 500,
  rasterPixels: 100_000_000,
  pageSize: 14_400,
} as const;

const length = z.number().finite().min(0).max(layoutLimits.pageSize);
const coordinate = z
  .number()
  .finite()
  .min(-layoutLimits.pageSize)
  .max(2 * layoutLimits.pageSize);
const frame = z.object({ x: coordinate, y: coordinate, width: length, height: length }).strict();
const fraction = z.number().finite().min(0).max(1);
/** A part of a source, as fractions of its width and height after `rotate`. */
const crop = z
  .object({ x: fraction, y: fraction, width: fraction, height: fraction })
  .strict()
  .refine((value) => value.width > 0 && value.height > 0, 'A crop needs a width and a height.')
  .refine(
    (value) => value.x + value.width <= 1 + 1e-9 && value.y + value.height <= 1 + 1e-9,
    'A crop stays inside its source.',
  );
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const source = z
  .number()
  .int()
  .min(0)
  .max(layoutLimits.sources - 1);
const whole = { x: 0, y: 0, width: 1, height: 1 };

/** A raster image source, rotated, then cropped, then stretched to `frame`: the planner chooses
 * the crop that keeps the picture's proportions. */
const imageItem = z
  .object({
    kind: z.literal('image'),
    source,
    frame,
    crop: crop.default(whole),
    rotate: rotation.default(0),
  })
  .strict();
/** One page of a PDF source, drawn as vectors, placed as an image is. */
const pageItem = z
  .object({
    kind: z.literal('page'),
    source,
    page: z.number().int().min(1).max(100_000),
    frame,
    crop: crop.default(whole),
    rotate: rotation.default(0),
  })
  .strict();
const rectItem = z
  .object({
    kind: z.literal('rect'),
    frame,
    fill: color.optional(),
    stroke: color.optional(),
    lineWidth: z.number().finite().min(0).max(100).default(0.5),
  })
  .strict();
/** A polyline: x, y pairs. Marks, cut lines and drawings. */
const pathItem = z
  .object({
    kind: z.literal('path'),
    points: z
      .array(coordinate)
      .min(4)
      .refine((values) => values.length % 2 === 0, 'Points come in x, y pairs.'),
    closed: z.boolean().default(false),
    stroke: color.optional(),
    fill: color.optional(),
    lineWidth: z.number().finite().min(0).max(100).default(0.25),
    dash: z.tuple([length, length]).optional(),
  })
  .strict();
/** One line of text; `y` is its baseline. */
const textItem = z
  .object({
    kind: z.literal('text'),
    text: z.string().min(1).max(layoutLimits.textLength),
    x: coordinate,
    y: coordinate,
    size: z.number().finite().min(2).max(200),
    color: color.default('#000000'),
    align: z.enum(['start', 'center', 'end']).default('start'),
    weight: z.enum(['regular', 'bold']).default('regular'),
    maxWidth: length.optional(),
  })
  .strict();
export const layoutItemSchema = z.discriminatedUnion('kind', [
  imageItem,
  pageItem,
  rectItem,
  pathItem,
  textItem,
]);
export const layoutPageSchema = z
  .object({
    width: length.min(1),
    height: length.min(1),
    background: color.optional(),
    items: z.array(layoutItemSchema).max(layoutLimits.itemsPerPage),
  })
  .strict();
export const layoutTransformSchema = z
  .object({
    kind: z.literal('layout'),
    format: z.enum(['pdf', 'png', 'jpeg']),
    /** A raster output's resolution; in a PDF, the most image pixels kept per inch. */
    dpi: z.number().int().min(36).max(1200).default(300),
    quality: z.number().int().min(1).max(100).default(90),
    title: z.string().max(200).optional(),
    pages: z.array(layoutPageSchema).min(1).max(layoutLimits.pages),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.format !== 'pdf') {
      if (plan.pages.length !== 1)
        context.addIssue({ code: 'custom', message: 'An image output holds one page.' });
      const page = plan.pages[0]!;
      const pixels = ((page.width * plan.dpi) / 72) * ((page.height * plan.dpi) / 72);
      if (pixels > layoutLimits.rasterPixels)
        context.addIssue({
          code: 'custom',
          message: 'Choose a lower resolution: the image would exceed 100 megapixels.',
        });
      if (page.items.some((item) => item.kind === 'page'))
        context.addIssue({ code: 'custom', message: 'PDF pages are laid out as a PDF.' });
    }
    const numbers = plan.pages.reduce(
      (total, page) =>
        total +
        page.items.reduce((sum, item) => sum + (item.kind === 'path' ? item.points.length : 0), 0),
      0,
    );
    if (numbers > layoutLimits.pathNumbers)
      context.addIssue({ code: 'custom', message: 'This layout has too many drawn points.' });
  });
export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type LayoutPage = z.infer<typeof layoutPageSchema>;
export type LayoutTransform = z.infer<typeof layoutTransformSchema>;
export type LayoutFormat = LayoutTransform['format'];
