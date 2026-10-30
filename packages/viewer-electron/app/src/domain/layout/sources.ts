import type { Size } from './geometry';
import { cameraRawFormats } from '../previews/images/rendered';

/** A photo as it is displayed, after its EXIF orientation. */
export interface ImageSource {
  kind: 'image';
  path: string;
  name: string;
  /** Pixels. */
  width: number;
  height: number;
  /** Whether `width` and `height` are the file's own pixels, not only its proportions. */
  measured: boolean;
  /** The date a caption shows. */
  date?: string;
}
export interface PDFSource {
  kind: 'pdf';
  path: string;
  name: string;
  /** Each page's size in points, as displayed. */
  pages: Size[];
}
export type LayoutSource = ImageSource | PDFSource;
export type LayoutSourceKind = LayoutSource['kind'];

/** One picture the planner places: a photo, or one page of a PDF. */
export interface LayoutPiece {
  source: number;
  /** A PDF page, from 1. */
  page?: number;
  /** Points for a page; pixels for a photo. */
  width: number;
  height: number;
}

/** The writer's limits on sources: each file, and a layout's PDFs together. */
export const sourceLimits = { each: 256_000_000, pdfs: 512_000_000 } as const;

/** The resolution at which a photo is "its own size". */
export const photoDPI = 300;

export function sourcePieces(sources: readonly LayoutSource[]): LayoutPiece[] {
  return sources.flatMap((source, index): LayoutPiece[] =>
    source.kind === 'image'
      ? [{ source: index, width: source.width, height: source.height }]
      : source.pages.map((page, number) => ({ source: index, page: number + 1, ...page })),
  );
}
/** A piece's printed size in points: a page's own, a photo's at `photoDPI`. */
export const printedSize = (piece: LayoutPiece): Size =>
  piece.page
    ? { width: piece.width, height: piece.height }
    : { width: (piece.width * 72) / photoDPI, height: (piece.height * 72) / photoDPI };

/** The pictures the layout writer draws: its own raster formats, those the system decoder reads,
 * and camera RAW. */
const imageExtensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'tif',
  'tiff',
  'heic',
  'heif',
  'gif',
  'bmp',
  'webp',
  'avif',
  ...cameraRawFormats,
]);
export type LayoutFileKind = LayoutSourceKind | 'drawing';
/** What the Layout plane does with a file, by its extension. */
export function layoutFileKind(entry: {
  directory: boolean;
  extension: string;
}): LayoutFileKind | undefined {
  if (entry.directory) return undefined;
  const extension = entry.extension.toLowerCase();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'dxf') return 'drawing';
  return imageExtensions.has(extension) ? 'image' : undefined;
}
