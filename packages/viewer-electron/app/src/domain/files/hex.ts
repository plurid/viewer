/**
 * HEX VIEW: a file shown as its bytes, sixteen to a row. The view reads pages of the file on
 * demand through its preview resource and keeps a few of them, so a large file is never held
 * whole.
 */
export const hexRow = 16;
export const hexPage = 64 * 1024;
/** Pages kept at once: 1 MiB of a file. */
export const hexCachedPages = 16;

/** Hexadecimal digits an offset takes in a file of `size` bytes: at least eight. */
export const offsetDigits = (size: number) =>
  Math.max(8, Math.max(0, size - 1).toString(16).length);
export const offsetText = (offset: number, digits = 8) =>
  offset.toString(16).toUpperCase().padStart(digits, '0');
export const byteText = (byte: number) => byte.toString(16).toUpperCase().padStart(2, '0');
/** Printable ASCII shows as itself; any other byte as a dot. */
export const asciiText = (byte: number) =>
  byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';

export type OffsetReading = { offset: number } | { error: string };

/**
 * An offset as a person types it: `0x1F0` or `1F0h` in hexadecimal, `496` in decimal, and a
 * number with the letters A to F in hexadecimal too. Separators `_` and spaces are ignored.
 */
export function readOffset(input: string, size: number): OffsetReading {
  const text = input.trim().replace(/[_\s]/g, '');
  if (!text) return { error: 'Type an offset, such as 0x1F0 or 496.' };
  const hexadecimal =
    /^0x([0-9a-f]+)$/i.exec(text)?.[1] ??
    /^([0-9a-f]+)h$/i.exec(text)?.[1] ??
    (/^[0-9a-f]*[a-f][0-9a-f]*$/i.test(text) ? text : undefined);
  const value = hexadecimal
    ? parseInt(hexadecimal, 16)
    : /^\d+$/.test(text)
      ? Number(text)
      : Number.NaN;
  if (!Number.isSafeInteger(value)) return { error: `${input.trim()} is not an offset.` };
  if (value >= Math.max(size, 1))
    return {
      error: `The file ends at ${offsetText(Math.max(size - 1, 0), offsetDigits(size))} (${Math.max(size - 1, 0).toLocaleString()}).`,
    };
  return { offset: value };
}
