/**
 * A DXF PART'S VALUES IN WORDS: its quantity and thickness as its cut sheet lists them, with where
 * each comes from (reconcile.ts decides them).
 */
import type { PartPlan, PartQuantity, ValueSource } from './reconcile';
import { countText } from '../layout/nesting/format';
import { thicknessText } from './names';

export const valueSourceLabels: Record<ValueSource, string> = {
  request: 'from the request',
  drawing: 'from the drawing',
  name: 'from the file name',
};
/** "4 pieces", or "2 sets × 2 pieces = 4 pieces" for a drawing of several separate pieces. */
export function quantityText(quantity: Pick<PartQuantity, 'sets' | 'pieces'>): string {
  const each = quantity.pieces / quantity.sets;
  return each === 1
    ? countText(quantity.pieces, 'piece')
    : `${countText(quantity.sets, 'set')} × ${countText(each, 'piece')} = ${countText(quantity.pieces, 'piece')}`;
}
/** "from the request", or "from the file name (“2buc”)" with the text the name was read from. */
function sourceText(source: ValueSource, quotes: readonly (string | undefined)[]): string {
  const read = source === 'name' ? quotes.filter(Boolean).map((quote) => `“${quote}”`) : [];
  return read.length
    ? `${valueSourceLabels[source]} (${read.join(', ')})`
    : valueSourceLabels[source];
}
/**
 * A part's quantity and thickness as its cut sheet lists them: "10 pieces · 3 mm, both from the
 * request", or each with its own source when they differ. Undefined when the job gives neither.
 */
export function partValuesText(part: Pick<PartPlan, 'quantity' | 'thickness'>): string | undefined {
  const { quantity, thickness } = part;
  // a count only a name gives is taken as sets; nothing says it is not pieces
  const caveat =
    quantity?.source === 'name' && quantity.pieces !== quantity.sets
      ? '; nothing else in the job says whether it counts sets or pieces'
      : '';
  if (quantity && thickness && quantity.source === thickness.source) {
    const from = sourceText(quantity.source, [quantity.quote, thickness.quote]);
    return `${quantityText(quantity)} · ${thicknessText(thickness.value)}, both ${from}${caveat}`;
  }
  const values = [
    quantity &&
      `${quantityText(quantity)}, ${sourceText(quantity.source, [quantity.quote])}${caveat}`,
    thickness &&
      `${thicknessText(thickness.value)}, ${sourceText(thickness.source, [thickness.quote])}`,
  ].filter(Boolean);
  return values.length ? values.join(' · ') : undefined;
}
