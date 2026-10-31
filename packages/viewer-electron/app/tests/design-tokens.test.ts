/**
 * THE DESIGN TOKENS: the type and spacing scales of DESIGN.md, as base.css declares them, and a
 * ratchet over every renderer stylesheet. App type uses the five `--text-*` sizes; a file that
 * styles a person's own documents keeps the document's sizes. Spacing off the `--gap-*` scale is
 * held to each file's budget, which only goes down: a file that loses some lowers its budget here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const renderer = path.resolve(import.meta.dirname, '../src/renderer');
const design = readFileSync(path.resolve(import.meta.dirname, '../../../../DESIGN.md'), 'utf8');

/** Every stylesheet under src/renderer, by its path from there. */
function stylesheets(folder = renderer): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return stylesheets(full);
    return entry.name.endsWith('.css')
      ? [path.relative(renderer, full).split(path.sep).join('/')]
      : [];
  });
}
const files = stylesheets().sort();
const source = (file: string) =>
  readFileSync(path.join(renderer, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Files that style a person's documents: rendered Markdown, notebooks, cards, font specimens and
 * mail. Their headings and specimens follow the document's own hierarchy (DESIGN.md: source
 * typography belongs inside rendered content, not in app controls), so their sizes stay free.
 */
const documentFiles = new Set([
  'styles/formats.css',
  'styles/text-documents.css',
  'previews/modules/mail.css',
]);
/** Sizes outside the scale, each for a reason. */
const sizeExceptions: Record<string, readonly string[]> = {
  // a diff's source reads at the read-only source size, 16 px (DESIGN.md typography.reading-preview)
  'styles/comparisons.css': ['16px'],
  // a map region's count, drawn as a picture (aria-hidden) to read when the map is zoomed out
  'styles/lenses.css': ['48px'],
};
const textToken = /^var\(--text-(label|compact|body|section|title)\)$/;
/** The person's own reading sizes, from Settings: the editor's and a note's. */
const preference = /^var\(--(editor|note)-font-size, \d+px\)$/;

/** Each declared font size: `font-size` values, and the size in a `font` shorthand. */
function fontSizes(text: string): string[] {
  const sizes: string[] = [];
  for (const [, value] of text.matchAll(/(?<![\w-])font-size\s*:\s*([^;{}]+)/g))
    sizes.push(value!.trim());
  for (const [, value] of text.matchAll(/(?<![\w-])font\s*:\s*([^;{}]+)/g)) {
    const shorthand = value!.replace(/\s+/g, ' ').trim();
    if (shorthand === 'inherit') continue;
    const size = /(?:^|\s)(var\(--[\w-]+\)|\d*\.?\d+(?:px|rem|em|pt))(?=\s|\/|$)/.exec(shorthand);
    sizes.push(size ? size[1]! : shorthand);
  }
  return sizes;
}

/** DESIGN.md's spacing scale, in pixels. */
const scale = new Set([0, 4, 6, 8, 12, 16, 18]);
/** Pixel lengths in padding, margin and gaps that are not on the scale. */
function offScaleSpacing(text: string): number {
  let count = 0;
  for (const [, , value] of text.matchAll(
    /(?<![\w-])((?:padding|margin)(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:\s*([^;{}]+)/g,
  ))
    for (const [length] of value!.matchAll(/-?\d*\.?\d+px/g))
      if (!scale.has(Math.abs(parseFloat(length)))) count++;
  return count;
}
/**
 * Off-scale spacing each file has now. Lower a budget when a file loses some; a new stylesheet
 * starts at none.
 */
const spacingBudgets: Record<string, number> = {
  'browser/browser.css': 4,
  'chat/chat.css': 9,
  'command-line/spoken.css': 1,
  'commands/capabilities.css': 9,
  'fabrication/check.css': 3,
  'git/commit-dialog.css': 1,
  'git/worktrees/worktrees.css': 5,
  'layout/layout.css': 7,
  'layout/nesting/nesting.css': 15,
  'local-servers/server-plane.css': 9,
  'media/image-tools.css': 2,
  'media/media.css': 7,
  'media/optimization.css': 6,
  'notes/notes.css': 2,
  'overview/overview.css': 3,
  'pdf-tools/pdf-tools.css': 9,
  'persistence/backup.css': 4,
  'previews/modules/inspection.css': 9,
  'previews/modules/mail.css': 11,
  'previews/modules/sqlite.css': 5,
  'speech/speech.css': 6,
  'styles/base.css': 18,
  'styles/commands.css': 19,
  'styles/comparisons.css': 2,
  'styles/dialogs.css': 12,
  'styles/files.css': 26,
  'styles/formats.css': 37,
  'styles/lenses.css': 5,
  'styles/planes.css': 12,
  'styles/previews.css': 14,
  'styles/settings.css': 33,
  'styles/tasks.css': 20,
  'styles/text-documents.css': 19,
  'styles/tools.css': 29,
  'styles/trash.css': 15,
  'tasks/tasks.css': 21,
  'terminals/run-command.css': 1,
  'workspace/tours/tours.css': 4,
};

describe('design tokens', () => {
  it('declares the DESIGN.md scales in base.css', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(source('styles/base.css'))![1]!;
    const declared = (name: string) =>
      new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(root)?.[1]?.trim();
    const spacing = /^spacing:\n((?: {2}.+\n)+)/m.exec(design)![1]!;
    for (const [, step, size] of spacing.matchAll(/^ {2}([\w-]+): '(\d+px)'$/gm))
      expect(declared(`gap-${step}`), `--gap-${step}`).toBe(size);
    const typography = (name: string) =>
      new RegExp(`^ {2}${name}:\\n(?: {4}.+\\n)*? {4}fontSize: '(\\d+px)'`, 'm').exec(design)![1]!;
    const sizes = {
      label: typography('label'),
      compact: typography('body-compact'),
      body: typography('body'),
      section: typography('settings-section'),
      title: typography('settings-title'),
    };
    for (const [token, size] of Object.entries(sizes))
      expect(declared(`text-${token}`), `--text-${token}`).toContain(
        `calc(${size} * var(--density-scale, 1))`,
      );
    expect(declared('shadow-panel')).toBeTruthy();
  });

  it.each(files.filter((file) => !documentFiles.has(file)))(
    'sizes app type in %s with the --text-* scale',
    (file) => {
      const off = fontSizes(source(file)).filter(
        (size) =>
          !textToken.test(size) &&
          !preference.test(size) &&
          size !== 'inherit' &&
          !sizeExceptions[file]?.includes(size),
      );
      expect(off, 'use var(--text-label|compact|body|section|title)').toEqual([]);
    },
  );

  it.each(files)('keeps off-scale spacing in %s within its budget', (file) => {
    const count = offScaleSpacing(source(file));
    const budget = spacingBudgets[file] ?? 0;
    expect(
      count,
      `over budget: use the --gap-* scale (4, 6, 8, 12, 16, 18 px)`,
    ).toBeLessThanOrEqual(budget);
    expect(count, `${file} now has ${count}: lower its budget to that`).toBe(budget);
  });

  it('budgets only stylesheets that exist', () => {
    expect(Object.keys(spacingBudgets).filter((file) => !files.includes(file))).toEqual([]);
  });
});
