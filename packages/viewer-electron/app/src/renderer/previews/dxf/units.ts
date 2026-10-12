import { angleAt, distance, polygonArea, type Point } from './math';
export const units = [
  { id: 0, label: 'Drawing units', symbol: 'units', mm: undefined },
  { id: 4, label: 'Millimetres', symbol: 'mm', mm: 1 },
  { id: 5, label: 'Centimetres', symbol: 'cm', mm: 10 },
  { id: 6, label: 'Metres', symbol: 'm', mm: 1000 },
  { id: 1, label: 'Inches', symbol: 'in', mm: 25.4 },
  { id: 2, label: 'Feet', symbol: 'ft', mm: 304.8 },
  { id: 3, label: 'Miles', symbol: 'mi', mm: 1609344 },
  { id: 7, label: 'Kilometres', symbol: 'km', mm: 1000000 },
  { id: 8, label: 'Microinches', symbol: 'µin', mm: 0.0000254 },
  { id: 9, label: 'Mils', symbol: 'mil', mm: 0.0254 },
  { id: 10, label: 'Yards', symbol: 'yd', mm: 914.4 },
  { id: 11, label: 'Ångströms', symbol: 'Å', mm: 1e-7 },
  { id: 12, label: 'Nanometres', symbol: 'nm', mm: 1e-6 },
  { id: 13, label: 'Microns', symbol: 'µm', mm: 0.001 },
  { id: 14, label: 'Decimetres', symbol: 'dm', mm: 100 },
  { id: 15, label: 'Decametres', symbol: 'dam', mm: 10000 },
  { id: 16, label: 'Hectometres', symbol: 'hm', mm: 100000 },
  { id: 17, label: 'Gigametres', symbol: 'Gm', mm: 1e12 },
  { id: 18, label: 'Astronomical units', symbol: 'au', mm: 149597870700000 },
  { id: 19, label: 'Light years', symbol: 'ly', mm: 9.4607304725808e18 },
  { id: 20, label: 'Parsecs', symbol: 'pc', mm: 3.0856775814913673e19 },
  { id: 21, label: 'US survey feet', symbol: 'ft (US)', mm: 1200000 / 3937 },
  { id: 22, label: 'US survey inches', symbol: 'in (US)', mm: 100000 / 3937 },
  { id: 23, label: 'US survey yards', symbol: 'yd (US)', mm: 3600000 / 3937 },
  { id: 24, label: 'US survey miles', symbol: 'mi (US)', mm: 6336000000 / 3937 },
] as const;
export function unitInfo(id: number) {
  return units.find((u) => u.id === id) ?? units[0];
}
export function formatMeasure(value: number, unitID: number, squared = false): string {
  const symbol = unitInfo(unitID).symbol;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)} ${symbol}${squared ? '²' : ''}`;
}
export function convertUnits(
  value: number,
  source: number,
  target: number,
  squared = false,
): number {
  const a = unitInfo(source).mm,
    b = unitInfo(target).mm;
  const factor = a && b ? a / b : 1;
  return value * (squared ? factor * factor : factor);
}
export type Tool = 'inspect' | 'distance' | 'angle' | 'area';
export interface Measurement {
  id: number;
  tool: Exclude<Tool, 'inspect'>;
  points: Point[];
}
export function measurementValue(measurement: Measurement): number | undefined {
  const p = measurement.points;
  return measurement.tool === 'distance'
    ? distance(p[0], p[1])
    : measurement.tool === 'area'
      ? polygonArea(p)
      : angleAt(p[0], p[1], p[2]);
}
