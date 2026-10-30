import { unzipModelPackage } from './packages';

const unitScale: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  meter: 1000,
  inch: 25.4,
  foot: 304.8,
};

/** Bound archive allocation and normalize 3MF's physical units, which Three's loader ignores. */
export function printingScale(buffer: ArrayBuffer): number {
  const files = unzipModelPackage(new Uint8Array(buffer), '3MF', (name) => /\.model$/i.test(name));
  const scales = new Set<number>();
  for (const file of Object.values(files)) {
    const document = new DOMParser().parseFromString(
      new TextDecoder().decode(file),
      'application/xml',
    );
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'model')
      throw new Error('This 3MF file has an invalid model document.');
    const unit = document.documentElement.getAttribute('unit') || 'millimeter';
    if (!unitScale[unit]) throw new Error(`Unsupported 3MF unit: ${unit}.`);
    scales.add(unitScale[unit]);
  }
  if (!scales.size) throw new Error('No model was found in this 3MF file.');
  if (scales.size > 1)
    throw new Error(
      'This 3MF contains models with different units. Export them with a shared unit to preview.',
    );
  const [scale] = scales;
  if (scale === undefined) throw new Error('No model was found in this 3MF file.');
  return scale;
}
