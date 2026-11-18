import type { ModelScrollDevice } from '../../../domain/previews/models/scroll-device';

/** Where a burst of wheel events comes from. */
export type WheelSource = 'mouse' | 'trackpad';

/** What one wheel event does to a 3D view. A scroll is in page pixels: positive x and y move
 * the content left and up, as a page scrolled right and down. */
export type WheelGesture =
  | { kind: 'none' }
  | { kind: 'zoom'; scale: number; smooth: boolean }
  | { kind: 'scroll'; x: number; y: number };

/** A wheel event as Chromium delivers it, with its legacy and macOS fields where present. */
export interface WheelReading {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** Legacy: ±120 per notch of a mouse wheel, and -3 times the pixel delta for a trackpad. */
  wheelDeltaX?: number;
  wheelDeltaY?: number;
  /** Chromium on macOS: the coasting events after a trackpad swipe. */
  momentum?: boolean;
}

/** A slow notch of a Mac mouse wheel: macOS's line delta of 0.1 times Chromium's 40 pixels. */
export const macWheelNotch = 4.000244140625;
/** Events closer together than this belong to one gesture and keep its source. */
const burstGap = 300;
/** One notch zooms by this much, as the + and - keys do. */
export const notchScale = 1.1;
const lineHeight = 16;
/** WheelEvent's delta modes, here so the reader also runs where the DOM is absent. */
const pixelMode = 0;
const lineMode = 1;
const pageMode = 2;

/** The fields Chromium adds to WheelEvent, read without trusting their presence. */
export function wheelReading(event: WheelEvent): WheelReading {
  const legacy = event as WheelEvent & {
    wheelDeltaX?: unknown;
    wheelDeltaY?: unknown;
    momentum?: unknown;
  };
  return {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    wheelDeltaX: typeof legacy.wheelDeltaX === 'number' ? legacy.wheelDeltaX : undefined,
    wheelDeltaY: typeof legacy.wheelDeltaY === 'number' ? legacy.wheelDeltaY : undefined,
    momentum: legacy.momentum === true,
  };
}

function legacyDelta(event: WheelReading): number | undefined {
  const { wheelDeltaX: x, wheelDeltaY: y } = event;
  if (typeof x !== 'number' && typeof y !== 'number') return;
  const total = Math.abs(x ?? 0) + Math.abs(y ?? 0);
  return total || undefined;
}

/** What one event says about its device, and whether it could only be that device. */
export interface WheelEvidence {
  source: WheelSource;
  /** False for a trackpad-shaped exact multiple of 120: a linear-scrolling mouse's 40 px notch
   * and a trackpad's 40 px step look the same. */
  certain: boolean;
}

/**
 * The device an event alone points to. An event moving both axes is a trackpad. A mouse notch
 * carries a whole number of 120s in its legacy delta whatever its pixels; page zoom scales and
 * truncates that delta, hence a tolerance. A trackpad's legacy delta is -3 times its whole
 * pixels; where that is also an exact multiple of 120, the event cannot tell. Without the legacy
 * fields, lines, pages and exact multiples of a Mac notch are a mouse, and so is a large purely
 * vertical step.
 */
export function wheelEvidence(event: WheelReading, pageZoom = 1): WheelEvidence {
  if (event.deltaX && event.deltaY) return { source: 'trackpad', certain: true };
  const legacy = legacyDelta(event);
  if (legacy !== undefined) {
    const shaped =
      Math.abs((event.wheelDeltaY ?? 0) + 3 * event.deltaY) <= 1.01 &&
      Math.abs((event.wheelDeltaX ?? 0) + 3 * event.deltaX) <= 1.01 &&
      Number.isInteger(event.deltaY) &&
      Number.isInteger(event.deltaX);
    const notches = (legacy * pageZoom) / 120;
    const whole = Math.round(notches);
    const exact = whole >= 1 && Math.abs(notches - whole) <= 1e-9;
    if (shaped)
      return exact ? { source: 'mouse', certain: false } : { source: 'trackpad', certain: true };
    if (whole >= 1 && Math.abs(notches - whole) <= 0.03) return { source: 'mouse', certain: true };
    return { source: 'trackpad', certain: true };
  }
  if (event.deltaMode !== pixelMode) return { source: 'mouse', certain: true };
  const ticks = Math.abs(event.deltaY) / macWheelNotch;
  if (!event.deltaX && Math.round(ticks) >= 1 && Math.abs(ticks - Math.round(ticks)) < 1e-6)
    return { source: 'mouse', certain: true };
  if (!event.deltaX && Math.abs(event.deltaY) >= 50) return { source: 'mouse', certain: true };
  return { source: 'trackpad', certain: true };
}

