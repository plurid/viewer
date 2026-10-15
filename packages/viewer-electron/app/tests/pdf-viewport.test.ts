import { describe, expect, it } from 'vitest';
import { pdfCanvasRatio, pdfScale, pdfZoom } from '../src/renderer/previews/pdf-viewport';

describe('PDF page fitting', () => {
  const portrait = { width: 816, height: 1056 };
  it.each([
    { width: 2200, height: 950 },
    { width: 640, height: 360 },
    { width: 170, height: 100 },
  ])('keeps an entire portrait page visible in $width × $height', (available) => {
    const scale = pdfScale(portrait, available, 'page');
    expect(portrait.width * scale).toBeLessThanOrEqual(available.width);
    expect(portrait.height * scale).toBeLessThanOrEqual(available.height);
    expect(
      Math.max(
        (portrait.width * scale) / available.width,
        (portrait.height * scale) / available.height,
      ),
    ).toBeCloseTo(1);
  });
  it('fits landscape/rotated pages by width and recalculates when the host shrinks', () => {
    const page = { width: 1056, height: 816 };
    expect(pdfScale(page, { width: 720, height: 900 }, 'page')).toBeCloseTo(720 / 1056);
    expect(pdfScale(page, { width: 720, height: 300 }, 'page')).toBeCloseTo(300 / 816);
  });
  it('keeps width fitting explicit and manual percentages independent of the window size', () => {
    const large = { width: 2200, height: 950 },
      small = { width: 400, height: 300 };
    expect(portrait.height * pdfScale(portrait, large, 'width')).toBeGreaterThan(large.height);
    expect(pdfScale(portrait, large, 1)).toBe(1);
    expect(pdfScale(portrait, small, 1)).toBe(1);
  });
  it('waits for a measurable host and defaults unrecognized saved modes to Fit page', () => {
    expect(pdfScale(portrait, { width: 0, height: 0 }, 'page')).toBe(0);
    for (const value of [undefined, null, '', '100%', 0, -1, 5, NaN, Infinity])
      expect(pdfZoom(value)).toBe('page');
    for (const value of ['page', 'width', 1.5]) expect(pdfZoom(value)).toBe(value);
  });
});
describe('PDF canvas density', () => {
  it('keeps the display ratio for ordinary pages and bounds zoomed pages', () => {
    expect(pdfCanvasRatio({ width: 800, height: 1000 }, 2)).toBe(2);
    expect(pdfCanvasRatio({ width: 800, height: 1000 }, 3)).toBe(2);
    const zoomed = { width: 3264, height: 4224 };
    const ratio = pdfCanvasRatio(zoomed, 2);
    expect(zoomed.width * ratio * zoomed.height * ratio).toBeLessThanOrEqual(32_000_001);
    expect(Math.max(zoomed.width, zoomed.height) * ratio).toBeLessThanOrEqual(8192);
  });
});
