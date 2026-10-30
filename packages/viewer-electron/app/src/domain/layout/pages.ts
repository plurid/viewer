import { millimetres } from './plan';
import type { Size } from './geometry';

const inches = (value: number) => value * 72;
const mm = millimetres;

export type PageGroup = 'paper' | 'photo' | 'screen';
export interface PagePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: PageGroup;
}
/** Sheet and print sizes in points. A screen size is in pixels: it is drawn at 72 dpi, one point
 * to a pixel. */
export const pagePresets = [
  { id: 'a4', label: 'A4', width: mm(210), height: mm(297), group: 'paper' },
  { id: 'a3', label: 'A3', width: mm(297), height: mm(420), group: 'paper' },
  { id: 'a5', label: 'A5', width: mm(148), height: mm(210), group: 'paper' },
  { id: 'a6', label: 'A6', width: mm(105), height: mm(148), group: 'paper' },
  { id: 'letter', label: 'Letter', width: inches(8.5), height: inches(11), group: 'paper' },
  { id: 'legal', label: 'Legal', width: inches(8.5), height: inches(14), group: 'paper' },
  { id: 'tabloid', label: 'Tabloid', width: inches(11), height: inches(17), group: 'paper' },
  { id: 'a2', label: 'A2', width: mm(420), height: mm(594), group: 'paper' },
  { id: 'a1', label: 'A1', width: mm(594), height: mm(841), group: 'paper' },
  { id: 'a0', label: 'A0', width: mm(841), height: mm(1189), group: 'paper' },
  { id: 'photo-10x15', label: '10 × 15 cm', width: mm(100), height: mm(150), group: 'photo' },
  { id: 'photo-13x18', label: '13 × 18 cm', width: mm(130), height: mm(180), group: 'photo' },
  { id: 'photo-4x6', label: '4 × 6 in', width: inches(4), height: inches(6), group: 'photo' },
  { id: 'photo-5x7', label: '5 × 7 in', width: inches(5), height: inches(7), group: 'photo' },
  { id: 'photo-8x10', label: '8 × 10 in', width: inches(8), height: inches(10), group: 'photo' },
  { id: 'square', label: 'Square 20 cm', width: mm(200), height: mm(200), group: 'photo' },
  { id: 'px-1080', label: '1080 × 1080 px', width: 1080, height: 1080, group: 'screen' },
  { id: 'px-1080x1350', label: '1080 × 1350 px', width: 1080, height: 1350, group: 'screen' },
  { id: 'px-1920x1080', label: '1920 × 1080 px', width: 1920, height: 1080, group: 'screen' },
  { id: 'px-3840x2160', label: '3840 × 2160 px', width: 3840, height: 2160, group: 'screen' },
] as const satisfies readonly PagePreset[];
export type PagePresetID = (typeof pagePresets)[number]['id'];
/** `fit`: a collage page shaped to its photos. */
export type PageSizeID = PagePresetID | 'fit';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';

export const pagePreset = (id: PagePresetID): PagePreset =>
  pagePresets.find((preset) => preset.id === id)!;
export const isScreenSize = (id: PageSizeID) => id !== 'fit' && pagePreset(id).group === 'screen';
export const pageLabel = (id: PageSizeID) =>
  id === 'fit' ? 'Fit the photos' : pagePreset(id).label;

export function oriented(size: Size, orientation: Exclude<PageOrientation, 'auto'>): Size {
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  return orientation === 'portrait'
    ? { width: short, height: long }
    : { width: long, height: short };
}
/** The sheets a layout tries: both orientations when the choice is automatic, portrait first. */
export function pageChoices(id: PagePresetID, orientation: PageOrientation): Size[] {
  const preset = pagePreset(id);
  if (orientation !== 'auto') return [oriented(preset, orientation)];
  if (preset.width === preset.height) return [{ width: preset.width, height: preset.height }];
  // a screen size keeps its own shape first: 1920 × 1080 is landscape
  const natural = preset.width > preset.height ? 'landscape' : 'portrait';
  const first = preset.group === 'screen' ? natural : 'portrait';
  return [
    oriented(preset, first),
    oriented(preset, first === 'portrait' ? 'landscape' : 'portrait'),
  ];
}
export const orientationOf = (size: Size): Exclude<PageOrientation, 'auto'> =>
  size.width > size.height ? 'landscape' : 'portrait';

