import type { CSSProperties } from 'react';
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';
import {
  darkPageMatrix,
  readsAsPaper,
  type PageColors,
} from '../../../domain/previews/documents/dark-pages';

/**
 * DARK PAGES ON A CANVAS. pdf.js 6 has its own `pageColors`, but it turns the whole canvas into
 * shades between two colours once drawn, so a photograph becomes a grey negative and coloured text
 * loses its colour. Viewer lets pdf.js draw the printed page, turns it dark with one colour matrix
 * (`darkPageMatrix`) and puts back the photographs pdf.js recorded, as they were.
 */

const svgNS = 'http://www.w3.org/2000/svg';
let definitions: SVGDefsElement | undefined;
const filters = new Map<string, string>();

/**
 * The SVG filter that turns a printed page dark, as a CSS or canvas `filter` takes it: one for
 * each set of colours, kept in the document as pdf.js keeps its own. It is hidden, not
 * `display: none`, which leaves a filter unresolved.
 */
export function darkPageFilter(colors: PageColors): string {
  if (!definitions?.isConnected) {
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    Object.assign(holder.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      visibility: 'hidden',
      contain: 'strict',
      zIndex: '-1',
    });
    const root = document.createElementNS(svgNS, 'svg');
    root.setAttribute('width', '0');
    root.setAttribute('height', '0');
    definitions = document.createElementNS(svgNS, 'defs');
    root.append(definitions);
    holder.append(root);
    document.body.append(holder);
    filters.clear();
  }
  const key = colors.page + colors.ink;
  const known = filters.get(key);
  if (known) return known;
  const id = `viewer-dark-page-${filters.size + 1}`;
  const filter = document.createElementNS(svgNS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const matrix = document.createElementNS(svgNS, 'feColorMatrix');
  matrix.setAttribute('type', 'matrix');
  matrix.setAttribute('values', darkPageMatrix(colors).join(' '));
  filter.append(matrix);
  definitions.append(filter);
  const reference = `url(#${id})`;
  filters.set(key, reference);
  return reference;
}

/** A dark sheet's own colours: the page beneath its canvas, and the accent its outlines, marks
 * and selection draw in, which reads on the page whatever the window's look. */
export function darkSheetStyle(colors: PageColors): CSSProperties {
  return { '--page': colors.page, '--accent': colors.accent } as CSSProperties;
}

type Point = [number, number];

interface Picture {
  corners: Point[];
  left: number;
  top: number;
  width: number;
  height: number;
}

/** At most this many of a page's pictures, the largest, are looked at; the rest darken with it. */
const pictureLimit = 64;
/** The longest side a picture is sampled at, to tell a photograph from paper. */
const sampleSide = 48;

/** The pictures pdf.js recorded: three corners of each, as fractions of the canvas. */
function pictures(paper: HTMLCanvasElement, coordinates: ArrayLike<number>): Picture[] {
  const found: Picture[] = [];
  for (let index = 0; index + 5 < coordinates.length; index += 6) {
    const [x0, y0, x1, y1, x2, y2] = Array.from(
      { length: 6 },
      (_, offset) => coordinates[index + offset]! * (offset % 2 ? paper.height : paper.width),
    ) as [number, number, number, number, number, number];
    const corners: Point[] = [
      [x0, y0],
      [x1, y1],
      [x1 + x2 - x0, y1 + y2 - y0],
      [x2, y2],
    ];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const right = Math.min(paper.width, Math.ceil(Math.max(...xs)));
    const bottom = Math.min(paper.height, Math.ceil(Math.max(...ys)));
    if (right - left >= 2 && bottom - top >= 2)
      found.push({ corners, left, top, width: right - left, height: bottom - top });
  }
  return found
    .sort((one, other) => other.width * other.height - one.width * one.height)
    .slice(0, pictureLimit);
}

/** Whether a picture reads as paper, a scan or a drawing on white, from a small sample of it. A
 * picture that cannot be read keeps its colours. */
function paperPicture(paper: HTMLCanvasElement, picture: Picture): boolean {
  const scale = Math.min(1, sampleSide / Math.max(picture.width, picture.height));
  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.round(picture.width * scale));
  sample.height = Math.max(1, Math.round(picture.height * scale));
  const context = sample.getContext('2d', { willReadFrequently: true });
  try {
    if (!context) return false;
    context.drawImage(
      paper,
      picture.left,
      picture.top,
      picture.width,
      picture.height,
      0,
      0,
      sample.width,
      sample.height,
    );
    return readsAsPaper(context.getImageData(0, 0, sample.width, sample.height).data);
  } catch {
    return false;
  } finally {
    sample.width = sample.height = 0;
  }
}

/**
 * Turns `paper`, a page pdf.js drew, dark in place. The photographs among `images`, the
 * coordinates pdf.js recorded, keep their colours; a picture that reads as paper darkens with the
 * page, where it would otherwise glare.
 */
export function darkenPage(
  paper: HTMLCanvasElement,
  colors: PageColors,
  images?: ArrayLike<number> | null,
): void {
  const context = paper.getContext('2d');
  if (!context) return;
  const kept = (images?.length ? pictures(paper, images) : []).flatMap((picture) => {
    if (paperPicture(paper, picture)) return [];
    const copy = document.createElement('canvas');
    copy.width = picture.width;
    copy.height = picture.height;
    const target = copy.getContext('2d');
    if (!target) return [];
    target.drawImage(
      paper,
      picture.left,
      picture.top,
      picture.width,
      picture.height,
      0,
      0,
      picture.width,
      picture.height,
    );
    return [{ picture, copy }];
  });
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = darkPageFilter(colors);
  context.drawImage(paper, 0, 0);
  context.filter = 'none';
  for (const { picture, copy } of kept) {
    context.save();
    context.beginPath();
    picture.corners.forEach(([x, y], index) =>
      index ? context.lineTo(x, y) : context.moveTo(x, y),
    );
    context.closePath();
    context.clip();
    context.drawImage(copy, picture.left, picture.top);
    context.restore();
    copy.width = copy.height = 0;
  }
  context.restore();
}

export interface PageDrawing {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * Draws `sheet` onto `canvas`, already sized, as `sheet.render` does. A dark page is drawn off
 * screen and shown once it is dark: pdf.js paints in steps, and the printed page would flash white
 * between them. pdf.js records where a page's pictures are on its first dark drawing.
 */
export function drawPage(
  sheet: PDFPageProxy,
  canvas: HTMLCanvasElement,
  parameters: { viewport: PageViewport; transform: number[] },
  dark: PageColors | undefined,
): PageDrawing {
  if (!dark) {
    const task = sheet.render({ canvas, ...parameters });
    return { promise: task.promise, cancel: () => task.cancel() };
  }
  const paper = document.createElement('canvas');
  paper.width = canvas.width;
  paper.height = canvas.height;
  const task = sheet.render({ canvas: paper, ...parameters, recordImages: true });
  let cancelled = false;
  const promise = task.promise
    .then(() => {
      if (cancelled) return;
      darkenPage(paper, dark, sheet.imageCoordinates);
      canvas.getContext('2d')?.drawImage(paper, 0, 0);
    })
    .finally(() => {
      paper.width = paper.height = 0;
    });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task.cancel();
    },
  };
}
