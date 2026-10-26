export const looks = {
  dark: {
    scheme: 'dark' as const,
    space: '#272a30',
    surface: '#31353d',
    ink: '#f2f4f6',
    accent: '#82b3cf',
  },
  light: {
    scheme: 'light' as const,
    space: '#eef0f4',
    surface: '#ffffff',
    ink: '#202733',
    accent: '#337396',
  },
};

const chosenLooks = new Map<string, (typeof looks)[keyof typeof looks] & { grid: boolean }>();
/** The four colours plurid derives its look from, as a theme gives them. */
export type LookPalette = Partial<Record<'space' | 'surface' | 'ink' | 'accent', string>>;
/**
 * plurid's look with the space's grid and colour from Settings → Space, or the workspace's own
 * colour, over the theme's colours. plurid derives the rest from it, so the grid lines,
 * minimap and palette backdrop follow too. One object per choice: plurid resolves a look once per
 * object.
 */
export function spaceLook(
  look: keyof typeof looks,
  { grid, color, palette }: { grid: boolean; color: string; palette?: LookPalette },
) {
  const themed = palette && Object.keys(palette).length ? palette : undefined;
  if (grid && !color && !themed) return looks[look];
  const key = `${look}|${grid}|${color}|${JSON.stringify(themed ?? {})}`;
  let chosen = chosenLooks.get(key);
  if (!chosen) {
    chosen = { ...looks[look], ...themed, grid, ...(color ? { space: color } : {}) };
    chosenLooks.set(key, chosen);
  }
  return chosen;
}
