import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { FileEntry, RendererOperationRequest } from '../../domain/contracts';
import { sourceVersion } from '../../domain/files/inspection';
import { turnConversion } from '../../domain/operations/image-conversions';
import type { QuarterTurn } from './contracts';

/**
 * A PICTURE'S VIEW, TURNED: by a quarter from the toolbar or ⌘L and ⌘R, or freely while two fingers
 * turn on the trackpad, settling on the nearest quarter once they stop. Only the view turns; a
 * rotated copy is a new file beside the picture. The picture is shown as its EXIF orientation says,
 * by Chromium and by the image processor alike, and the turn is on top of that.
 */

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

/** Degrees as one turn, 0 up to 360. */
export const normalAngle = (degrees: number) => ((degrees % 360) + 360) % 360;
/** The nearest quarter turn. */
export const nearestTurn = (degrees: number) => normalAngle(Math.round(degrees / 90) * 90);
/** A saved turn as a quarter, whatever was saved: a project's view state is read back unchecked. */
export const savedTurn = (value: unknown) => nearestTurn(Number(value) || 0);
/** Whether a turn lays the picture on its side. */
export const sideways = (degrees: number) => nearestTurn(degrees) % 180 === 90;

/**
 * How much more than its laid-out size a turned picture is drawn, so it still fits `room` as a
 * whole: the box of its turned corners fits, and it never grows past its own pixels. 1 when
 * upright, where the stylesheet already fits it.
 */
export function turnedFit(shown: Size, natural: Size, room: Size, degrees: number): number {
  if (normalAngle(degrees) % 180 === 0) return 1;
  if (shown.width <= 0 || shown.height <= 0 || room.width <= 0 || room.height <= 0) return 1;
  const radians = (normalAngle(degrees) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = shown.width * cos + shown.height * sin;
  const height = shown.width * sin + shown.height * cos;
  const largest = natural.width > 0 ? natural.width / shown.width : Infinity;
  return Math.min(room.width / width, room.height / height, Math.max(1, largest));
}

/** A screen offset turned with the picture, clockwise. */
export function turnPoint(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: Math.round(point.x * cos - point.y * sin),
    y: Math.round(point.x * sin + point.y * cos),
  };
}

/** A copy of `entry` turned `turn` degrees clockwise, as the Rotated Copy quick actions make it:
 * "<name> rotated" beside it, the picture itself only read (domain/operations/image-conversions). */
export function rotatedCopyRequest(entry: FileEntry, turn: QuarterTurn): RendererOperationRequest {
  return {
    kind: 'convert',
    conversion: turnConversion(turn),
    sources: [entry.path],
    expectedSources: [{ path: entry.path, version: sourceVersion(entry) }],
  };
}

/** A picture a trackpad's rotation may turn. */
interface Turnable {
  element: HTMLElement;
  /** Degrees clockwise since the last report. */
  turn(degrees: number): void;
  /** The fingers stopped: settle on a quarter. */
  settle(): void;
}
/** How long after the last report the fingers count as stopped. */
export const gestureSettle = 150;
const turnables = new Set<Turnable>();
let pointed: Turnable | undefined;
let stopListening: (() => void) | undefined;
let settling: ReturnType<typeof setTimeout> | undefined;

/**
 * The picture a rotation is for (DESIGN.md, the Picture Turn Rule): the one under the pointer, else
 * the one whose preview holds the keyboard; none otherwise. With a dialog open, only a picture in
 * the topmost one.
 */
function turnable(): Turnable | undefined {
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  const candidates = [...turnables].filter(
    (item) =>
      item.element.isConnected &&
      !item.element.closest('.held-preview-waiting') &&
      (!dialog || dialog.contains(item.element)),
  );
  if (pointed && candidates.includes(pointed)) return pointed;
  const focus = document.activeElement;
  const focused = candidates.find(
    (item) => focus && item.element.closest('.preview-host')?.contains(focus),
  );
  return focused;
}

/** The desktop reports macOS rotation in degrees since the last report, counterclockwise. */
function listen(): void {
  if (stopListening || typeof window === 'undefined' || !window.viewer?.onEvent) return;
  let target: Turnable | undefined;
  stopListening = window.viewer.onEvent((event) => {
    if (event.type !== 'rotate-gesture') return;
    // a gesture stays with the picture it started on
    target ??= turnable();
    if (!target) return;
    clearTimeout(settling);
    const settled = target;
    const settle = () => {
      target = undefined;
      settled.settle();
    };
    // 0 is the last report, as the fingers lift; without it, the fingers stopped a moment ago
    if (!event.rotation) settle();
    else {
      target.turn(-event.rotation);
      settling = setTimeout(settle, gestureSettle);
    }
  });
}

/** Lets a trackpad's two fingers turn the picture in `element` while `enabled`. */
export function useRotateGesture(
  element: RefObject<HTMLElement | null>,
  enabled: boolean,
  turn: (degrees: number) => void,
  settle: () => void,
): void {
  const callbacks = useRef({ turn, settle });
  callbacks.current = { turn, settle };
  useEffect(() => {
    const node = element.current;
    if (!node || !enabled) return;
    const item: Turnable = {
      element: node,
      turn: (degrees) => callbacks.current.turn(degrees),
      settle: () => callbacks.current.settle(),
    };
    const enter = () => {
      pointed = item;
    };
    const leave = () => {
      if (pointed === item) pointed = undefined;
    };
    turnables.add(item);
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    listen();
    return () => {
      turnables.delete(item);
      leave();
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      if (!turnables.size) {
        stopListening?.();
        stopListening = undefined;
      }
    };
  }, [element, enabled]);
}
