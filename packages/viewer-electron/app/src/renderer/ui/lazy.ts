import { lazy, type ComponentType } from 'react';

/**
 * A component whose code loads the first time it renders, under a `<Suspense>`. Rarely opened
 * dialogs and windows stay out of the code every window parses at startup.
 */
export function lazyComponent<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  return lazy(async () => ({ default: await load() }));
}
