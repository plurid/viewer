import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { cadFormats } from '../../../domain/previews/models/formats';
import type { ModelScrollDevice } from '../../../domain/previews/models/scroll-device';
import { notchScale, wheelReader, wheelReading } from './wheel';

export type ModelRotation = 'free' | 'turntable';
type ModelControls = OrbitControls | TrackballControls;
type ModelVector = [number, number, number];

export interface ModelCamera {
  position: number[];
  target: number[];
  up: number[];
  rotation: ModelRotation;
}

/** A turn toward a chosen view: orientation, target and distance eased together. */
interface ModelTurn {
  start: number;
  duration: number;
  view: ModelCamera;
  from: ModelPose;
  to: ModelPose;
}

interface ModelPose {
  orientation: THREE.Quaternion;
  target: THREE.Vector3;
  distance: number;
}

/** TrackballControls reads modifier keys from the whole window. No key code is this name. */
const noKey = 'Viewer.NoKey';

export function defaultModelRotation(extension: string): ModelRotation {
  const format = extension.toLowerCase();
  return cadFormats.includes(format) || ['stl', '3mf', '3ds'].includes(format)
    ? 'free'
    : 'turntable';
}

export function defaultModelUp(extension: string): ModelVector {
  return defaultModelRotation(extension) === 'free' ? [0, 0, 1] : [0, 1, 0];
}

export function modelRotation(extension: string, saved: unknown): ModelRotation {
  const rotation = saved && typeof saved === 'object' && 'rotation' in saved && saved.rotation;
  return rotation === 'free' || rotation === 'turntable'
    ? rotation
    : defaultModelRotation(extension);
}

function vector(value: unknown): value is ModelVector {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

export function readModelCamera(extension: string, saved: unknown): ModelCamera | undefined {
  if (!saved || typeof saved !== 'object' || !('position' in saved) || !('target' in saved)) return;
  if (!vector(saved.position) || !vector(saved.target)) return;
  const up = 'up' in saved ? saved.up : undefined;
  return {
    position: [...saved.position],
    target: [...saved.target],
    up: vector(up) && up.some((value) => value !== 0) ? [...up] : defaultModelUp(extension),
    rotation: modelRotation(extension, saved),
  };
}

function pose(view: ModelCamera): ModelPose {
  const position = new THREE.Vector3().fromArray(view.position);
  const target = new THREE.Vector3().fromArray(view.target);
  const up = new THREE.Vector3().fromArray(view.up);
  return {
    // A camera's orientation is the rotation of a matrix looking from its position at its target.
    orientation: new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(position, target, up),
    ),
    target,
    distance: position.distanceTo(target),
  };
}

