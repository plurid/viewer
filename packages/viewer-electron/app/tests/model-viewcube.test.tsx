// @vitest-environment jsdom
import * as THREE from 'three';
import type * as ThreeModule from 'three';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import type { PreviewCommand, PreviewContext } from '../src/renderer/previews/contracts';
import type { ModelCamera, ModelRotation } from '../src/renderer/previews/model/navigation';
import { defaultModelUp } from '../src/renderer/previews/model/navigation';
import {
  cubePatch,
  cubeTransform,
  cubeViews,
  homeOffset,
  modelCubeBasis,
  nearestCubeView,
  standardModelView,
  stepCubeView,
} from '../src/renderer/previews/model/viewcube';
import type { CubeView } from '../src/renderer/previews/model/viewcube';
import { modelGeometryCache } from '../src/renderer/previews/model/cache';

const graphics = vi.hoisted(() => ({
  camera: undefined as ThreeModule.PerspectiveCamera | undefined,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  now: 0,
  reducedMotion: true,
}));

vi.mock('three', async (original) => ({
  ...(await original<typeof ThreeModule>()),
  // Real controls, camera and geometry; only WebGL is absent in jsdom.
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    render(_scene: ThreeModule.Scene, camera: ThreeModule.PerspectiveCamera) {
      graphics.camera = camera;
    }
    dispose() {}
    forceContextLoss() {}
  },
}));

vi.mock('../src/renderer/previews/model/mesh', async () => {
  const THREE = await import('three');
  return {
    importMesh: vi.fn(async () => undefined),
    meshObjects: () =>
      new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshStandardMaterial()),
  };
});

beforeEach(() => {
  graphics.now = 1000;
  graphics.reducedMotion = true;
  vi.spyOn(performance, 'now').mockImplementation(() => graphics.now);
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('reduced-motion') && graphics.reducedMotion,
      }) as MediaQueryList,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    })),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++graphics.nextFrame;
    graphics.frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    graphics.frames.delete(id);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  const captures = new WeakMap<Element, Set<number>>();
  HTMLElement.prototype.setPointerCapture = function (id: number) {
    captures.set(this, (captures.get(this) ?? new Set()).add(id));
  };
  HTMLElement.prototype.releasePointerCapture = function (id: number) {
    captures.get(this)?.delete(id);
  };
  HTMLElement.prototype.hasPointerCapture = function (id: number) {
    return !!captures.get(this)?.has(id);
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  graphics.frames.clear();
  graphics.camera = undefined;
  modelGeometryCache.clear();
});

function frames(count = 1) {
  act(() => {
    for (let index = 0; index < count; index += 1) {
      const pending = [...graphics.frames.values()];
      graphics.frames.clear();
      for (const callback of pending) callback(graphics.now);
    }
  });
}

function pointer(target: EventTarget, type: string, x: number, y: number, button = 0) {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button,
    buttons: type === 'pointerup' ? 0 : 1,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

async function preview(extension: string, values = new Map<string, unknown>()) {
  let commands: readonly PreviewCommand[] = [];
  const context: PreviewContext = {
    resource: {
      id: `model-${extension}`,
      url: `https://fixture.invalid/model.${extension}`,
      entry: {
        path: `/fixture/model.${extension}`,
        name: `model.${extension}`,
        parent: '/fixture',
        extension,
        kind: 'file',
        directory: false,
        size: 100,
        modified: 1,
        created: 1,
        hidden: false,
        mime: 'application/octet-stream',
        identity: `model-${extension}`,
      },
    },
    active: true,
    interactive: true,
    toolbar: 'all',
    state: {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value);
      },
    },
    look: 'dark',
    signal: new AbortController().signal,
    commands: {
      register: (next) => {
        commands = next;
        return () => {
          commands = [];
        };
      },
    },
    services: {} as PreviewContext['services'],
  };
  const view = render(<ModelPreview {...context} />);
  await waitFor(() =>
    expect(commands.find((command) => command.id === 'model-frame')?.available).toBe(true),
  );
  frames();
  const canvas = view.container.querySelector('canvas')!;
  return {
    ...view,
    canvas,
    values,
    context,
    run(id: string) {
      const command = commands.find((command) => command.id === id);
      expect(command?.available).toBe(true);
      act(() => {
        void command!.run();
      });
    },
  };
}

const patch = (view: CubeView) =>
  screen.getByRole<HTMLButtonElement>('button', { name: `${view.label} view` });
