import { useEffect, useState } from 'react';
import { mediaTime } from '../../domain/operations/transforms';
export function Timecode({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange(value: number): void;
}) {
  const [text, setText] = useState(mediaTime(value));
  useEffect(() => setText(mediaTime(value)), [value]);
  return (
    <label className="media-timecode">
      <span>{label}</span>
      <input
        aria-label={label}
        value={text}
        inputMode="decimal"
        onChange={(event) => {
          setText(event.target.value);
          event.target.setCustomValidity('');
        }}
        onBlur={(event) => {
          const parts = text.split(':').map(Number);
          const seconds = parts.reduce((value, part) => value * 60 + part, 0);
          if (parts.length > 3 || !Number.isFinite(seconds) || seconds < min || seconds > max) {
            event.target.setCustomValidity(
              `Enter a time between ${mediaTime(min)} and ${mediaTime(max)}.`,
            );
            event.target.reportValidity();
            setText(mediaTime(value));
            return;
          }
          onChange(seconds);
          setText(mediaTime(seconds));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
