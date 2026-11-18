// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cadFormats, modelFormats } from '../src/domain/previews/models/formats';
import { fileViewValues } from '../src/domain/previews/history';
import {
  defaultModelRotation,
  defaultModelUp,
  modelNavigation,
  modelRotation,
  readModelCamera,
} from '../src/renderer/previews/model/navigation';
import type { ModelRotation } from '../src/renderer/previews/model/navigation';

const modes: ModelRotation[] = ['free', 'turntable'];
const fixtures: { dispose(): void }[] = [];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
});

afterEach(() => {
  for (const fixture of fixtures) fixture.dispose();
  fixtures.length = 0;
  vi.restoreAllMocks();
});

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  button = 0,
  id = 1,
  pointerType = 'mouse',
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: pointerType },
  });
  target.dispatchEvent(event);
}

function fixture(rotation: ModelRotation) {
  const canvas = document.createElement('canvas');
  const captures = new Set<number>();
  canvas.setPointerCapture = (id) => {
    captures.add(id);
  };
  canvas.hasPointerCapture = (id) => captures.has(id);
  canvas.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  document.body.append(canvas);
  const camera = new THREE.PerspectiveCamera(40, 800 / 600, 0.01, 10000);
  camera.position.set(5, -8, 6);
  camera.up.set(0, 0, 1);
  const change = vi.fn();
  const wake = vi.fn();
  const frame = vi.fn();
  const navigation = modelNavigation(camera, canvas, rotation, { change, wake, frame });
  fixtures.push({
    dispose: () => {
      navigation.dispose();
      canvas.remove();
    },
  });
  return { canvas, camera, navigation, change, wake, frame, captures };
}

describe('model rotation defaults and saved cameras', () => {
  it.each([...cadFormats, 'stl', '3mf', '3ds'])(
    'freely tumbles %s with its existing Z-up start',
    (extension) => {
      expect(defaultModelRotation(extension)).toBe('free');
      expect(defaultModelUp(extension)).toEqual([0, 0, 1]);
    },
  );

  it.each(
    modelFormats.filter((extension) => ![...cadFormats, 'stl', '3mf', '3ds'].includes(extension)),
  )('keeps %s as a Y-up turntable', (extension) => {
    expect(defaultModelRotation(extension)).toBe('turntable');
    expect(defaultModelUp(extension)).toEqual([0, 1, 0]);
  });

  it('validates remembered vectors and supports cameras saved before rotation modes', () => {
    const legacy = { position: [8, 9, 10], target: [1, 2, 3] };
    expect(readModelCamera('step', legacy)).toEqual({ ...legacy, up: [0, 0, 1], rotation: 'free' });
    expect(readModelCamera('gltf', legacy)).toEqual({
      ...legacy,
      up: [0, 1, 0],
      rotation: 'turntable',
    });
    expect(readModelCamera('stl', { ...legacy, up: [0, 0, 0] })?.up).toEqual([0, 0, 1]);
    expect(readModelCamera('obj', { ...legacy, up: [NaN, 1, 0] })?.up).toEqual([0, 1, 0]);
    expect(readModelCamera('step', { ...legacy, position: [Infinity, 0, 1] })).toBeUndefined();
    expect(readModelCamera('step', { position: ['1', 2, 3], target: [0, 0, 0] })).toBeUndefined();
    expect(modelRotation('STEP', { rotation: 'unknown' })).toBe('free');
    expect(modelRotation('step', { rotation: 'turntable' })).toBe('turntable');
    expect(modelRotation('obj', { rotation: 'free' })).toBe('free');
  });

  it.each(modes)(
    'round trips a %s camera, target, up vector and mode through file history',
    (rotation) => {
      const { navigation } = fixture(rotation);
      const saved = {
        position: [12, -8, 17],
        target: [2, 3, 4],
        up: [0.6, -0.8, 0],
        rotation,
      };
      navigation.view(saved);
      // A turntable turns around the model's top, so a rolled up vector levels.
      const kept = rotation === 'turntable' ? { ...saved, up: [0, 0, 1] } : saved;
      const history = fileViewValues(
        JSON.parse(JSON.stringify({ 'model.camera': navigation.snapshot() })),
      );
      const remembered = readModelCamera('step', history['model.camera']);
      expect(remembered).toEqual(kept);
      const reopened = fixture(rotation).navigation;
      reopened.view(remembered!);
      expect(reopened.snapshot()).toEqual(kept);
    },
  );
});

