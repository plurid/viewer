import type { HandoffNesting } from '../../../domain/fabrication/handoff';

/**
 * NESTINGS READY TO SAVE: each thickness's nesting a Layout plane has checked, by its drawings, as
 * Save nesting would write it. A fabrication handoff saves these as its cut sheets; the operation
 * checks each drawing's version again before anything is written.
 */
const prepared = new Map<string, HandoffNesting>();
/** Nestings kept, the oldest forgotten first. */
const limit = 32;
const key = (nesting: HandoffNesting) =>
  nesting.sources
    .map((source) => source.path)
    .sort()
    .join('\n');

export function prepareNesting(nesting: HandoffNesting): void {
  const id = key(nesting);
  prepared.delete(id);
  prepared.set(id, structuredClone(nesting));
  if (prepared.size > limit) prepared.delete(prepared.keys().next().value!);
}
/** The nestings ready, oldest first. */
export const preparedNestings = (): HandoffNesting[] => [...prepared.values()];
export function forgetNestings(): void {
  prepared.clear();
}
