import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { blankFileSpace } from './selection';

/** A rectangle in the coordinates of a view's sized content element. */
export interface MarqueeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Applies a marquee result: the entries under the rectangle, added to `base`. */
export type MarqueeSelect = (entries: FileEntry[], base: readonly string[]) => void;
const threshold = 4;
const edge = 28;

/** Rows of a virtualized list that a rectangle crosses. */
export function rowsUnder(
  rows: readonly { index: number; start: number; end: number }[],
  rect: MarqueeRect,
): number[] {
  return rows
    .filter((row) => row.end > rect.top && row.start < rect.bottom)
    .map((row) => row.index);
}
/** Tiles of a virtualized grid that a rectangle crosses, as entry indexes. */
export function tilesUnder(
  rows: readonly { index: number; start: number; end: number }[],
  rect: MarqueeRect,
  columns: number,
  width: number,
  count: number,
): number[] {
  const tile = width / columns;
  const first = Math.max(0, Math.floor(rect.left / tile));
  const last = Math.min(columns - 1, Math.floor((rect.right - 0.01) / tile));
  if (rect.right <= 0 || rect.left >= width || first > last) return [];
  return rowsUnder(rows, rect).flatMap((row) =>
    Array.from({ length: last - first + 1 }, (_, offset) => row * columns + first + offset).filter(
      (index) => index < count,
    ),
  );
}

/**
 * Drag on blank file space to select the items under a rectangle, as in Finder.
 * Shift or Command adds to the selection held when the drag began. Near the top or
 * bottom edge the view scrolls, and the rectangle keeps its starting point in the content.
 */
export function useMarquee(
  scroll: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  hit: (rect: MarqueeRect) => FileEntry[],
  select: MarqueeSelect | undefined,
  selection: readonly string[],
) {
  const [rect, setRect] = useState<MarqueeRect>();
  const latest = useRef({ hit, select, selection });
  latest.current = { hit, select, selection };
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const scroller = scroll.current,
      inner = content.current;
    if (!select || !scroller || !inner || event.button !== 0 || event.ctrlKey) return;
    if (!blankFileSpace(event.target)) return;
    // A press on a scrollbar belongs to the scrollbar.
    const frame = scroller.getBoundingClientRect();
    const scale = frame.width / (scroller.offsetWidth || frame.width || 1) || 1;
    if (
      (event.clientX - frame.left) / scale > scroller.clientWidth ||
      (event.clientY - frame.top) / scale > scroller.clientHeight
    )
      return;
    // Planes can be scaled in space; measure in the content's own units.
    const point = (x: number, y: number) => {
      const box = inner.getBoundingClientRect();
      const factor = box.width / (inner.offsetWidth || box.width || 1) || 1;
      return { x: (x - box.left) / factor, y: (y - box.top) / factor };
    };
    const origin = point(event.clientX, event.clientY);
    const base = event.shiftKey || event.metaKey ? [...latest.current.selection] : [];
    let pointer = { x: event.clientX, y: event.clientY };
    let started = false,
      frameID = 0,
      last = '';
    const update = () => {
      const now = point(pointer.x, pointer.y);
      const next = {
        left: Math.min(origin.x, now.x),
        top: Math.min(origin.y, now.y),
        right: Math.max(origin.x, now.x),
        bottom: Math.max(origin.y, now.y),
      };
      setRect(next);
      const entries = latest.current.hit(next);
      const signature = entries.length + ':' + entries.map((entry) => entry.path).join('\n');
      if (signature !== last) {
        last = signature;
        latest.current.select?.(entries, base);
      }
    };
    const tick = () => {
      frameID = 0;
      if (!started) return;
      const box = scroller.getBoundingClientRect();
      const delta =
        pointer.y < box.top + edge
          ? -Math.min(24, box.top + edge - pointer.y)
          : pointer.y > box.bottom - edge
            ? Math.min(24, pointer.y - (box.bottom - edge))
            : 0;
      if (delta) scroller.scrollTop += delta;
      update();
      if (delta) frameID = requestAnimationFrame(tick);
    };
    const move = (moved: globalThis.PointerEvent) => {
      if (moved.pointerId !== event.pointerId) return;
      pointer = { x: moved.clientX, y: moved.clientY };
      if (
        !started &&
        Math.hypot(moved.clientX - event.clientX, moved.clientY - event.clientY) < threshold
      )
        return;
      started = true;
      moved.preventDefault();
      if (!frameID) frameID = requestAnimationFrame(tick);
    };
    const end = (ended: globalThis.PointerEvent) => {
      if (ended.pointerId !== event.pointerId) return;
      finish();
      if (!started) return;
      // The click that ends a drag must not clear the selection it made.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const finish = () => {
      cancelAnimationFrame(frameID);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      stop.current = undefined;
      setRect(undefined);
    };
    stop.current?.();
    stop.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const overlay = rect && (
    <div
      className="file-marquee"
      aria-hidden="true"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      }}
    />
  );
  return { onPointerDown, overlay };
}
