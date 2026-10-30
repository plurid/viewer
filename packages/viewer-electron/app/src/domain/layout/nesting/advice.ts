/** Plain advice from a nesting: which format to buy, what does not fit, what more freedom saves. */
import { countText, moneyText, percentText, sizeText } from './format';
import { sheetLength, sheetWidth, type NestFormat, type NestPart } from './nest';
import { sheetName } from './plan';
import type { BoxEstimate } from './rectangles';
import type { NestSummary } from './search';

export type AdviceTone = 'saving' | 'warning' | 'note';
export interface Advice {
  tone: AdviceTone;
  text: string;
}
export interface AdviceInput {
  names: readonly string[];
  parts: readonly NestPart[];
  formats: readonly NestFormat[];
  margin: number;
  /** The best true-shape layout so far. */
  best?: NestSummary;
  /** The best true-shape layout on each format alone. */
  single: readonly (NestSummary | undefined)[];
  /** The box estimate on each format alone. */
  boxes: readonly BoxEstimate[];
  looser?: { summary: NestSummary; loosened: readonly number[]; rotation: string };
  currency: string;
}
interface Outcome {
  format: number;
  sheets: number;
  placed: number;
  utilisation: number;
  cost: number;
}

/** Whether a part's turned box fits inside a format's margin at any of `angles`. */
export function fitsFormat(
  part: Pick<NestPart, 'rings' | 'paths'>,
  angles: readonly number[],
  format: NestFormat,
  margin: number,
): boolean {
  const length = sheetLength(format) - 2 * margin,
    width = sheetWidth(format) - 2 * margin;
  return angles.some((angle) => {
    const radians = (angle * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const values of [...part.rings, ...part.paths])
      for (let i = 0; i < values.length; i += 2) {
        const x = cos * values[i]! - sin * values[i + 1]!,
          y = sin * values[i]! + cos * values[i + 1]!;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    return x1 - x0 <= length + 1e-9 && y1 - y0 <= width + 1e-9;
  });
}
const everyAngle = Array.from({ length: 72 }, (_, i) => i * 5);

export function nestingAdvice(input: AdviceInput): Advice[] {
  const advice: Advice[] = [];
  const priced = input.formats.some((format) => format.price > 0);
  const requested = input.parts.reduce((sum, part) => sum + part.quantity, 0);
  let tooLarge = 0;
  input.parts.forEach((part, index) => {
    if (!part.quantity) return;
    if (input.formats.some((format) => fitsFormat(part, part.angles, format, input.margin))) return;
    tooLarge += part.quantity;
    const name = input.names[index]!;
    advice.push(
      input.formats.some((format) => fitsFormat(part, everyAngle, format, input.margin))
        ? {
            tone: 'warning',
            text: `${name} fits a sheet only when turned. Allow it to turn further.`,
          }
        : {
            tone: 'warning',
            text: `${name} (${sizeText(part.width, part.height)}) is larger than every sheet.`,
          },
    );
  });
  if (input.best && input.best.placed < requested - tooLarge)
    advice.push({
      tone: 'warning',
      text: `${countText(requested - tooLarge - input.best.placed, 'part')} do not fit the sheets in stock. Add stock or allow another format.`,
    });

  // Each format alone, from true-shape layouts when there are any, else from boxes.
  const outcomes: Outcome[] = input.formats.map((format, index) => {
    const summary = input.single[index];
    if (summary)
      return {
        format: index,
        sheets: summary.sheets,
        placed: summary.placed,
        utilisation: summary.utilisation,
        cost: summary.cost,
      };
    const boxes = input.boxes[index]!;
    const area = boxes.sheets.reduce((sum, sheet) => sum + sheet.area, 0);
    return {
      format: index,
      sheets: boxes.sheets.length,
      placed: requested - boxes.unplaced.reduce((sum, count) => sum + count, 0),
      utilisation: boxes.sheets.length
        ? area / (boxes.sheets.length * format.width * format.height)
        : 0,
      cost: boxes.sheets.length * format.price,
    };
  });
  if (outcomes.length > 1) {
    const material = (o: Outcome) =>
      o.sheets * input.formats[o.format]!.width * input.formats[o.format]!.height;
    const ranked = [...outcomes].sort(
      (a, b) =>
        b.placed - a.placed ||
        (priced ? a.cost - b.cost : material(a) - material(b)) ||
        a.sheets - b.sheets,
    );
    for (const o of ranked)
      advice.push({
        tone: 'note',
        text:
          `${sheetName(input.formats[o.format]!)}: ${countText(o.sheets, 'sheet')}, ${percentText(o.utilisation)} used` +
          (priced ? `, ${moneyText(o.cost, input.currency)}` : '') +
          (o.placed < requested ? `, ${countText(requested - o.placed, 'part')} left off` : ''),
      });
    const complete = ranked.filter((o) => o.placed === ranked[0]!.placed);
    const fewest = [...complete].sort((a, b) => a.sheets - b.sheets || a.cost - b.cost)[0]!;
    if (complete.length > 1 && complete.some((o) => o.sheets > fewest.sheets))
      advice.push({
        tone: 'saving',
        text: `${sheetName(input.formats[fewest.format]!)} needs the fewest sheets.`,
      });
    if (priced && complete[0] && complete[0] !== fewest)
      advice.push({
        tone: 'saving',
        text: `${sheetName(input.formats[complete[0].format]!)} costs least.`,
      });
    const mixed = input.best;
    if (mixed && new Set(mixed.layout.sheets.map((sheet) => sheet.format)).size > 1) {
      const counts = new Map<number, number>();
      for (const sheet of mixed.layout.sheets)
        counts.set(sheet.format, (counts.get(sheet.format) ?? 0) + 1);
      advice.push({
        tone: 'saving',
        text:
          'Mixing formats does best: ' +
          [...counts]
            .map(([format, count]) => `${count} × ${sheetName(input.formats[format]!)}`)
            .join(' and ') +
          (priced ? `, ${moneyText(mixed.cost, input.currency)}.` : '.'),
      });
    }
  }

  const best = input.best;
  if (best) {
    const format = best.layout.sheets[0]?.format;
    const boxes = format === undefined ? undefined : input.boxes[format];
    const saved = boxes ? boxes.sheets.length - best.sheets : 0;
    if (saved > 0 && best.layout.sheets.every((sheet) => sheet.format === format))
      advice.push({
        tone: 'saving',
        text: `True-shape nesting saves ${countText(saved, 'sheet')} over packing the parts' boxes.`,
      });
    const looser = input.looser;
    if (looser && looser.summary.placed >= best.placed && looser.summary.sheets < best.sheets) {
      const names = looser.loosened.map((index) => input.names[index]!);
      const listed =
        names.length > 3
          ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
          : names.length > 1
            ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
            : names[0]!;
      advice.push({
        tone: 'saving',
        text: `Letting ${listed} turn in ${looser.rotation} would save ${countText(best.sheets - looser.summary.sheets, 'sheet')} (${looser.summary.sheets} instead of ${best.sheets}).`,
      });
    }
    const last = best.layout.sheets.at(-1);
    if (last && best.sheets > 1) {
      const size = input.formats[last.format]!;
      const used = last.area / (size.width * size.height);
      if (used < 0.25)
        advice.push({
          tone: 'note',
          text: `Sheet ${best.sheets} is only ${percentText(used)} used, by ${countText(last.placements.length, 'part')}. Fewer copies would save it.`,
        });
    }
  }
  return advice;
}
