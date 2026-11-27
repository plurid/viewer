/** Other layouts of the current mode worth a look, best first, each with its reason. */
import { collageStyleAvailable, collageStyles } from './collage';
import type { CollageStyle } from './collage';
import { nUpCounts } from './n-up';
import { pageLabel } from './pages';
import type { ItemSizeID, PagePresetID } from './pages';
import { isProblem, planLayout } from './planner';
import type { LayoutResult } from './planner';
import { changeMode, changePage } from './settings';
import type { LayoutSettings, PlannedMode } from './settings';
import type { LayoutSource } from './sources';

export interface LayoutCandidate {
  /** Stable for the same choice. */
  id: string;
  label: string;
  settings: LayoutSettings;
  result: LayoutResult;
  /** The same for two candidates that draw the same pages. */
  fingerprint: string;
}
interface Variant {
  id: string;
  label: string;
  settings: LayoutSettings;
}

export const collageStyleLabel = (style: CollageStyle, count: number) =>
  ({
    justified: 'Rows',
    featured: 'Featured',
    grid: 'Grid',
    strip: 'Strip',
    split: count === 2 ? 'Halves' : 'Thirds',
  })[style];

export function layoutCandidates(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
  mode: PlannedMode,
  limit = 4,
): LayoutCandidate[] {
  const ranked: LayoutCandidate[] = [];
  const seen = new Set<string>();
  for (const variant of variants(settings, sources, mode)) {
    const result = planLayout(variant.settings, sources, mode);
    if (isProblem(result)) continue;
    // two choices that come out the same are one candidate
    const fingerprint = layoutFingerprint(result);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    ranked.push({ ...variant, result, fingerprint });
  }
  const ordered = rankedByScore.has(mode)
    ? ranked.sort((a, b) => b.result.score - a.result.score)
    : ranked;
  return ordered.slice(0, limit);
}
export const layoutFingerprint = (result: LayoutResult) => JSON.stringify(result.plan.pages);
/** Modes whose candidates are ordered by score; the others keep the order they are offered in. */
const rankedByScore = new Set<PlannedMode>(['collage', 'booklet']);

function variants(
  settings: LayoutSettings,
  sources: readonly LayoutSource[],
  mode: PlannedMode,
): Variant[] {
  const photos = sources.filter((source) => source.kind === 'image').length;
  const onlyPhotos = sources.every((source) => source.kind === 'image');
  switch (mode) {
    case 'collage':
      return collageStyles
        .filter((style) => collageStyleAvailable(style, photos))
        .map((style) => ({
          id: 'collage:' + style,
          label: collageStyleLabel(style, photos),
          settings: changeMode(settings, 'collage', { style }),
        }));
    case 'contact-sheet': {
      const current = settings['contact-sheet'].columns;
      const automatic = planLayout(
        changeMode(settings, 'contact-sheet', { columns: 'auto' }),
        sources,
        mode,
      );
      const base = isProblem(automatic) ? 4 : (automatic.columns ?? 4);
      const counts = [base, base + 1, base - 1, base + 2].filter((value) => value >= 2);
      return [
        {
          id: 'contact-sheet:auto',
          label: 'Automatic',
          settings: changeMode(settings, 'contact-sheet', { columns: 'auto' }),
        },
        ...counts
          .filter((value) => value !== current)
          .map((columns) => ({
            id: 'contact-sheet:' + columns,
            label: `${columns} columns`,
            settings: changeMode(settings, 'contact-sheet', { columns }),
          })),
      ];
    }
    case 'n-up': {
      const current = settings['n-up'].perSheet;
      return [current, ...nUpCounts.filter((count) => count !== current)].map((perSheet) => ({
        id: 'n-up:' + perSheet,
        label: `${perSheet} per sheet`,
        settings: changeMode(settings, 'n-up', { perSheet }),
      }));
    }
    case 'booklet':
      return (['a4', 'a3', 'letter', 'tabloid', 'a5'] as const satisfies PagePresetID[]).map(
        (size) => ({
          id: 'booklet:' + size,
          label: pageLabel(size),
          settings: changePage(settings, 'booklet', { size }),
        }),
      );
    case 'step-repeat': {
      const current = settings['step-repeat'].item;
      const items: ItemSizeID[] = onlyPhotos
        ? ['photo-10x15', 'passport', 'passport-us', 'photo-9x13']
        : ['original', 'business-card', 'business-card-us', 'label-21'];
      return [current, ...items.filter((item) => item !== current)].map((item) => ({
        id: 'step-repeat:' + item,
        label: itemLabel(item),
        settings: changeMode(settings, 'step-repeat', { item }),
      }));
    }
    case 'poster': {
      const sizes = onlyPhotos
        ? (['a2', 'a1', 'a0', 'a3'] as const)
        : (['a2', 'a1', 'a0'] as const);
      return [
        ...(onlyPhotos
          ? []
          : [
              {
                id: 'poster:100',
                label: 'Actual size',
                settings: changeMode(settings, 'poster', { target: 'scale', scale: 100 }),
              },
            ]),
        ...sizes.map((size) => ({
          id: 'poster:' + size,
          label: pageLabel(size),
          settings: changeMode(settings, 'poster', { target: 'size', size }),
        })),
      ];
    }
  }
}
export const itemLabel = (item: ItemSizeID) =>
  ({
    'business-card': 'Business cards',
    'business-card-us': 'US business cards',
    passport: 'Passport photos',
    'passport-us': 'US passport photos',
    'photo-10x15': '10 × 15 cm prints',
    'photo-9x13': '9 × 13 cm prints',
    'photo-4x6': '4 × 6 in prints',
    'label-21': '21 labels',
    'label-14': '14 labels',
    'label-65': '65 labels',
    'label-30': '30 labels',
    original: 'Actual size',
    custom: 'Custom size',
  })[item];
