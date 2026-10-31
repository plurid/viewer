/**
 * DARK PAGES: when PDF and Office previews draw pages dark, what the Dark pages button sets, and
 * the colours a dark page is drawn in. The night is local time, may pass midnight, begins at its
 * first minute and ends at its last; the button keeps its choice and names the mode it replaced.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPageMatrix,
  atNight,
  contrast,
  darkPageColors,
  darkPageMatrix,
  darkPagesNote,
  nextNightChange,
  pagesDark,
  readsAsPaper,
  toggledDarkPages,
} from '../src/domain/previews/documents/dark-pages';
import { builtInTheme, themeFor, type Theme } from '../src/domain/preferences/themes';

/** A local time on 31 October 2026. */
const at = (time: string, day = 31) => {
  const [hours, minutes, seconds = 0] = time.split(':').map(Number);
  return new Date(2026, 9, day, hours, minutes, seconds);
};

describe('the night', () => {
  it('passes midnight, from its first minute until, not including, its last', () => {
    const night = (time: string) => atNight(at(time), '20:00', '07:00');
    expect(night('19:59:59')).toBe(false);
    expect(night('20:00')).toBe(true);
    expect(night('23:59:59')).toBe(true);
    expect(night('00:00')).toBe(true);
    expect(night('06:59:59')).toBe(true);
    expect(night('07:00')).toBe(false);
    expect(night('12:00')).toBe(false);
  });
  it('can sit within one day, and is none when it begins as it ends', () => {
    expect(atNight(at('00:30'), '01:00', '05:00')).toBe(false);
    expect(atNight(at('01:00'), '01:00', '05:00')).toBe(true);
    expect(atNight(at('05:00'), '01:00', '05:00')).toBe(false);
    for (const time of ['00:00', '20:00', '20:01', '23:59'])
      expect(atNight(at(time), '20:00', '20:00'), time).toBe(false);
  });
  it('changes next at its nearest edge, the next day once both have passed', () => {
    expect(nextNightChange(at('19:30'), '20:00', '07:00')).toEqual(at('20:00'));
    expect(nextNightChange(at('20:00'), '20:00', '07:00')).toEqual(at('07:00', 32));
    expect(nextNightChange(at('23:00'), '20:00', '07:00')).toEqual(at('07:00', 32));
    expect(nextNightChange(at('03:00'), '20:00', '07:00')).toEqual(at('07:00'));
    expect(nextNightChange(at('07:00'), '20:00', '07:00')).toEqual(at('20:00'));
  });
});

describe('dark pages now', () => {
  const night = { darkPagesFrom: '20:00', darkPagesUntil: '07:00' };
  it('follows each mode: off, on, the night and macOS', () => {
    expect(pagesDark({ ...night, darkPages: 'off' }, at('23:00'), 'dark')).toBe(false);
    expect(pagesDark({ ...night, darkPages: 'on' }, at('12:00'), 'light')).toBe(true);
    expect(pagesDark({ ...night, darkPages: 'night' }, at('23:00'), 'light')).toBe(true);
    expect(pagesDark({ ...night, darkPages: 'night' }, at('12:00'), 'dark')).toBe(false);
    expect(pagesDark({ ...night, darkPages: 'system' }, at('12:00'), 'dark')).toBe(true);
    expect(pagesDark({ ...night, darkPages: 'system' }, at('23:00'), 'light')).toBe(false);
  });
  it('are off for a configuration written before them', () => {
    expect(pagesDark({}, at('23:00'), 'dark')).toBe(false);
    expect(pagesDark({ darkPages: 'night' }, at('21:00'), 'light')).toBe(true);
  });
});

describe('the Dark pages button', () => {
  it('sets the other way from how pages are now, as a choice that stays', () => {
    expect(toggledDarkPages('off', false)).toEqual({ mode: 'on' });
    expect(toggledDarkPages('on', true)).toEqual({ mode: 'off' });
  });
  it('turns an automatic mode into that choice and names the mode, to be told once', () => {
    const night = toggledDarkPages('night', true);
    expect(night).toEqual({ mode: 'off', replaced: 'night' });
    expect(darkPagesNote({ mode: 'off', replaced: 'night' })).toBe(
      'Dark pages stay off. Choose At night in Settings → Previews to switch with the time.',
    );
    expect(toggledDarkPages('night', false)).toEqual({ mode: 'on', replaced: 'night' });
    expect(toggledDarkPages('system', false)).toEqual({ mode: 'on', replaced: 'system' });
    expect(darkPagesNote({ mode: 'on', replaced: 'system' })).toBe(
      'Dark pages stay on. Choose With macOS dark mode in Settings → Previews to follow macOS.',
    );
  });
});

