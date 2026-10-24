import { useSyncExternalStore } from 'react';
import { canonicalKeymap, upgradeKeymap, type Keymap } from '../../domain/keymap';
import { emptySessionKeys, withSessionKeys, type SessionKeys } from '../../domain/session-keys';
import { getState } from '../state/store';

let session: SessionKeys = emptySessionKeys;
const listeners = new Set<() => void>();
/** The session's `:bind` and `:alias`, as the main process holds them (2026-10-23). */
export function receiveSessionKeys(next: SessionKeys): void {
  session = next;
  for (const listener of listeners) listener();
}
export const sessionKeys = () => session;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useSessionKeys = () => useSyncExternalStore(subscribe, () => session);
let cached: { keymap: Keymap; session: SessionKeys; effective: Keymap } | undefined;
/**
 * The keymap in force: config.jsonc's, its moved defaults, the session's bindings over it, and
 * every key as the key layer names it (`C-b` and `Ctrl+B` are ⌃b).
 */
export function effectiveKeymap(): Keymap {
  const keymap = getState().settings.settings.keymap;
  if (cached?.keymap !== keymap || cached.session !== session)
    cached = {
      keymap,
      session,
      effective: canonicalKeymap(withSessionKeys(upgradeKeymap(keymap), session)),
    };
  return cached.effective;
}
