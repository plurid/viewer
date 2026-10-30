/**
 * A text item's line as the layout writer draws it: in Helvetica, shortened by its metrics, when
 * WinAnsi holds the line; otherwise in the system sans-serif, shortened by its measured width.
 */
import { fitHelvetica, inWinAnsi, plainText } from '../../domain/layout/helvetica';
import type { TextWeight } from '../../domain/layout/helvetica';
import type { LayoutItem } from '../../domain/layout/plan';

type TextItem = Extract<LayoutItem, { kind: 'text' }>;
export type LineFont = 'helvetica' | 'system';
export interface ShownLine {
  text: string;
  font: LineFont;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string) => [...segmenter.segment(text)].map((part) => part.segment);
let measuring: CanvasRenderingContext2D | null | undefined;
/** A system sans-serif line's width in points; without a canvas, the writer's own estimate. */
function systemWidth(text: string, size: number, weight: TextWeight): number {
  measuring ??= document.createElement('canvas').getContext('2d');
  if (measuring) {
    measuring.font = `${weight === 'bold' ? 700 : 400} ${size}px sans-serif`;
    return measuring.measureText(text).width;
  }
  return (
    graphemes(text).reduce(
      (total, part) => total + (part.codePointAt(0)! >= 0x1100 ? 1.1 : 0.7),
      0,
    ) * size
  );
}
function fitSystem(text: string, item: TextItem): string | undefined {
  const { size, weight, maxWidth } = item;
  if (maxWidth === undefined || systemWidth(text, size, weight) <= maxWidth) return text;
  const parts = graphemes(text);
  const shortened = (count: number) => parts.slice(0, count).join('').trimEnd() + '…';
  if (systemWidth(shortened(0), size, weight) > maxWidth) return undefined;
  let low = 0;
  let high = parts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (systemWidth(shortened(middle), size, weight) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return shortened(low);
}

/** The line drawn, or undefined when not even an ellipsis fits its width. */
export function shownLine(item: TextItem): ShownLine | undefined {
  const line = plainText(item.text);
  if (inWinAnsi(line)) {
    const text = fitHelvetica(line, item.size, item.weight, item.maxWidth);
    return text === undefined ? undefined : { text, font: 'helvetica' };
  }
  const text = fitSystem(line, item);
  return text === undefined ? undefined : { text, font: 'system' };
}
