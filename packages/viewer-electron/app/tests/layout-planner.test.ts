/**
 * The Layout plane's planner: the mode a selection suggests, the plan each mode makes, and the
 * candidates shown beside it. Every plan must pass the desktop writer's schema as it is.
 */
import { describe, expect, it } from 'vitest';
import { layoutTransformSchema, millimetres as mm } from '../src/domain/layout/plan';
import type { LayoutTransform } from '../src/domain/layout/plan';
import { layoutModes } from '../src/domain/layout/modes';
import { isProblem, planLayout } from '../src/domain/layout/planner';
import type { LayoutResult } from '../src/domain/layout/planner';
import { changeMode, changePage, defaultLayoutSettings } from '../src/domain/layout/settings';
import type { LayoutSettings, PlannedMode } from '../src/domain/layout/settings';
import { layoutCandidates } from '../src/domain/layout/candidates';
import { pageClass, suggestLayout } from '../src/domain/layout/suggest';
import { layoutFileName, layoutName } from '../src/domain/layout/names';
import { layoutFileKind } from '../src/domain/layout/sources';
import type { ImageSource, LayoutSource, PDFSource } from '../src/domain/layout/sources';
import { pagePreset } from '../src/domain/layout/pages';
import { validateTransform } from '../src/domain/operations/transforms';

const photo = (name: string, width = 4032, height = 3024, measured = true): ImageSource => ({
  kind: 'image',
  path: '/Photos/' + name,
  name,
  width,
  height,
  measured,
  date: '2026-10-21',
});
const pdf = (name: string, pages: number, width: number, height: number): PDFSource => ({
  kind: 'pdf',
  path: '/Documents/' + name,
  name,
  pages: Array.from({ length: pages }, () => ({ width, height })),
});
const a4 = pagePreset('a4');
const photos = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    index % 3 === 2 ? photo(`IMG_${index}.jpg`, 3024, 4032) : photo(`IMG_${index}.jpg`),
  );
const planned = layoutModes.filter((mode): mode is PlannedMode => mode !== 'nesting');
const plan = (settings: LayoutSettings, sources: readonly LayoutSource[], mode: PlannedMode) => {
  const outcome = planLayout(settings, sources, mode);
  if (isProblem(outcome)) throw new Error(outcome.problem);
  return outcome;
};
/** The plan as the desktop receives it: parsed, defaults filled, unchanged. */
const valid = (result: LayoutResult): LayoutTransform => {
  const parsed = layoutTransformSchema.parse(result.plan);
  expect(parsed).toEqual(result.plan);
  expect(validateTransform(result.plan, result.sources.length)).toEqual(result.plan);
  for (const page of result.plan.pages)
    for (const item of page.items)
      if (item.kind === 'image' || item.kind === 'page')
        expect(item.source).toBeLessThan(result.sources.length);
  return parsed;
};