const camera = () => graphics.camera!;
/** The fixture model is centred on the origin, the camera's target. */
const looking = () => camera().position.clone().normalize();

/** The direction a standard view looks from, in the model's coordinates. */
function expectedDirection(view: CubeView, extension: string) {
  return new THREE.Vector3()
    .fromArray(view.direction)
    .normalize()
    .transformDirection(modelCubeBasis(extension));
}

function cssDirection(transform: string, vector: THREE.Vector3) {
  const values = /matrix3d\(([^)]+)\)/.exec(transform)![1]!.split(',').map(Number);
  // CSS points y down; the cube's own coordinates point y up.
  return new THREE.Vector3(vector.x, -vector.y, vector.z).applyMatrix4(
    new THREE.Matrix4().fromArray(values),
  );
}

describe('standard views', () => {
  it('names 6 faces, 12 edges and 8 corners once each, in sentence case', () => {
    expect(cubeViews.map((view) => view.kind).filter((kind) => kind === 'face')).toHaveLength(6);
    expect(cubeViews.filter((view) => view.kind === 'edge')).toHaveLength(12);
    expect(cubeViews.filter((view) => view.kind === 'corner')).toHaveLength(8);
    expect(new Set(cubeViews.map((view) => view.label)).size).toBe(26);
    expect(cubeViews.slice(0, 6).map((view) => view.label)).toEqual([
      'Front',
      'Right',
      'Back',
      'Left',
      'Top',
      'Bottom',
    ]);
    expect(cubeViews.map((view) => view.label)).toContain('Top front right');
    expect(cubeViews.map((view) => view.label)).toContain('Bottom back');
    for (const view of cubeViews) expect(view.label).not.toMatch(/\u2014/);
  });

  it.each([
    ['step', 'Front', [0, -1, 0], [0, 0, 1]],
    ['step', 'Top', [0, 0, 1], [0, 1, 0]],
    ['step', 'Bottom', [0, 0, -1], [0, -1, 0]],
    ['step', 'Right', [1, 0, 0], [0, 0, 1]],
    ['obj', 'Front', [0, 0, 1], [0, 1, 0]],
    ['obj', 'Top', [0, 1, 0], [0, 0, -1]],
    ['obj', 'Back', [0, 0, -1], [0, 1, 0]],
    ['obj', 'Left', [-1, 0, 0], [0, 1, 0]],
  ])('looks at %s from the %s with the upright up vector', (extension, label, direction, up) => {
    const view = cubeViews.find((candidate) => candidate.label === label)!;
    const result = standardModelView(view, extension, {
      position: [2, 3, 14],
      target: [2, 3, 4],
      up: [0.6, 0.8, 0],
      rotation: 'free',
    });
    const looking = new THREE.Vector3().fromArray(result.position).sub(new THREE.Vector3(2, 3, 4));
    expect(looking.length()).toBeCloseTo(10, 10);
    expect(looking.normalize().distanceTo(new THREE.Vector3(...direction))).toBeLessThan(1e-12);
    expect(
      new THREE.Vector3().fromArray(result.up).distanceTo(new THREE.Vector3(...up)),
    ).toBeLessThan(1e-12);
  });

  it('walks the views like a globe with the arrow keys', () => {
    const named = (label: string) => cubeViews.find((view) => view.label === label)!;
    const walk = (from: string, ...keys: ('left' | 'right' | 'up' | 'down')[]) =>
      keys.reduce((view, key) => stepCubeView(view, key, 1), named(from)).label;
    expect(walk('Front', 'right')).toBe('Front right');
    expect(walk('Front', 'right', 'right')).toBe('Right');
    expect(walk('Front', 'left')).toBe('Front left');
    expect(walk('Back', 'right', 'right', 'right', 'right')).toBe('Front');
    expect(walk('Front', 'up')).toBe('Top front');
    expect(walk('Front', 'up', 'up')).toBe('Top');
    expect(walk('Top', 'up')).toBe('Top');
    // Left and Right turn around a pole from the last heading, 1, front right.
    expect(walk('Top', 'right')).toBe('Top right');
    expect(walk('Top', 'left')).toBe('Top front');
    expect(walk('Bottom', 'right', 'right')).toBe('Bottom back right');
    expect(walk('Bottom', 'down')).toBe('Bottom');
    // Leaving a pole keeps the last heading.
    expect(walk('Top', 'down')).toBe('Top front right');
    expect(walk('Front right', 'down', 'down', 'down')).toBe('Bottom');
    expect(walk('Bottom', 'up', 'up')).toBe('Front right');
  });
});

