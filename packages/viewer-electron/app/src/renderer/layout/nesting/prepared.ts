import type { HandoffNesting } from '../../../domain/fabrication/handoff';

/**
 * NESTINGS READY TO SAVE: each thickness's nesting a Layout plane has checked, or one nested for a
 * handoff without a plane (headless.ts), by its drawings, as Save nesting would write it. A
 * fabrication handoff saves these as its cut sheets; the operation checks each drawing's version
 * again before anything is written.
 */
const prepared = new Map<string, HandoffNesting>();
/** Nestings kept, the oldest forgotten first. */
const limit = 32;
/** What `preparedNestings` gives until the next change, so a view can subscribe to it. */
let snapshot: readonly HandoffNesting[] = [];
const listeners = new Set<() => void>();
const key = (nesting: HandoffNesting) =>
  nesting.sources
    .map((source) => source.path)
    .sort()
    .join('\n');
function changed(): void {
  snapshot = [...prepared.values()];
  for (const listener of listeners) listener();
}

export function prepareNesting(nesting: HandoffNesting): void {
  const id = key(nesting);
  prepared.delete(id);
  prepared.set(id, structuredClone(nesting));
  if (prepared.size > limit) prepared.delete(prepared.keys().next().value!);
  changed();
}
/** The nestings ready, oldest first. */
export const preparedNestings = (): readonly HandoffNesting[] => snapshot;
export function subscribeNestings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function forgetNestings(): void {
  prepared.clear();
  changed();
}