describe('mode suggestion', () => {
  const modes = (sources: LayoutSource[], drawings = 0) =>
    suggestLayout({ sources, drawings }).modes.map((item) => item.mode);

  it('makes a collage of two to nine photos and a contact sheet of ten or more', () => {
    expect(modes(photos(2))[0]).toBe('collage');
    expect(modes(photos(3))).toEqual(['collage', 'contact-sheet']);
    expect(modes(photos(9))[0]).toBe('collage');
    expect(modes(photos(10))).toEqual(['contact-sheet', 'collage']);
    expect(modes(photos(200))).toEqual(['contact-sheet']);
    const suggestion = suggestLayout({ sources: photos(3), drawings: 0 });
    expect(suggestion.settings.mode).toBe('collage');
    expect(suggestion.modes[0]!.reason).toBe('3 photos on one page');
  });

  it('offers prints of one photo, and a poster when it is large', () => {
    expect(modes([photo('small.jpg', 1200, 900)])).toEqual(['step-repeat']);
    expect(modes([photo('large.jpg')])).toEqual(['step-repeat', 'poster']);
    // proportions only, from a thumbnail: too little is known to promise a poster
    expect(modes([photo('unknown.jpg', 4032, 3024, false)])).toEqual(['step-repeat']);
    expect(
      suggestLayout({ sources: [photo('a.jpg')], drawings: 0 }).settings['step-repeat'].item,
    ).toBe('photo-10x15');
  });

  it('goes by page size for PDFs', () => {
    const a5 = pdf('Zine.pdf', 8, mm(148), mm(210));
    expect(modes([a5])).toEqual(['n-up', 'booklet', 'contact-sheet']);
    expect(suggestLayout({ sources: [a5], drawings: 0 }).settings['n-up'].perSheet).toBe(2);
    const a6 = pdf('Cards.pdf', 2, mm(105), mm(148));
    expect(suggestLayout({ sources: [a6], drawings: 0 }).settings['n-up'].perSheet).toBe(4);
    const card = pdf('Card.pdf', 1, mm(85), mm(55));
    expect(modes([card])[0]).toBe('step-repeat');
    expect(suggestLayout({ sources: [card], drawings: 0 }).settings['step-repeat'].item).toBe(
      'original',
    );
    const plan = pdf('Plan.pdf', 1, mm(594), mm(841));
    expect(modes([plan])[0]).toBe('poster');
    expect(modes([pdf('Report.pdf', 12, a4.width, a4.height)])).toEqual([
      'n-up',
      'booklet',
      'contact-sheet',
    ]);
    expect(modes([pdf('Report.pdf', 3, a4.width, a4.height)])).not.toContain('booklet');
    expect(modes([pdf('Letter.pdf', 1, a4.width, a4.height)])[0]).toBe('poster');
  });

  it('classifies page sizes', () => {
    expect(pageClass({ width: mm(85), height: mm(55) })).toBe('card');
    expect(pageClass({ width: mm(148), height: mm(210) })).toBe('small');
    expect(pageClass({ width: a4.width, height: a4.height })).toBe('document');
    expect(pageClass({ width: mm(420), height: mm(594) })).toBe('large');
  });

  it('nests DXF parts, and follows the largest kind in a mixed selection', () => {
    expect(modes([], 4)).toEqual(['nesting']);
    expect(modes(photos(3), 1)[0]).toBe('collage');
    expect(modes(photos(1), 5)[0]).toBe('nesting');
    const mixed = modes([
      ...photos(2),
      pdf('a.pdf', 4, a4.width, a4.height),
      pdf('b.pdf', 1, a4.width, a4.height),
      pdf('c.pdf', 1, a4.width, a4.height),
    ]);
    expect(mixed[0]).toBe('n-up');
    expect(mixed).toContain('collage');
  });

  it('knows which files it lays out', () => {
    expect(layoutFileKind({ directory: false, extension: 'HEIC' })).toBe('image');
    expect(layoutFileKind({ directory: false, extension: 'pdf' })).toBe('pdf');
    expect(layoutFileKind({ directory: false, extension: 'dxf' })).toBe('drawing');
    expect(layoutFileKind({ directory: false, extension: 'mp4' })).toBeUndefined();
    expect(layoutFileKind({ directory: true, extension: '' })).toBeUndefined();
  });
});

