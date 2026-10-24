import { useEffect, useRef, useSyncExternalStore } from 'react';
import { KeySequence, keyName, type KeymapBinding } from '../../domain/keymap';
import { matchesShortcut } from '../../domain/shortcuts';
import { editable } from '../commands/editing';
import { overlayOpen } from '../ui/modal';
import { report } from '../state/store';
import { effectiveKeymap } from './session';

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
  /** A mode on (2026-10-23), and the count typed in it. */
  mode?: string;
  count?: number;
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
  publish({ active: true, shown: true, keys: [], node: effectiveKeymap().bindings, help: true });
}
/** The installed key layer's own: modes entered and left by a line (`:mode resize`). */
let modes: { enter(name: string): boolean; leave(): void } | undefined;
/** Into a key mode until Escape; false when the keymap has none of that name. */
export const enterKeyMode = (name: string) => modes?.enter(name) ?? false;
export const leaveKeyMode = () => modes?.leave();
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
const leaf = (binding: KeymapBinding | undefined) =>
  typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : undefined;
/**
 * THE KEY LAYER (2026-10-23): the prefix (or the leader) starts a sequence through the keymap's
 * bindings; `root` keys need none; a repeat key may come again without it; a mode keeps its table
 * until Escape. Each binding is a line, run through `run` (App's line runner) after the sequence
 * has ended, `count` times. Installed before App's own key handler, it takes the keys of a sequence
 * or mode and leaves every other key alone.
 */
export function useKeySequences(
  run: (lines: readonly string[], count: number) => Promise<unknown>,
): void {
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const sequence = new KeySequence(effectiveKeymap(), (lines, count) => {
      // after the sequence has ended: a line that shows something (keymap-help) is not then
      // hidden with the sequence
      void Promise.resolve()
        .then(() => runRef.current(lines, count))
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
    const showMode = (message?: string) =>
      publish({
        active: true,
        shown: true,
        keys: [],
        node: sequence.current(),
        mode: sequence.mode(),
        count: sequence.counted(),
        ...(message ? { message } : {}),
      });
    modes = {
      enter: (name) => {
        clearTimeout(ending);
        clearTimeout(showing);
        sequence.cancel();
        sequence.configure(effectiveKeymap());
        if (!sequence.enterMode(name)) return false;
        showMode();
        return true;
      },
      leave: end,
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
      const keymap = effectiveKeymap();
      sequence.configure(keymap);
      const target = event.target as Element;
      if (view.help) {
        if (!keyName(event)) return;
        consume(event);
        end();
        return;
      }
      const terminal = !!target.closest?.('.terminal-plane');
      const field = editable(target);
      // the shell's and the editor's own keys, unless the keymap says otherwise
      const allowed =
        (terminal ? keymap.inTerminals : true) && (field && !terminal ? keymap.inTextFields : true);
      if (sequence.mode()) {
        // a dialog opened from the mode takes its own keys; the mode waits
        if (overlayOpen()) return;
        const name = keyName(event);
        if (!name) return;
        consume(event);
        const step = sequence.feed(name, performance.now());
        if (step === 'cancelled') end();
        else showMode(step === 'unbound' ? 'Not bound' : undefined);
        return;
      }
      if (sequence.repeating()) {
        const name = keyName(event);
        if (!name) return;
        if (sequence.feed(name, performance.now()) === 'passed') {
          // not a repeat key: it is the window's, as after tmux's repeat time
          end();
          return;
        }
        consume(event);
        wait(keymap.repeatTime, false);
        return;
      }
      if (!sequence.active()) {
        if (event.repeat || overlayOpen()) return;
        const name = keyName(event);
        // a key with no prefix (tmux's bind -n)
        const root = name ? leaf(keymap.root[name]) : undefined;
        if (root && allowed) {
          consume(event);
          void Promise.resolve()
            .then(() => runRef.current(root, 1))
            .catch(report);
          return;
        }
        const prefix = !!keymap.prefix && matchesShortcut(keymap.prefix, event);
        const leader = !prefix && !!keymap.leader && !terminal && !field && name === keymap.leader;
        if (!prefix && !leader) return;
        if (prefix && !allowed) return;
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
      else if (step === 'ran' && sequence.repeating()) wait(keymap.repeatTime, false);
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
      modes = undefined;
      publish(idle);
    };
  }, []);
}
