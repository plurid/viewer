import { useEffect, useRef, useState } from 'react';
import { keyGlyphs, keyName } from '../../../domain/keymap';

/** The unmodified key from its place: Option and Shift change the character. */
const placeKey = (event: KeyboardEvent) =>
  /^Key([A-Z])$/.exec(event.code)?.[1] ??
  /^Digit(\d)$/.exec(event.code)?.[1] ??
  (event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key);
/** A chord as shortcuts write it, from a key press: `Ctrl+A`, `Ctrl+Shift+Space`, `Cmd+Alt+K`. */
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
/**
 * PRESS TO SET A KEY (2026-10-23): as tmux's `set -g prefix C-a`, by pressing it. A prefix needs ⌃
 * or ⌘; a leader is any key. Escape keeps the key as it was; Backspace turns it off.
 */
export function KeyCapture({
  label,
  value,
  kind,
  onChange,
}: {
  label: string;
  value: string;
  kind: 'prefix' | 'leader';
  onChange(value: string): void;
}) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!listening) return;
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey) {
        setListening(false);
        return;
      }
      if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey) {
        setListening(false);
        onChange('');
        return;
      }
      const chosen = kind === 'prefix' ? chordFrom(event) : keyName(event);
      if (!chosen) return;
      if (kind === 'prefix' && !event.ctrlKey && !event.metaKey) {
        setHint('Hold ⌃ or ⌘ with the key.');
        return;
      }
      setListening(false);
      setHint('');
      onChange(chosen);
    };
    window.addEventListener('keydown', keydown, true);
    const stop = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) setListening(false);
    };
    window.addEventListener('pointerdown', stop, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('pointerdown', stop, true);
    };
  }, [listening, kind, onChange]);
  return (
    <span className="key-capture">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-pressed={listening}
        title="Click, then press the key. Escape keeps it; Backspace turns it off."
        onClick={() => {
          setHint('');
          setListening((value) => !value);
        }}
      >
        {listening ? 'Press a key…' : value ? keyGlyphs(value) : 'Off'}
      </button>
      {hint && <small role="alert">{hint}</small>}
    </span>
  );
}
