import { useEffect, useRef, useState } from 'react';
import {
  recordedShortcut,
  validShortcut,
  validGlobalShortcut,
} from '../../../domain/preferences/shortcuts';
import { keyGlyphs, keyName } from '../../../domain/preferences/keymap';
const sequenceText = (keys: readonly string[]) => keys.map(keyGlyphs).join(' ');
/**
 * Press to set a key. A shortcut or prefix is a chord with ⌃ or ⌘; a leader is any key;
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
      // a key that was taken before a valid one is no longer the news
      setMessage('');
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
        setMessage('');
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
      const chord = recordedShortcut(event);
      if (!chord) return;
      if (!event.ctrlKey && !event.metaKey && !(kind === 'global-shortcut' && event.altKey)) {
        setMessage('Hold ⌃ or ⌘ with the key.');
        return;
      }
      const valid = kind === 'global-shortcut' ? validGlobalShortcut : validShortcut;
      if (!valid(chord)) {
        setMessage('Viewer cannot use this key for a shortcut.');
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
        title="Click, then press the keys. Esc keeps the current ones; ⌫ clears them."
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