/** The preset of a size, either way round, within a point. */
export const presetOf = (size: Size): PagePreset | undefined =>
  pagePresets.find(
    (item) =>
      (Math.abs(item.width - size.width) < 1 && Math.abs(item.height - size.height) < 1) ||
      (Math.abs(item.width - size.height) < 1 && Math.abs(item.height - size.width) < 1),
  );
/** A size by name, when it has one: "A4 landscape"; otherwise in millimetres. */
export function sizeName(size: Size): string {
  const preset = presetOf(size);
  if (preset?.group === 'screen')
    return `${Math.round(size.width)} × ${Math.round(size.height)} px`;
  if (preset)
    return preset.width === preset.height ? preset.label : `${preset.label} ${orientationOf(size)}`;
  return `${Math.round(size.width / mm(1))} × ${Math.round(size.height / mm(1))} mm`;
}

/** Item sizes for step and repeat. A label sheet places its labels where its maker printed them. */
export interface ItemPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  sheet?: LabelSheet;
}
export interface LabelSheet {
  page: PagePresetID;
  columns: number;
  rows: number;
  left: number;
  top: number;
  /** From one label's edge to the next one's. */
  pitchX: number;
  pitchY: number;
}
export const itemPresets = [
  { id: 'business-card', label: 'Business card 85 × 55 mm', width: mm(85), height: mm(55) },
  {
    id: 'business-card-us',
    label: 'Business card 3.5 × 2 in',
    width: inches(3.5),
    height: inches(2),
  },
  { id: 'passport', label: 'Passport photo 35 × 45 mm', width: mm(35), height: mm(45) },
  { id: 'passport-us', label: 'Passport photo 2 × 2 in', width: inches(2), height: inches(2) },
  { id: 'photo-10x15', label: 'Print 10 × 15 cm', width: mm(100), height: mm(150) },
  { id: 'photo-9x13', label: 'Print 9 × 13 cm', width: mm(90), height: mm(130) },
  { id: 'photo-4x6', label: 'Print 4 × 6 in', width: inches(4), height: inches(6) },
  {
    id: 'label-21',
    label: 'Labels 63.5 × 38.1 mm, 21 per A4',
    width: mm(63.5),
    height: mm(38.1),
    sheet: {
      page: 'a4',
      columns: 3,
      rows: 7,
      left: mm(7.25),
      top: mm(15.15),
      pitchX: mm(66),
      pitchY: mm(38.1),
    },
  },
  {
    id: 'label-14',
    label: 'Labels 99.1 × 38.1 mm, 14 per A4',
    width: mm(99.1),
    height: mm(38.1),
    sheet: {
      page: 'a4',
      columns: 2,
      rows: 7,
      left: mm(4.65),
      top: mm(15.15),
      pitchX: mm(101.6),
      pitchY: mm(38.1),
    },
  },
  {
    id: 'label-65',
    label: 'Labels 38.1 × 21.2 mm, 65 per A4',
    width: mm(38.1),
    height: mm(21.2),
    sheet: {
      page: 'a4',
      columns: 5,
      rows: 13,
      left: mm(4.75),
      top: mm(10.7),
      pitchX: mm(40.6),
      pitchY: mm(21.2),
    },
  },
  {
    id: 'label-30',
    label: 'Labels 2.625 × 1 in, 30 per Letter',
    width: inches(2.625),
    height: inches(1),
    sheet: {
      page: 'letter',
      columns: 3,
      rows: 10,
      left: inches(0.1875),
      top: inches(0.5),
      pitchX: inches(2.75),
      pitchY: inches(1),
    },
  },
] as const satisfies readonly ItemPreset[];
export type ItemPresetID = (typeof itemPresets)[number]['id'];
/** `original`: each picture at its own size; `custom`: the width and height given. */
export type ItemSizeID = ItemPresetID | 'original' | 'custom';
export const itemPreset = (id: ItemPresetID): ItemPreset =>
  itemPresets.find((preset) => preset.id === id)!;
