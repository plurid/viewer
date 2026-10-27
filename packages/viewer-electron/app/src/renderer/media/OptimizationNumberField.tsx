import { useState, type InputHTMLAttributes } from 'react';

/** Preserve an incomplete numeric edit (including empty text) while the parent
 * validates its numeric value. Loading a recipe replaces the draft. */
export function OptimizationNumberField({
  value,
  onValue,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValue(value: number): void;
}) {
  const [draft, setDraft] = useState({ value, text: String(value) });
  if (draft.value !== value) setDraft({ value, text: String(value) });
  return (
    <input
      {...props}
      type="number"
      value={draft.value === value ? draft.text : String(value)}
      onChange={(event) => {
        const text = event.target.value;
        const next = Number(text) || 0;
        setDraft({ value: next, text });
        onValue(next);
      }}
    />
  );
}