describe.each(modes)('%s navigation with real three controls', (rotation) => {
  it('keeps the camera on a mode switch, levels it for a turntable, and drops momentum', () => {
    const { canvas, camera, navigation } = fixture(rotation);
    pointer(canvas, 'pointerdown', 400, 300);
    pointer(document, 'pointermove', 520, 440);
    navigation.update();
    const before = navigation.snapshot();
    const orientation = camera.quaternion.clone();
    const other = rotation === 'free' ? 'turntable' : 'free';
    navigation.rotation(other);
    const up = other === 'turntable' ? [0, 0, 1] : before.up;
    expect(navigation.snapshot()).toEqual({ ...before, rotation: other, up });
    if (other === 'free') expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
    navigation.update();
    expect(camera.position.distanceTo(new THREE.Vector3().fromArray(before.position))).toBeLessThan(
      1e-12,
    );
    expect(camera.up.toArray()).toEqual(up);
    navigation.rotation(rotation);
    expect(camera.up.toArray()).toEqual(up);
  });

  it('wakes on pointer input, redraws through damping, then settles', () => {
    const { canvas, camera, navigation, wake } = fixture(rotation);
    pointer(canvas, 'pointerdown', 400, 300);
    wake.mockClear();
    pointer(document, 'pointermove', 550, 420);
    expect(wake).toHaveBeenCalled();
    expect(navigation.update()).toBe(true);
    pointer(canvas, 'pointerup', 550, 420);
    const released = camera.position.clone();
    expect(navigation.update()).toBe(true);
    expect(camera.position.distanceTo(released)).toBeGreaterThan(0.001);
    for (let index = 0; index < 350; index += 1) navigation.update();
    expect(navigation.update()).toBe(false);
  });

  it('pans with right-drag and two-finger scroll and zooms with wheel and pinch', () => {
    // Each wheel event below starts its own burst.
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000));
    const { canvas, camera, navigation } = fixture(rotation);
    const start = navigation.snapshot();
    pointer(canvas, 'pointerdown', 400, 300, 2);
    pointer(document, 'pointermove', 480, 340, 2);
    navigation.update();
    pointer(canvas, 'pointerup', 480, 340, 2);
    expect(navigation.target.length()).toBeGreaterThan(0.01);
    navigation.view(start);
    const distance = camera.position.distanceTo(navigation.target);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 12, deltaY: 8, cancelable: true }));
    expect(navigation.target.length()).toBeGreaterThan(0.01);
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(distance, 10);
    navigation.view(start);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    navigation.update();
    expect(camera.position.distanceTo(navigation.target)).toBeGreaterThan(distance);
    navigation.view(start);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -12, ctrlKey: true, cancelable: true }));
    navigation.update();
    expect(camera.position.distanceTo(navigation.target)).toBeLessThan(distance);
    navigation.view(start);
    pointer(canvas, 'pointerdown', 300, 300, 0, 1, 'touch');
    pointer(canvas, 'pointerdown', 500, 300, 0, 2, 'touch');
    pointer(document, 'pointermove', 600, 330, 0, 2, 'touch');
    navigation.update();
    expect(camera.position.distanceTo(navigation.target)).toBeLessThan(distance);
    expect(navigation.target.length()).toBeGreaterThan(0.01);
  });

  it('supports focused keyboard pan, rotate, zoom and reset without leaking gestures', () => {
    const { canvas, camera, navigation, frame } = fixture(rotation);
    const bubbled = vi.fn();
    canvas.parentElement!.addEventListener('keydown', bubbled);
    const start = navigation.snapshot();
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        code: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(navigation.target.length()).toBeGreaterThan(0);
    navigation.view(start);
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        code: 'ArrowUp',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    navigation.update();
    expect(camera.position.toArray()).not.toEqual(start.position);
    navigation.view(start);
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }),
    );
    expect(camera.position.length()).toBeLessThan(
      new THREE.Vector3().fromArray(start.position).length(),
    );
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    expect(frame).toHaveBeenCalledOnce();
    expect(bubbled).not.toHaveBeenCalled();
    canvas.parentElement!.removeEventListener('keydown', bubbled);
  });

  it('respects distance bounds and the inactive input switch', () => {
    const { canvas, camera, navigation, captures } = fixture(rotation);
    navigation.minDistance = 4;
    navigation.maxDistance = 20;
    for (let index = 0; index < 100; index += 1) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
      navigation.update();
    }
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(4, 10);
    navigation.rotation(rotation === 'free' ? 'turntable' : 'free');
    for (let index = 0; index < 100; index += 1) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
      navigation.update();
    }
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(20, 10);
    pointer(canvas, 'pointerdown', 400, 300);
    expect(captures.size).toBe(1);
    navigation.enabled = false;
    expect(captures.size).toBe(0);
    const before = navigation.snapshot();
    pointer(document, 'pointermove', 650, 500);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(navigation.update()).toBe(false);
    expect(navigation.snapshot()).toEqual(before);
    navigation.enabled = true;
    pointer(canvas, 'pointerdown', 400, 300);
    pointer(document, 'pointermove', 500, 400);
    expect(navigation.update()).toBe(true);
  });
});

