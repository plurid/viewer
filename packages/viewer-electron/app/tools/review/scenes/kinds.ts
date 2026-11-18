/** Every preview kind, each on its playground sample in its own plane. */
import { filePreviewModules } from '../../../src/domain/previews/formats';
import type { BuiltInPreviewKind } from '../../../src/domain/previews/formats';
import { planeInView } from '../checks';
import { kindSamples, sampleFolders } from '../samples';
import type { ReviewArea, Scene } from '../types';
import { coverageVariants } from '../variants';

/** What every preview keeps, whatever its kind. */
const previewRules = [
  'The plane header is one line; the kind’s main tools show, the rest are in “…”.',
  'The content fills the plane with no collapsed or empty area, in both sizes.',
  'The footer is one line: the name keeps its extension, then kind and size.',
  'Nothing reads “unavailable” without a reason; a failure offers Try Again.',
];

/** What a kind's own plane must also show, from the layout batch (audit section 4). */
const kindRules: Partial<Record<BuiltInPreviewKind, readonly string[]>> = {
  pdf: [
    'The page field shows a three-digit page whole, with no spin arrows; the zoom button keeps one width.',
    'The thumbnails are one Tab stop; outline titles end in “…” on one line.',
  ],
  djvu: ['The page field has no spin arrows and the zoom button keeps one width.'],
  epub: ['The “3 / 24” counter keeps one width as chapters change.'],
  office: [
    'More is a menu with no checked row; the sheet tabs sit at the bottom in Sheet and Layout.',
    'Next stays under the pointer as the row range changes.',
  ],
  archive: ['Each row shows its entry’s own name first, keeping its extension, then its folder.'],
  mail: ['Each attachment chip is one line: its name keeps its extension, then a readable kind.'],
  torrent: ['File names lose their middle and keep their extension.'],
  text: ['The line-number gutter is wide enough for the last line’s number.'],
  media: [
    'The player has its full height from the start; Open buttons show only if loading is slow.',
  ],
  sqlite: ['The table list’s selection runs to its right edge: no empty scroll track.'],
};

/** Kinds a run must not open yet, and why. */
const held: Partial<Record<BuiltInPreviewKind, string>> = {};

const kindScene = (kind: BuiltInPreviewKind, label: string): Scene => ({
  id: 'kind-' + kind,
  title: 'Preview: ' + label,
  mustBeTrue: [...previewRules, ...(kindRules[kind] ?? [])],
  setup: { folder: sampleFolders.kinds, view: 'list' },
  variants: coverageVariants,
  covers: { previews: [kind], commands: ['linked'] },
  focus: [planeInView],
  ...(held[kind] ? { blocked: held[kind] } : {}),
  async steps(page) {
    const name = kindSamples[kind];
    if (!name) throw new Error('The playground makes no sample for ' + label + '.');
    await page.select(page.path(sampleFolders.kinds, name));
    await page.palette('Open linked plane');
    await page.waitFor('.preview-host');
    await page.settle(1500);
  },
});

export const kinds: ReviewArea = {
  id: 'kinds',
  title: 'Preview kinds',
  scenes: filePreviewModules.map((module) => kindScene(module.id, module.label)),
};
