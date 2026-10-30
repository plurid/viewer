/**
 * Plans a layout from the person's settings and the measured sources. The plan it returns is the
 * one the preview draws and the one saved, item for item.
 */
import { layoutLimits, toMillimetres } from './plan';
import type { LayoutFormat, LayoutItem, LayoutPage, LayoutTransform } from './plan';
import {
  area,
  fillCrop,
  fitInside,
  inset,
  pageBox,
  roundCrop,
  roundRect,
  turned,
  wholeCrop,
} from './geometry';
import type { Crop, Rect, Rotation, Size } from './geometry';
import { collage, collageLimit, collageStyleAvailable, scoreCells } from './collage';
import type { CollageLayout, CollageMetrics, CollageOptions, CollagePhoto } from './collage';
import {
  captionLine,
  captionSize,
  contactSheetCell,
  contactSheetGrid,
  footerHeight,
  headerHeight,
} from './contact-sheet';
import type { ContactSheetGrid } from './contact-sheet';
import { cellSize, nUpArrangement, nUpCells, pageRotation } from './n-up';
import { bookletPlacement, bookletSides } from './booklet';
import { labelCells, repeatCells, repeatCopies } from './step-repeat';
import type { RepeatCell } from './step-repeat';
import { posterTiling } from './poster';
import { cropMarks, cutTicks, frameItem, guideColor, segmentItem, textItem } from './marks';
import type { Segment } from './marks';
import {
  isScreenSize,
  itemPreset,
  oriented,
  orientationOf,
  pageChoices,
  pagePreset,
  sizeName,
} from './pages';
import { printedSize, sourcePieces } from './sources';
import type { LayoutPiece, LayoutSource } from './sources';
import type { LayoutSettings, PageSetup, PlannedMode } from './settings';
import { baseName, parentPath } from '../workspaces/planes';

export interface LayoutResult {
  plan: LayoutTransform;
  /** The files the plan's `source` numbers refer to, in order. */
  sources: string[];
  /** What it makes, in a line: "2 per sheet · 3 sheets · A4 landscape". */
  summary: string;
  /** Why it is a good choice, beside a candidate: "Fills 94% of A4, no cropping". */
  reason: string;
  /** Higher is better; comparable between layouts of one mode. */
  score: number;
  /** How to print or put it together, when that matters. */
  note?: string;
  /** The formats it can be saved as: an image holds one page and no PDF page. */
  formats: LayoutFormat[];
  /** Copies or pages on each sheet, for the output's name. */
  perSheet?: number;
  /** A contact sheet's columns. */
  columns?: number;
}
export interface LayoutProblem {
  problem: string;
}
export type LayoutOutcome = LayoutResult | LayoutProblem;
export const isProblem = (outcome: LayoutOutcome): outcome is LayoutProblem => 'problem' in outcome;

interface Draft {
  pages: LayoutPage[];
  summary: string;
  reason: string;
  score: number;
  note?: string;
  /** A resolution the layout needs: a screen size is drawn a point to a pixel. */
  dpi?: number;
  perSheet?: number;
  columns?: number;
}

export function planLayout(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
  mode: PlannedMode = settings.mode === 'nesting' ? 'collage' : settings.mode,
): LayoutOutcome {
  if (!sources.length) return { problem: 'Choose photos or PDFs to lay out.' };
  const draft = drafts[mode](settings, sources);
  if ('problem' in draft) return draft;
  if (draft.pages.length > layoutLimits.pages)
    return {
      problem: `This layout needs more than ${layoutLimits.pages} pages. Choose fewer files.`,
    };
  return finish(draft, settings, mode, sources);
}

const drafts: Record<
  PlannedMode,
  (settings: LayoutSettings, sources: readonly LayoutSource[]) => Draft | LayoutProblem
> = {
  collage: collageDraft,
  'contact-sheet': contactSheetDraft,
  'n-up': nUpDraft,
  booklet: bookletDraft,
  'step-repeat': stepRepeatDraft,
  poster: posterDraft,
};

