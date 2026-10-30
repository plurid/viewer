/** What a person chooses in the Layout plane, for each mode. Lengths are points. */
import { millimetres } from './plan';
import type { LayoutFormat } from './plan';
import type { LayoutMode } from './modes';
import type { CropAnchor } from './geometry';
import type { CollageDirection, CollageFit, CollageStyle } from './collage';
import type { NUpCount, ReadingOrder } from './n-up';
import type { ItemSizeID, PageOrientation, PagePresetID, PageSizeID } from './pages';

/** The modes this planner lays out; nesting has its own panel. */
export type PlannedMode = Exclude<LayoutMode, 'nesting'>;
export interface PageSetup {
  size: PageSizeID;
  orientation: PageOrientation;
  margin: number;
  gap: number;
  /** `#rrggbb`, or empty for none: transparent in a PNG, the paper elsewhere. */
  background: string;
}
interface ModeBase {
  page: PageSetup;
  format: LayoutFormat;
}
export interface CollageSettings extends ModeBase {
  style: CollageStyle;
  fit: CollageFit;
  anchor: CropAnchor;
  direction: CollageDirection;
  feature: number | 'auto';
}
export interface ContactSheetSettings extends ModeBase {
  columns: number | 'auto';
  date: boolean;
  dimensions: boolean;
  title: boolean;
}
export interface NUpSettings extends ModeBase {
  perSheet: NUpCount;
  order: ReadingOrder;
  cropMarks: boolean;
  frames: boolean;
  /** Bleed included in the source pages, cut away at the crop marks. */
  bleed: number;
}
export interface BookletSettings extends ModeBase {
  /** How far each sheet inward from the outside moves its pages toward the fold. */
  creep: number;
}
export type CutMarks = 'none' | 'crop' | 'lines';
export interface StepRepeatSettings extends ModeBase {
  item: ItemSizeID;
  /** A custom item's size. */
  width: number;
  height: number;
  /** As many as one sheet holds, or `copies` of each. */
  fill: boolean;
  copies: number[];
  marks: CutMarks;
  fit: CollageFit;
  rotate: boolean;
}
export type PosterTarget = 'scale' | 'size';
export interface PosterSettings extends ModeBase {
  target: PosterTarget;
  /** Percent of the picture's own size. */
  scale: number;
  size: PagePresetID;
  /** Which picture: an index into the selection's photos and pages. */
  piece: number;
  overlap: number;
  labels: boolean;
  marks: boolean;
}
export interface LayoutSettings {
  mode: LayoutMode;
  /** A raster output's resolution on paper; a PDF's most image pixels per inch. */
  dpi: number;
  quality: number;
  collage: CollageSettings;
  'contact-sheet': ContactSheetSettings;
  'n-up': NUpSettings;
  booklet: BookletSettings;
  'step-repeat': StepRepeatSettings;
  poster: PosterSettings;
}
export type ModeSettings = LayoutSettings[PlannedMode];

const mm = millimetres;
const white = '#ffffff';
export function defaultLayoutSettings(): LayoutSettings {
  return {
    mode: 'collage',
    dpi: 300,
    quality: 90,
    collage: {
      page: { size: 'fit', orientation: 'auto', margin: mm(6), gap: mm(3), background: white },
      format: 'jpeg',
      style: 'justified',
      fit: 'fill',
      anchor: 'center',
      direction: 'auto',
      feature: 'auto',
    },
    'contact-sheet': {
      page: { size: 'a4', orientation: 'portrait', margin: mm(12), gap: mm(4), background: white },
      format: 'pdf',
      columns: 'auto',
      date: true,
      dimensions: false,
      title: true,
    },
    'n-up': {
      page: { size: 'a4', orientation: 'auto', margin: mm(5), gap: mm(5), background: white },
      format: 'pdf',
      perSheet: 2,
      order: 'rows',
      cropMarks: false,
      frames: false,
      bleed: 0,
    },
    booklet: {
      page: { size: 'a4', orientation: 'auto', margin: mm(5), gap: 0, background: white },
      format: 'pdf',
      creep: 0,
    },
    'step-repeat': {
      page: { size: 'a4', orientation: 'portrait', margin: mm(10), gap: 0, background: white },
      format: 'pdf',
      item: 'business-card',
      width: mm(85),
      height: mm(55),
      fill: true,
      copies: [],
      marks: 'lines',
      fit: 'fill',
      rotate: true,
    },
    poster: {
      page: { size: 'a4', orientation: 'auto', margin: mm(6), gap: 0, background: white },
      format: 'pdf',
      target: 'scale',
      scale: 100,
      size: 'a2',
      piece: 0,
      overlap: mm(10),
      labels: true,
      marks: true,
    },
  };
}

export const isPlannedMode = (mode: LayoutMode): mode is PlannedMode => mode !== 'nesting';
/** Settings with a change to one mode's choices. */
export function changeMode<Mode extends PlannedMode>(
  settings: LayoutSettings,
  mode: Mode,
  change: Partial<LayoutSettings[Mode]>,
): LayoutSettings {
  return { ...settings, [mode]: { ...settings[mode], ...change } };
}
export function changePage(
  settings: LayoutSettings,
  mode: PlannedMode,
  change: Partial<PageSetup>,
): LayoutSettings {
  return changeMode(settings, mode, { page: { ...settings[mode].page, ...change } });
}
