import { useLayoutEffect, type RefObject } from 'react';
import type { PreviewContext } from './contracts';

interface ScrollPosition {
  section: string;
  top: number;
  left: number;
}
function position(value: unknown, section: string): ScrollPosition | undefined {
  const saved = value as Partial<ScrollPosition> | undefined;
  return saved &&
    saved.section === section &&
    typeof saved.top === 'number' &&
    Number.isFinite(saved.top) &&
    saved.top >= 0 &&
    typeof saved.left === 'number' &&
    Number.isFinite(saved.left) &&
    saved.left >= 0
    ? (saved as ScrollPosition)
    : undefined;
}

/** Restore after content is ready, yield to user input, and flush before a view disappears. */
export function usePreviewScroll(
  state: PreviewContext['state'],
  ref: RefObject<HTMLElement | null>,
  key: string,
  {
    ready = true,
    section = '',
    restore = true,
  }: { ready?: boolean; section?: string; restore?: boolean } = {},
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !state || !ready) return;
    const saved = restore ? position(state.get('scroll.' + key), section) : undefined;
    let restoring = !!saved;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let frames = 0;
    let last = saved;
    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      if (restoring) return;
      const next = { section, top: element.scrollTop, left: element.scrollLeft };
      if (last && last.top === next.top && last.left === next.left && last.section === section)
        return;
      state.set('scroll.' + key, next);
      last = next;
    };
    const apply = () => {
      if (!restoring || !saved) return;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
      if (
        Math.abs(element.scrollTop - saved.top) < 1 &&
        Math.abs(element.scrollLeft - saved.left) < 1
      )
        restoring = false;
    };
    const step = () => {
      apply();
      if (restoring && ++frames < 4) frame = requestAnimationFrame(step);
    };
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    for (const child of Array.from(element.children).slice(0, 4)) observer.observe(child);
    if (saved) {
      apply();
      frame = requestAnimationFrame(step);
    } else if (restore) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
    // A changed viewport can clamp an old pixel offset. Do not keep snapping
    // back indefinitely while images load or a virtual table measures its rows.
    const settle = setTimeout(() => {
      apply();
      restoring = false;
    }, 500);
    const intent = () => {
      restoring = false;
    };
    const scroll = () => {
      if (restoring) return;
      clearTimeout(timer);
      timer = setTimeout(save, 150);
    };
    element.addEventListener('scroll', scroll, { passive: true });
    element.addEventListener('wheel', intent, { passive: true });
    element.addEventListener('pointerdown', intent);
    element.addEventListener('keydown', intent);
    window.addEventListener('pagehide', save);
    window.addEventListener('viewer-preview-flush', save);
    return () => {
      save();
      clearTimeout(timer);
      clearTimeout(settle);
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('wheel', intent);
      element.removeEventListener('pointerdown', intent);
      element.removeEventListener('keydown', intent);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('viewer-preview-flush', save);
    };
  }, [state, ref, key, ready, section, restore]);
}
