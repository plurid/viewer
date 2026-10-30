/**
 * Layout text in a PDF's standard Helvetica: WinAnsi codes and the widths that align and shorten
 * a line. Text WinAnsi cannot hold is drawn as a picture instead (layout-image.ts).
 */
import type { LayoutItem } from '../../domain/layout/plan';
import type { TextWeight } from '../../domain/layout/helvetica';
import {
  helveticaWidths as widths,
  plainText,
  winAnsiExtras as extras,
} from '../../domain/layout/helvetica';

export type TextItem = Extract<LayoutItem, { kind: 'text' }>;
export type { TextWeight };
export { plainText };

const ellipsis = 0x85;

/** The text's WinAnsi codes, or undefined when a character falls outside WinAnsi. */
export function winAnsi(text: string): Uint8Array | undefined {
  const codes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0)!;
    const code =
      (point >= 0x20 && point <= 0x7e) || (point >= 0xa0 && point <= 0xff)
        ? point
        : extras.get(point);
    if (code === undefined) return undefined;
    codes.push(code);
  }
  return Uint8Array.from(codes);
}

/** The text's WinAnsi codes, with a question mark for each character outside WinAnsi. */
export const winAnsiReplaced = (text: string): Uint8Array =>
  winAnsi([...text].map((character) => (winAnsi(character) ? character : '?')).join(''))!;

/** The width of WinAnsi codes in points. Standard fonts are drawn without kerning. */
export function winAnsiWidth(codes: Uint8Array, size: number, weight: TextWeight): number {
  const table = widths[weight];
  let total = 0;
  for (const code of codes) total += table[code - 32] ?? 0;
  return (total * size) / 1000;
}

/** The longest start of the codes that fits `maxWidth` with an ellipsis after it, or the codes
 * themselves when they fit. Undefined when not even the ellipsis fits. */
export function fitWinAnsi(
  codes: Uint8Array,
  size: number,
  weight: TextWeight,
  maxWidth: number | undefined,
): Uint8Array | undefined {
  if (maxWidth === undefined || winAnsiWidth(codes, size, weight) <= maxWidth) return codes;
  let low = 0,
    high = codes.length - 1;
  const shortened = (length: number) => {
    let end = length;
    while (end > 0 && codes[end - 1] === 0x20) end--;
    return Uint8Array.from([...codes.subarray(0, end), ellipsis]);
  };
  if (winAnsiWidth(shortened(0), size, weight) > maxWidth) return undefined;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (winAnsiWidth(shortened(middle), size, weight) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return shortened(low);
}

/** A PDF literal string of WinAnsi codes. */
export function pdfString(codes: Uint8Array): string {
  let value = '(';
  for (const code of codes)
    value +=
      code === 0x28 || code === 0x29 || code === 0x5c
        ? '\\' + String.fromCharCode(code)
        : code >= 0x20 && code < 0x7f
          ? String.fromCharCode(code)
          : '\\' + code.toString(8).padStart(3, '0');
  return value + ')';
}