describe.each([
  ['stl', 'free'],
  ['stl', 'turntable'],
  ['obj', 'turntable'],
  ['obj', 'free'],
] as [string, ModelRotation][])('the %s view cube in %s rotation', (extension, rotation) => {
  const label = rotation === 'free' ? 'Free' : 'Turntable';
  async function cube() {
    const view = await preview(extension);
    const mode = screen.getByRole('button', { name: /^Rotation\b/ });
    if (!mode.textContent?.includes(label)) {
      fireEvent.click(mode);
      fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
    }
    expect(mode.textContent).toContain(label);
    return view;
  }

  it('sets each face, edge and corner view with its direction and up vector', async () => {
    const view = await cube();
    const top = new THREE.Vector3(...(extension === 'stl' ? [0, 0, 1] : [0, 1, 0]));
    const front = new THREE.Vector3(0, 0, 1).transformDirection(modelCubeBasis(extension));
    for (const standard of cubeViews) {
      fireEvent.click(patch(standard));
      frames();
      const direction = expectedDirection(standard, extension);
      const pole = Math.abs(direction.dot(top)) > 0.99;
      expect(looking().distanceTo(direction), standard.label).toBeLessThan(1e-5);
      const up = camera().up.clone();
      if (rotation === 'turntable') {
        expect(up.toArray()).toEqual(top.toArray());
      } else if (pole) {
        expect(
          up.distanceTo(front.clone().multiplyScalar(direction.dot(top) > 0 ? -1 : 1)),
        ).toBeLessThan(1e-9);
      } else {
        expect(Math.abs(up.dot(direction))).toBeLessThan(1e-9);
        expect(up.dot(top)).toBeGreaterThan(0);
      }
      // The cube turns with the camera: the chosen side faces the viewer, upright.
      const solid = view.container.querySelector<HTMLElement>('.model-viewcube-solid')!;
      expect(solid.style.transform).toBe(cubeTransform(camera(), extension));
      const facing = cssDirection(
        solid.style.transform,
        new THREE.Vector3().fromArray(standard.direction).normalize(),
      );
      expect(facing.z, standard.label).toBeGreaterThan(0.99999);
      expect(nearestCubeView(camera(), extension)).toBe(standard);
      if (standard.label === 'Front') {
        const screenUp = cssDirection(solid.style.transform, new THREE.Vector3(0, 1, 0));
        expect(screenUp.y).toBeCloseTo(-1, 9);
      }
    }
    act(() => {
      window.dispatchEvent(new Event('viewer-preview-flush'));
    });
    expect((view.values.get('model.camera') as ModelCamera).rotation).toBe(rotation);
  });

  it('returns Home to the fitted starting view, and turns there unless motion is reduced', async () => {
    const view = await cube();
    const start = camera().position.toArray();
    const up = camera().up.toArray();
    fireEvent.click(patch(cubeViews.find((standard) => standard.label === 'Bottom back left')!));
    frames();
    expect(camera().position.toArray()).not.toEqual(start);
    graphics.reducedMotion = false;
    fireEvent.click(screen.getByRole('button', { name: 'Home view' }));
    frames();
    expect(camera().position.toArray()).not.toEqual(start);
    graphics.now += 160;
    frames();
    const midway = camera().position.toArray();
    expect(midway).not.toEqual(start);
    graphics.now += 200;
    frames(2);
    for (let index = 0; index < 3; index += 1) {
      expect(camera().position.toArray()[index]).toBeCloseTo(start[index]!, 9);
      expect(camera().up.toArray()[index]).toBeCloseTo(up[index]!, 9);
    }
    view.run('model-frame');
    for (let index = 0; index < 3; index += 1)
      expect(camera().position.toArray()[index]).toBeCloseTo(start[index]!, 9);
  });

  it('turns the model when the cube is dragged, without choosing the side it started on', async () => {
    await cube();
    const start = camera().position.clone();
    const front = patch(cubeViews[0]!);
    const toolbar = screen.getByRole('toolbar', { name: 'View cube' });
    const plane = vi.fn();
    document.body.addEventListener('pointerdown', plane);
    pointer(front, 'pointerdown', 700, 500);
    pointer(front, 'pointermove', 702, 501);
    expect(camera().position.toArray()).toEqual(start.toArray());
    pointer(front, 'pointermove', 740, 520);
    expect(toolbar.hasPointerCapture(1)).toBe(true);
    pointer(toolbar, 'pointerup', 740, 520);
    fireEvent.click(front, { detail: 1 });
    document.body.removeEventListener('pointerdown', plane);
    expect(plane).not.toHaveBeenCalled();
    const moved = camera().position.clone();
    expect(moved.distanceTo(start)).toBeGreaterThan(0.1);
    expect(moved.length()).toBeCloseTo(start.length(), 9);
    expect(looking().distanceTo(expectedDirection(cubeViews[0]!, extension))).toBeGreaterThan(0.1);
    // Keyboard activation is never taken for the end of a drag.
    fireEvent.click(front, { detail: 0 });
    frames();
    expect(looking().distanceTo(expectedDirection(cubeViews[0]!, extension))).toBeLessThan(1e-5);
  });

  it('steps between views with the arrow keys and chooses one with Enter', async () => {
    await cube();
    const stop = screen
      .getAllByRole('button')
      .filter((button) => button.classList.contains('model-viewcube-patch'))
      .filter((button) => button.tabIndex === 0);
    expect(stop).toHaveLength(1);
    const nearest = nearestCubeView(camera(), extension);
    expect(stop[0]).toBe(patch(nearest));
    act(() => stop[0]!.focus());
    const outside = vi.fn();
    document.body.addEventListener('keydown', outside);
    fireEvent.keyDown(stop[0]!, { key: 'ArrowLeft' });
    const next = stepCubeView(nearest, 'left');
    expect(document.activeElement).toBe(patch(next));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    const above = stepCubeView(next, 'up');
    expect(document.activeElement).toBe(patch(above));
    expect(patch(above).tabIndex).toBe(0);
    expect(patch(nearest).tabIndex).toBe(-1);
    document.body.removeEventListener('keydown', outside);
    expect(outside).not.toHaveBeenCalled();
    // A button's Enter is a click with no pointer detail.
    fireEvent.click(document.activeElement!, { detail: 0 });
    frames();
    expect(looking().distanceTo(expectedDirection(above, extension))).toBeLessThan(1e-5);
    // Focus inside the cube stays put while the camera turns.
    expect(document.activeElement).toBe(patch(above));
  });

  it('never measures through the cube', async () => {
    const view = await cube();
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    const top = cubeViews.find((standard) => standard.label === 'Top')!;
    pointer(patch(top), 'pointerdown', 700, 500);
    pointer(patch(top), 'pointerup', 700, 500);
    fireEvent.click(patch(top), { detail: 1 });
    frames();
    expect(looking().distanceTo(expectedDirection(top, extension))).toBeLessThan(1e-5);
    expect(view.values.get('model.measurement') ?? []).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('Click two surface points');
  });
});

