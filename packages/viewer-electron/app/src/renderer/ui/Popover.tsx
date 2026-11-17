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
type LayerAnchor = Box | LayerPoint;
interface LayerCoordinates {
  left: number;
  top: number;
}
/** Which side of its anchor a layer opens on; a layer at a point opens below it. */
export type LayerSide = 'below' | 'above';
interface LayerPosition extends LayerCoordinates {
  maxHeight: number;
  side: LayerSide;
}
/** How far a layer keeps from the window's edges, and from its anchor. */
const edge = 8;
const offset = 4;
/** About three menu rows: the least room a layer gets before it may cover its anchor's edge. */
const leastHeight = 3 * 34 + 10;

/**
 * Where a layer of `size` goes in a `view`, 8 px inside it. From an anchor's box: lined up with
 * its `align` edge, below it if the layer fits there, else above it if it fits there, else on the
 * side with more room, its height bounded to that room, so it never covers its anchor. Only when
 * neither side has room for about three rows does it cover the anchor's edge, as little as it
 * can. From a point: at the point, moved back inside the window.
 */
export function anchoredPosition(
  size: Size,
  from: LayerAnchor,
  view: Size,
  align: LayerAlign = 'end',
): LayerPosition {
  const clamp = (value: number, length: number, room: number) =>
    Math.max(edge, Math.min(value, room - length - edge));
  // A DOMRect has x and y too: taken for a point, it put the layer on its anchor's corner.
  if (!('bottom' in from)) {
    const top = clamp(from.y, size.height, view.height);
    return {
      left: clamp(from.x, size.width, view.width),
      top,
      maxHeight: Math.max(0, view.height - top - edge),
      side: 'below',
    };
  }
  const left = clamp(align === 'end' ? from.right - size.width : from.left, size.width, view.width);
  const below = Math.max(edge, from.bottom + offset);
  const above = Math.min(view.height - edge, from.top - offset);
  const roomBelow = Math.max(0, view.height - edge - below);
  const roomAbove = Math.max(0, above - edge);
  const least = Math.min(size.height, leastHeight);
  if (roomBelow < least && roomAbove < least) {
    if (roomBelow >= roomAbove) {
      const top = Math.max(edge, Math.min(below, view.height - edge - least));
      return { left, top, maxHeight: view.height - edge - top, side: 'below' };
    }
    const bottom = Math.min(view.height - edge, Math.max(above, edge + least));
    const maxHeight = bottom - edge;
    return { left, top: bottom - Math.min(size.height, maxHeight), maxHeight, side: 'above' };
  }
  const opensBelow =
    size.height <= roomBelow || (size.height > roomAbove && roomBelow >= roomAbove);
  const maxHeight = opensBelow ? roomBelow : roomAbove;
  const top = opensBelow ? below : above - Math.min(size.height, maxHeight);
  return { left, top, maxHeight, side: opensBelow ? 'below' : 'above' };
}

/**
 * Window coordinates as the `left` and `top` of a fixed layer. They are the same unless an
 * ancestor, such as a transformed dialog, holds the layer: then its origin is that ancestor's.
 */
export function layerCoordinates(
  element: HTMLElement,
  position: LayerCoordinates,
): LayerCoordinates {
  element.style.left = '0px';
  element.style.top = '0px';
  const origin = element.getBoundingClientRect();
  return {
    left: position.left - origin.left,
    top: position.top - origin.top,
  };
}

/** A window coordinate as the `bottom` of a fixed layer, measured as `layerCoordinates` does. */
function layerBottom(element: HTMLElement, bottom: number): number {
  element.style.top = 'auto';
  element.style.bottom = '0px';
  return element.getBoundingClientRect().bottom - bottom;
}

/** Whether a press lands on a layer's trigger, or on a label whose control the trigger is. */
function pressesTrigger(target: Node, trigger: HTMLElement | undefined): boolean {
  if (!trigger) return false;
  if (trigger.contains(target)) return true;
  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest('label')?.control === trigger;
}

/**
 * Swallows the click that ends a press which closed a button's menu, as on macOS, where that
 * press reaches nothing else. It goes when the press's task ends, or at the next press.
 */
