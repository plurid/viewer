import { useCallback, useEffect, useRef, useState } from 'react';
import { overlayOpen } from './modal';

export type TitlebarState = 'shown' | 'hidden' | 'revealed';
/**
 * A hidden title bar: Viewer's title bar can be hidden (⌥⌘T), and the window's buttons
 * go with it. With the pointer at the window's top edge it comes back over the space, so the window
 * can still be moved and its menus reached; it hides again a moment after the pointer leaves, unless
 * one of its menus or dialogs is open.
 */
export function useTitlebar(visible: boolean) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const state: TitlebarState = visible ? 'shown' : revealed ? 'revealed' : 'hidden';
  useEffect(() => {
    void window.viewer.windowButtons?.(state !== 'hidden').catch(() => {
      // the buttons stay as they were: the bar still hides
    });
  }, [state]);
  useEffect(() => {
    if (visible) {
      clearTimeout(timer.current);
      setRevealed(false);
    }
  }, [visible]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reveal = useCallback(() => {
    clearTimeout(timer.current);
    setRevealed(true);
  }, []);
  const conceal = useCallback(() => {
    clearTimeout(timer.current);
    const later = () => {
      timer.current = setTimeout(() => {
        if (overlayOpen()) later();
        else setRevealed(false);
      }, 600);
    };
    later();
  }, []);
  return { state, reveal, conceal };
}