describe('a dark page’s colours', () => {
  it('come from the dark theme, readable and not pure black and white', () => {
    const colors = darkPageColors(themeFor({ themes: [], theme: { dark: '', light: '' } }, 'dark'));
    const shell = builtInTheme('dark').shell;
    expect(colors).toEqual({ page: shell.surface, ink: shell.ink, accent: shell.accent });
    expect(colors.page).not.toBe('#000000');
    expect(colors.ink).not.toBe('#ffffff');
    expect(contrast(colors.ink, colors.page)).toBeGreaterThanOrEqual(7);
    // the outline of a tour's stop and its text marks show on the page
    expect(contrast(colors.accent, colors.page)).toBeGreaterThanOrEqual(3);
  });
  it('fall back where a theme would not read, and where its accent would not show', () => {
    const theme = (shell: Theme['shell']): Theme => ({
      id: 'mine',
      name: 'Mine',
      look: 'dark',
      shell: { ...builtInTheme('dark').shell, ...shell },
      syntax: {},
      terminal: {},
    });
    const base = builtInTheme('dark').shell;
    // ink too close to its surface, and a surface that is not dark
    for (const shell of [{ ink: '#505560' }, { surface: '#d0d0d0', ink: '#ffffff' }])
      expect(darkPageColors(theme(shell))).toMatchObject({ page: base.surface, ink: base.ink });
    // a theme's own page and ink, with an accent too dark to outline anything on it
    const own = darkPageColors(theme({ surface: '#1d2021', ink: '#ebdbb2', accent: '#26292b' }));
    expect(own).toEqual({ page: '#1d2021', ink: '#ebdbb2', accent: base.accent });
    expect(darkPageColors(theme({ surface: '#1d2021', accent: '#fabd2f' })).accent).toBe('#fabd2f');
  });
  it('turn paper into the page and black ink into the ink, a colour keeping its hue', () => {
    const colors = { page: '#31353d', ink: '#f2f4f6', accent: '#82b3cf' };
    const matrix = darkPageMatrix(colors);
    expect(matrix).toHaveLength(20);
    expect(applyPageMatrix(matrix, [255, 255, 255])).toEqual([0x31, 0x35, 0x3d]);
    expect(applyPageMatrix(matrix, [0, 0, 0])).toEqual([0xf2, 0xf4, 0xf6]);
    // grey keeps its place between them
    const [grey] = applyPageMatrix(matrix, [128, 128, 128]);
    expect(grey).toBeGreaterThan(0x31);
    expect(grey).toBeLessThan(0xf2);
    // red stays red, and a dark blue becomes a light blue
    const [red, green, blue] = applyPageMatrix(matrix, [200, 30, 30]);
    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);
    const navy = applyPageMatrix(matrix, [20, 40, 120]);
    expect(navy[2]).toBeGreaterThan(navy[0]);
    expect(navy[2]).toBeGreaterThan(120);
  });
});

describe('a picture on a page', () => {
  const pixels = (colour: (index: number) => [number, number, number], count = 400) =>
    Uint8ClampedArray.from({ length: count * 4 }, (_, index) =>
      index % 4 === 3 ? 255 : colour(Math.floor(index / 4))[index % 4]!,
    );
  it('reads as paper when it is mostly light and with little colour: a scan, an old book, a chart', () => {
    expect(readsAsPaper(pixels((index) => (index % 10 ? [250, 250, 250] : [20, 20, 20])))).toBe(
      true,
    );
    expect(readsAsPaper(pixels((index) => (index % 8 ? [238, 226, 196] : [60, 50, 40])))).toBe(
      true,
    );
    expect(readsAsPaper(pixels((index) => (index % 6 ? [255, 255, 255] : [30, 110, 220])))).toBe(
      true,
    );
  });
  it('is a photograph otherwise, which keeps its colours', () => {
    const photo = pixels((index) => [(index * 37) % 200, (index * 91) % 180, (index * 53) % 160]);
    expect(readsAsPaper(photo)).toBe(false);
    expect(readsAsPaper(pixels(() => [255, 200, 40]))).toBe(false);
    expect(readsAsPaper(new Uint8ClampedArray(16))).toBe(false);
  });
});
