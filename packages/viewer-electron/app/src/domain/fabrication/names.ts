/**
 * JOB NAMES: what a laser part's file name says about the job, when it says anything. One common
 * convention Viewer reads is `g<thickness>-<part>-<n>buc.dxf`, as in `g6-MB20-A1-4buc.dxf`: 6 mm,
 * part MB20-A1, 4 pieces ("buc" is Romanian for pieces), with the variants below; many shops name
 * parts otherwise. A name is a fallback and a cross-check: the request comes first
 * (reconcile.ts). The reading is deterministic. A value it is unsure of stays undefined, with a
 * note naming the text it saw; it never guesses (docs/reference/fabrication.md).
 */

/** Millimetres. */
export const thicknessRange = { least: 0.1, most: 300 } as const;
export const quantityRange = { least: 1, most: 20_000 } as const;

export type NameMarker = 'thickness' | 'quantity';
export interface NameReading {
  value: number;
  /** The text read, as written: "g6", "6mm", "4buc", "4 buc", "x4". */
  text: string;
  /** Where that text starts in the file name. */
  at: number;
}
export interface JobName {
  /** The file name as given. */
  name: string;
  /** The rest of the name once thickness and quantity are read: "MB20-A1". */
  part?: string;
  thickness?: NameReading;
  quantity?: NameReading;
  /** A trailing note in brackets, such as "corrected" in "… (corrected).dxf". */
  suffix?: string;
  /** Why a thickness or quantity was not read, a sentence each. */
  notes: string[];
}

/** Drawing and cutting formats; any other ending is part of the name. */
const extension = /\.(?:dxf|dwg|dwf|pdf|svg|stp|step|igs|iges|ai|eps|nc|cnc)$/i;
const separators = /[-_\s]+/g;
const decimal = String.raw`\d+(?:[.,]\d+)?`;
/** Unit-bearing forms read anywhere in the name; the bare forms only at its two ends, where the
 * convention puts them, so a part called T6 keeps its name. */
const patterns: readonly {
  marker: NameMarker;
  strong: boolean;
  pattern: RegExp;
}[] = [
  { marker: 'thickness', strong: true, pattern: new RegExp(`^g(${decimal})(?:mm)?$`, 'i') },
  { marker: 'thickness', strong: true, pattern: new RegExp(`^(${decimal}) ?mm$`, 'i') },
  { marker: 'thickness', strong: true, pattern: new RegExp(`^t(${decimal})mm$`, 'i') },
  { marker: 'thickness', strong: false, pattern: new RegExp(`^t(${decimal})$`, 'i') },
  { marker: 'quantity', strong: true, pattern: /^(\d+) ?(?:buc|pcs|pc)\.?$/i },
  { marker: 'quantity', strong: false, pattern: /^x(\d+)$/i },
  { marker: 'quantity', strong: false, pattern: /^(\d+)x$/i },
];

interface Token {
  text: string;
  at: number;
  /** The separator before it, kept when the part name is put back together. */
  before: string;
}
interface Marker {
  marker: NameMarker;
  strong: boolean;
  /** The number as written; out of range when the name holds an unusable value. */
  value: number;
  text: string;
  at: number;
  /** Tokens it spans: one, or a number and its unit ("4 buc"). */
  span: number;
}

function tokenize(base: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of base.matchAll(separators)) {
    if (match.index > last)
      tokens.push({ text: base.slice(last, match.index), at: last, before: '' });
    last = match.index + match[0].length;
  }
  if (last < base.length) tokens.push({ text: base.slice(last), at: last, before: '' });
  for (let index = 1; index < tokens.length; index++) {
    const previous = tokens[index - 1]!;
    tokens[index]!.before = base.slice(previous.at + previous.text.length, tokens[index]!.at);
  }
  return tokens;
}
function markerOf(text: string, at: number, span: number, read = text): Marker | undefined {
  for (const { marker, strong, pattern } of patterns) {
    const match = pattern.exec(read);
    if (match)
      return { marker, strong, value: Number(match[1]!.replace(',', '.')), text, at, span };
  }
  return undefined;
}
/** A number and its unit across one separator: "4 buc", "4_buc", "6-mm". */
function pairOf(first: Token | undefined, second: Token | undefined, base: string) {
  if (!first || !second || second.before.length !== 1 || !/^\d+(?:[.,]\d+)?$/.test(first.text))
    return undefined;
  return markerOf(
    base.slice(first.at, second.at + second.text.length),
    first.at,
    2,
    `${first.text} ${second.text}`,
  );
}
/** The marker that starts at token `index`: a number with its unit after it, or one token. */
const markerFrom = (tokens: readonly Token[], index: number, base: string) =>
  pairOf(tokens[index], tokens[index + 1], base) ??
  markerOf(tokens[index]!.text, tokens[index]!.at, 1);
