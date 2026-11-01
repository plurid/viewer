import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A public, fictional CC0 project with independently calculable outcomes. */
export async function canvasProject(directory: string): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const lines = [
    'Workshop kits',
    'Purchase planning request',
    'Compare the two attached supplier quotations.',
    'Start with 20 kits and a budget of EUR 2000.',
    'The initial delivery window is 10 calendar days.',
    'All prices include tax. Shipping is charged once per order.',
    'Each supplier can deliver the entire requested quantity.',
    'Use the same currency throughout; no exchange rate is needed.',
    'We may increase to 40 kits and require delivery within 3 days.',
    'Prepare a comparison and a decision report; do not place an order.',
    'Public sample: fictional suppliers and prices. CC0-1.0.',
  ];
  const stream =
    'BT /F1 18 Tf 48 750 Td ' +
    lines
      .map(
        (line, index) =>
          `${index ? '0 -30 Td /F1 12 Tf ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`,
      )
      .join('\n') +
    '\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const files = new Map([
    ['Request.pdf', pdf],
    ['North.csv', 'supplier,unit_price_eur,shipping_eur,delivery_days\nNorth,42,180,7\n'],
    ['East.csv', 'supplier,unit_price_eur,shipping_eur,delivery_days\nEast,48,40,2\n'],
  ]);
  for (const [name, content] of files)
    await writeFile(path.join(directory, name), content, { flag: 'wx' });
  return [...files.keys()].map((name) => path.join(directory, name));
}

export const canvasGoldenCases = [
  {
    quantity: 20,
    budget: 2000,
    deadlineDays: 10,
    north: 1020,
    east: 1000,
    eligible: ['North', 'East'],
    cheapestEligible: 'East',
  },
  {
    quantity: 40,
    budget: 2000,
    deadlineDays: 3,
    north: 1860,
    east: 1960,
    eligible: ['East'],
    cheapestEligible: 'East',
  },
  {
    quantity: 40,
    budget: 2000,
    deadlineDays: 7,
    north: 1860,
    east: 1960,
    eligible: ['North', 'East'],
    cheapestEligible: 'North',
  },
];
