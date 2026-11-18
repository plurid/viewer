import { useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent } from 'react';

/** What a number field passes on: whole numbers, or decimals as typed. */
export type NumberKind = 'integer' | 'decimal';

/** The value `text` stands for, kept inside `min` and `max` and to whole numbers where asked;
 * undefined when it is not a number at all, so the field goes back to its value. */
export function numberFromText(
  text: string,
  { min, max, kind = 'integer' }: { min?: number; max?: number; kind?: NumberKind },
): number | undefined {
  const parsed = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(parsed)) return undefined;
  const whole = kind === 'integer' ? Math.round(parsed) : parsed;
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, whole));
}

/**
 * A NUMBER FIELD as a Mac's: a text field with no spin arrows that takes what is typed as a draft,
 * applies it on Return or when it loses focus, clamped once to its limits, and goes back to its
 * value on Escape or when the text is not a number. ↑ and ↓ step it. Typing "50" into a field
 * whose minimum is 10 is never cut to 10 at the "5".
 */
/** A field that must hold a number, or one where empty means none, such as "Original" size. */
type NumberValue =
  | { value: number; onCommit(value: number): void; empty?: false }
  | { value: number | undefined; onCommit(value: number | undefined): void; empty: true };

export function NumberField({
  value,
  onCommit,
  empty = false,
  min,
  max,
  step = 1,
  kind = 'integer',
  className = '',
  onKeyDown,
  onBlur,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> &
  NumberValue & {
    min?: number;
    max?: number;
    step?: number;
    kind?: NumberKind;
  }) {
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? (value === undefined ? '' : String(value));
  const apply = onCommit as (value: number | undefined) => void;
  const commit = (text: string) => {
    setDraft(undefined);
    if (empty && !text.trim()) {
      if (value !== undefined) apply(undefined);
      return;
    }
    const next = numberFromText(text, { min, max, kind });
    if (next !== undefined && next !== value) apply(next);
  };
  // a step of 0.1 adds no binary noise: 0.30000000000000004 reads 0.3
  const places = (String(step).split('.')[1] ?? '').length;
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && draft !== undefined) {
      // the first Return applies the draft; a form's own Return acts on the value once it shows
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Escape' && draft !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(undefined);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = numberFromText(shown, { min, max, kind }) ?? value ?? min ?? 0;
      const next = base + (event.key === 'ArrowUp' ? step : -step) * (event.shiftKey ? 10 : 1);
      commit(next.toFixed(places));
    }
  };
  return (
    <input
      {...props}
      type="text"
      inputMode={kind === 'integer' ? 'numeric' : 'decimal'}
      className={`number-field ${className}`}
      value={shown}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={keyDown}
      onBlur={(event) => {
        if (draft !== undefined) commit(draft);
        onBlur?.(event);
      }}
    />
  );
}
