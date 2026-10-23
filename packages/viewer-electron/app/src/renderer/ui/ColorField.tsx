import type { CSSProperties } from 'react';

/** Space colours that suit each appearance: quiet, so planes and their text stay the focus. */
export const spaceSwatches = {
  dark: [
    ['Graphite', '#1e2024'],
    ['Midnight', '#141a24'],
    ['Ocean', '#0f2633'],
    ['Forest', '#12241b'],
    ['Plum', '#221a2c'],
    ['Wine', '#2a161b'],
    ['Umber', '#2a2219'],
    ['Slate', '#262c33'],
  ],
  light: [
    ['Paper', '#f7f5f0'],
    ['Mist', '#eef2f5'],
    ['Sky', '#e6f0f8'],
    ['Mint', '#e8f4ec'],
    ['Lavender', '#f0ecf7'],
    ['Rose', '#f8ecee'],
    ['Sand', '#f5efe4'],
    ['Stone', '#ebebeb'],
  ],
} as const;
/**
 * A SPACE COLOUR (2026-10-23): the automatic colour (the appearance's, or a workspace's general one),
 * swatches for the appearance, and a colour of one's own from the system picker.
 */
export function ColorField({
  label,
  value,
  look,
  automatic,
  automaticColor,
  onChange,
}: {
  label: string;
  /** `#rrggbb`, or empty for the automatic colour. */
  value: string;
  look: 'dark' | 'light';
  /** The automatic choice's name: "Automatic", "General colour". */
  automatic: string;
  /** What the automatic choice is now, shown on it and offered first by the picker. */
  automaticColor?: string;
  onChange(value: string): void;
}) {
  const swatches = spaceSwatches[look];
  const own = !!value && !swatches.some(([, color]) => color === value);
  const swatch = (color: string) => ({ '--swatch': color }) as CSSProperties;
  return (
    <div className="color-field" role="group" aria-label={label}>
      <button
        type="button"
        className="color-automatic"
        aria-pressed={!value}
        title={automaticColor ? `${automatic} (${automaticColor})` : automatic}
        onClick={() => onChange('')}
      >
        {automaticColor && <span className="color-dot" style={swatch(automaticColor)} />}
        {automatic}
      </button>
      {swatches.map(([name, color]) => (
        <button
          key={color}
          type="button"
          className="color-swatch"
          aria-label={name}
          aria-pressed={value === color}
          title={`${name} (${color})`}
          style={swatch(color)}
          onClick={() => onChange(color)}
        />
      ))}
      <label
        className="color-swatch color-own"
        data-selected={own}
        title={own ? `Your colour (${value})` : 'A colour of your own'}
        style={own ? swatch(value) : undefined}
      >
        <input
          type="color"
          aria-label="Custom colour"
          value={value || automaticColor || '#272a30'}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
      </label>
    </div>
  );
}
