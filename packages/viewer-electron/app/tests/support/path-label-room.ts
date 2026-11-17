import { vi } from 'vitest';

/** Every character of a path label measures this many pixels. */
export const characterWidth = 7;

export interface PathLabelRoom {
  /** Gives every one-line path label a new width in pixels. */
  resize(room: number): void;
  remove(): void;
}

/**
 * jsdom has no layout and no canvas: one-line path labels get `room` pixels through a stylesheet,
 * which jsdom's computed style reads, and the canvas measures `characterWidth` per character.
 */
export function measurePathLabels(room: number): PathLabelRoom {
  const style = document.createElement('style');
  const write = (width: number) => {
    style.textContent = `.path-label[data-layout='line'] { width: ${width}px; }`;
  };
  write(room);
  document.head.append(style);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * characterWidth }),
  } as unknown as CanvasRenderingContext2D);
  return {
    resize: write,
    remove: () => style.remove(),
  };
}