it('takes no input in an inactive plane and hides while the model is unavailable', async () => {
  const view = await preview('stl');
  const cube = view.container.querySelector<HTMLElement>('.model-viewcube')!;
  expect(cube.hasAttribute('inert')).toBe(false);
  expect(cube.parentElement!.hidden).toBe(false);
  view.rerender(<ModelPreview {...view.context} interactive={false} />);
  expect(cube.hasAttribute('inert')).toBe(true);
  view.unmount();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  );
  const failed = render(
    <ModelPreview
      {...view.context}
      resource={{
        ...view.context.resource,
        id: 'missing',
        entry: { ...view.context.resource.entry, identity: 'missing' },
      }}
    />,
  );
  await screen.findByText("Can't show this model");
  expect(failed.container.querySelector<HTMLElement>('.model-viewcube-layer')!.hidden).toBe(true);
});

it('zooms the model with a wheel over the cube, reading the event itself', async () => {
  const view = await preview('obj');
  const cube = view.container.querySelector<HTMLElement>('.model-viewcube')!;
  const distance = camera().position.length();
  const event = new WheelEvent('wheel', {
    deltaY: 4.000244140625,
    bubbles: true,
    cancelable: true,
  });
  // A Mac mouse notch, told apart only by the legacy field a re-sent event would lose.
  Object.defineProperty(event, 'wheelDeltaY', { value: -120 });
  const outside = vi.fn();
  document.body.addEventListener('wheel', outside);
  act(() => {
    cube.dispatchEvent(event);
  });
  document.body.removeEventListener('wheel', outside);
  frames(60);
  expect(event.defaultPrevented).toBe(true);
  expect(outside).not.toHaveBeenCalled();
  expect(camera().position.length() / distance).toBeCloseTo(1.1, 6);
});

