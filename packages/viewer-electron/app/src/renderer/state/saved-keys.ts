import type { SavedState } from '../../domain/contracts';
import type { ViewerState } from './core';

/** What changes on every click, camera move or scroll, and no command definition reads. */
const volatile = new Set([
  'activePane',
  'arrangement',
  'previewStates',
  'previewHistory',
  'visits',
  'promptHistory',
]);
const keys = new WeakMap<SavedState, string>();

/**
 * The saved state that command definitions depend on, as a string to compare. Clicking a plane
 * saves its ID; without this, every click rebuilt every command list in every plane header.
 * Cached per saved-state object, so each store update costs a lookup.
 */
export function savedDefinitionsKey(state: ViewerState): string {
  let key = keys.get(state.saved);
  if (key === undefined) {
    key = JSON.stringify(state.saved, (name, value: unknown) =>
      volatile.has(name) ? undefined : value,
    );
    keys.set(state.saved, key);
  }
  return key;
}
