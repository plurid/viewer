import { useEffect, useRef, useState } from 'react';
import { keyGlyphs, keyName } from '../../../domain/keymap';

/** The unmodified key from its place: Option and Shift change the character. */
const placeKey = (event: KeyboardEvent) =>
  /^Key([A-Z])$/.exec(event.code)?.[1] ??
  /^Digit(\d)$/.exec(event.code)?.[1] ??
  (event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key);
/** A chord as shortcuts write it, from a key press: `Ctrl+A`, `Shift+Cmd+Z`, `Ctrl+Space`. */
export function chordFrom(event: KeyboardEvent): string | undefined {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return undefined;
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Cmd',
    placeKey(event),
  ]
    .filter(Boolean)
    .join('+');
}
const sequenceText = (keys: readonly string[]) => keys.map(keyGlyphs).join(' ');
/**
 * PRESS TO SET A KEY (2026-10-23). A shortcut or prefix is a chord with ⌃ or ⌘; a leader is any key;
 * a binding's keys are pressed in turn and end with Enter or a pause. Escape keeps the key as it
 * was; Backspace clears it. A chord another command has is refused and named.
 */
export function KeyCapture({
  label,
  value,
  kind,
  onChange,
  owner,
}: {
  label: string;
  value: string;
  kind: 'shortcut' | 'global-shortcut' | 'leader' | 'sequence';
  onChange(value: string): void;
  /** What has a chord already, other than this. */
  owner?(value: string): string | undefined;
}) {
  const [listening, setListening] = useState(false);
  const [keys, setKeys] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  useEffect(() => {
    if (!listening) return;
    let pressed: string[] = [];
    let pause: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: string) => {
      clearTimeout(pause);
      setListening(false);
      setKeys([]);
      change.current(value);
    };
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (event.key === 'Escape' && plain) {
        clearTimeout(pause);
        setListening(false);
        setKeys([]);
        return;
      }
      if (event.key === 'Backspace' && plain && !pressed.length) return finish('');
      if (kind === 'sequence') {
        if (event.key === 'Enter' && plain && pressed.length) return finish(pressed.join(' '));
        const name = keyName(event);
        if (!name) return;
        pressed = [...pressed, name].slice(0, 4);
        setKeys(pressed);
        clearTimeout(pause);
        pause = setTimeout(() => finish(pressed.join(' ')), 1200);
        return;
      }
      if (kind === 'leader') {
        const name = keyName(event);
        if (name) finish(name);
        return;
      }
      const chord = chordFrom(event);
      if (!chord) return;
      if (!event.ctrlKey && !event.metaKey && !(kind === 'global-shortcut' && event.altKey)) {
        setMessage('Hold ⌃ or ⌘ with the key');
        return;
      }
      const taken = ownerRef.current?.(chord);
      if (taken) {
        setMessage(`Used by ${taken}`);
        return;
      }
      finish(chord);
    };
    const away = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) {
        clearTimeout(pause);
        setListening(false);
        setKeys([]);
      }
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      clearTimeout(pause);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [listening, kind]);
  const shown =
    kind === 'sequence' ? sequenceText(value.split(/\s+/).filter(Boolean)) : keyGlyphs(value);
  return (
    <span className="key-capture">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-pressed={listening}
        title="Click and press. Escape keeps it, Backspace clears it."
        onClick={(event) => {
          // inside a settings row's label, the click would reach this button twice
          event.preventDefault();
          setMessage('');
          setKeys([]);
          setListening((value) => !value);
        }}
      >
        {listening
          ? keys.length
            ? sequenceText(keys) + '…'
            : 'Press keys…'
          : value
            ? shown
            : 'Off'}
      </button>
      {message && <small role="alert">{message}</small>}
    </span>
  );
}