function swallowClick(pressed: Node): void {
  const swallow = (event: MouseEvent) => {
    if (!(event.target instanceof Node) || !event.target.contains(pressed)) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  const later = () => setTimeout(stop);
  const stop = () => {
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('pointerup', later, true);
    window.removeEventListener('pointercancel', later, true);
    window.removeEventListener('pointerdown', stop, true);
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('pointerup', later, true);
  window.addEventListener('pointercancel', later, true);
  window.addEventListener('pointerdown', stop, true);
}

/** The views `focusPlane` gives the keyboard to. */
const planeViews = '.folder-explorer, .preview-plane, .terminal-plane';
const focusable =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), ' +
  'a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Where focus goes when what opened a layer is gone: its plane's view, else the first control
 * left in the nearest place that held it. Nothing when only the page is left, so a closing
 * dialog keeps its own restoration.
 */
function focusHome(ancestry: readonly HTMLElement[]): HTMLElement | undefined {
  const home = ancestry.find((element) => element.isConnected);
  if (!home || home === document.body || home === document.documentElement) return undefined;
  const plane = home.closest('[data-plurid-entity="PluridPlane"]');
  return (
    plane?.querySelector<HTMLElement>(planeViews) ??
    home.querySelector<HTMLElement>(focusable) ??
    undefined
  );
}

/** Whether a box moved on screen by more than a pixel. */
const moved = (from: DOMRect, to: DOMRect) =>
  Math.abs(from.left - to.left) > 1 || Math.abs(from.top - to.top) > 1;

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
 * opens, inside the window and clear of its anchor; an outside press or Escape closes it, and
 * focus goes back, unless a dialog it is not in opened meanwhile. As a macOS menu does, it also
 * closes when the window loses focus or is resized, and an anchored one when what holds its
 * anchor scrolls, the camera moves its anchor's plane, or the anchor is gone.
 *
 * What it returns goes on the layer's root; `select` finds what is placed in it.
 */
export function useAnchoredLayer({
  anchor,
  point,
  align,
  fit,
  select = (root) => root.firstElementChild as HTMLElement | null,
  onClose,
}: {
  /** What it opens from: its box places the layer, a press on it is not outside, so the
   * button's own toggle closes it, and focus goes back to it. */
  anchor?: HTMLElement;
  /** Without an anchor, where it opens: focus goes back to what had it. */
  point?: LayerPoint;
  /** Which edge of the anchor it lines up with: the end, or the start when a point is given. */
  align?: LayerAlign;
  /** The tallest it grows, in pixels, also kept within the room on its side. */
  fit?: number;
  select?(root: HTMLElement): HTMLElement | null;
  onClose(): void;
}): AnchoredLayer {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const trigger = useRef(anchor);
  trigger.current = anchor;
  const focused = useRef(anchor ?? (document.activeElement as HTMLElement | null));
  useLayoutEffect(() => {
    const layer = root.current;
    const element = layer && select(layer);
    const from = anchor?.getBoundingClientRect() ?? point;
    if (element && from) {
      if (fit !== undefined) element.style.maxHeight = `${fit}px`;
      const rect = element.getBoundingClientRect();
      const view = { width: innerWidth, height: innerHeight };
      const position = anchoredPosition(rect, from, view, align ?? (point ? 'start' : 'end'));
      const { left, top } = layerCoordinates(element, position);
      // Without a `fit`, its stylesheet's height limit holds: it grows no taller than measured.
      const height = Math.min(fit ?? rect.height, position.maxHeight);
      element.style.left = `${left}px`;
      element.style.maxHeight = `${height}px`;
      // Above its anchor it is held by its bottom, so a list that shortens as it is searched
      // stays against the anchor.
      if (position.side === 'above')
        element.style.bottom = `${layerBottom(element, position.top + Math.min(rect.height, height))}px`;
      else element.style.top = `${top}px`;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (layer?.contains(target) || pressesTrigger(target, trigger.current)) return;
      // A press outside a button's menu only closes it, as on macOS: focus stays and the press
      // reaches nothing. A context menu at the pointer lets the press go on to what it lands on.
      if (trigger.current) {
        event.preventDefault();
        swallowClick(target);
      }
      close.current();
    };
    const scrolled = (event: Event) => {
      const box = event.target;
      if (anchor && box instanceof Node && !layer?.contains(box) && box.contains(anchor))
        close.current();
    };
    // the window's own blur, as the app loses focus: an element's blur does not bubble
    const leave = (event: Event) => {
      if (event.target === event.currentTarget) close.current();
    };
    const resized = () => close.current();
    window.addEventListener('pointerdown', dismiss);
    // scroll does not bubble: only a capturing listener hears every box that scrolls
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('blur', leave);
    window.addEventListener('resize', resized);
    const plane = anchor?.closest('[data-plurid-entity="PluridPlane"]');
    const planeBox = plane?.getBoundingClientRect();
    let frame = 0;
    // The camera moves a plane by its transforms, which no event reports: its box shows it.
    const watch = () => {
      if (!anchor?.isConnected || (plane && planeBox && moved(planeBox, plane.getBoundingClientRect())))
        close.current();
      else frame = requestAnimationFrame(watch);
    };
    if (anchor) frame = requestAnimationFrame(watch);
    const restore = focused.current;
    const ancestry: HTMLElement[] = [];
    for (let parent = restore?.parentElement; parent; parent = parent.parentElement)
      ancestry.push(parent);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('blur', leave);
      window.removeEventListener('resize', resized);
      cancelAnimationFrame(frame);
      const home = restore?.isConnected ? restore : focusHome(ancestry);
      if (home && (home.closest('dialog[open]') || !dialogOpen()))
        home.focus({ preventScroll: true });
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