it('crosses the poles freely while turntable rotation keeps its fixed up and polar limits', () => {
  for (const rotation of modes) {
    const { canvas, camera, navigation } = fixture(rotation);
    camera.position.set(0, -10, 0);
    camera.up.set(0, 0, 1);
    navigation.view(navigation.snapshot());
    pointer(canvas, 'pointerdown', 400, 300);
    for (let index = 1; index <= 12; index += 1) {
      pointer(document, 'pointermove', 400, 300 + index * 70);
      navigation.update();
    }
    if (rotation === 'free') {
      expect(camera.up.z).toBeLessThan(0);
    } else {
      expect(camera.up.toArray()).toEqual([0, 0, 1]);
      expect(Math.abs(camera.position.z / camera.position.length())).toBeCloseTo(1, 6);
    }
  }
});

describe.each(modes)('%s turns toward a chosen view', (rotation) => {
  const destination = {
    position: [1, -10, 3],
    target: [1, 2, 3],
    up: [0, 0, 1],
    rotation,
  };

  it('eases toward the view, then lands on it exactly', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { camera, navigation, wake } = fixture(rotation);
    const start = camera.position.clone();
    wake.mockClear();
    navigation.animate(destination, 300);
    expect(wake).toHaveBeenCalled();
    expect(navigation.turning).toBe(true);
    expect(camera.position.toArray()).toEqual(start.toArray());
    now += 150;
    expect(navigation.update()).toBe(true);
    const target = new THREE.Vector3().fromArray(destination.target);
    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.1);
    expect(
      camera.position.distanceTo(new THREE.Vector3().fromArray(destination.position)),
    ).toBeGreaterThan(0.1);
    expect(navigation.target.distanceTo(target)).toBeGreaterThan(0.1);
    expect(navigation.destination()).toEqual(destination);
    now += 200;
    expect(navigation.update()).toBe(true);
    expect(navigation.turning).toBe(false);
    expect(navigation.snapshot()).toEqual(destination);
  });

  it('places the view at once without motion, and lands on it when input is switched off', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { navigation } = fixture(rotation);
    navigation.animate(destination, 0);
    expect(navigation.turning).toBe(false);
    expect(navigation.snapshot()).toEqual(destination);
    navigation.animate({ ...destination, position: [1, 2, 15] }, 300);
    now += 100;
    navigation.update();
    navigation.enabled = false;
    expect(navigation.turning).toBe(false);
    expect(navigation.snapshot()).toEqual({ ...destination, position: [1, 2, 15] });
  });

  it('gives way to a press, wheel or key where the turn is, without jumping to its end', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { canvas, navigation } = fixture(rotation);
    for (const interrupt of [
      () => pointer(canvas, 'pointerdown', 400, 300),
      () => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true })),
      () =>
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }),
        ),
    ]) {
      navigation.view({ ...destination, position: [12, 2, 3] });
      navigation.animate(destination, 300);
      now += 100;
      navigation.update();
      const midway = navigation.snapshot();
      interrupt();
      pointer(canvas, 'pointerup', 400, 300);
      expect(navigation.turning).toBe(false);
      expect(navigation.snapshot().target).toEqual(midway.target);
      expect(navigation.snapshot().position).not.toEqual(destination.position);
    }
  });
});

