import { describe, expect, it } from 'vitest';
import {
  macWheelNotch,
  notchScale,
  wheelReader,
  wheelSource,
} from '../src/renderer/previews/model/wheel';
import type { WheelReading } from '../src/renderer/previews/model/wheel';
import type { ModelScrollDevice } from '../src/domain/previews/models/scroll-device';

/**
 * Events as Chromium on macOS sends them, all in pixels. A mouse notch is macOS's line delta
 * times 40 px, with ±120 legacy units per notch however fast the wheel turns. A trackpad or Magic
 * Mouse sends whole pixels with a legacy delta of -3 times them. A pinch sets Control, with
 * 100 ln(scale) pixels.
 */
function mac(deltaY: number, wheelDeltaY: number, deltaX = 0, wheelDeltaX = 0): WheelReading {
  return {
    deltaX,
    deltaY,
    deltaMode: 0,
    ctrlKey: false,
    shiftKey: false,
    wheelDeltaX,
    wheelDeltaY,
  };
}
const mouse = (deltaY: number, notches = 1) => mac(deltaY, -Math.sign(deltaY) * 120 * notches);
const trackpad = (deltaY: number, deltaX = 0) => mac(deltaY, -3 * deltaY, deltaX, -3 * deltaX);
function plain(deltaY: number, deltaMode = 0, deltaX = 0): WheelReading {
  return { deltaX, deltaY, deltaMode, ctrlKey: false, shiftKey: false };
}
function reader(device: ModelScrollDevice = 'automatic') {
  return wheelReader({ device: () => device, pageHeight: () => 600 });
}

describe('telling a mouse from a trackpad', () => {
  it.each([macWheelNotch, 12.0009765625, 20.001220703125, 40, 40.00244140625, 89.9])(
    'reads a %s px notch with one legacy notch as a mouse',
    (deltaY) => {
      expect(wheelSource(mouse(deltaY))).toBe('mouse');
      expect(wheelSource(mouse(-deltaY))).toBe('mouse');
    },
  );

  it('reads two or three notches in one event as a mouse', () => {
    expect(wheelSource(mouse(96, 2))).toBe('mouse');
    expect(wheelSource(mouse(120, 3))).toBe('mouse');
  });

  it.each([1, 3, 6, 18, 60, 41])('reads a %s px trackpad scroll as a trackpad', (deltaY) => {
    expect(wheelSource(trackpad(deltaY))).toBe('trackpad');
    expect(wheelSource(trackpad(0, deltaY))).toBe('trackpad');
    expect(wheelSource(trackpad(-deltaY, 2))).toBe('trackpad');
  });

  it('allows for page zoom, which scales and truncates the legacy delta', () => {
    // At 90 % zoom one notch reports 133 legacy units, truncated.
    expect(wheelSource(mac(4.000244140625, -133), 0.9)).toBe('mouse');
    expect(wheelSource(mac(4.000244140625, -133), 1)).toBe('trackpad');
    expect(wheelSource(mac(4.000244140625, -125), 1)).toBe('trackpad');
    expect(wheelSource(mac(4.000244140625, -123), 1)).toBe('mouse');
  });

  it('reads events without legacy deltas from their units and size', () => {
    expect(wheelSource(plain(3, 1))).toBe('mouse');
    expect(wheelSource(plain(1, 2))).toBe('mouse');
    expect(wheelSource(plain(macWheelNotch * 3))).toBe('mouse');
    expect(wheelSource(plain(100))).toBe('mouse');
    expect(wheelSource(plain(-120))).toBe('mouse');
    expect(wheelSource(plain(8))).toBe('trackpad');
    expect(wheelSource(plain(30, 0, 4))).toBe('trackpad');
    expect(wheelSource(plain(100, 0, 1))).toBe('trackpad');
  });
});

