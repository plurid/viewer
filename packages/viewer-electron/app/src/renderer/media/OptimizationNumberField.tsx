import type { InputHTMLAttributes } from 'react';
import { NumberField } from '../ui/NumberField';

/** An Optimize number: the shared number field, decimal where its step is `any` (a target size in
 * kB or MB), whole otherwise. A recipe that loads replaces what shows. */
export function OptimizationNumberField({
  value,
  onValue,
  min,
  max,
  step,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> & {
  value: number;
  onValue(value: number): void;
  min?: number;
  max?: number;
  step?: number | 'any';
}) {
  return (
    <NumberField
      {...props}
      value={value}
      onCommit={onValue}
      min={min}
      max={max}
      kind={step === 'any' ? 'decimal' : 'integer'}
      step={typeof step === 'number' ? step : 1}
    />
  );
}