describe('plans', () => {
  const selections: [string, LayoutSource[]][] = [
    ['one photo', photos(1)],
    ['three photos', photos(3)],
    ['twelve photos', photos(12)],
    ['an A5 zine', [pdf('Zine.pdf', 10, mm(148), mm(210))]],
    ['a business card', [pdf('Card.pdf', 2, mm(85), mm(55))]],
    ['an A1 plan', [pdf('Plan.pdf', 1, mm(594), mm(841))]],
    ['photos and a PDF', [...photos(2), pdf('Report.pdf', 3, a4.width, a4.height)]],
  ];

  it.each(selections)('are valid for %s in every mode', (_name, sources) => {
    const settings = suggestLayout({ sources, drawings: 0 }).settings;
    for (const mode of planned) {
      const outcome = planLayout(settings, sources, mode);
      if (isProblem(outcome)) {
        // only a collage, which needs photos, and a booklet, which needs two pages, refuse
        expect(['collage', 'booklet']).toContain(mode);
        continue;
      }
      valid(outcome);
      expect(outcome.summary).not.toBe('');
      expect(outcome.reason).not.toBe('');
    }
  });

  it('stay valid across page sizes, orientations, fits and formats', () => {
    const sources = photos(5);
    const base = defaultLayoutSettings();
    for (const size of ['fit', 'a4', 'letter', 'photo-4x6', 'square', 'px-1080x1350'] as const)
      for (const orientation of ['auto', 'portrait', 'landscape'] as const)
        for (const fit of ['fill', 'fit'] as const)
          for (const format of ['pdf', 'png', 'jpeg'] as const) {
            const settings = changeMode(
              changePage(base, 'collage', { size, orientation }),
              'collage',
              {
                fit,
                format,
              },
            );
            valid(plan(settings, sources, 'collage'));
          }
  });

  it('refer only to the files they draw', () => {
    const sources = [...photos(2), pdf('Report.pdf', 3, a4.width, a4.height)];
    const collage = plan(defaultLayoutSettings(), sources, 'collage');
    expect(collage.sources).toEqual(['/Photos/IMG_0.jpg', '/Photos/IMG_1.jpg']);
    const booklet = plan(defaultLayoutSettings(), sources, 'booklet');
    expect(booklet.sources).toHaveLength(3);
    const pages = booklet.plan.pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'page');
    expect(pages.every((item) => item.kind === 'page' && item.source === 2)).toBe(true);
  });

  it('are saved as an image only when they are one page without PDF pages', () => {
    const collage = plan(defaultLayoutSettings(), photos(3), 'collage');
    expect(collage.formats).toEqual(['pdf', 'png', 'jpeg']);
    expect(collage.plan.format).toBe('jpeg');
    const zine = [pdf('Zine.pdf', 10, mm(148), mm(210))];
    const nUp = plan(changeMode(defaultLayoutSettings(), 'n-up', { format: 'png' }), zine, 'n-up');
    expect(nUp.formats).toEqual(['pdf']);
    expect(nUp.plan.format).toBe('pdf');
  });

  it('draw a screen size a point to a pixel, and keep an image under 100 megapixels', () => {
    const square = changePage(defaultLayoutSettings(), 'collage', { size: 'px-1080' });
    const result = plan(square, photos(3), 'collage');
    expect(result.plan.dpi).toBe(72);
    expect([result.plan.pages[0]!.width, result.plan.pages[0]!.height]).toEqual([1080, 1080]);
    const huge = changeMode(
      changePage({ ...defaultLayoutSettings(), dpi: 1200 }, 'collage', { size: 'a3' }),
      'collage',
      { format: 'png' },
    );
    const capped = plan(huge, photos(3), 'collage');
    const page = capped.plan.pages[0]!;
    expect(
      ((page.width * capped.plan.dpi) / 72) * ((page.height * capped.plan.dpi) / 72),
    ).toBeLessThanOrEqual(1e8);
  });

  it('shape a fitted collage to its photos and size it from their pixels', () => {
    const result = plan(defaultLayoutSettings(), photos(3), 'collage');
    expect(result.reason).toBe('No empty space, no cropping');
    expect(result.summary).toMatch(/^3 photos · \d+ × \d+ px$/);
    // three 12 megapixel photos keep about their own resolution
    expect(result.plan.dpi).toBeGreaterThan(200);
  });

  it('shape three landscape photos as a print, not a strip', () => {
    const three = [photo('A.jpg'), photo('B.jpg'), photo('C.jpg')];
    const result = plan(defaultLayoutSettings(), three, 'collage');
    const page = result.plan.pages[0]!;
    const proportion = Math.max(page.width, page.height) / Math.min(page.width, page.height);
    expect(proportion).toBeLessThanOrEqual(16 / 9 + 0.01);
    expect(result.reason).toMatch(/no cropping/);
    // two side by side above one across: every photo whole, the page close to square
    const rows = new Set(
      page.items.map((item) => ('frame' in item ? Math.round(item.frame.y) : 0)),
    );
    expect(rows.size).toBe(2);
    // and the plane opens on it: no empty space beats photos of equal size
    const [first] = layoutCandidates(defaultLayoutSettings(), three, 'collage');
    expect(first!.result.reason).toBe('No empty space, no cropping');
  });

  it('give a collage on A4 a reason with its coverage and cropping', () => {
    const settings = changePage(defaultLayoutSettings(), 'collage', { size: 'a4' });
    const result = plan(settings, photos(3), 'collage');
    expect(result.reason).toMatch(
      /^Fills (\d+% of )?A4 (portrait|landscape), (no cropping|crops \d+%)$/,
    );
  });

  it('caption a contact sheet and number its pages', () => {
    const result = plan(defaultLayoutSettings(), photos(200), 'contact-sheet');
    const pages = valid(result).pages;
    expect(pages.length).toBeGreaterThan(1);
    const texts = pages.at(-1)!.items.flatMap((item) => (item.kind === 'text' ? [item.text] : []));
    expect(texts).toContain(`Page ${pages.length} of ${pages.length}`);
    expect(texts).toContain('Photos');
    expect(texts).toContain('2026-10-21');
    const images = pages.flatMap((page) => page.items).filter((item) => item.kind === 'image');
    expect(images).toHaveLength(200);
    // every photo is whole
    expect(
      images.every(
        (item) => item.kind === 'image' && item.crop.width === 1 && item.crop.height === 1,
      ),
    ).toBe(true);
    const dimensions = changeMode(defaultLayoutSettings(), 'contact-sheet', {
      dimensions: true,
      date: false,
    });
    const captioned = plan(dimensions, photos(2), 'contact-sheet');
    const lines = captioned.plan.pages[0]!.items.flatMap((item) =>
      item.kind === 'text' ? [item.text] : [],
    );
    expect(lines).toContain('4032 × 3024');
    expect(lines).not.toContain('2026-10-21');
  });

  it('turn two A5 pages onto a portrait A4 sheet when the orientation is fixed', () => {
    const zine = [pdf('Zine.pdf', 4, mm(148), mm(210))];
    const portrait = changePage(defaultLayoutSettings(), 'n-up', {
      orientation: 'portrait',
      margin: 0,
      gap: 0,
    });
    const result = plan(portrait, zine, 'n-up');
    expect(result.plan.pages).toHaveLength(2);
    const items = result.plan.pages[0]!.items.filter((item) => item.kind === 'page');
    expect(items.map((item) => item.kind === 'page' && item.rotate)).toEqual([90, 90]);
    expect(result.plan.pages[0]!.height).toBeGreaterThan(result.plan.pages[0]!.width);
  });

  it('cut away an N-up page bleed at its crop marks', () => {
    const zine = [pdf('Bleed.pdf', 2, mm(154), mm(216))];
    const settings = changeMode(defaultLayoutSettings(), 'n-up', {
      bleed: mm(3),
      cropMarks: true,
      frames: true,
    });
    const result = plan(settings, zine, 'n-up');
    const page = result.plan.pages[0]!;
    const [first] = page.items.filter((item) => item.kind === 'page');
    expect(first!.kind === 'page' && first!.crop.x).toBeGreaterThan(0);
    expect(page.items.some((item) => item.kind === 'path')).toBe(true);
    expect(page.items.some((item) => item.kind === 'rect')).toBe(true);
  });

  it('impose a booklet with its printing note', () => {
    const result = plan(defaultLayoutSettings(), [pdf('Zine.pdf', 6, mm(148), mm(210))], 'booklet');
    expect(result.plan.pages).toHaveLength(4);
    expect(result.summary).toBe('2 sheets · 8 pages, 2 blank · A4 landscape');
    expect(result.note).toBe(
      'Print on both sides, flipping on the short edge. Fold the stack of 2 sheets in half and staple along the fold.',
    );
    const order = result.plan.pages.map((page) =>
      page.items.flatMap((item) => (item.kind === 'page' ? [item.page] : [])),
    );
    expect(order).toEqual([[1], [2], [6, 3], [4, 5]]);
  });

  it('fit ten business cards on A4, with cut lines in the margins', () => {
    const card = [pdf('Card.pdf', 1, mm(85), mm(55))];
    const settings = suggestLayout({ sources: card, drawings: 0 }).settings;
    const result = plan(settings, card, 'step-repeat');
    expect(result.perSheet).toBe(10);
    expect(result.summary).toBe('10 per sheet · 1 sheet · A4 portrait');
    expect(layoutName(settings, 'step-repeat', card, result.perSheet)).toBe('Card 10 up');
    const items = result.plan.pages[0]!.items;
    expect(items.filter((item) => item.kind === 'page')).toHaveLength(10);
    expect(items.filter((item) => item.kind === 'path').length).toBeGreaterThan(0);
    const named = changeMode(settings, 'step-repeat', { item: 'business-card' });
    expect(layoutName(named, 'step-repeat', card, 10)).toBe('Cards 10 up');
  });

  it('make exact copies across as many sheets as they need', () => {
    const card = [pdf('Card.pdf', 1, mm(85), mm(55))];
    const settings = changeMode(defaultLayoutSettings(), 'step-repeat', {
      fill: false,
      copies: [25],
    });
    const result = plan(settings, card, 'step-repeat');
    expect(result.plan.pages).toHaveLength(3);
    expect(result.summary).toBe('10 per sheet · 3 sheets · 25 copies · A4 portrait');
  });

  it('keep a portrait card portrait, turning it on the sheet only to fit more', () => {
    const portrait = [pdf('Tall.pdf', 1, mm(55), mm(85))];
    const settings = changeMode(defaultLayoutSettings(), 'step-repeat', {
      item: 'business-card',
      fit: 'fit',
    });
    const cards = plan(settings, portrait, 'step-repeat');
    expect(cards.perSheet).toBe(10);
    const item = cards.plan.pages[0]!.items.find((value) => value.kind === 'page')!;
    expect(item.kind === 'page' && item.rotate).toBe(90);
    const upright = plan(
      changeMode(settings, 'step-repeat', { rotate: false }),
      portrait,
      'step-repeat',
    );
    expect(upright.perSheet).toBe(9);
    const still = upright.plan.pages[0]!.items.find((value) => value.kind === 'page')!;
    expect(still.kind === 'page' && still.rotate).toBe(0);
  });

  it('crop a landscape photo to a portrait passport photo without turning it', () => {
    const settings = changeMode(defaultLayoutSettings(), 'step-repeat', {
      item: 'passport',
      fit: 'fill',
      rotate: false,
    });
    const passport = plan(settings, photos(1), 'step-repeat');
    const picture = passport.plan.pages[0]!.items.find((value) => value.kind === 'image')!;
    expect(picture.kind === 'image' && picture.rotate).toBe(0);
    expect(picture.kind === 'image' && picture.crop.width * picture.crop.height).toBeLessThan(1);
    expect(picture.kind === 'image' && picture.frame.height).toBeGreaterThan(
      picture.kind === 'image' ? picture.frame.width : 0,
    );
    expect(passport.perSheet).toBeGreaterThan(20);
  });

  it('print a landscape photo as a landscape print', () => {
    const prints = plan(
      changeMode(defaultLayoutSettings(), 'step-repeat', { item: 'photo-10x15' }),
      photos(1),
      'step-repeat',
    );
    const picture = prints.plan.pages[0]!.items.find((value) => value.kind === 'image')!;
    if (picture.kind !== 'image') throw new Error('Expected a photo.');
    // 4:3 on a 3:2 print: a little off the top and bottom, upright
    expect(picture.rotate).toBe(0);
    expect(picture.frame.width).toBeGreaterThan(picture.frame.height);
    expect(picture.crop.width).toBe(1);
    expect(picture.crop.height).toBeCloseTo(8 / 9, 5);
  });

  it('tile a poster with labels, trim and glue marks', () => {
    const sheet = [pdf('Plan.pdf', 1, mm(594), mm(841))];
    const settings = changePage(suggestLayout({ sources: sheet, drawings: 0 }).settings, 'poster', {
      orientation: 'portrait',
      margin: mm(5),
    });
    const result = plan(settings, sheet, 'poster');
    expect(result.plan.pages).toHaveLength(12);
    expect(result.summary).toBe('12 sheets of A4 portrait (4 × 3) · poster 594 × 841 mm');
    const labels = result.plan.pages.map((page) =>
      page.items.find((item) => item.kind === 'text' && item.weight === 'bold')!,
    );
    expect(labels.map((item) => item.kind === 'text' && item.text).slice(0, 5)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'B1',
    ]);
    const dashed = result.plan.pages[0]!.items.filter((item) => item.kind === 'path' && item.dash);
    expect(dashed.length).toBeGreaterThan(0);
    // the tiles together show the whole page once, overlaps aside
    const crops = result.plan.pages.map((page) => page.items.find((item) => item.kind === 'page')!);
    const last = crops.at(-1)!;
    expect(last.kind === 'page' && last.crop.x + last.crop.width).toBeCloseTo(1, 5);
    expect(last.kind === 'page' && last.crop.y + last.crop.height).toBeCloseTo(1, 5);
  });

  it('explain what cannot be laid out', () => {
    const outcome = planLayout(
      defaultLayoutSettings(),
      [pdf('Report.pdf', 2, a4.width, a4.height)],
      'collage',
    );
    expect(outcome).toEqual({ problem: 'Choose photos to make a collage.' });
    const tiny = changeMode(
      changePage(defaultLayoutSettings(), 'step-repeat', { size: 'a6' }),
      'step-repeat',
      { item: 'custom', width: mm(200), height: mm(200) },
    );
    expect(planLayout(tiny, photos(1), 'step-repeat')).toEqual({
      problem: 'The item is larger than the sheet. Choose a larger sheet or a smaller item.',
    });
    expect(planLayout(defaultLayoutSettings(), [], 'collage')).toEqual({
      problem: 'Choose photos or PDFs to lay out.',
    });
  });
});