describe('turning the model from the view cube', () => {
  it('turns a free camera any way, through the poles, keeping its distance', () => {
    const { camera, navigation, change } = fixture('free');
    camera.position.set(0, -10, 0);
    navigation.view(navigation.snapshot());
    navigation.hold();
    change.mockClear();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    navigation.turn(0.3, 0);
    expect(change).toHaveBeenCalled();
    expect(camera.position.dot(right)).toBeLessThan(-1);
    expect(camera.position.length()).toBeCloseTo(10, 10);
    navigation.view({ ...navigation.snapshot(), position: [0, -10, 0], up: [0, 0, 1] });
    navigation.turn(0, Math.PI);
    expect(camera.position.toArray().map((value) => +value.toFixed(9))).toEqual([0, 10, 0]);
    expect(camera.up.z).toBeCloseTo(-1, 9);
  });

  it('turns a turntable around its axis and stops at the poles', () => {
    const { camera, navigation } = fixture('turntable');
    camera.position.set(0, -10, 0);
    navigation.view(navigation.snapshot());
    navigation.turn(0.5, 0);
    expect(camera.position.z).toBeCloseTo(0, 10);
    expect(camera.position.length()).toBeCloseTo(10, 10);
    navigation.turn(0, 10);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
    expect(camera.position.angleTo(new THREE.Vector3(0, 0, 1))).toBeCloseTo(1e-6, 9);
    navigation.turn(0, -10);
    expect(camera.position.angleTo(new THREE.Vector3(0, 0, -1))).toBeCloseTo(1e-6, 9);
    expect(camera.position.length()).toBeCloseTo(10, 10);
  });
});

it('keeps trackball buttons when a key with an empty code is held anywhere in the window', () => {
  const { canvas, navigation } = fixture('free');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process' }));
  try {
    pointer(canvas, 'pointerdown', 400, 300, 2);
    pointer(document, 'pointermove', 480, 340, 2);
    navigation.update();
    pointer(canvas, 'pointerup', 480, 340, 2);
    // A right-drag pans: the target moves. In rotate mode it would stay at the origin.
    expect(navigation.target.length()).toBeGreaterThan(0.01);
  } finally {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process' }));
  }
});

it.each(modes)(
  'turns a %s camera over a pole without spinning the picture at the end',
  (rotation) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { camera, navigation } = fixture(rotation);
    navigation.view({ position: [0, 10, 0], target: [0, 0, 0], up: [0, 0, 1], rotation });
    // The Top view of a Z-up model: the camera a millionth of a turn toward the front (-Y).
    const top = new THREE.Vector3(0, -1e-6, 1).normalize().multiplyScalar(10);
    navigation.animate(
      {
        position: top.toArray(),
        target: [0, 0, 0],
        up: rotation === 'free' ? [0, 1, 0] : [0, 0, 1],
        rotation,
      },
      300,
    );
    let previous = camera.quaternion.clone();
    let largest = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      now += 10;
      navigation.update();
      largest = Math.max(largest, camera.quaternion.angleTo(previous));
      previous = camera.quaternion.clone();
    }
    expect(navigation.turning).toBe(false);
    // Half a turn eased over 30 frames moves at most about 0.31 radians a frame.
    expect(largest).toBeLessThan(0.4);
    expect(camera.up.toArray()).toEqual(rotation === 'free' ? [0, 1, 0] : [0, 0, 1]);
    // The back of the model is at the top of the picture.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y).toBeCloseTo(1, 5);
  },
);

