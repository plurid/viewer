/**
 * Collage styles for a few photos on one page. Each style places photos in slots; a slot is filled
 * (cropped to its shape) or fitted (letterboxed). Candidates are scored by how much of the page the
 * photos cover, how much of them is cut away, how even their sizes are and, for an output with a
 * pixel size, whether a photo would be enlarged past its own pixels.
 */
import { area, aspect, fillCrop, fitInside, transpose, wholeCrop } from './geometry';
import type { Crop, CropAnchor, Rect, Size } from './geometry';

export const collageStyles = ['justified', 'featured', 'grid', 'strip', 'split'] as const;
export type CollageStyle = (typeof collageStyles)[number];
export type CollageFit = 'fill' | 'fit';
export type CollageDirection = 'auto' | 'horizontal' | 'vertical';
/** Collages beyond this many photos are better as a contact sheet. */
export const collageLimit = 100;

export interface CollagePhoto extends Size {
  /** Whether the size is the photo's own pixels, so enlargement can be judged. */
  measured?: boolean;
}
export interface CollageOptions {
  style: CollageStyle;
  fit: CollageFit;
  anchor: CropAnchor;
  direction: CollageDirection;
  gap: number;
  /** The large photo of a featured or split layout; by default the one with the most pixels. */
  feature?: number;
  /** Output pixels per point: set when the output has a pixel size. */
  pixelsPerPoint?: number;
}
export interface CollageCell {
  photo: number;
  frame: Rect;
  crop: Crop;
}
export interface CollageMetrics {
  /** The share of the box the photos cover. */
  coverage: number;
  /** The average share of each photo cut away. */
  cropped: number;
  /** 1 when every photo shows at the same size. */
  evenness: number;
  /** 1 when no photo is enlarged past its own pixels. */
  sharpness: number;
  score: number;
}
export interface CollageLayout {
  cells: CollageCell[];
  metrics: CollageMetrics;
}
interface Slot {
  photo: number;
  rect: Rect;
}

export const collageStyleAvailable = (style: CollageStyle, count: number) =>
  style === 'split' ? count === 2 || count === 3 : style === 'featured' ? count >= 3 : count >= 1;

export function collage(
  photos: readonly CollagePhoto[],
  box: Rect,
  options: CollageOptions,
): CollageLayout | undefined {
  if (!photos.length || box.width <= 0 || box.height <= 0) return undefined;
  switch (options.style) {
    case 'justified':
      return best(
        justifiedVariants(photos, indices(photos.length), box, options),
        photos,
        box,
        options,
      );
    case 'featured':
      return best(featuredVariants(photos, box, options), photos, box, options);
    case 'grid':
      return best(gridVariants(photos.length, box, options.gap), photos, box, options);
    case 'strip':
      return best(stripVariants(photos, box, options), photos, box, options);
    case 'split':
      return best(splitVariants(photos, box, options), photos, box, options);
  }
}

/** The most pixels wins; ties within a tenth go to the earlier photo. */
export function featuredPhoto(photos: readonly CollagePhoto[]): number {
  let chosen = 0;
  photos.forEach((photo, index) => {
    if (area(photo) > area(photos[chosen]!) * 1.1) chosen = index;
  });
  return chosen;
}

/** Scores a layout. The gaps chosen between photos are not empty space: each frame counts with
 * half a gap around it, within the box. */
