/** What the Layout plane makes from a selection (docs/guides/layout.md). */
export const layoutModes = [
  'collage',
  'contact-sheet',
  'n-up',
  'booklet',
  'step-repeat',
  'poster',
  'nesting',
] as const;
export type LayoutMode = (typeof layoutModes)[number];
