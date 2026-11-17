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
  // Dragging the window by its bar is the system's move: the page sees no pointer events, so the
  // bar's own pointerleave never comes after a drop (onto another display, say) and the bar stayed.
  // While revealed, any movement outside the bar, leaving the window or losing focus hides it.
  useEffect(() => {
    if (state !== 'revealed') return;
    // one countdown per departure: restarting it on every move would hide the bar only once the
    // pointer stopped
    let leaving = false;
    const away = () => {
      if (leaving) return;
      leaving = true;
      conceal();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.app-titlebar, .titlebar-reveal')) leaving = false;
      else away();
    };
    document.addEventListener('pointermove', outside, true);
    document.documentElement.addEventListener('pointerleave', away);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointermove', outside, true);
      document.documentElement.removeEventListener('pointerleave', away);
      window.removeEventListener('blur', away);
    };
  }, [state, conceal]);
  return { state, reveal, conceal };
}
