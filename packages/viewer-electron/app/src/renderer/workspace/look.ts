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
/**
 * plurid's look with the space's grid and colour from Settings → Space, or the workspace's own
 * colour (2026-10-23). plurid derives the rest from it, so the grid lines, minimap and palette
 * backdrop follow the colour too. One object per choice: plurid resolves a look once per object.
 */
export function spaceLook(
  look: keyof typeof looks,
  { grid, color }: { grid: boolean; color: string },
) {
  if (grid && !color) return looks[look];
  const key = `${look}|${grid}|${color}`;
  let chosen = chosenLooks.get(key);
  if (!chosen) {
    chosen = { ...looks[look], grid, ...(color ? { space: color } : {}) };
    chosenLooks.set(key, chosen);
  }
  return chosen;
}
