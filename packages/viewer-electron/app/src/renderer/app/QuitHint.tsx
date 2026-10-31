import { useEffect, useState } from 'react';
import './quit-hint.css';

/**
 * A first ⌘Q's reminder, while a second one would quit. The status region stays mounted so the
 * reminder is announced when it appears.
 */
export function QuitHint() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = window.viewer.onEvent((event) => {
      if (event.type !== 'quit-hint') return;
      clearTimeout(timer);
      setShown(true);
      timer = setTimeout(() => setShown(false), event.duration);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="quit-hint" role="status">
      {shown && (
        <p className="bar bar-floating">
          Press <kbd>⌘Q</kbd> again to quit
        </p>
      )}
    </div>
  );
}
