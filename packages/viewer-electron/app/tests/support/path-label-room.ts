import { vi } from 'vitest';

/** Every character of a path label measures this many pixels. */
export const characterWidth = 7;
/** A label whose computed font size is this measures twice as wide, as a larger interface font. */
export const largeFont = '28px';

export interface PathLabelRoom {
  /** Gives every one-line path label a new width in pixels. */
  resize(room: number): void;
  remove(): void;
}

/**
 * jsdom has no layout and no canvas: one-line path labels get `room` pixels through a stylesheet,
 * which jsdom's computed style reads, and the canvas measures `characterWidth` per character, twice
 * that in a `largeFont`. The first context a window measures with stays its canvas.
 */
export function measurePathLabels(room: number): PathLabelRoom {
  const style = document.createElement('style');
  const write = (width: number) => {
    style.textContent = `.path-label[data-layout='line'] { width: ${width}px; }`;
  };
  write(room);
  document.head.append(style);
  const context = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * characterWidth * (context.font.includes(largeFont) ? 2 : 1),
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  return {
    resize: write,
    remove: () => style.remove(),
  };
}