/** The marker that ends at token `index`. */
const markerTo = (tokens: readonly Token[], index: number, base: string) =>
  pairOf(tokens[index - 1], tokens[index], base) ??
  markerOf(tokens[index]!.text, tokens[index]!.at, 1);
const usable = (marker: Marker) =>
  marker.marker === 'thickness'
    ? marker.value >= thicknessRange.least && marker.value <= thicknessRange.most
    : Number.isInteger(marker.value) &&
      marker.value >= quantityRange.least &&
      marker.value <= quantityRange.most;
const word: Record<NameMarker, { one: string; many: string }> = {
  thickness: { one: 'thickness', many: 'thicknesses' },
  quantity: { one: 'quantity', many: 'quantities' },
};

export function readJobName(fileName: string): JobName {
  const notes: string[] = [];
  let base = fileName.replace(extension, '').trim();
  let suffix: string | undefined;
  const bracket = /\s*\(([^()]*)\)$/.exec(base);
  if (bracket && bracket.index > 0) {
    suffix = bracket[1]!.trim() || undefined;
    base = base.slice(0, bracket.index);
  }
  const tokens = tokenize(base);
  const found: Marker[] = [];
  const taken = new Set<NameMarker>();
  const consumed = new Set<number>();
  const take = (marker: Marker, first: number) => {
    found.push(marker);
    taken.add(marker.marker);
    for (let k = 0; k < marker.span; k++) consumed.add(first + k);
  };
  // From the front, then from the back, while each token is a marker not read yet.
  let start = 0;
  while (start < tokens.length) {
    const marker = markerFrom(tokens, start, base);
    if (!marker || taken.has(marker.marker)) break;
    take(marker, start);
    start += marker.span;
  }
  let end = tokens.length - 1;
  while (end >= start) {
    const marker = markerTo(tokens, end, base);
    if (!marker || taken.has(marker.marker) || end - marker.span + 1 < start) break;
    take(marker, end - marker.span + 1);
    end -= marker.span;
  }
  // Between them, only the unit-bearing forms are read.
  for (let index = start; index <= end; index++) {
    const marker = markerFrom(tokens, index, base);
    if (!marker?.strong || index + marker.span - 1 > end) continue;
    take(marker, index);
    index += marker.span - 1;
  }
  const reading = (kind: NameMarker): NameReading | undefined => {
    const markers = found.filter((marker) => marker.marker === kind);
    if (!markers.length) return undefined;
    const unusable = markers.find((marker) => !usable(marker));
    if (unusable) {
      notes.push(`“${unusable.text}” gives no usable ${word[kind].one}.`);
      return undefined;
    }
    const values = new Set(markers.map((marker) => marker.value));
    if (values.size > 1) {
      notes.push(
        `The name gives two ${word[kind].many}: ${markers
          .map((marker) => `“${marker.text}”`)
          .join(' and ')}.`,
      );
      return undefined;
    }
    const [first] = markers;
    return { value: first!.value, text: first!.text, at: first!.at };
  };
  const thickness = reading('thickness'),
    quantity = reading('quantity');
  const kept = tokens.filter((_, index) => !consumed.has(index));
  const part = kept.map((token, index) => (index ? token.before : '') + token.text).join('');
  return {
    name: fileName,
    ...(part ? { part } : {}),
    ...(thickness ? { thickness } : {}),
    ...(quantity ? { quantity } : {}),
    ...(suffix ? { suffix } : {}),
    notes,
  };
}

export interface ThicknessGroup<T> {
  /** The thickness in millimetres as text, or "unknown". */
  key: string;
  thickness?: number;
  /** "6 mm", or "Thickness not in name". */
  label: string;
  items: T[];
}
export const thicknessText = (millimetres: number) =>
  `${millimetres.toLocaleString('en', { maximumFractionDigits: 2 })} mm`;

/** Items grouped by thickness, thinnest first: the one `given`, as a request gives it, else the
 * one their names give; those with neither last. */
export function groupByThickness<T>(
  items: readonly T[],
  name: (item: T) => string,
  given?: (item: T) => number | undefined,
): ThicknessGroup<T>[] {
  const groups = new Map<string, ThicknessGroup<T>>();
  for (const item of items) {
    const thickness = given?.(item) ?? readJobName(name(item)).thickness?.value;
    const key = thickness === undefined ? 'unknown' : String(thickness);
    const group = groups.get(key) ?? {
      key,
      ...(thickness === undefined ? {} : { thickness }),
      label: thickness === undefined ? 'Thickness not in name' : thicknessText(thickness),
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.thickness ?? Infinity) - (b.thickness ?? Infinity));
}
