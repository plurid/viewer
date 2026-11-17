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

/**
 * The source of an event read on its own. A mouse notch carries a whole number of 120s in its
 * legacy delta whatever its pixels, so that comes first: a brisk 40 px notch also has -3 times
 * its pixels, as a trackpad does. Page zoom scales and truncates the legacy delta, hence a
 * tolerance, except for whole pixels with exactly a trackpad's legacy delta, where 41 px would
 * otherwise pass for a notch. Without the legacy fields, lines, pages and exact multiples of a
 * Mac notch are a mouse, and so is a large purely vertical step.
 */
export function wheelSource(event: WheelReading, pageZoom = 1): WheelSource {
  const legacy = legacyDelta(event);
  if (legacy !== undefined) {
    const shaped =
      Math.abs((event.wheelDeltaY ?? 0) + 3 * event.deltaY) <= 1.01 &&
      Math.abs((event.wheelDeltaX ?? 0) + 3 * event.deltaX) <= 1.01 &&
      Number.isInteger(event.deltaY) &&
      Number.isInteger(event.deltaX);
    const notches = (legacy * pageZoom) / 120;
    const whole = Math.round(notches);
    if (whole >= 1 && Math.abs(notches - whole) <= (shaped ? 1e-9 : 0.03)) return 'mouse';
    return 'trackpad';
  }
  if (event.deltaMode !== pixelMode) return 'mouse';
  const ticks = Math.abs(event.deltaY) / macWheelNotch;
  if (!event.deltaX && Math.round(ticks) >= 1 && Math.abs(ticks - Math.round(ticks)) < 1e-6)
    return 'mouse';
  if (!event.deltaX && Math.abs(event.deltaY) >= 50) return 'mouse';
  return 'trackpad';
}

/** How many mouse notches an event turns, for its zoom. */
function notches(event: WheelReading, pageZoom: number): number {
  const legacy = legacyDelta(event);
  if (legacy !== undefined) return (legacy * pageZoom) / 120;
  const delta = Math.abs(event.deltaY || event.deltaX);
  // Three lines or one page per notch; pixels are 100 a notch elsewhere, and a Mac notch is one.
  if (event.deltaMode === lineMode) return delta / 3;
  if (event.deltaMode === pageMode) return delta;
  return Math.max(1, delta / 100);
}

export interface WheelReaderOptions {
  device(): ModelScrollDevice;
  /** The page's zoom factor, which scales the legacy deltas. */
  pageZoom?(): number;
  /** Pixels in one page, for page-mode deltas. */
  pageHeight?(): number;
}

/**
 * Reads wheel events into zooms and scrolls. A burst keeps the source of its first event; only
 * a pinch and a trackpad's momentum speak for themselves inside one. A pinch is a wheel event
 * with Control set: a real Control key held with a wheel zooms by notches instead.
 */
export function wheelReader(options: WheelReaderOptions) {
  let latched: WheelSource | undefined;
  let last = -Infinity;
  let control = false;
  const pixels = (delta: number, mode: number) =>
    mode === lineMode
      ? delta * lineHeight
      : mode === pageMode
        ? delta * Math.max(options.pageHeight?.() ?? 800, 1)
        : delta;
  return {
    /** Whether the Control key itself is down, from key events. */
    control(held: boolean) {
      control = held;
    },
    read(event: WheelReading, now: number): WheelGesture {
      const { deltaX, deltaY, deltaMode } = event;
      if (!deltaX && !deltaY) return { kind: 'none' };
      const pageZoom = options.pageZoom?.() ?? 1;
      if (event.ctrlKey && !control)
        return { kind: 'zoom', scale: Math.exp(-pixels(deltaY, deltaMode) / 100), smooth: false };
      const device = options.device();
      let source: WheelSource;
      if (device !== 'automatic') source = device;
      else if (event.momentum) source = 'trackpad';
      else if (latched && now - last < burstGap) source = latched;
      else source = wheelSource(event, pageZoom);
      latched = source;
      last = now;
      const direction = Math.sign(deltaY || deltaX);
      if (event.ctrlKey)
        return {
          kind: 'zoom',
          scale: notchScale ** (-direction * notches(event, pageZoom)),
          smooth: source === 'mouse',
        };
      if (source === 'trackpad')
        return { kind: 'scroll', x: pixels(deltaX, deltaMode), y: pixels(deltaY, deltaMode) };
      // A mouse wheel zooms. Shift, a tilt or macOS's Shift-turned-sideways wheel scrolls across.
      if (event.shiftKey || !deltaY)
        return { kind: 'scroll', x: pixels(deltaY || deltaX, deltaMode), y: 0 };
      return {
        kind: 'zoom',
        scale: notchScale ** (-direction * notches(event, pageZoom)),
        smooth: true,
      };
    },
  };
}

export type WheelReader = ReturnType<typeof wheelReader>;
