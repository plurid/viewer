/**
 * New themes, layouts, profiles and macros get readable IDs from their names. Two made in the
 * same millisecond once shared one; an ID already taken now gets a counter.
 */
import { importVSCodeTheme } from '../src/domain/preferences/theme-import';
import { settingsSchema } from '../src/desktop/preferences/settings-schema';
import { expect, it } from 'vitest';
import { slugID, slugOf } from '../src/domain/ids';

it('slugs a name, or falls back when nothing is left', () => {
  expect(slugOf('Night Owl (2)', 'theme')).toBe('night-owl-2');
  expect(slugOf('***', 'theme')).toBe('theme');
});

it('makes a readable ID that is unique among those taken', () => {
  const now = 1_700_000_000_000;
  const first = slugID('Triage', 'layout', [], now);
  expect(first).toBe(`triage-${now.toString(36)}`);
  expect(slugID('Triage', 'layout', [first], now)).toBe(`${first}-2`);
  expect(slugID('Triage', 'layout', [first, `${first}-2`], now)).toBe(`${first}-3`);
});

it('bounds long IDs including collision counters and imported theme names', () => {
  const name = 'a'.repeat(100);
  const taken = new Set<string>();
  for (let index = 0; index < 12; index++) {
    const id = slugID(name, 'layout', taken, 1700000000000);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(taken.has(id)).toBe(false);
    taken.add(id);
  }
  const theme = importVSCodeTheme(
    JSON.stringify({ name: name + 'x', colors: { 'editor.background': '#ffffff' } }),
  );
  expect(settingsSchema.shape.themes.parse([theme])[0]?.name).toBe(name);
});