function eased(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export interface ModelNavigationOptions {
  /** The format's top, the axis a turntable turns around: the camera's up when created. */
  top?: readonly number[];
  /** What the wheel is read as; Automatic tells a mouse from a trackpad. */
  scrollDevice?(): ModelScrollDevice;
}

/** Keeps model state and input independent of the controls' different damping APIs. */
export function modelNavigation(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  initialRotation: ModelRotation,
  callbacks: { change(): void; wake(): void; frame(): void },
  options: ModelNavigationOptions = {},
) {
  const top = new THREE.Vector3().fromArray(options.top ?? camera.up.toArray()).normalize();
  let rotation = initialRotation;
  let changed = false;
  let motion: ModelTurn | undefined;
  /** Zoom still to come from wheel notches, as the logarithm of its scale. */
  let zooming = 0;
  const reader = wheelReader({
    device: options.scrollDevice ?? (() => 'automatic'),
    pageHeight: () => canvas.clientHeight,
  });
  const pointers = new Set<number>();
  const change = () => {
    changed = true;
    callbacks.change();
  };
  const create = (target: THREE.Vector3, enabled: boolean, minimum: number, maximum: number) => {
    const position = camera.position.clone();
    const up = camera.up.clone();
    const next: ModelControls =
      rotation === 'free'
        ? new TrackballControls(camera, canvas)
        : new OrbitControls(camera, canvas);
    if (next instanceof TrackballControls) {
      next.staticMoving = false;
      next.dynamicDampingFactor = 0.1;
      // Keyboard actions belong to the focused canvas, never another plane's typing. An empty
      // code would match a synthetic or composed key event and hold every button in one mode.
      next.keys = [noKey, noKey, noKey];
    } else {
      next.enableDamping = true;
      next.dampingFactor = 0.1;
      next.listenToKeyEvents(canvas);
    }
    next.target.copy(target);
    next.enabled = enabled;
    next.minDistance = minimum;
    next.maxDistance = maximum;
    // Constructors update the camera before its target is assigned. Restore all coordinates.
    camera.position.copy(position);
    camera.up.copy(up);
    camera.lookAt(target);
    next.addEventListener('change', change);
    next.addEventListener('start', callbacks.wake);
    return next;
  };
  let controls = create(new THREE.Vector3(), true, 0, Infinity);
  const releasePointers = () => {
    for (const id of pointers) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    pointers.clear();
  };
  /**
   * A turntable turns around the model's top, so its camera is level. Straight above or below,
   * where level has no direction, it leans a millionth of a turn so the picture keeps the view's
   * own up at the top: away from it above the model and toward it below, as the cube's Top and
   * Bottom views do.
   */
  const levelled = (view: ModelCamera): ModelCamera => {
    const target = new THREE.Vector3().fromArray(view.target);
    const position = new THREE.Vector3().fromArray(view.position);
    const eye = position.clone().sub(target);
    if (eye.lengthSq() && eye.clone().normalize().cross(top).lengthSq() < 1e-14) {
      const given = new THREE.Vector3().fromArray(view.up);
      const lean = given.addScaledVector(top, -given.dot(top));
      if (lean.lengthSq() > 1e-12)
        position.addScaledVector(lean.normalize(), -Math.sign(eye.dot(top)) * eye.length() * 1e-6);
    }
    return { ...view, position: position.toArray(), up: top.toArray() };
  };
  const replace = (requested: ModelCamera) => {
    motion = undefined;
    const view = requested.rotation === 'turntable' ? levelled(requested) : requested;
    const { enabled, minDistance, maxDistance } = controls;
    controls.dispose();
    releasePointers();
    zooming = 0;
    rotation = view.rotation;
    camera.position.fromArray(view.position);
    camera.up.fromArray(view.up);
    controls = create(
      new THREE.Vector3().fromArray(view.target),
      enabled,
      minDistance,
      maxDistance,
    );
    change();
  };
  /** A turntable's up is its axis, also while a turn rolls the picture. */
  const restingUp = () => (rotation === 'turntable' ? top.toArray() : camera.up.toArray());
  const snapshot = (): ModelCamera => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    up: restingUp(),
    rotation,
  });
  /** Where a running turn is heading: disabling the controls or switching rotation lands there. */
  const settled = () => motion?.view ?? snapshot();
  /** Input takes over from a running turn where it is, without the jump to its end. */
  const interrupt = () => {
    if (!motion) return;
    camera.up.fromArray(restingUp());
    camera.lookAt(controls.target);
    motion = undefined;
  };
  const step = (active: ModelTurn) => {
    const progress = Math.min((performance.now() - active.start) / active.duration, 1);
    if (progress >= 1) {
      replace(active.view);
      return;
    }
    const amount = eased(progress);
    const orientation = active.from.orientation.clone().slerp(active.to.orientation, amount);
    controls.target.lerpVectors(active.from.target, active.to.target, amount);
    const distance = THREE.MathUtils.lerp(active.from.distance, active.to.distance, amount);
    camera.position.set(0, 0, distance).applyQuaternion(orientation).add(controls.target);
    // The picture rolls with the turn in both modes: a turntable's fixed up would spin it half a
    // turn where the path passes over a pole. The turntable's axis returns when the turn ends.
    camera.up.set(0, 1, 0).applyQuaternion(orientation);
    camera.lookAt(controls.target);
    change();
  };
  const resize = () => {
    if (controls instanceof TrackballControls) controls.handleResize();
  };
  const down = (event: PointerEvent) => {
    if (!controls.enabled) return;
    interrupt();
    resize();
    pointers.add(event.pointerId);
    canvas.focus({ preventScroll: true });
    callbacks.wake();
  };
  const move = () => {
    // TrackballControls only records pointer deltas; its update runs on the next frame.
    if (controls.enabled && pointers.size) callbacks.wake();
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
  };
  /** Moves the camera `x` pixels left and `y` up: the model moves the other way. */
  const pan = (x: number, y: number) => {
    camera.updateMatrix();
    const scale =
      (2 *
        camera.position.distanceTo(controls.target) *
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
      Math.max(canvas.clientHeight, 1);
    const offset = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrix, 0)
      .multiplyScalar(-x * scale);
    offset.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1), y * scale);
    camera.position.add(offset);
    controls.target.add(offset);
    change();
  };
  /** Moves the camera toward the target by the logarithm of a scale, within the limits. */
  const zoom = (amount: number) => {
    const distance = camera.position.distanceTo(controls.target);
    const next = THREE.MathUtils.clamp(
      distance / Math.exp(amount),
      controls.minDistance,
      controls.maxDistance,
    );
    if (Math.abs(next - distance) <= distance * 1e-9) return false;
    camera.position.sub(controls.target).setLength(next).add(controls.target);
    change();
    return true;
  };
  // Every wheel zooms and pans here, at one speed in both modes: the controls' own wheel zoom
  // differs per mode and reads every scroll as a zoom.
  const wheel = (event: WheelEvent) => {
    if (!controls.enabled) return;
    interrupt();
    event.preventDefault();
    event.stopImmediatePropagation();
    const gesture = reader.read(wheelReading(event), performance.now());
    if (gesture.kind === 'zoom') {
      if (gesture.smooth) zooming += Math.log(gesture.scale);
      else zoom(Math.log(gesture.scale));
    } else if (gesture.kind === 'scroll') {
      // A page scrolled down moves its content up: the camera moves down.
      pan(-gesture.x, -gesture.y);
    }
    callbacks.wake();
  };
  // Every key and pointer event says whether Control is down, so a release the window never saw,
  // such as one in a native menu, cannot leave pinches reading as notches.
  const controlKey = (event: KeyboardEvent | PointerEvent) => reader.control(event.ctrlKey);
  const controlReleased = () => reader.control(false);
  const key = (event: KeyboardEvent) => {
    if (!controls.enabled || event.altKey || event.metaKey) return;
    const horizontal = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    const vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    const zoomKey = ['+', '=', '-', '_'].includes(event.key);
    if (event.key !== 'Home' && !zoomKey && !horizontal && !vertical) return;
    interrupt();
    if (event.key === 'Home') {
      callbacks.frame();
    } else if (zoomKey) {
      zoom((event.key === '-' || event.key === '_' ? -1 : 1) * Math.log(notchScale));
    } else if (controls instanceof TrackballControls) {
      if (event.shiftKey || event.ctrlKey) {
        const eye = camera.position.clone().sub(controls.target);
        const axis = horizontal
          ? camera.up.clone().normalize()
          : new THREE.Vector3().crossVectors(camera.up, eye).normalize();
        const spin = new THREE.Quaternion().setFromAxisAngle(
          axis,
          (horizontal || vertical) * -0.08,
        );
        camera.position.copy(eye.applyQuaternion(spin)).add(controls.target);
        camera.up.applyQuaternion(spin);
        change();
      } else {
        pan(horizontal * 7, vertical * 7);
      }
      camera.lookAt(controls.target);
    }
    event.preventDefault();
    event.stopPropagation();
    callbacks.wake();
  };
  // Capture runs before the controls' own wheel listeners, which it stops.
  canvas.addEventListener('wheel', wheel, { capture: true, passive: false });
  canvas.addEventListener('pointerdown', down, { capture: true });
  canvas.addEventListener('keydown', key);
  canvas.ownerDocument.addEventListener('pointermove', move);
  canvas.ownerDocument.addEventListener('pointerup', up);
  canvas.ownerDocument.addEventListener('pointercancel', up);
  // A pinch arrives as a wheel with Control set; only key events tell the real key apart.
  const owner = canvas.ownerDocument.defaultView;
  const controlEvents = ['keydown', 'keyup', 'pointerdown', 'pointermove'] as const;
  for (const type of controlEvents) owner?.addEventListener(type, controlKey, { capture: true });
  owner?.addEventListener('blur', controlReleased);

  return {
    get target() {
      return controls.target;
    },
    get enabled() {
      return controls.enabled;
    },
    set enabled(value: boolean) {
      if (controls.enabled === value) return;
      controls.enabled = value;
      // Disabled controls drop their momentum; a running turn lands on its view.
      if (!value) replace(settled());
    },
    set minDistance(value: number) {
      controls.minDistance = value;
    },
    set maxDistance(value: number) {
      controls.maxDistance = value;
    },
    /** True while a turn toward a chosen view is running. */
    get turning() {
      return !!motion;
    },
    snapshot,
    /** A wheel event over the view cube, read as one over the canvas. */
    wheel,
    /** Zooms by whole notches, in for positive steps, as + and - do. */
    zoom(steps: number) {
      interrupt();
      zoom(steps * Math.log(notchScale));
      callbacks.wake();
    },
    /** Where the camera is heading: a running turn's view, else where it is. */
    destination: settled,
    view: replace,
    /** Turns toward `view` over `duration` milliseconds; zero places it at once. */
    animate(view: ModelCamera, duration: number) {
      if (duration <= 0) {
        replace(view);
        return;
      }
      // Fresh controls drop old momentum before the turn starts from where the camera is.
      replace(snapshot());
      motion = {
        start: performance.now(),
        duration,
        view,
        from: pose(snapshot()),
        to: pose(view),
      };
      callbacks.wake();
    },
    /** Momentum and a running turn stop before the cube is dragged. */
    hold() {
      interrupt();
      replace(snapshot());
    },
    /**
     * Rotates the camera around the target as a drag would: `x` and `y` are angles for a drag
     * right and down. A turntable keeps its axis and stops at the poles.
     */
    turn(x: number, y: number) {
      interrupt();
      const target = controls.target;
      const eye = camera.position.clone().sub(target);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      if (rotation === 'turntable') {
        const axis = camera.up.clone().normalize();
        eye.applyAxisAngle(axis, -x);
        right.applyAxisAngle(axis, -x);
        const polar = eye.angleTo(axis);
        const next = THREE.MathUtils.clamp(polar - y, 1e-6, Math.PI - 1e-6);
        eye.applyAxisAngle(right, next - polar);
      } else {
        const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const rotate = new THREE.Quaternion()
          .setFromAxisAngle(screenUp, -x)
          .multiply(new THREE.Quaternion().setFromAxisAngle(right, -y));
        eye.applyQuaternion(rotate);
        camera.up.applyQuaternion(rotate);
      }
      camera.position.copy(target).add(eye);
      camera.lookAt(target);
      change();
      callbacks.wake();
    },
    /**
     * Switches the rotation mode where the camera is. Into a turntable, a rolled camera turns
     * level over `duration` milliseconds; zero levels it at once.
     */
    rotation(value: ModelRotation, duration = 0) {
      if (rotation === value) return;
      const rolled = settled();
      replace({ ...rolled, rotation: value });
      const level = snapshot();
      if (duration <= 0 || pose(rolled).orientation.angleTo(pose(level).orientation) < 1e-9) return;
      camera.position.fromArray(rolled.position);
      camera.up.fromArray(rolled.up);
      camera.lookAt(controls.target);
      motion = {
        start: performance.now(),
        duration,
        view: level,
        from: pose(rolled),
        to: pose(level),
      };
      callbacks.wake();
    },
    resize,
    update(): boolean {
      changed = false;
      // A turn places the camera itself; the controls take over when it lands.
      if (motion) {
        step(motion);
        return true;
      }
      // Wheel notches ease in over a few frames; the last sliver lands at once.
      if (zooming) {
        const amount = Math.abs(zooming) < 1e-4 ? zooming : zooming * 0.35;
        zooming -= amount;
        if (!zoom(amount)) zooming = 0;
      }
      if (controls.enabled) controls.update();
      return changed;
    },
    dispose() {
      motion = undefined;
      controls.dispose();
      releasePointers();
      canvas.removeEventListener('wheel', wheel, { capture: true });
      canvas.removeEventListener('pointerdown', down, { capture: true });
      canvas.removeEventListener('keydown', key);
      canvas.ownerDocument.removeEventListener('pointermove', move);
      canvas.ownerDocument.removeEventListener('pointerup', up);
      canvas.ownerDocument.removeEventListener('pointercancel', up);
      for (const type of controlEvents)
        owner?.removeEventListener(type, controlKey, { capture: true });
      owner?.removeEventListener('blur', controlReleased);
    },
  };
}

export type ModelNavigation = ReturnType<typeof modelNavigation>;