export function scoreCells(
  photos: readonly CollagePhoto[],
  cells: readonly CollageCell[],
  box: Rect,
  gap = 0,
  pixelsPerPoint?: number,
): CollageMetrics {
  const areas = cells.map((cell) => area(cell.frame));
  const total = areas.reduce((sum, value) => sum + value, 0);
  const covered = cells.reduce((sum, cell) => {
    const left = Math.max(box.x, cell.frame.x - gap / 2);
    const top = Math.max(box.y, cell.frame.y - gap / 2);
    const right = Math.min(box.x + box.width, cell.frame.x + cell.frame.width + gap / 2);
    const bottom = Math.min(box.y + box.height, cell.frame.y + cell.frame.height + gap / 2);
    return sum + Math.max(0, right - left) * Math.max(0, bottom - top);
  }, 0);
  const mean = total / cells.length;
  const deviation = Math.sqrt(
    areas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / cells.length,
  );
  const cropped =
    cells.reduce((sum, cell) => sum + 1 - cell.crop.width * cell.crop.height, 0) / cells.length;
  const sharp = cells.map((cell) => {
    const photo = photos[cell.photo]!;
    if (!pixelsPerPoint || !photo.measured) return 1;
    return Math.min(1, (photo.width * cell.crop.width) / (cell.frame.width * pixelsPerPoint));
  });
  const metrics = {
    coverage: Math.min(1, covered / area(box)),
    cropped,
    evenness: mean > 0 ? 1 - Math.min(1, deviation / mean) : 0,
    sharpness: sharp.reduce((sum, value) => sum + value, 0) / cells.length,
  };
  return {
    ...metrics,
    // empty space shows more than photos of different sizes
    score:
      0.45 * metrics.coverage +
      0.35 * (1 - metrics.cropped) +
      0.1 * metrics.evenness +
      0.1 * metrics.sharpness,
  };
}

function best(
  variants: Iterable<Slot[]>,
  photos: readonly CollagePhoto[],
  box: Rect,
  options: CollageOptions,
): CollageLayout | undefined {
  let chosen: CollageLayout | undefined;
  for (const slots of variants) {
    const layout = place(slots, photos, box, options);
    if (!chosen || layout.metrics.score > chosen.metrics.score + 1e-9) chosen = layout;
  }
  return chosen;
}
function place(
  slots: readonly Slot[],
  photos: readonly CollagePhoto[],
  box: Rect,
  options: CollageOptions,
): CollageLayout {
  const cells = slots.map(({ photo, rect }): CollageCell => {
    const size = photos[photo]!;
    return options.fit === 'fill'
      ? { photo, frame: rect, crop: fillCrop(size, rect, options.anchor) }
      : { photo, frame: fitInside(size, rect), crop: wholeCrop };
  });
  return { cells, metrics: scoreCells(photos, cells, box, options.gap, options.pixelsPerPoint) };
}
const indices = (count: number) => Array.from({ length: count }, (_, index) => index);
const directions = (direction: CollageDirection): ('horizontal' | 'vertical')[] =>
  direction === 'auto' ? ['horizontal', 'vertical'] : [direction];

/**
 * Splits photos, in order, into `rows` rows whose heights are as close as possible to the height
 * the page asks of each row: the balanced partition photo sites use for justified galleries.
 * Returns where each row starts, then the count.
 */
export function balancedRows(
  aspects: readonly number[],
  rows: number,
  width: number,
  gap: number,
  target: number,
): number[] {
  const count = aspects.length;
  const prefix = [0];
  for (const value of aspects) prefix.push(prefix.at(-1)! + value);
  const cost = (start: number, end: number) => {
    const height = (width - gap * (end - start - 1)) / (prefix[end]! - prefix[start]!);
    return height <= 0 ? Infinity : ((height - target) / target) ** 2;
  };
  const totals = Array.from({ length: rows + 1 }, () =>
    new Array<number>(count + 1).fill(Infinity),
  );
  const starts = Array.from({ length: rows + 1 }, () => new Array<number>(count + 1).fill(0));
  totals[0]![0] = 0;
  for (let row = 1; row <= rows; row++)
    for (let end = row; end <= count; end++)
      for (let start = row - 1; start < end; start++) {
        const value = totals[row - 1]![start]! + cost(start, end);
        if (value < totals[row]![end]!) {
          totals[row]![end] = value;
          starts[row]![end] = start;
        }
      }
  const bounds = [count];
  for (let row = rows, end = count; row > 0; row--) {
    end = starts[row]![end]!;
    bounds.unshift(end);
  }
  return bounds;
}

