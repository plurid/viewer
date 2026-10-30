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
/** What a Layout plane opens with beyond its files and mode. */
export interface LayoutOpening {
  /** Pieces to nest of each drawing, by path; opening the plane again replaces them. */
  quantities?: Readonly<Record<string, number>>;
  /** Millimetres of each drawing, by path, as its request gives them: they group it before its
   * name does. */
  thicknesses?: Readonly<Record<string, number>>;
}
