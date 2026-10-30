/** Nesting figures in words, the same in the panel, the report and the CSV. */

const number = (value: number, digits = 0) =>
  value.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
/** "850 mm" up to a metre, then "8.95 m", "12.3 m" and "152 m". */
export const lengthText = (millimetres: number) =>
  millimetres < 1000
    ? `${number(millimetres)} mm`
    : `${number(millimetres / 1000, millimetres < 10_000 ? 2 : millimetres < 100_000 ? 1 : 0)} m`;
export const areaText = (squareMillimetres: number) =>
  `${number(squareMillimetres / 1e6, squareMillimetres < 1e7 ? 3 : 2)} m²`;
export const sizeText = (width: number, height: number) =>
  `${number(width, 1)} × ${number(height, 1)} mm`;
/** A gap to a tenth of a millimetre: "5.4 mm". */
export const gapText = (millimetres: number) => `${number(millimetres, 1)} mm`;
export const percentText = (fraction: number) => `${Math.round(fraction * 100)}%`;
export const weightText = (kilograms: number) =>
  kilograms < 1
    ? `${number(kilograms * 1000)} g`
    : `${number(kilograms, kilograms < 100 ? 1 : 0)} kg`;
export function durationText(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60),
    rest = whole % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
/** A one-character symbol leads ("€120"); a longer one follows ("120 lei"). */
export function moneyText(value: number, currency: string): string {
  const amount = number(value, value < 100 ? 2 : 0);
  if (!currency) return amount;
  return [...currency].length === 1 ? `${currency}${amount}` : `${amount} ${currency}`;
}
export const countText = (count: number, one: string, many = one + 's') =>
  `${number(count)} ${count === 1 ? one : many}`;
