/**
 * Which layout a selection asks for. Photos make a collage, or a contact sheet when there are many;
 * one photo makes prints, or a poster when it is large. PDFs go by their page size: small pages
 * print several to a sheet, card-sized ones repeat, large ones tile, and four pages or more can
 * fold into a booklet. DXF parts nest. A mixed selection follows its largest kind.
 */
import { millimetres } from './plan';
import type { Size } from './geometry';
import type { LayoutMode } from './modes';
import { nUpArrangement } from './n-up';
import type { NUpCount } from './n-up';
import { pageChoices, presetOf } from './pages';
import { collageLimit } from './collage';
import { changeMode, defaultLayoutSettings } from './settings';
import type { LayoutSettings } from './settings';
import type { LayoutSource } from './sources';

export interface LayoutSelection {
  sources: readonly LayoutSource[];
  /** DXF parts, which nesting lays out. */
  drawings: number;
}
export interface ModeSuggestion {
  mode: LayoutMode;
  /** Why, in a few words: "3 photos on one page". */
  reason: string;
}
export interface LayoutSuggestion {
  /** Best first. */
  modes: ModeSuggestion[];
  /** Defaults that suit these files, for every mode. */
  settings: LayoutSettings;
}

export type PageClass = 'card' | 'small' | 'document' | 'large';
const mm = millimetres;
/** Cards and tickets; A5 and half-letter or smaller; A2 and larger; everything between. */
export function pageClass(size: Size): PageClass {
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  if (long <= mm(110) && short <= mm(80)) return 'card';
  if (long <= mm(217)) return 'small';
  if (long >= mm(594) * 0.97) return 'large';
  return 'document';
}
/** A photo with this many pixels on its long edge prints well past A3. */
export const posterPixels = 3000;

const plural = (count: number, one: string, many = one + 's') =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** The most pages of `page` an A4 sheet holds at nine tenths of their size or more. */
export function pagesPerSheet(page: Size, margin: number, gap: number): NUpCount {
  let chosen: NUpCount = 2;
  for (const count of [2, 4, 8, 16] as const)
    if (nUpArrangement(count, page, pageChoices('a4', 'auto'), margin, gap).scale >= 0.9)
      chosen = count;
  return chosen;
}

export function suggestLayout(
  selection: LayoutSelection,
  base: LayoutSettings = defaultLayoutSettings(),
): LayoutSuggestion {
  let settings = base;
  const images = selection.sources.filter((source) => source.kind === 'image');
  const pages = selection.sources.flatMap((source) => (source.kind === 'pdf' ? source.pages : []));
  const photoModes = (): ModeSuggestion[] => {
    const count = images.length;
    if (!count) return [];
    if (count === 1) {
      const [photo] = images;
      const large = photo!.measured && Math.max(photo!.width, photo!.height) >= posterPixels;
      settings = changeMode(settings, 'step-repeat', {
        item: 'photo-10x15',
        fit: 'fill',
        page: { ...settings['step-repeat'].page, margin: mm(5) },
      });
      settings = changeMode(settings, 'poster', {
        target: 'size',
        size: photo!.width * photo!.height > 24e6 ? 'a1' : 'a2',
      });
      return [
        { mode: 'step-repeat', reason: 'Prints of one photo' },
        ...(large ? [{ mode: 'poster' as const, reason: 'Large enough for a poster' }] : []),
      ];
    }
    const collage: ModeSuggestion = {
      mode: 'collage',
      reason: `${plural(count, 'photo')} on one page`,
    };
    const sheet: ModeSuggestion = {
      mode: 'contact-sheet',
      reason: `${plural(count, 'photo')} with their names`,
    };
    if (count <= 9) return [collage, sheet];
    return count <= collageLimit ? [sheet, collage] : [sheet];
  };
  const documentModes = (): ModeSuggestion[] => {
    if (!pages.length) return [];
    const classes = pages.map(pageClass);
    const counts = new Map<PageClass, number>();
    for (const value of classes) counts.set(value, (counts.get(value) ?? 0) + 1);
    const kind = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const first = pages[classes.indexOf(kind)]!;
    const booklet: ModeSuggestion[] =
      pages.length >= 4
        ? [{ mode: 'booklet', reason: `${plural(pages.length, 'page')} fold into a booklet` }]
        : [];
    const sheet: ModeSuggestion[] =
      pages.length >= 2 ? [{ mode: 'contact-sheet', reason: 'Every page on a sheet' }] : [];
    switch (kind) {
      case 'card':
        settings = changeMode(settings, 'step-repeat', {
          item: 'original',
          fit: 'fit',
          marks: 'lines',
          page: { ...settings['step-repeat'].page, gap: 0 },
        });
        return [
          { mode: 'step-repeat', reason: 'Card-sized pages repeat on a sheet' },
          { mode: 'n-up', reason: 'Several pages to a sheet' },
          ...sheet,
        ];
      case 'small': {
        const page = settings['n-up'].page;
        const perSheet = pagesPerSheet(first, page.margin, page.gap);
        settings = changeMode(settings, 'n-up', { perSheet });
        return [
          {
            mode: 'n-up',
            reason: `${presetOf(first)?.label ?? 'Small'} pages print ${perSheet} on A4`,
          },
          ...booklet,
          ...sheet,
        ];
      }
      case 'large':
        settings = changeMode(settings, 'poster', { target: 'scale', scale: 100 });
        return [
          { mode: 'poster', reason: `${presetOf(first)?.label ?? 'Large'} page tiles onto A4` },
          { mode: 'n-up', reason: 'Scaled onto A4 sheets' },
          ...sheet,
        ];
      case 'document':
        if (pages.length === 1) {
          settings = changeMode(settings, 'poster', { target: 'size', size: 'a2' });
          return [
            { mode: 'poster', reason: 'Enlarged across A4 sheets' },
            { mode: 'step-repeat', reason: 'Copies on a sheet' },
          ];
        }
        return [{ mode: 'n-up', reason: '2 pages to a sheet' }, ...booklet, ...sheet];
    }
  };
  const nesting: ModeSuggestion[] = selection.drawings
    ? [{ mode: 'nesting', reason: `${plural(selection.drawings, 'DXF part')} to nest` }]
    : [];
  const kinds = [
    { count: images.length, modes: photoModes() },
    { count: selection.sources.length - images.length, modes: documentModes() },
    { count: selection.drawings, modes: nesting },
  ].sort((a, b) => b.count - a.count);
  const modes: ModeSuggestion[] = [];
  for (const { modes: offered } of kinds)
    for (const suggestion of offered)
      if (!modes.some((item) => item.mode === suggestion.mode)) modes.push(suggestion);
  return { modes, settings: { ...settings, mode: modes[0]?.mode ?? settings.mode } };
}