/** The plan, with only the sources it draws, in a format it can be saved as. */
function finish(
  draft: Draft,
  settings: LayoutSettings,
  mode: PlannedMode,
  sources: readonly LayoutSource[],
): LayoutResult {
  const vectors = draft.pages.some((page) => page.items.some((item) => item.kind === 'page'));
  const formats: LayoutFormat[] =
    draft.pages.length === 1 && !vectors ? ['pdf', 'png', 'jpeg'] : ['pdf'];
  const chosen = settings[mode].format;
  const format = formats.includes(chosen) ? chosen : 'pdf';
  const first = draft.pages[0]!;
  let dpi = draft.dpi ?? settings.dpi;
  if (format !== 'pdf') {
    // the most a raster output may hold
    const most = Math.floor(
      72 * Math.sqrt(layoutLimits.rasterPixels / (first.width * first.height)),
    );
    dpi = Math.min(dpi, most);
  }
  dpi = Math.max(36, Math.min(1200, Math.round(dpi)));
  const used = [
    ...new Set(
      draft.pages.flatMap((page) =>
        page.items.flatMap((item) =>
          item.kind === 'image' || item.kind === 'page' ? [item.source] : [],
        ),
      ),
    ),
  ].sort((a, b) => a - b);
  const index = new Map(used.map((source, position) => [source, position]));
  const pages = draft.pages.map((page) => ({
    ...page,
    items: page.items.map((item) =>
      item.kind === 'image' || item.kind === 'page'
        ? { ...item, source: index.get(item.source)! }
        : item,
    ),
  }));
  return {
    plan: { kind: 'layout', format, dpi, quality: settings.quality, pages },
    sources: used.map((source) => sources[source]!.path),
    summary: draft.summary,
    reason: draft.reason,
    score: draft.score,
    ...(draft.note ? { note: draft.note } : {}),
    formats,
    ...(draft.perSheet ? { perSheet: draft.perSheet } : {}),
    ...(draft.columns ? { columns: draft.columns } : {}),
  };
}