describe('candidates', () => {
  it('rank collage styles by score, each with a reason, none twice', () => {
    const settings = changePage(defaultLayoutSettings(), 'collage', { size: 'a4' });
    const candidates = layoutCandidates(settings, photos(3), 'collage');
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates.length).toBeLessThanOrEqual(4);
    const scores = candidates.map((candidate) => candidate.result.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(
      new Set(candidates.map((candidate) => JSON.stringify(candidate.result.plan.pages))).size,
    ).toBe(candidates.length);
    for (const candidate of candidates) {
      expect(candidate.result.reason).toMatch(/^Fills/);
      valid(candidate.result);
      // a candidate's settings plan exactly what it shows
      expect(plan(candidate.settings, photos(3), 'collage').plan).toEqual(candidate.result.plan);
    }
  });

  it('offer other counts, sheets, items and sizes in the other modes', () => {
    const zine = [pdf('Zine.pdf', 8, mm(148), mm(210))];
    const settings = suggestLayout({ sources: zine, drawings: 0 }).settings;
    expect(layoutCandidates(settings, zine, 'n-up').map((item) => item.label)).toEqual([
      '2 per sheet',
      '4 per sheet',
      '6 per sheet',
      '8 per sheet',
    ]);
    const booklet = layoutCandidates(settings, zine, 'booklet');
    expect(booklet[0]!.label).toBe('A4');
    expect(booklet[0]!.result.reason).toBe('Pages at 95% on A4 landscape');
    expect(layoutCandidates(settings, photos(200), 'contact-sheet')[0]!.label).toBe('Automatic');
    expect(
      layoutCandidates(settings, photos(1), 'step-repeat').map((item) => item.label),
    ).toContain('Passport photos');
    expect(layoutCandidates(settings, photos(1), 'poster').map((item) => item.label)).toEqual([
      'A2',
      'A1',
      'A0',
      'A3',
    ]);
  });
});

