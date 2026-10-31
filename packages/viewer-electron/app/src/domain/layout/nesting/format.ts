/** Nesting figures in words, the same in the panel, the report and the CSV. Values arrive in
 * millimetres and read in the unit chosen: millimetres and metres, or inches and feet. */
import { millimetresPerInch, type LengthUnit } from './plan';

const number = (value: number, digits = 0) =>
  value.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const inches = (millimetres: number) => millimetres / millimetresPerInch;
/** A length in the unit, as a plain number for a field or a CSV cell. */
export const inUnit = (millimetres: number, units: LengthUnit) =>
  units === 'in' ? inches(millimetres) : millimetres;
/** A length typed in the unit, in millimetres, without the float's last digit. */
export const fromUnit = (value: number, units: LengthUnit) =>
  units === 'in' ? Number((value * millimetresPerInch).toFixed(6)) : value;
/** A field's value: millimetres to a hundredth, inches to a thousandth. */
export const fieldValue = (millimetres: number, units: LengthUnit) =>
  Number(inUnit(millimetres, units).toFixed(units === 'in' ? 3 : 2));
export const unitSymbol = (units: LengthUnit) => (units === 'in' ? 'in' : 'mm');
/** "850 mm" up to a metre, then "8.95 m", "12.3 m" and "152 m"; in inches "35.4 in" up to ten
 * feet, then "29.5 ft" and "1,204 ft". */
export function lengthText(millimetres: number, units: LengthUnit = 'mm'): string {
  if (units === 'in') {
    const value = inches(millimetres);
    if (value < 120) return `${number(value, 1)} in`;
    const feet = value / 12;
    return `${number(feet, feet < 1000 ? 1 : 0)} ft`;
  }
  return millimetres < 1000
    ? `${number(millimetres)} mm`
    : `${number(millimetres / 1000, millimetres < 10_000 ? 2 : millimetres < 100_000 ? 1 : 0)} m`;
}
/** "0.012 m²"; in inches "72.5 in²" up to a square foot, then "3.36 ft²". */
export function areaText(squareMillimetres: number, units: LengthUnit = 'mm'): string {
  if (units === 'in') {
    const value = squareMillimetres / millimetresPerInch ** 2;
    return value < 144 ? `${number(value, 1)} in²` : `${number(value / 144, 2)} ft²`;
  }
  return `${number(squareMillimetres / 1e6, squareMillimetres < 1e7 ? 3 : 2)} m²`;
}
export const sizeText = (width: number, height: number, units: LengthUnit = 'mm') =>
  units === 'in'
    ? `${number(inches(width), 2)} × ${number(inches(height), 2)} in`
    : `${number(width, 1)} × ${number(height, 1)} mm`;
/** A gap to a tenth of a millimetre, "5.4 mm", or a thousandth of an inch, "0.213 in". */
export const gapText = (millimetres: number, units: LengthUnit = 'mm') =>
  units === 'in' ? `${number(inches(millimetres), 3)} in` : `${number(millimetres, 1)} mm`;
/** "4,000 mm/min", or "157.5 in/min". */
export const speedText = (millimetresPerMinute: number, units: LengthUnit = 'mm') =>
  units === 'in'
    ? `${number(inches(millimetresPerMinute), 1)} in/min`
    : `${number(millimetresPerMinute)} mm/min`;
export const percentText = (fraction: number) => `${Math.round(fraction * 100)}%`;
/** Kilograms, or pounds when lengths read in inches. */
export function weightText(kilograms: number, units: LengthUnit = 'mm'): string {
  if (units === 'in') {
    const pounds = kilograms / 0.45359237;
    return pounds < 1
      ? `${number(pounds * 16, 1)} oz`
      : `${number(pounds, pounds < 100 ? 1 : 0)} lb`;
  }
  return kilograms < 1
    ? `${number(kilograms * 1000)} g`
    : `${number(kilograms, kilograms < 100 ? 1 : 0)} kg`;
}
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
