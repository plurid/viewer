import { useEffect, useRef, useSyncExternalStore } from 'react';
import { KeySequence, keyName, type KeymapBinding } from '../../domain/keymap';
import { matchesShortcut } from '../../domain/shortcuts';
import { editable } from '../commands/editing';
import { overlayOpen } from '../ui/modal';
import { getState, report } from '../state/store';

/** What which-key shows: the keys pressed so far and the chord they reached. */
export interface SequenceView {
  active: boolean;
  /** Shown once a sequence has waited a moment: a quick typist sees nothing. */
  shown: boolean;
  keys: readonly string[];
  node?: KeymapBinding;
  /** `?`: every binding, until the next key. */
  help?: boolean;
  /** A key that is not bound, said briefly. */
  message?: string;
}
const idle: SequenceView = { active: false, shown: false, keys: [] };
let view: SequenceView = idle;
const listeners = new Set<() => void>();
const publish = (next: SequenceView) => {
  view = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useSequenceView = () => useSyncExternalStore(subscribe, () => view);
/** Every binding, until the next key or Escape (`keymap-help`, prefix `?`). */
export function showKeymapHelp(): void {
  publish({
    active: true,
    shown: true,
    keys: [],
    node: getState().settings.settings.keymap.bindings,
    help: true,
  });
}
/** ⌃B pressed twice reaches the terminal as ⌃B, as tmux sends its prefix on (2026-10-23). */
function sendPrefix(target: Element, prefix: string): void {
  const terminal = target.closest<HTMLElement>('.terminal-plane[data-terminal-id]');
  const letter = /(?:^|\+)([a-z])$/i.exec(prefix)?.[1];
  if (!terminal?.dataset.terminalId || !letter || !/ctrl/i.test(prefix)) return;
  void window.viewer
    .terminalWrite(
      terminal.dataset.terminalId,
      String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64),
    )
    .catch(report);
}
const consume = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopImmediatePropagation();
};
/**
 * THE KEY LAYER (2026-10-23): the prefix (or the leader) starts a sequence through the keymap's
 * bindings; its commands run through `invoke`, App's wrapper, as menu commands do. Installed before
 * App's own key handler, it takes the keys of a sequence and leaves every other key alone.
 */
export function useKeySequences(invoke: (id: string) => Promise<unknown>): void {
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  useEffect(() => {
    const sequence = new KeySequence(getState().settings.settings.keymap, (commands) => {
      // after the sequence has ended: a command that shows something (keymap-help) is not then
      // hidden with the sequence
      void Promise.resolve()
        .then(async () => {
          for (const id of commands) await invokeRef.current(id);
        })
        .catch(report);
    });
    let ending: ReturnType<typeof setTimeout> | undefined;
    let showing: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      clearTimeout(ending);
      clearTimeout(showing);
      sequence.cancel();
      publish(idle);
    };
    const wait = (timeout: number, whichKey: boolean) => {
      clearTimeout(ending);
      ending = setTimeout(end, timeout);
      const next = { active: true, keys: sequence.pressed(), node: sequence.current() };
      publish({ ...next, shown: view.shown });
      if (whichKey && !view.shown) {
        clearTimeout(showing);
        showing = setTimeout(() => {
          if (view.active) publish({ ...view, shown: true });
        }, 350);
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const keymap = getState().settings.settings.keymap;
      sequence.configure(keymap);
      const target = event.target as Element;
      if (view.help) {
        if (!keyName(event)) return;
        consume(event);
        end();
        return;
      }
      if (!sequence.active()) {
        if (event.repeat || overlayOpen()) return;
        const terminal = !!target.closest?.('.terminal-plane');
        const field = editable(target);
        const prefix = !!keymap.prefix && matchesShortcut(keymap.prefix, event);
        const leader =
          !prefix && !!keymap.leader && !terminal && !field && keyName(event) === keymap.leader;
        if (!prefix && !leader) return;
        // the shell's and the editor's own keys, unless the keymap says otherwise
        if (prefix && terminal && !keymap.inTerminals) return;
        if (prefix && field && !terminal && !keymap.inTextFields) return;
        consume(event);
        sequence.start(performance.now());
        wait(keymap.timeout, keymap.whichKey);
        return;
      }
      const name = keyName(event);
      // a modifier alone waits for its key
      if (!name) return;
      consume(event);
      if (!sequence.pressed().length && keymap.prefix && matchesShortcut(keymap.prefix, event)) {
        end();
        sendPrefix(target, keymap.prefix);
        return;
      }
      const pressed = sequence.pressed();
      const step = sequence.feed(name, performance.now());
      if (step === 'pending') wait(keymap.timeout, keymap.whichKey);
      else if (step === 'unbound') {
        clearTimeout(showing);
        clearTimeout(ending);
        publish({ active: true, shown: true, keys: [...pressed, name], message: 'Not bound' });
        ending = setTimeout(end, 900);
      } else end();
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      clearTimeout(ending);
      clearTimeout(showing);
      publish(idle);
    };
  }, []);
}
