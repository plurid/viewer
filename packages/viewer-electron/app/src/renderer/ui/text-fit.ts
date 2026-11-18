import type { TextMeasure } from '../../domain/files/path-label';

/**
 * Measuring text for labels that fit their room on one line: path labels and file names. One
 * canvas measures every label in each label's computed font, and one observer refits every label
 * when its room changes, so a virtual list of thousands costs only its mounted rows.
 */
let canvas: CanvasRenderingContext2D | null | undefined;
let canvasFont = '';
const widths = new Map<string, number>();

/** A label's computed font, as the canvas takes it. */
export function fontOf(element: HTMLElement): string {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/** Measures text in `font`; undefined where there is no canvas, as in a test without one. */
export function measurerFor(font: string): TextMeasure | undefined {
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d');
  const context = canvas;
  if (!context) return undefined;
  return (text) => {
    const key = font + '\n' + text;
    let width = widths.get(key);
    if (width === undefined) {
      if (canvasFont !== font) {
        context.font = font;
        canvasFont = font;
      }
      width = context.measureText(text).width;
      // Candidates repeat as windows resize; a long session starts the memory over.
      if (widths.size >= 5000) widths.clear();
      widths.set(key, width);
    }
    return width;
  };
}

/** Measures text in `element`'s font. */
export function measurer(element: HTMLElement): TextMeasure | undefined {
  return measurerFor(fontOf(element));
}

const fitters = new WeakMap<Element, () => void>();
let observer: ResizeObserver | undefined;
let observerType: typeof ResizeObserver | undefined;
/** Every one-line label's fit, for the changes its own size does not show. */
const refits = new Set<() => void>();
let appearanceWatched = false;

function refitAll() {
  for (const fit of refits) fit();
}

/**
 * The interface font, density and theme change how wide a label's text is without changing its
 * room: the theme sets the root's style, density a `data-density`, and a late font finishes
 * loading.
 */
function watchAppearance() {
  if (appearanceWatched || typeof MutationObserver !== 'function') return;
  appearanceWatched = true;
  const root = document.documentElement;
  new MutationObserver(refitAll).observe(root, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-look'],
  });
  new MutationObserver(refitAll).observe(root, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-density'],
  });
  document.fonts?.addEventListener?.('loadingdone', () => {
    widths.clear();
    refitAll();
  });
}

/** Refits `element`'s label whenever its room or the appearance changes; returns the release. */
export function watchFit(element: Element, fit: () => void): () => void {
  refits.add(fit);
  watchAppearance();
  if (typeof ResizeObserver !== 'function') return () => refits.delete(fit);
  if (!observer || observerType !== ResizeObserver) {
    observerType = ResizeObserver;
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) fitters.get(entry.target)?.();
    });
  }
  const current = observer;
  fitters.set(element, fit);
  current.observe(element);
  return () => {
    fitters.delete(element);
    refits.delete(fit);
    current.unobserve?.(element);
  };
}
