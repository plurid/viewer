export const textComparisonModes = [
  { value: 'split', label: 'Side by side' },
  { value: 'unified', label: 'Unified' },
] as const;

export const imageComparisonModes = [
  { value: 'slider', label: 'Slider' },
  { value: 'onion', label: 'Onion skin' },
  { value: 'side', label: 'Side by side' },
  { value: 'difference', label: 'Difference' },
] as const;

export type ImageComparisonMode = (typeof imageComparisonModes)[number]['value'];

export function imageComparisonMode(value: string | undefined): ImageComparisonMode {
  return imageComparisonModes.find((mode) => mode.value === value)?.value ?? 'slider';
}