describe('output names', () => {
  const settings = defaultLayoutSettings();
  it.each([
    ['collage', photos(3), undefined, 'Collage of 3 photos'],
    ['contact-sheet', photos(40), undefined, 'Contact sheet of 40 photos'],
    ['booklet', [pdf('Report.pdf', 8, a4.width, a4.height)], undefined, 'Booklet of Report'],
    ['poster', [pdf('Plan.pdf', 1, mm(594), mm(841))], undefined, 'Poster of Plan'],
    ['n-up', [pdf('Report.pdf', 8, a4.width, a4.height)], 2, 'Report 2 up'],
    [
      'n-up',
      [pdf('a.pdf', 1, a4.width, a4.height), pdf('b.pdf', 1, a4.width, a4.height)],
      4,
      '2 PDFs 4 up',
    ],
  ] as const)('names a %s', (mode, sources, perSheet, name) => {
    expect(layoutName(settings, mode, sources, perSheet)).toBe(name);
  });

  it('adds the extension of the format, once', () => {
    expect(layoutFileName('Collage of 3 photos', 'jpeg')).toBe('Collage of 3 photos.jpg');
    expect(layoutFileName('Poster of Plan.pdf', 'pdf')).toBe('Poster of Plan.pdf');
    expect(layoutFileName('Cards 10 up.png', 'pdf')).toBe('Cards 10 up.pdf');
    expect(layoutName(settings, 'booklet', [pdf('a/b:c.pdf', 4, a4.width, a4.height)])).toBe(
      'Booklet of a b c',
    );
  });
});