describe('reading wheel events into gestures', () => {
  it('ignores an event that moves nothing', () => {
    expect(reader().read(mac(0, 0), 0)).toEqual({ kind: 'none' });
  });

  it('zooms a mouse notch by one step, smoothly, out for a turn toward the person', () => {
    const wheel = reader();
    const notch = wheel.read(mouse(macWheelNotch), 0);
    expect(notch).toMatchObject({ kind: 'zoom', smooth: true });
    expect((notch as { scale: number }).scale).toBeCloseTo(1 / notchScale, 12);
    const back = wheel.read(mouse(-40), 1000);
    expect(back).toMatchObject({ kind: 'zoom', smooth: true });
    expect((back as { scale: number }).scale).toBeCloseTo(notchScale, 12);
    const two = wheel.read(mouse(96, 2), 2000) as { scale: number };
    expect(two.scale).toBeCloseTo(notchScale ** -2, 12);
  });

  it('scrolls a trackpad as a page, in pixels', () => {
    expect(reader().read(trackpad(6, -2), 0)).toEqual({ kind: 'scroll', x: -2, y: 6 });
    expect(reader().read(plain(2, 1, 1), 0)).toMatchObject({ kind: 'zoom' });
    expect(reader('trackpad').read(plain(2, 1, 1), 0)).toEqual({ kind: 'scroll', x: 16, y: 32 });
    expect(reader('trackpad').read(plain(1, 2), 0)).toEqual({ kind: 'scroll', x: 0, y: 600 });
  });

  it('keeps one source for a burst and starts again after a pause', () => {
    const wheel = reader();
    const kinds = (events: [WheelReading, number][]) =>
      events.map(([event, now]) => wheel.read(event, now).kind);
    // A fast swipe passes 40 and 120 px, whose legacy deltas look like notches.
    expect(
      kinds([
        [trackpad(6), 0],
        [trackpad(18), 16],
        [trackpad(40), 32],
        [trackpad(120), 48],
        [trackpad(8), 64],
      ]),
    ).toEqual(['scroll', 'scroll', 'scroll', 'scroll', 'scroll']);
    expect(
      kinds([
        [mouse(macWheelNotch), 1000],
        [mouse(8), 1100],
        [mouse(48), 1150],
        [mac(3, -9), 1400],
      ]),
    ).toEqual(['zoom', 'zoom', 'zoom', 'zoom']);
    expect(kinds([[mac(3, -9), 1701]])).toEqual(['scroll']);
  });

  it('lets a pinch and momentum speak for themselves inside a burst', () => {
    const wheel = reader();
    wheel.read(mouse(40), 0);
    const pinch = wheel.read({ ...mac(-10, 30), ctrlKey: true }, 10) as { scale: number };
    expect(pinch).toMatchObject({ kind: 'zoom', smooth: false });
    expect(pinch.scale).toBeCloseTo(Math.exp(0.1), 12);
    expect(wheel.read({ ...trackpad(40), momentum: true }, 20)).toEqual({
      kind: 'scroll',
      x: 0,
      y: 40,
    });
    // Momentum ends the mouse burst: what follows within it is the trackpad's.
    expect(wheel.read(mouse(40), 30)).toMatchObject({ kind: 'scroll' });
  });

  it('zooms by notches with the Control key itself held, instead of reading a pinch', () => {
    const wheel = reader();
    wheel.control(true);
    const held = wheel.read({ ...mouse(macWheelNotch), ctrlKey: true }, 0);
    expect(held).toMatchObject({ kind: 'zoom', smooth: true });
    expect((held as { scale: number }).scale).toBeCloseTo(1 / notchScale, 12);
    wheel.control(false);
    const pinch = wheel.read({ ...mouse(macWheelNotch), ctrlKey: true }, 1000) as {
      scale: number;
      smooth: boolean;
    };
    expect(pinch.smooth).toBe(false);
    expect(pinch.scale).toBeCloseTo(Math.exp(-macWheelNotch / 100), 12);
  });

  it('scrolls sideways with Shift, a tilt or macOS turning a Shift wheel sideways', () => {
    expect(reader().read({ ...mouse(40), shiftKey: true }, 0)).toEqual({
      kind: 'scroll',
      x: 40,
      y: 0,
    });
    expect(reader().read({ ...mac(0, 0, 40, -120), shiftKey: true }, 0)).toEqual({
      kind: 'scroll',
      x: 40,
      y: 0,
    });
    expect(reader().read(mac(0, 0, -12.0009765625, 120), 0)).toEqual({
      kind: 'scroll',
      x: -12.0009765625,
      y: 0,
    });
  });

  it('follows the scroll device chosen in Settings', () => {
    expect(reader('mouse').read(trackpad(6), 0)).toMatchObject({ kind: 'zoom' });
    expect(reader('trackpad').read(mouse(macWheelNotch), 0)).toMatchObject({ kind: 'scroll' });
    expect(reader('trackpad').read({ ...trackpad(-5), ctrlKey: true }, 0)).toMatchObject({
      kind: 'zoom',
      smooth: false,
    });
  });
});