export function pieceItem(
  piece: LayoutPiece,
  frame: Rect,
  crop: Crop = wholeCrop,
  rotate: Rotation = 0,
): LayoutItem {
  const placed = { source: piece.source, frame: roundRect(frame), crop: roundCrop(crop), rotate };
  return piece.page ? { kind: 'page', page: piece.page, ...placed } : { kind: 'image', ...placed };
}
const page = (size: Size, setup: PageSetup, items: LayoutItem[]): LayoutPage => ({
  width: size.width,
  height: size.height,
  ...(setup.background ? { background: setup.background } : {}),
  items,
});
const percent = (value: number) => `${Math.round(value * 100)}%`;
const plural = (count: number, one: string, many = one + 's') =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
/** The most common size, near enough, of a list of sizes. */
function typicalSize(sizes: readonly Size[]): Size {
  const counts = new Map<string, { size: Size; count: number }>();
  for (const size of sizes) {
    const key = `${Math.round(size.width)}x${Math.round(size.height)}`;
    const entry = counts.get(key) ?? { size, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]!.size;
}
const sheetChoices = (setup: PageSetup): Size[] =>
  setup.size === 'fit'
    ? pageChoices('a4', setup.orientation)
    : pageChoices(setup.size, setup.orientation);

function collageDraft(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
): Draft | LayoutProblem {
  const options = settings.collage;
  const pieces = sourcePieces(sources).filter((piece) => !piece.page);
  if (!pieces.length) return { problem: 'Choose photos to make a collage.' };
  if (pieces.length > collageLimit)
    return { problem: `A collage holds up to ${collageLimit} photos. Choose Contact sheet.` };
  const photos: CollagePhoto[] = pieces.map((piece) => {
    const source = sources[piece.source]!;
    return {
      width: piece.width,
      height: piece.height,
      measured: source.kind === 'image' && source.measured,
    };
  });
  const style = collageStyleAvailable(options.style, photos.length) ? options.style : 'justified';
  const base: CollageOptions = {
    style,
    fit: options.fit,
    anchor: options.anchor,
    direction: options.direction,
    gap: options.page.gap,
    feature:
      options.feature === 'auto' || options.feature >= photos.length ? undefined : options.feature,
  };
  const margin = options.page.margin;
  const cells = (layout: CollageLayout) =>
    layout.cells.map((cell) => pieceItem(pieces[cell.photo]!, cell.frame, cell.crop));
  if (options.page.size === 'fit') {
    const fitted = fittedCollage(photos, base, margin);
    if (!fitted) return { problem: 'Choose a smaller margin or gap.' };
    return {
      pages: [page(fitted.size, options.page, cells(fitted.layout))],
      summary: `${plural(photos.length, 'photo')} · ${fitted.pixels}`,
      reason: collageReason(fitted.layout.metrics),
      score: fitted.layout.metrics.score,
      dpi: fitted.dpi,
    };
  }
  const screen = isScreenSize(options.page.size);
  const dpi = screen ? 72 : settings.dpi;
  const pixels = screen || options.format !== 'pdf';
  let chosen: { size: Size; layout: CollageLayout } | undefined;
  for (const size of sheetChoices(options.page)) {
    const layout = collage(photos, inset(pageBox(size), margin), {
      ...base,
      ...(pixels ? { pixelsPerPoint: dpi / 72 } : {}),
    });
    if (layout && (!chosen || layout.metrics.score > chosen.layout.metrics.score + 1e-9))
      chosen = { size, layout };
  }
  if (!chosen) return { problem: 'Choose a smaller margin or gap.' };
  return {
    pages: [page(chosen.size, options.page, cells(chosen.layout))],
    summary: `${plural(photos.length, 'photo')} · ${sizeName(chosen.size)}`,
    reason: collageReason(chosen.layout.metrics, sizeName(chosen.size)),
    score: chosen.layout.metrics.score,
    ...(screen ? { dpi } : {}),
  };
}

/** The long edge of a page shaped to its photos; its resolution comes from the photos' pixels. */
const fittedEdge = 1200;
const fittedShapes = [3 / 2, 4 / 3, 1, 3 / 4, 2 / 3, 16 / 9, 9 / 16, 2, 1 / 2, 3, 1 / 3];
/**
 * A page shaped to its photos: each shape is laid out with every photo whole, the page is trimmed
 * to what the photos cover, and the best result, preferring ordinary proportions, is laid out again
 * on its own page as chosen.
 */
function fittedCollage(photos: readonly CollagePhoto[], options: CollageOptions, margin: number) {
  let best: { size: Size; score: number } | undefined;
  for (const shape of fittedShapes) {
    const size =
      shape >= 1
        ? { width: fittedEdge, height: fittedEdge / shape }
        : { width: fittedEdge * shape, height: fittedEdge };
    const layout = collage(photos, inset(pageBox(size), margin), { ...options, fit: 'fit' });
    if (!layout) continue;
    const left = Math.min(...layout.cells.map((cell) => cell.frame.x));
    const top = Math.min(...layout.cells.map((cell) => cell.frame.y));
    const right = Math.max(...layout.cells.map((cell) => cell.frame.x + cell.frame.width));
    const bottom = Math.max(...layout.cells.map((cell) => cell.frame.y + cell.frame.height));
    const bounds = { x: left, y: top, width: right - left, height: bottom - top };
    // the page is trimmed, not scaled, so its margin and gaps stay as chosen
    const trimmed = { width: bounds.width + 2 * margin, height: bounds.height + 2 * margin };
    const score =
      scoreCells(photos, layout.cells, bounds, options.gap).score * ordinaryShape(trimmed);
    if (!best || score > best.score + 1e-9) best = { size: trimmed, score };
  }
  if (!best) return undefined;
  const measured = photos.filter((photo) => photo.measured);
  const own = measured.reduce((sum, photo) => sum + area(photo), 0);
  // the photos' own pixels, between 4 and 24 megapixels
  const target = Math.min(24e6, Math.max(4e6, measured.length ? own : 12e6));
  const long = Math.sqrt(
    (target * Math.max(best.size.width, best.size.height)) /
      Math.min(best.size.width, best.size.height),
  );
  const edge = Math.max(best.size.width, best.size.height);
  const dpi = Math.max(72, Math.min(600, Math.round((72 * long) / edge)));
  const found = collage(photos, inset(pageBox(best.size), margin), {
    ...options,
    pixelsPerPoint: dpi / 72,
  });
  if (!found) return undefined;
  const factor = ordinaryShape(best.size);
  const layout = { ...found, metrics: { ...found.metrics, score: found.metrics.score * factor } };
  const width = Math.round((best.size.width * dpi) / 72);
  const height = Math.round((best.size.height * dpi) / 72);
  return { size: best.size, layout, dpi, pixels: `${width} × ${height} px` };
}
/** Prints and screens come between square and 16:9, either way round: such a page scores in full,
 * one up to 2:1 a little less, and a longer strip, which few people want, much less. */
export const ordinaryShape = (size: Size) => {
  const proportion = Math.max(size.width, size.height) / Math.min(size.width, size.height);
  return proportion <= 16 / 9 + 0.01 ? 1 : proportion <= 2.05 ? 0.92 : 0.75;
};
function collageReason(metrics: CollageMetrics, sheet?: string): string {
  const cropping =
    metrics.cropped < 0.005 ? 'no cropping' : `crops ${percent(Math.max(0.01, metrics.cropped))}`;
  const covered =
    metrics.coverage >= 0.995
      ? sheet
        ? `Fills ${sheet}`
        : 'No empty space'
      : sheet
        ? `Fills ${percent(metrics.coverage)} of ${sheet}`
        : `${percent(1 - metrics.coverage)} empty`;
  const enlarged = metrics.sharpness < 0.85 ? ', enlarges a photo' : '';
  return `${covered}, ${cropping}${enlarged}`;
}

function contactSheetDraft(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
): Draft | LayoutProblem {
  const options = settings['contact-sheet'];
  const pieces = sourcePieces(sources);
  const lines = 1 + (options.date ? 1 : 0) + (options.dimensions ? 1 : 0);
  const wide = pieces.filter((piece) => piece.width > piece.height * 1.05).length;
  const tall = pieces.filter((piece) => piece.height > piece.width * 1.05).length;
  const boxAspect = wide > pieces.length * 0.6 ? 4 / 3 : tall > pieces.length * 0.6 ? 3 / 4 : 1;
  const { margin, gap } = options.page;
  const header = options.title ? headerHeight : 0;
  let chosen: { sheet: Size; grid: ContactSheetGrid; content: Rect } | undefined;
  for (const sheet of sheetChoices(options.page)) {
    const content = inset(pageBox(sheet), margin, margin + header, margin, margin + footerHeight);
    const grid = contactSheetGrid(pieces.length, content, gap, lines, boxAspect, options.columns);
    if (grid && (!chosen || grid.pages < chosen.grid.pages)) chosen = { sheet, grid, content };
  }
  if (!chosen) return { problem: 'Choose a smaller margin or fewer columns.' };
  const { sheet, grid, content } = chosen;
  const folder = baseName(parentPath(sources[0]!.path));
  const pages: LayoutPage[] = [];
  for (let number = 0; number < grid.pages; number++) {
    const items: LayoutItem[] = [];
    if (options.title) {
      items.push(
        textItem(folder, margin, margin + 11, 11, {
          weight: 'bold',
          maxWidth: (sheet.width - 2 * margin) * 0.7,
        }),
        textItem(
          plural(
            pieces.length,
            sources.every((source) => source.kind === 'image') ? 'photo' : 'picture',
          ),
          sheet.width - margin,
          margin + 11,
          8,
          {
            align: 'end',
            color: '#555555',
          },
        ),
      );
    }
    pieces.slice(number * grid.perPage, (number + 1) * grid.perPage).forEach((piece, offset) => {
      const cell = contactSheetCell(grid, content, gap, offset);
      const box = { x: cell.x, y: cell.y, width: cell.width, height: grid.picture.height };
      items.push(frameItem(box, '#e2e2e2', 0.25), pieceItem(piece, fitInside(piece, box)));
      captionLines(piece, sources, options).forEach((text, line) =>
        items.push(
          textItem(
            text,
            cell.x + cell.width / 2,
            box.y + box.height + 3 + captionSize + line * captionLine,
            captionSize,
            {
              align: 'center',
              maxWidth: cell.width,
              color: line ? '#666666' : '#222222',
            },
          ),
        ),
      );
    });
    items.push(
      textItem(`Page ${number + 1} of ${grid.pages}`, sheet.width / 2, sheet.height - margin, 8, {
        align: 'center',
        color: '#555555',
      }),
    );
    pages.push(page(sheet, options.page, items));
  }
  return {
    pages,
    summary: `${grid.columns} columns · ${plural(grid.pages, 'page')} · ${sizeName(sheet)}`,
    reason: `${grid.perPage} per page, ${plural(grid.pages, 'page')}`,
    // fewer pages first, then larger pictures
    score: -grid.pages + grid.picture.width / 10000,
    perSheet: grid.perPage,
    columns: grid.columns,
  };
}
function captionLines(
  piece: LayoutPiece,
  sources: readonly LayoutSource[],
  options: LayoutSettings['contact-sheet'],
): string[] {
  const source = sources[piece.source]!;
  const lines = [
    source.kind === 'pdf' && piece.page ? `${source.name}, page ${piece.page}` : source.name,
  ];
  if (options.date && source.kind === 'image' && source.date) lines.push(source.date);
  if (options.dimensions)
    lines.push(
      source.kind === 'image'
        ? source.measured
          ? `${source.width} × ${source.height}`
          : 'Size unknown'
        : sizeName(piece),
    );
  return lines;
}

/** A piece less the bleed it carries on every side, unless the bleed would leave nothing. */
const trimmed = (size: Size, bleed: number): Size =>
  bleed > 0 && size.width > 4 * bleed && size.height > 4 * bleed
    ? { width: size.width - 2 * bleed, height: size.height - 2 * bleed }
    : size;
function nUpDraft(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
): Draft | LayoutProblem {
  const options = settings['n-up'];
  const pieces = sourcePieces(sources);
  const sizes = pieces.map(printedSize);
  const trims = sizes.map((size) => trimmed(size, options.bleed));
  const { gap } = options.page;
  // crop marks need room outside the bleed at the sheet's edges
  const margin = options.cropMarks
    ? Math.max(options.page.margin, options.bleed + 14)
    : options.page.margin;
  const arrangement = nUpArrangement(
    options.perSheet,
    typicalSize(trims),
    sheetChoices(options.page),
    margin,
    gap,
  );
  const cells = nUpCells(arrangement, margin, gap, options.order);
  const cell = cellSize(arrangement.sheet, arrangement.columns, arrangement.rows, margin, gap);
  if (cell.width <= 0 || cell.height <= 0) return { problem: 'Choose a smaller margin or gap.' };
  const sheets = Math.ceil(pieces.length / options.perSheet);
  const sheetBox = pageBox(arrangement.sheet);
  const pages: LayoutPage[] = [];
  for (let sheet = 0; sheet < sheets; sheet++) {
    const items: LayoutItem[] = [];
    const trimsHere: Rect[] = [];
    const drawn: Rect[] = [];
    cells.forEach((slot, position) => {
      const index = sheet * options.perSheet + position;
      const piece = pieces[index];
      if (!piece) return;
      const size = sizes[index]!;
      const trim = trims[index]!;
      const rotate = pageRotation(trim, slot, arrangement.rotate);
      const shown = turned(trim, rotate);
      const scale = Math.min(slot.width / shown.width, slot.height / shown.height);
      const trimRect = fitInside(shown, slot);
      const bleed = (size.width - trim.width) / 2;
      // as much of the bleed as the gap and the margin leave room for
      const extra = Math.min(bleed * scale, gap / 2, margin);
      const cut = bleed - extra / scale;
      const full = turned(size, rotate);
      const frame = inset(trimRect, -extra);
      items.push(
        pieceItem(
          piece,
          frame,
          {
            x: cut / full.width,
            y: cut / full.height,
            width: 1 - (2 * cut) / full.width,
            height: 1 - (2 * cut) / full.height,
          },
          rotate,
        ),
      );
      trimsHere.push(trimRect);
      drawn.push(frame);
    });
    if (options.frames) items.push(...trimsHere.map((rect) => frameItem(rect, guideColor, 0.5)));
    if (options.cropMarks) {
      const offset = Math.max(2, ...drawn.map((rect, index) => trimsHere[index]!.x - rect.x + 2));
      items.push(...marks(cropMarks(trimsHere, sheetBox, offset, 8, drawn)));
    }
    pages.push(page(arrangement.sheet, options.page, items));
  }
  return {
    pages,
    summary: `${options.perSheet} per sheet · ${plural(sheets, 'sheet')} · ${sizeName(arrangement.sheet)}`,
    reason: `Pages at ${percent(arrangement.scale)}, ${plural(sheets, 'sheet')}`,
    score: arrangement.scale,
    perSheet: options.perSheet,
  };
}
const marks = (segments: readonly Segment[], dash?: [number, number]) =>
  segments.map((segment) => segmentItem(segment, dash ? { dash } : {}));

function bookletDraft(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
): Draft | LayoutProblem {
  const options = settings.booklet;
  const pieces = sourcePieces(sources);
  if (pieces.length < 2) return { problem: 'A booklet needs at least two pages.' };
  const sizes = pieces.map(printedSize);
  const typical = typicalSize(sizes);
  const { margin } = options.page;
  const halves = (sheet: Size) => ({
    left: {
      x: margin,
      y: margin,
      width: sheet.width / 2 - margin,
      height: sheet.height - 2 * margin,
    },
    right: {
      x: sheet.width / 2,
      y: margin,
      width: sheet.width / 2 - margin,
      height: sheet.height - 2 * margin,
    },
  });
  const scaleOn = (sheet: Size) => {
    const { left } = halves(sheet);
    return Math.min(left.width / typical.width, left.height / typical.height);
  };
  // a tie goes to landscape, where pages stand side by side as they are read
  const sheet = sheetChoices(options.page).reduce((best, option) =>
    scaleOn(option) > scaleOn(best) * (1 + 1e-6) ||
    (Math.abs(scaleOn(option) - scaleOn(best)) <= scaleOn(best) * 1e-6 &&
      option.width > option.height)
      ? option
      : best,
  );
  const { left, right } = halves(sheet);
  if (left.width <= 0 || left.height <= 0) return { problem: 'Choose a smaller margin.' };
  const sides = bookletSides(pieces.length);
  const pages = sides.map((side) => {
    const shift = side.sheet * options.creep;
    const items = side.pages.flatMap((number, half): LayoutItem[] => {
      if (!number) return [];
      const placement = bookletPlacement(
        sizes[number - 1]!,
        half ? right : left,
        half ? 'left' : 'right',
        shift,
      );
      return [pieceItem(pieces[number - 1]!, placement.frame, placement.crop)];
    });
    return page(sheet, options.page, items);
  });
  const count = sides.length / 2;
  const blanks = count * 4 - pieces.length;
  const edge = sheet.width > sheet.height ? 'short' : 'long';
  return {
    pages,
    summary: `${plural(count, 'sheet')} · ${plural(count * 4, 'page')}${blanks ? `, ${blanks} blank` : ''} · ${sizeName(sheet)}`,
    reason: `Pages at ${percent(scaleOn(sheet))} on ${sizeName(sheet)}`,
    score: -Math.abs(Math.log(scaleOn(sheet))),
    note: `Print on both sides, flipping on the ${edge} edge. Fold the stack of ${plural(count, 'sheet')} in half and staple along the fold.`,
  };
}

function stepRepeatDraft(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
): Draft | LayoutProblem {
  const options = settings['step-repeat'];
  const pieces = sourcePieces(sources);
  const preset =
    options.item === 'original' || options.item === 'custom' ? undefined : itemPreset(options.item);
  const own = printedSize(pieces[0]!);
  const given: Size = preset
    ? { width: preset.width, height: preset.height }
    : options.item === 'custom'
      ? { width: options.width, height: options.height }
      : own;
  // a card or print stands as its picture does; a passport photo and a label keep their shape
  const item =
    preset?.sheet || options.item.startsWith('passport') || own.width === own.height
      ? given
      : oriented(given, orientationOf(own));
  if (item.width <= 0 || item.height <= 0) return { problem: 'Enter an item width and height.' };
  const { margin, gap } = options.page;
  let sheet: Size;
  let cells: RepeatCell[];
  if (preset?.sheet) {
    sheet = oriented(pagePreset(preset.sheet.page), 'portrait');
    cells = labelCells(preset.sheet, item);
  } else {
    let best: { sheet: Size; cells: RepeatCell[] } | undefined;
    for (const choice of sheetChoices(options.page)) {
      const found = repeatCells(inset(pageBox(choice), margin), item, gap, options.rotate);
      if (!best || found.length > best.cells.length) best = { sheet: choice, cells: found };
    }
    sheet = best!.sheet;
    cells = best!.cells;
  }
  if (!cells.length)
    return {
      problem: 'The item is larger than the sheet. Choose a larger sheet or a smaller item.',
    };
  const copies = repeatCopies(pieces.length, cells.length, options.fill ? 'fill' : options.copies);
  const sequence = pieces.flatMap((piece, index) =>
    Array.from({ length: copies[index]! }, () => piece),
  );
  if (!sequence.length) return { problem: 'Choose at least one copy.' };
  const sheets = Math.ceil(sequence.length / cells.length);
  if (sheets > layoutLimits.pages) return { problem: 'Choose fewer copies.' };
  const sheetBox = pageBox(sheet);
  const pages: LayoutPage[] = [];
  for (let number = 0; number < sheets; number++) {
    const here = sequence.slice(number * cells.length, (number + 1) * cells.length);
    const used = cells.slice(0, here.length);
    const items = here.map((piece, index) => {
      const cell = used[index]!;
      const size = printedSize(piece);
      const across = (value: Size) => value.width > value.height * 1.02;
      const upright = (value: Size) => value.height > value.width * 1.02;
      // a label's design turns to the label; elsewhere it turns only with a cell turned to fit
      const rotate: Rotation = preset?.sheet
        ? (across(size) && upright(cell)) || (upright(size) && across(cell))
          ? 90
          : 0
        : cell.turned
          ? 90
          : 0;
      const shown = turned(size, rotate);
      return options.fit === 'fill'
        ? pieceItem(piece, cell, fillCrop(shown, cell), rotate)
        : pieceItem(piece, fitInside(shown, cell), wholeCrop, rotate);
    });
    if (options.marks === 'crop') items.push(...marks(cropMarks(used, sheetBox)));
    if (options.marks === 'lines') items.push(...marks(cutTicks(used, sheetBox)));
    pages.push(page(sheet, options.page, items));
  }
  const exact = options.fill ? '' : ` · ${plural(sequence.length, 'copy', 'copies')}`;
  return {
    pages,
    summary: `${cells.length} per sheet · ${plural(sheets, 'sheet')}${exact} · ${sizeName(sheet)}`,
    reason: `${cells.length} per sheet of ${sizeName(sheet)}`,
    score: cells.length,
    perSheet: cells.length,
  };
}

function posterDraft(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
): Draft | LayoutProblem {
  const options = settings.poster;
  const pieces = sourcePieces(sources);
  const piece = pieces[Math.min(Math.max(0, options.piece), pieces.length - 1)]!;
  const own = printedSize(piece);
  const poster =
    options.target === 'scale'
      ? { width: (own.width * options.scale) / 100, height: (own.height * options.scale) / 100 }
      : fitInside(own, { x: 0, y: 0, ...oriented(pagePreset(options.size), orientationOf(own)) });
  if (poster.width <= 0 || poster.height <= 0) return { problem: 'Choose a poster size.' };
  const { margin } = options.page;
  const tiling = posterTiling(poster, sheetChoices(options.page), margin, options.overlap);
  if (!tiling) return { problem: 'Choose a smaller margin or overlap.' };
  if (tiling.tiles.length > layoutLimits.pages)
    return {
      problem: `This poster needs more than ${layoutLimits.pages} sheets. Choose a smaller size.`,
    };
  const { sheet, columns, rows } = tiling;
  const pages = tiling.tiles.map((tile) => {
    const { window } = tile;
    const items: LayoutItem[] = [
      pieceItem(
        piece,
        { x: margin, y: margin, width: window.width, height: window.height },
        {
          x: window.x / poster.width,
          y: window.y / poster.height,
          width: window.width / poster.width,
          height: window.height / poster.height,
        },
      ),
    ];
    const room = margin - 2;
    if (options.labels && margin >= 9) {
      const size = Math.min(9, margin * 0.55);
      items.push(
        textItem(tile.label, margin, margin - 3, size, { weight: 'bold' }),
        textItem(`${columns} × ${rows} sheets`, sheet.width - margin, margin - 3, size * 0.85, {
          align: 'end',
          color: '#555555',
        }),
      );
    }
    if (options.marks && room >= 4) {
      const right = margin + window.width;
      const bottom = margin + window.height;
      const trims: Segment[] = [];
      const glue: Segment[] = [];
      // a sheet after the first is trimmed at its picture's edge and laid over the overlap
      if (tile.column > 0)
        trims.push([margin, 2, margin, room], [margin, bottom + 2, margin, sheet.height - 2]);
      if (tile.row > 0)
        trims.push([2, margin, room, margin], [right + 2, margin, sheet.width - 2, margin]);
      if (tile.column < columns - 1) {
        const x = right - options.overlap;
        glue.push([x, 2, x, room], [x, bottom + 2, x, sheet.height - 2]);
      }
      if (tile.row < rows - 1) {
        const y = bottom - options.overlap;
        glue.push([2, y, room, y], [right + 2, y, sheet.width - 2, y]);
      }
      items.push(
        ...marks(trims),
        ...glue.map((segment) => segmentItem(segment, { stroke: guideColor, dash: [2, 2] })),
      );
    }
    return page(sheet, options.page, items);
  });
  const dimensions = `${Math.round(toMillimetres(poster.width))} × ${Math.round(toMillimetres(poster.height))} mm`;
  return {
    pages,
    summary: `${plural(pages.length, 'sheet')} of ${sizeName(sheet)} (${columns} × ${rows}) · poster ${dimensions}`,
    reason: `${plural(pages.length, 'sheet')}, poster ${dimensions}`,
    score: -pages.length,
    note:
      pages.length > 1
        ? 'Trim each sheet after the first at the solid marks, then glue it over the dashed overlap of its neighbour, starting from A1.'
        : undefined,
  };
}