it('reads the wheel as the scroll device chosen in Settings, also once open', async () => {
  const view = await preview('obj');
  const notch = () => {
    const event = new WheelEvent('wheel', { deltaY: 4.000244140625, cancelable: true });
    Object.defineProperty(event, 'wheelDeltaY', { value: -120 });
    act(() => {
      view.canvas.dispatchEvent(event);
    });
    frames(60);
  };
  const before = camera().position.clone();
  view.rerender(
    <ModelPreview
      {...view.context}
      limits={{ maxImagePixels: 1, maxModelMB: 256, modelScrollDevice: 'trackpad' }}
    />,
  );
  notch();
  // A trackpad scroll pans: the camera moves, its distance stays.
  expect(camera().position.distanceTo(before)).toBeGreaterThan(1e-6);
  expect(camera().position.length()).toBeCloseTo(before.length(), 3);
});

describe('the cube’s keyboard, pointer and place', () => {
  it('is one tab stop after the canvas, with Home reached by its key', async () => {
    const view = await preview('stl');
    const stops = [...view.container.querySelectorAll<HTMLElement>('[tabindex]')].filter(
      (element) => element.closest('.model-viewcube') && element.tabIndex >= 0,
    );
    expect(stops).toHaveLength(1);
    const home = screen.getByRole('button', { name: 'Home view' });
    expect(home.tabIndex).toBe(-1);
    expect(home.closest('[role="toolbar"]')).toBeTruthy();
    expect(
      view.canvas.compareDocumentPosition(stops[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const start = camera().position.toArray();
    fireEvent.click(patch(cubeViews.find((standard) => standard.label === 'Left')!));
    frames();
    act(() => stops[0]!.focus());
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    frames(2);
    camera()
      .position.toArray()
      .forEach((value, index) => expect(value).toBeCloseTo(start[index]!, 9));
  });

  it('keeps Space and Enter from Quick Preview and zooms with + and -', async () => {
    await preview('stl');
    const stop = patch(nearestCubeView(camera(), 'stl'));
    act(() => stop.focus());
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    fireEvent.keyDown(stop, { key: ' ' });
    fireEvent.keyDown(stop, { key: 'Enter' });
    const distance = camera().position.length();
    fireEvent.keyDown(stop, { key: '+' });
    frames();
    expect(camera().position.length()).toBeCloseTo(distance / 1.1, 9);
    fireEvent.keyDown(stop, { key: '-' });
    frames();
    expect(camera().position.length()).toBeCloseTo(distance, 9);
    window.removeEventListener('keydown', outside);
    expect(outside).not.toHaveBeenCalled();
  });

  it('turns around a pole with Left and Right, from the heading the camera last had', async () => {
    await preview('stl');
    // The starting view is nearest Top front right: heading 1.
    expect(nearestCubeView(camera(), 'stl').label).toBe('Top front right');
    const top = cubeViews.find((standard) => standard.label === 'Top')!;
    fireEvent.click(patch(top));
    frames();
    expect(patch(top).tabIndex).toBe(0);
    act(() => patch(top).focus());
    fireEvent.keyDown(patch(top), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      patch(cubeViews.find((v) => v.label === 'Top front right')!),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(patch(cubeViews.find((v) => v.label === 'Top right')!));
  });

  it('keeps keyboard focus and its tab stop while the camera turns', async () => {
    await preview('stl');
    const right = patch(cubeViews.find((standard) => standard.label === 'Right')!);
    fireEvent.click(right);
    frames();
    act(() => right.focus());
    fireEvent.click(patch(cubeViews.find((standard) => standard.label === 'Back')!), {
      detail: 1,
    });
    frames();
    expect(nearestCubeView(camera(), 'stl').label).toBe('Back');
    expect(right.tabIndex).toBe(0);
    expect(document.activeElement).toBe(right);
  });

  it('names the side a drag turns to, even with a side focused', async () => {
    const view = await preview('stl');
    const front = patch(cubeViews[0]!);
    act(() => front.focus());
    const caption = view.container.querySelector('.model-viewcube-caption')!;
    pointer(front, 'pointerdown', 700, 500);
    pointer(front, 'pointermove', 700 + 52, 500);
    frames();
    const nearest = nearestCubeView(camera(), 'stl');
    expect(nearest).not.toBe(cubeViews[0]);
    expect(caption.textContent).toBe(nearest.label);
    expect(patch(nearest).tabIndex).toBe(0);
  });

  it('keeps every press, menu and double click from the plane', async () => {
    const view = await preview('stl');
    const cube = view.container.querySelector<HTMLElement>('.model-viewcube')!;
    const plane = vi.fn();
    for (const type of ['pointerdown', 'contextmenu', 'dblclick'])
      document.body.addEventListener(type, plane);
    pointer(patch(cubeViews[0]!), 'pointerdown', 700, 500, 2);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      cube.dispatchEvent(menu);
    });
    fireEvent.doubleClick(patch(cubeViews[0]!));
    for (const type of ['pointerdown', 'contextmenu', 'dblclick'])
      document.body.removeEventListener(type, plane);
    expect(plane).not.toHaveBeenCalled();
    expect(menu.defaultPrevented).toBe(true);
  });

  it('hides once the graphics context is lost', async () => {
    const view = await preview('stl');
    const layer = view.container.querySelector<HTMLElement>('.model-viewcube-layer')!;
    act(() => {
      view.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });
    expect(layer.hidden).toBe(true);
  });
});

/** A face label's on-screen axes after choosing it: its text runs right and reads upward. */
function labelAxes(extension: string, rotation: ModelRotation, label: string) {
  const view = cubeViews.find((candidate) => candidate.label === label)!;
  const result = standardModelView(view, extension, {
    position: [0, 0, 10],
    target: [0, 0, 0],
    up: defaultModelUp(extension),
    rotation,
  });
  const viewer = new THREE.PerspectiveCamera();
  viewer.position.fromArray(result.position);
  viewer.up.fromArray(result.up);
  viewer.lookAt(0, 0, 0);
  viewer.updateMatrixWorld();
  const values = (transform: string) =>
    new THREE.Matrix4().fromArray(
      /matrix3d\(([^)]+)\)/.exec(transform)![1]!.split(',').map(Number),
    );
  const solid = values(cubeTransform(viewer, extension));
  const patchTransform = cubePatch(view).transform as string;
  const local = values(patchTransform.slice(patchTransform.indexOf('matrix3d')));
  // An element's text runs along its local +x; CSS y points down, so its top is local -y.
  return {
    right: new THREE.Vector3(1, 0, 0).applyMatrix4(local).applyMatrix4(solid),
    up: new THREE.Vector3(0, -1, 0).applyMatrix4(local).applyMatrix4(solid),
    facing: new THREE.Vector3(0, 0, 1).applyMatrix4(local).applyMatrix4(solid),
  };
}

describe('cube geometry and the starting view', () => {
  it.each([
    ['stl', 'free'],
    ['stl', 'turntable'],
    ['obj', 'free'],
    ['obj', 'turntable'],
  ] as [string, ModelRotation][])(
    'reads each face label of %s upright in %s rotation',
    (extension, rotation) => {
      for (const label of ['Front', 'Right', 'Back', 'Left', 'Top', 'Bottom']) {
        const { right, up, facing } = labelAxes(extension, rotation, label);
        expect(facing.z, label).toBeGreaterThan(0.99999);
        expect(right.x, label).toBeGreaterThan(0.99999);
        expect(up.y, label).toBeLessThan(-0.99999);
      }
    },
  );

  it('places every patch on the outside of the cube, facing out', () => {
    for (const view of cubeViews) {
      const transform = cubePatch(view).transform as string;
      const [x, y, z] = /translate3d\(([^)]+)\)/
        .exec(transform)![1]!
        .split(',')
        .map((part) => Number.parseFloat(part));
      const centre = new THREE.Vector3(x!, -y!, z!);
      expect(
        centre.dot(new THREE.Vector3().fromArray(view.direction).normalize()),
        view.label,
      ).toBeGreaterThan(25);
    }
  });

  it.each([
    ['step', [1, 0, 0], [0, -1, 0], [0, 0, 1]],
    ['obj', [1, 0, 0], [0, 0, 1], [0, 1, 0]],
  ] as [string, number[], number[], number[]][])(
    'starts %s front right and a little above',
    (extension, right, front, top) => {
      const offset = homeOffset(extension).normalize();
      expect(offset.dot(new THREE.Vector3(...right))).toBeGreaterThan(0.3);
      expect(offset.dot(new THREE.Vector3(...front))).toBeGreaterThan(0.5);
      const above = offset.dot(new THREE.Vector3(...top));
      expect(above).toBeGreaterThan(0.2);
      expect(above).toBeLessThan(0.5);
    },
  );
});