it('keeps the turntable axis when input interrupts a rolling turn', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { canvas, camera, navigation } = fixture('turntable');
  navigation.view({
    position: [0, 10, 0],
    target: [0, 0, 0],
    up: [0, 0, 1],
    rotation: 'turntable',
  });
  navigation.animate(
    { position: [0, -1e-5, 10], target: [0, 0, 0], up: [0, 0, 1], rotation: 'turntable' },
    300,
  );
  now += 150;
  navigation.update();
  expect(camera.up.toArray()).not.toEqual([0, 0, 1]);
  expect(navigation.snapshot().up).toEqual([0, 0, 1]);
  pointer(canvas, 'pointerdown', 400, 300);
  pointer(canvas, 'pointerup', 400, 300);
  expect(camera.up.toArray()).toEqual([0, 0, 1]);
});

/** A wheel event as Chromium on macOS sends it: pixels, with the legacy wheelDelta fields. */
function macWheel(deltaY: number, wheelDeltaY: number, deltaX = 0, wheelDeltaX = 0) {
  const event = new WheelEvent('wheel', { deltaX, deltaY, deltaMode: 0, cancelable: true });
  Object.defineProperties(event, {
    wheelDeltaY: { value: wheelDeltaY },
    wheelDeltaX: { value: wheelDeltaX },
  });
  return event;
}

