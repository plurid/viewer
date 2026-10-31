import type { Look } from '../../contracts';
import { builtInTheme, type Theme } from '../../preferences/themes';

/**
 * DARK PAGES: PDF and Office previews draw a printed page dark, with light ink, for reading at
 * night. Only the view changes: printing, exports and the file keep the page's own colours.
 */
export const darkPageModes = ['off', 'on', 'night', 'system'] as const;
export type DarkPageMode = (typeof darkPageModes)[number];
/** A mode that switches by itself: with the time of day, or with macOS dark mode. */
export type AutomaticDarkPages = Extract<DarkPageMode, 'night' | 'system'>;
/** The choice the Dark pages button makes. */
export type ManualDarkPages = Extract<DarkPageMode, 'on' | 'off'>;

export interface DarkPageSettings {
  darkPages: DarkPageMode;
  /** When night begins, a 24-hour local time. */
  darkPagesFrom: string;
  /** When night ends; before `darkPagesFrom`, the night passes midnight. */
  darkPagesUntil: string;
}

export const darkPageDefaults: DarkPageSettings = {
  darkPages: 'off',
  darkPagesFrom: '20:00',
  darkPagesUntil: '07:00',
};

/** A 24-hour time of day, `HH:MM`. */
export const clockTime = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes after midnight of an `HH:MM` time. */
function minutes(time: string): number {
  const [hours = 0, rest = 0] = time.split(':').map(Number);
  return hours * 60 + rest;
}

/**
 * Whether `now` is at night, in local time. The night begins at `from` and ends at `until`, so
 * 20:00 is night and 07:00 is not; it passes midnight when `until` is earlier. The same time twice
 * is no night.
 */
export function atNight(now: Date, from: string, until: string): boolean {
  const start = minutes(from);
  const end = minutes(until);
  const at = now.getHours() * 60 + now.getMinutes();
  return start <= end ? at >= start && at < end : at >= start || at < end;
}

/** The next moment after `now` when the night begins or ends. */
export function nextNightChange(now: Date, from: string, until: string): Date {
  const next = (time: string) => {
    const value = minutes(time);
    const at = new Date(now);
    at.setHours(Math.floor(value / 60), value % 60, 0, 0);
    if (at <= now) {
      // a day later at the same local time, which a daylight-saving change makes 23 or 25 hours
      at.setDate(at.getDate() + 1);
      at.setHours(Math.floor(value / 60), value % 60, 0, 0);
    }
    return at;
  };
  const begins = next(from);
  const ends = next(until);
  return begins < ends ? begins : ends;
}

/** Whether page previews draw dark pages now. `systemLook` is macOS's own appearance. */
export function pagesDark(
  settings: Partial<DarkPageSettings>,
  now: Date,
  systemLook: Look,
): boolean {
  const mode = settings.darkPages ?? darkPageDefaults.darkPages;
  if (mode === 'on') return true;
  if (mode === 'system') return systemLook === 'dark';
  if (mode === 'night')
    return atNight(
      now,
      settings.darkPagesFrom ?? darkPageDefaults.darkPagesFrom,
      settings.darkPagesUntil ?? darkPageDefaults.darkPagesUntil,
    );
  return false;
}

export interface DarkPagesToggle {
  mode: ManualDarkPages;
  /** The automatic mode the button replaced, which the person is told how to choose again. */
  replaced?: AutomaticDarkPages;
}

/** What the Dark pages button sets: the other way from how pages are now, kept from then on. */
export function toggledDarkPages(mode: DarkPageMode, dark: boolean): DarkPagesToggle {
  const next: ManualDarkPages = dark ? 'off' : 'on';
  return mode === 'night' || mode === 'system' ? { mode: next, replaced: mode } : { mode: next };
}

/** The note shown once when the button replaced an automatic mode. */
export function darkPagesNote(toggle: Required<DarkPagesToggle>): string {
  const kept = `Dark pages stay ${toggle.mode}.`;
  return toggle.replaced === 'night'
    ? `${kept} Choose At night in Settings → Previews to switch with the time.`
    : `${kept} Choose With macOS dark mode in Settings → Previews to follow macOS.`;
}

