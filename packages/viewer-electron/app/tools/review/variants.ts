import type { Look, Variant } from './types';

/** The window sizes every scene is seen at: the shipped minimum's neighbour and a large display. */
export const windowSizes = {
  narrow: { width: 800, height: 560 },
  wide: { width: 1600, height: 1000 },
} as const;

export type WindowSize = keyof typeof windowSizes;

export function variant(size: WindowSize, look: Look, data: Record<string, string> = {}): Variant {
  const extra = Object.values(data);
  return {
    id: [size, look, ...extra].join('-'),
    label: [size, look, ...extra].join(', '),
    ...windowSizes[size],
    look,
    data,
  };
}

/** Wide and narrow, dark and light. */
export const standardVariants: readonly Variant[] = [
  variant('wide', 'dark'),
  variant('narrow', 'dark'),
  variant('narrow', 'light'),
  variant('wide', 'light'),
];

/** The standard variants once for each value of one scene choice, such as a short and a long
 * file name. */
export function across(key: string, values: readonly string[]): Variant[] {
  return values.flatMap((value) =>
    standardVariants.map((base) =>
      variant(base.width === windowSizes.wide.width ? 'wide' : 'narrow', base.look, {
        [key]: value,
      }),
    ),
  );
}

/** Both sizes in one appearance: for scenes whose colours another scene already shows. */
export function sizesIn(look: Look, data: Record<string, string> = {}): Variant[] {
  return [variant('wide', look, data), variant('narrow', look, data)];
}