describe.each(modes)('the wheel in %s rotation', (rotation) => {
  it.each([4.000244140625, 12.0009765625, 40])('zooms on a %s px mouse notch', (deltaY) => {
    const { canvas, camera, navigation } = fixture(rotation);
    const target = navigation.target.clone();
    const distance = camera.position.distanceTo(target);
    const event = macWheel(deltaY, -120);
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    for (let index = 0; index < 60; index += 1) navigation.update();
    expect(navigation.target.distanceTo(target)).toBeLessThan(1e-9);
    expect(camera.position.distanceTo(navigation.target) / distance).toBeCloseTo(1.1, 6);
  });

  it('reads one accelerating wheel gesture one way, and a trackpad swipe as a pan', () => {
    const { canvas, navigation } = fixture(rotation);
    const kinds = (events: WheelEvent[]) =>
      events.map((event) => {
        const before = navigation.target.clone();
        canvas.dispatchEvent(event);
        return navigation.target.distanceTo(before) > 1e-9 ? 'pan' : 'zoom';
      });
    expect(kinds([4.000244140625, 8, 24, 48, 96].map((deltaY) => macWheel(deltaY, -120)))).toEqual([
      'zoom',
      'zoom',
      'zoom',
      'zoom',
      'zoom',
    ]);
    const swipe = fixture(rotation);
    const pans = [6, 18, 60, 120, 40, 8].map((deltaY) => {
      const before = swipe.navigation.target.clone();
      swipe.canvas.dispatchEvent(macWheel(deltaY, -3 * deltaY));
      return swipe.navigation.target.distanceTo(before) > 1e-9;
    });
    expect(pans).toEqual([true, true, true, true, true, true]);
  });

  it('moves the model with the content, as a scrolled page moves', () => {
    const { canvas, camera, navigation } = fixture(rotation);
    navigation.update();
    const origin = navigation.target.clone();
    const screen = () => {
      camera.updateMatrixWorld();
      const projected = origin.clone().project(camera);
      return { x: projected.x * 400, y: -projected.y * 300 };
    };
    canvas.dispatchEvent(macWheel(0, 0, 30, -90));
    expect(screen().x).toBeLessThan(-1);
    expect(Math.abs(screen().y)).toBeLessThan(1e-6);
    navigation.view({ ...navigation.snapshot(), target: origin.toArray() });
    canvas.dispatchEvent(macWheel(30, -90));
    expect(screen().y).toBeLessThan(-1);
  });

  it('zooms at one speed in both modes, for a notch and for a pinch', () => {
    const { canvas, camera, navigation } = fixture(rotation);
    const start = camera.position.distanceTo(navigation.target);
    for (let index = 0; index < 50; index += 1)
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -2, ctrlKey: true, deltaMode: 0, cancelable: true }),
      );
    for (let index = 0; index < 50; index += 1) navigation.update();
    // Fifty pinch steps of -2 px are one scale of e: the distance shrinks by that much.
    expect(camera.position.distanceTo(navigation.target) / start).toBeCloseTo(Math.exp(-1), 9);
  });

  it('keeps the controls’ own wheel zoom out, and stops easing at the distance limits', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000));
    const { canvas, camera, navigation } = fixture(rotation);
    navigation.minDistance = 9;
    navigation.maxDistance = 12;
    const start = camera.position.distanceTo(navigation.target);
    canvas.dispatchEvent(macWheel(6, -18));
    for (let index = 0; index < 200; index += 1) navigation.update();
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(start, 9);
    for (let index = 0; index < 20; index += 1)
      canvas.dispatchEvent(macWheel(40.00244140625, -120));
    for (let index = 0; index < 100; index += 1) navigation.update();
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(12, 9);
    expect(navigation.update()).toBe(false);
    // Zoom past a limit is dropped, not saved up: the next notch back moves at once.
    for (let index = 0; index < 20; index += 1)
      canvas.dispatchEvent(macWheel(40.00244140625, -120));
    navigation.update();
    navigation.update();
    canvas.dispatchEvent(macWheel(-40, 120));
    for (let index = 0; index < 3; index += 1) navigation.update();
    expect(camera.position.distanceTo(navigation.target)).toBeLessThan(11.5);
  });

  it('pans sideways with Shift and a mouse, and zooms by notches with the Control key held', () => {
    const { canvas, camera, navigation } = fixture(rotation);
    const distance = camera.position.distanceTo(navigation.target);
    const shifted = macWheel(40.00244140625, -120);
    Object.defineProperty(shifted, 'shiftKey', { value: true });
    canvas.dispatchEvent(shifted);
    expect(navigation.target.length()).toBeGreaterThan(0.01);
    expect(camera.position.distanceTo(navigation.target)).toBeCloseTo(distance, 9);
    const held = fixture(rotation);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    const control = macWheel(4.000244140625, -120);
    Object.defineProperty(control, 'ctrlKey', { value: true });
    held.canvas.dispatchEvent(control);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }));
    const first = held.camera.position.distanceTo(held.navigation.target);
    for (let index = 0; index < 60; index += 1) held.navigation.update();
    // Eased over frames, as a notch: not at once, as a pinch would be.
    expect(first).toBeCloseTo(distance, 9);
    expect(held.camera.position.distanceTo(held.navigation.target) / distance).toBeCloseTo(1.1, 6);
  });

  it('follows the scroll device chosen in Settings', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const camera = new THREE.PerspectiveCamera(40, 800 / 600, 0.01, 10000);
    camera.position.set(5, -8, 6);
    camera.up.set(0, 0, 1);
    let device: 'mouse' | 'trackpad' = 'trackpad';
    const navigation = modelNavigation(
      camera,
      canvas,
      rotation,
      { change: () => {}, wake: () => {}, frame: () => {} },
      { scrollDevice: () => device },
    );
    fixtures.push({
      dispose: () => {
        navigation.dispose();
        canvas.remove();
      },
    });
    canvas.dispatchEvent(macWheel(4.000244140625, -120));
    expect(navigation.target.length()).toBeGreaterThan(0.01);
    device = 'mouse';
    const target = navigation.target.clone();
    canvas.dispatchEvent(macWheel(3, -9));
    expect(navigation.target.distanceTo(target)).toBeLessThan(1e-9);
  });
});

it('turns a turntable around the model top after a rolled free camera switches to it', () => {
  const { navigation } = fixture('free');
  navigation.turn(0, 1.1);
  navigation.turn(0.9, 0);
  navigation.turn(0, -0.7);
  const rolled = new THREE.Vector3().fromArray(navigation.snapshot().up);
  expect(rolled.angleTo(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.2);
  navigation.rotation('turntable');
  expect(navigation.snapshot().up).toEqual([0, 0, 1]);
  const custom = fixture('turntable');
  const levelled = modelNavigation(
    custom.camera,
    custom.canvas,
    'turntable',
    { change: () => {}, wake: () => {}, frame: () => {} },
    { top: [0, 1, 0] },
  );
  levelled.view({ position: [3, 4, 5], target: [0, 0, 0], up: [1, 0, 0], rotation: 'turntable' });
  expect(levelled.snapshot().up).toEqual([0, 1, 0]);
  levelled.dispose();
});

it('rolls a free camera’s up vector with Shift and the arrows', () => {
  const { canvas, camera } = fixture('free');
  const up = camera.up.clone();
  canvas.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, cancelable: true }),
  );
  expect(camera.up.angleTo(up)).toBeCloseTo(0.08, 9);
});