/** A dark page's colours, each `#rrggbb`. */
export interface PageColors {
  page: string;
  ink: string;
  /** Outlines, marks and selections on the page. */
  accent: string;
}

type RGB = [number, number, number];

function rgb(color: string | undefined): RGB | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(color ?? '');
  return match
    ? ([match[1]!, match[2]!, match[3]!].map((part) => parseInt(part, 16)) as RGB)
    : undefined;
}

function luminance([red, green, blue]: RGB): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The WCAG contrast ratio of two colours, from 1 to 21. */
export function contrast(first: string, second: string): number {
  const one = rgb(first);
  const two = rgb(second);
  if (!one || !two) return 1;
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

const hex = (color: string) => color.slice(0, 7).toLowerCase();

/** Whether a colour is dark enough to read a page on at night. */
function darkEnough(color: string): boolean {
  const value = rgb(color);
  return !!value && luminance(value) < 0.1;
}

/**
 * The dark page from the dark theme: its surface is the page, its ink the text and its accent the
 * outlines, so a page reads as the rest of Viewer does at night. A theme whose surface is not dark,
 * or whose ink would not read clearly on it, gives the built-in colours; an accent that would not
 * show on the page gives the built-in one.
 */
export function darkPageColors(theme: Theme): PageColors {
  const base = builtInTheme('dark').shell;
  const { surface = '', ink = '' } = theme.shell;
  const own = darkEnough(surface) && contrast(surface, ink) >= 7;
  const page = hex(own ? surface : base.surface!);
  const text = hex(own ? ink : base.ink!);
  const accent = [theme.shell.accent, base.accent].find(
    (color): color is string => !!color && contrast(color, page) >= 3,
  );
  return { page, ink: text, accent: accent ? hex(accent) : text };
}

/** `hue-rotate(180deg)` as the Filter Effects specification writes it: a colour's hue turned over,
 * its greys kept. */
const hueTurned: readonly RGB[] = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

/**
 * The colour matrix that turns a printed page dark: an SVG `feColorMatrix`'s 20 values, on sRGB
 * channels from 0 to 1. White paper becomes `page` and black ink `ink`; a colour keeps its hue
 * with its lightness turned over, as `invert(1) hue-rotate(180deg)` does, between the two. That
 * is `ink - (ink - page) × hue-turned(colour)` for each channel, in one step, with no clamping
 * between.
 */
export function darkPageMatrix(colors: PageColors): number[] {
  const page = rgb(colors.page)!.map((value) => value / 255);
  const ink = rgb(colors.ink)!.map((value) => value / 255);
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return [
    ...hueTurned.flatMap((row, channel) => {
      const span = ink[channel]! - page[channel]!;
      return [...row.map((weight) => round(-span * weight)), 0, round(ink[channel]!)];
    }),
    ...[0, 0, 0, 1, 0],
  ];
}

/** Applies `matrix` to an sRGB colour from 0 to 255, as the filter does. */
export function applyPageMatrix(matrix: readonly number[], [red, green, blue]: RGB): RGB {
  const input = [red / 255, green / 255, blue / 255, 1];
  return [0, 1, 2].map((row) => {
    const value = input.reduce(
      (sum, channel, index) => sum + channel * matrix[row * 5 + index]!,
      0,
    );
    return Math.round(Math.min(1, Math.max(0, value + matrix[row * 5 + 4]!)) * 255);
  }) as RGB;
}

/**
 * Whether a picture on a page reads as paper: mostly light, with little colour, as a scanned page,
 * an old book's yellowed scan or a chart on white does. It turns dark with the page, where it
 * would otherwise glare; a photograph keeps its colours. `pixels` are RGBA, as a canvas gives
 * them; transparent ones are not counted.
 */
export function readsAsPaper(pixels: ArrayLike<number>): boolean {
  let counted = 0;
  let light = 0;
  let colour = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue;
    const red = pixels[index]!;
    const green = pixels[index + 1]!;
    const blue = pixels[index + 2]!;
    counted += 1;
    if (0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.8 * 255) light += 1;
    colour += (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
  }
  return counted > 0 && light / counted >= 0.5 && colour / counted < 0.2;
}