export function wheelSource(event: WheelReading, pageZoom = 1): WheelSource {
  return wheelEvidence(event, pageZoom).source;
}

/** How many mouse notches an event turns, for its zoom. */
function notches(event: WheelReading): number {
  const legacy = legacyDelta(event);
  if (legacy !== undefined) return legacy / 120;
  const delta = Math.abs(event.deltaY || event.deltaX);
  // Three lines or one page per notch; pixels are 100 a notch elsewhere, and a Mac notch is one.
  if (event.deltaMode === lineMode) return delta / 3;
  if (event.deltaMode === pageMode) return delta;
  return Math.max(1, delta / 100);
}

/** The device this window last read clearly, which an ambiguous first event follows. */
export interface WheelMemory {
  clear?: WheelSource;
}
const windowMemory: WheelMemory = {};

export interface WheelReaderOptions {
  device(): ModelScrollDevice;
  /** Pixels in one page, for page-mode deltas. */
  pageHeight?(): number;
  /** Shared by the window's 3D previews unless given. */
  memory?: WheelMemory;
}

/**
 * Reads wheel events into zooms and scrolls. A burst keeps its source until a pause. An event
 * that cannot tell its device never decides a burst: it follows the burst it is in, or starts
 * one as the device the window last read clearly, else a mouse, and the next event that can only
 * be one device settles it. A pinch and a trackpad's momentum speak for themselves. A pinch is a
 * wheel event with Control set; a real Control key held with a wheel zooms by notches instead.
 */
export function wheelReader(options: WheelReaderOptions) {
  const memory = options.memory ?? windowMemory;
  let latched: WheelSource | undefined;
  /** The burst began with an event that could not tell its device. */
  let tentative = false;
  let last = -Infinity;
  let control = false;
  const pixels = (delta: number, mode: number) =>
    mode === lineMode
      ? delta * lineHeight
      : mode === pageMode
        ? delta * Math.max(options.pageHeight?.() ?? 800, 1)
        : delta;
  const source = (event: WheelReading, now: number): WheelSource => {
    const device = options.device();
    if (device !== 'automatic') return device;
    if (event.momentum) {
      tentative = false;
      memory.clear = 'trackpad';
      return 'trackpad';
    }
    const burst = latched && now - last < burstGap ? latched : undefined;
    const evidence = wheelEvidence(event);
    if (evidence.certain && (!burst || tentative)) {
      tentative = false;
      memory.clear = evidence.source;
      return evidence.source;
    }
    if (burst) return burst;
    tentative = true;
    return memory.clear ?? 'mouse';
  };
  return {
    /** Whether the Control key itself is down, from key and pointer events. */
    control(held: boolean) {
      control = held;
    },
    read(event: WheelReading, now: number): WheelGesture {
      const { deltaX, deltaY, deltaMode } = event;
      if (!deltaX && !deltaY) return { kind: 'none' };
      if (event.ctrlKey && !control)
        return { kind: 'zoom', scale: Math.exp(-pixels(deltaY, deltaMode) / 100), smooth: false };
      const from = source(event, now);
      latched = from;
      last = now;
      const direction = Math.sign(deltaY || deltaX);
      if (event.ctrlKey)
        return {
          kind: 'zoom',
          scale: notchScale ** (-direction * notches(event)),
          smooth: from === 'mouse',
        };
      if (from === 'trackpad')
        return { kind: 'scroll', x: pixels(deltaX, deltaMode), y: pixels(deltaY, deltaMode) };
      // A mouse wheel zooms. Shift, a tilt or macOS's Shift-turned-sideways wheel scrolls across.
      if (event.shiftKey || !deltaY)
        return { kind: 'scroll', x: pixels(deltaY || deltaX, deltaMode), y: 0 };
      return {
        kind: 'zoom',
        scale: notchScale ** (-direction * notches(event)),
        smooth: true,
      };
    },
  };
}

export type WheelReader = ReturnType<typeof wheelReader>;