describe('zoom easing and the Control key', () => {
  const notch = () => macWheel(40.00244140625, -120);
  const pinch = () => {
    const event = macWheel(-2, 6);
    Object.defineProperty(event, 'ctrlKey', { value: true });
    return event;
  };

  it('eases a notch over frames, and a new view drops what is left of it', () => {
    const { canvas, camera, navigation } = fixture('free');
    const distance = camera.position.distanceTo(navigation.target);
    canvas.dispatchEvent(notch());
    navigation.update();
    const first = camera.position.distanceTo(navigation.target) / distance;
    expect(first).toBeCloseTo(1.1 ** 0.35, 9);
    const view = navigation.snapshot();
    navigation.view(view);
    for (let index = 0; index < 60; index += 1) navigation.update();
    expect(camera.position.distanceTo(navigation.target) / distance).toBeCloseTo(first, 9);
  });

  it('reads a pinch again once the window loses focus with Control down', () => {
    const { canvas, camera, navigation } = fixture('turntable');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    window.dispatchEvent(new Event('blur'));
    const distance = camera.position.distanceTo(navigation.target);
    canvas.dispatchEvent(pinch());
    // A pinch zooms at once; a notch with Control held would ease in over frames.
    expect(distance / camera.position.distanceTo(navigation.target)).toBeCloseTo(Math.exp(0.02), 9);
  });

  it('reads a pinch again once a key or pointer event shows Control is up', () => {
    for (const release of [
      () => document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })),
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
    ]) {
      const { canvas, camera, navigation } = fixture('free');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
      release();
      const distance = camera.position.distanceTo(navigation.target);
      canvas.dispatchEvent(pinch());
      expect(distance / camera.position.distanceTo(navigation.target)).toBeCloseTo(
        Math.exp(0.02),
        9,
      );
    }
  });
});

describe('levelling for a turntable', () => {
  it('turns a rolled free camera level over the given time, then hands over', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { camera, navigation } = fixture('free');
    navigation.turn(0, 1.1);
    navigation.turn(0.9, 0);
    const rolled = navigation.snapshot();
    expect(
      new THREE.Vector3().fromArray(rolled.up).angleTo(new THREE.Vector3(0, 0, 1)),
    ).toBeGreaterThan(0.2);
    navigation.rotation('turntable', 320);
    expect(navigation.snapshot()).toMatchObject({ rotation: 'turntable', up: [0, 0, 1] });
    expect(navigation.turning).toBe(true);
    expect(camera.up.toArray()).toEqual(rolled.up);
    now += 160;
    navigation.update();
    const midway = camera.up.angleTo(new THREE.Vector3(0, 0, 1));
    expect(midway).toBeGreaterThan(1e-3);
    expect(midway).toBeLessThan(
      new THREE.Vector3().fromArray(rolled.up).angleTo(new THREE.Vector3(0, 0, 1)),
    );
    now += 200;
    navigation.update();
    expect(navigation.turning).toBe(false);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
    expect(camera.position.toArray()).toEqual(rolled.position);
  });

  it('keeps the picture’s top when it levels a camera straight above or below', () => {
    const { camera, navigation } = fixture('turntable');
    navigation.view({
      position: [0, 0, 20],
      target: [0, 0, 0],
      up: [0, 1, 0],
      rotation: 'turntable',
    });
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    expect(screenUp.y).toBeGreaterThan(0.999);
    navigation.view({
      position: [0, 0, -20],
      target: [0, 0, 0],
      up: [-1, 0, 0],
      rotation: 'turntable',
    });
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).x).toBeLessThan(-0.999);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
  });
});