/** Rows that fill the box's width, each photo at its own proportions. Fitted rows shrink to fit the
 * height; filled rows stretch to it, so their photos crop a little. */
function rowSlots(
  photos: readonly Size[],
  order: readonly number[],
  bounds: readonly number[],
  box: Rect,
  gap: number,
  fit: CollageFit,
): Slot[] | undefined {
  const groups = bounds.slice(1).map((end, row) => order.slice(bounds[row], end));
  const natural = groups.map(
    (group) =>
      (box.width - gap * (group.length - 1)) /
      group.reduce((sum, photo) => sum + aspect(photos[photo]!), 0),
  );
  const available = box.height - gap * (groups.length - 1);
  const sum = natural.reduce((total, value) => total + value, 0);
  if (available <= 0 || natural.some((value) => value <= 0)) return undefined;
  const scale = fit === 'fit' ? Math.min(1, available / sum) : available / sum;
  const heights = natural.map((value) => value * scale);
  const used = heights.reduce((total, value) => total + value, 0) + gap * (groups.length - 1);
  let y = box.y + (box.height - used) / 2;
  const slots: Slot[] = [];
  groups.forEach((group, row) => {
    // a fitted row keeps its photos' proportions; a filled one keeps the full width
    const base = fit === 'fit' ? heights[row]! : natural[row]!;
    const widths = group.map((photo) => aspect(photos[photo]!) * base);
    const span = widths.reduce((total, value) => total + value, 0) + gap * (group.length - 1);
    let x = box.x + (box.width - span) / 2;
    group.forEach((photo, index) => {
      slots.push({ photo, rect: { x, y, width: widths[index]!, height: heights[row]! } });
      x += widths[index]! + gap;
    });
    y += heights[row]! + gap;
  });
  return slots;
}
function* justifiedVariants(
  photos: readonly Size[],
  order: readonly number[],
  box: Rect,
  options: Pick<CollageOptions, 'gap' | 'fit' | 'direction'>,
  rowCounts?: readonly number[],
): Generator<Slot[]> {
  for (const direction of directions(options.direction)) {
    const vertical = direction === 'vertical';
    const space = vertical ? transpose(box) : box;
    const sizes = vertical
      ? photos.map((photo) => ({ width: photo.height, height: photo.width }))
      : photos;
    const aspects = order.map((photo) => aspect(sizes[photo]!));
    // rows of height h hold width / h of aspect each: k rows hold all of it when k² ≈ Σ·height/width
    const ideal = Math.round(
      Math.sqrt((aspects.reduce((sum, value) => sum + value, 0) * space.height) / space.width),
    );
    const counts = rowCounts ?? [1, 2, 3, ...indices(5).map((index) => ideal - 2 + index)];
    for (const rows of new Set(counts)) {
      if (rows < 1 || rows > order.length) continue;
      const target = (space.height - options.gap * (rows - 1)) / rows;
      if (target <= 0) continue;
      const bounds = balancedRows(aspects, rows, space.width, options.gap, target);
      const slots = rowSlots(sizes, order, bounds, space, options.gap, options.fit);
      if (slots)
        yield vertical ? slots.map((slot) => ({ ...slot, rect: transpose(slot.rect) })) : slots;
    }
  }
}
function* stripVariants(
  photos: readonly Size[],
  box: Rect,
  options: CollageOptions,
): Generator<Slot[]> {
  yield* justifiedVariants(photos, indices(photos.length), box, options, [1]);
}
function* gridVariants(count: number, box: Rect, gap: number): Generator<Slot[]> {
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    if ((rows - 1) * columns >= count) continue;
    const width = (box.width - gap * (columns - 1)) / columns;
    const height = (box.height - gap * (rows - 1)) / rows;
    if (width <= 0 || height <= 0) continue;
    yield indices(count).map((photo) => {
      const row = Math.floor(photo / columns);
      const inRow = Math.min(columns, count - row * columns);
      // a short last row is centred
      const offset = ((columns - inRow) * (width + gap)) / 2;
      return {
        photo,
        rect: {
          x: box.x + offset + (photo % columns) * (width + gap),
          y: box.y + row * (height + gap),
          width,
          height,
        },
      };
    });
  }
}
function* featuredVariants(
  photos: readonly CollagePhoto[],
  box: Rect,
  options: CollageOptions,
): Generator<Slot[]> {
  const feature = options.feature ?? featuredPhoto(photos);
  const rest = indices(photos.length).filter((photo) => photo !== feature);
  const own = aspect(photos[feature]!);
  for (const side of ['left', 'top'] as const) {
    const across = side === 'left' ? box.width : box.height;
    const natural =
      side === 'left'
        ? (own * box.height) / (box.width - options.gap)
        : box.width / own / (box.height - options.gap);
    const shares = [Math.min(0.75, Math.max(0.45, natural)), 0.5, 0.6, 0.67];
    for (const share of new Set(shares)) {
      const size = share * (across - options.gap);
      const large: Rect =
        side === 'left'
          ? { x: box.x, y: box.y, width: size, height: box.height }
          : { x: box.x, y: box.y, width: box.width, height: size };
      const remaining: Rect =
        side === 'left'
          ? { ...box, x: box.x + size + options.gap, width: box.width - size - options.gap }
          : { ...box, y: box.y + size + options.gap, height: box.height - size - options.gap };
      const others = best(
        [...justifiedVariants(photos, rest, remaining, { ...options, direction: 'auto' })],
        photos,
        remaining,
        options,
      );
      if (!others) continue;
      yield [
        { photo: feature, rect: large },
        ...others.cells.map((cell) => ({
          photo: cell.photo,
          // the slot, not the fitted frame: placing again keeps the same result
          rect: cell.frame,
        })),
      ];
    }
  }
}
/** Halves for two photos; thirds, or one half and two quarters, for three. */
function* splitVariants(
  photos: readonly CollagePhoto[],
  box: Rect,
  options: CollageOptions,
): Generator<Slot[]> {
  const count = photos.length;
  if (count !== 2 && count !== 3) return;
  const { gap } = options;
  const equal = (vertical: boolean) =>
    indices(count).map((photo): Slot => {
      const width = (box.width - gap * (count - 1)) / count;
      const height = (box.height - gap * (count - 1)) / count;
      return {
        photo,
        rect: vertical
          ? { x: box.x, y: box.y + photo * (height + gap), width: box.width, height }
          : { x: box.x + photo * (width + gap), y: box.y, width, height: box.height },
      };
    });
  yield equal(false);
  yield equal(true);
  if (count !== 3) return;
  const large = options.feature ?? featuredPhoto(photos);
  const [first, second] = indices(3).filter((photo) => photo !== large) as [number, number];
  const halfWidth = (box.width - gap) / 2;
  const halfHeight = (box.height - gap) / 2;
  yield [
    { photo: large, rect: { x: box.x, y: box.y, width: halfWidth, height: box.height } },
    {
      photo: first,
      rect: { x: box.x + halfWidth + gap, y: box.y, width: halfWidth, height: halfHeight },
    },
    {
      photo: second,
      rect: {
        x: box.x + halfWidth + gap,
        y: box.y + halfHeight + gap,
        width: halfWidth,
        height: halfHeight,
      },
    },
  ];
  yield [
    { photo: large, rect: { x: box.x, y: box.y, width: box.width, height: halfHeight } },
    {
      photo: first,
      rect: { x: box.x, y: box.y + halfHeight + gap, width: halfWidth, height: halfHeight },
    },
    {
      photo: second,
      rect: {
        x: box.x + halfWidth + gap,
        y: box.y + halfHeight + gap,
        width: halfWidth,
        height: halfHeight,
      },
    },
  ];
}
