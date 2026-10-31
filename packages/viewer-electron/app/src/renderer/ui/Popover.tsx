import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { dialogOpen } from './modal';
import './popover.css';

/** Which edge of its anchor a layer lines up with: the start, or the end. */
export type LayerAlign = 'start' | 'end';
export interface LayerPoint {
  x: number;
  y: number;
}
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
interface Size {
  width: number;
  height: number;
}
/** How far a layer keeps from the window's edges, and from its anchor. */
const edge = 8;
const offset = 4;

/**
 * Where a layer of `size` goes in a `view`: under its anchor's box, lined up with its `align`
 * edge, or above it when the window ends first; or at a point. Either way, inside the window by
 * 8 px on each side, starting at the top or left edge when it is larger than the window.
 */
export function anchoredPosition(
  size: Size,
  from: Box | LayerPoint,
  view: Size,
  align: LayerAlign = 'end',
): { left: number; top: number } {
  const clamp = (value: number, length: number, room: number) =>
    Math.max(edge, Math.min(value, room - length - edge));
  if ('x' in from)
    return {
      left: clamp(from.x, size.width, view.width),
      top: clamp(from.y, size.height, view.height),
    };
  const left = align === 'end' ? from.right - size.width : from.left;
  const below = from.bottom + offset;
  const top =
    below + size.height <= view.height - edge
      ? below
      : Math.max(edge, from.top - offset - size.height);
  return { left: clamp(left, size.width, view.width), top };
}

/** Where a layer renders: in the open dialog it opens from, which is in the top layer, or the page. */
export function layerContainer(from?: Element | null): HTMLElement {
  return from?.closest<HTMLElement>('dialog[open]') ?? document.body;
}

/** The props of an anchored layer's root. */
export interface AnchoredLayer {
  ref: RefObject<HTMLDivElement | null>;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}
/**
 * A layer anchored to an element or a point, outside any plane, so its position comes from
 * `getBoundingClientRect`, which already includes a plane's 3D transforms. Placed once as it
 * opens, inside the window; an outside press or Escape closes it, and focus goes back, unless a
 * dialog it is not in opened meanwhile.
 *
 * What it returns goes on the layer's root; `select` finds what is placed in it.
 */
export function useAnchoredLayer({
  anchor,
  point,
  align = 'end',
  fit,
  select = (root) => root.firstElementChild as HTMLElement | null,
  onClose,
}: {
  /** What it opens from: a press on it is not outside; without a point, its box places the
   * layer and focus goes back to it. */
  anchor?: HTMLElement;
  /** Where it opens, such as the pointer of a context menu: focus goes back to what had it. */
  point?: LayerPoint;
  align?: LayerAlign;
  /** The tallest it grows, in pixels, also kept within the room below its top. */
  fit?: number;
  select?(root: HTMLElement): HTMLElement | null;
  onClose(): void;
}): AnchoredLayer {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const trigger = useRef(anchor);
  trigger.current = anchor;
  const focused = useRef(
    point || !anchor ? (document.activeElement as HTMLElement | null) : anchor,
  );
  useLayoutEffect(() => {
    const layer = root.current;
    const element = layer && select(layer);
    const from = point ?? anchor?.getBoundingClientRect();
    if (element && from) {
      const rect = element.getBoundingClientRect();
      const view = { width: innerWidth, height: innerHeight };
      const { left, top } = anchoredPosition(rect, from, view, align);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      if (fit) element.style.maxHeight = `min(${fit}px, calc(100vh - ${top + edge}px))`;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!layer?.contains(target) && !trigger.current?.contains(target)) close.current();
    };
    window.addEventListener('pointerdown', dismiss);
    const restore = focused.current;
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      if (restore?.isConnected && (restore.closest('dialog[open]') || !dialogOpen()))
        restore.focus({ preventScroll: true });
    };
    // Placed once when opened; placing again would move it under the pointer as it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    ref: root,
    // what is inside keeps its own Escape, such as a submenu that goes back first
    onKeyDown: (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    },
  };
}

/**
 * A POPOVER: a small layer of content anchored to the button that opens it (popover.css), in the
 * open dialog's top layer or the page. Menus use `useAnchoredLayer` for their own markup.
 */
export function Popover({
  label,
  anchor,
  point,
  align,
  onClose,
  className = '',
  children,
}: {
  label: string;
  anchor?: HTMLElement;
  point?: LayerPoint;
  align?: LayerAlign;
  onClose(): void;
  className?: string;
  children: ReactNode;
}) {
  const layer = useAnchoredLayer({ anchor, point, align, onClose });
  return createPortal(
    <div
      {...layer}
      className="popover-layer"
      role="dialog"
      aria-label={label}
      data-plurid-overlay="context-menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={`popover ${className}`.trim()}>{children}</div>
    </div>,
    layerContainer(anchor ?? document.activeElement),
  );
}
