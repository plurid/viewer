// @vitest-environment jsdom
import type * as ThreeModule from 'three';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelPreview from '../src/renderer/previews/modules/ModelPreview';
import type { PreviewCommand, PreviewContext } from '../src/renderer/previews/contracts';
import type { ModelCamera } from '../src/renderer/previews/model/navigation';

const graphics = vi.hoisted(() => ({
  camera: undefined as ThreeModule.PerspectiveCamera | undefined,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  renders: 0,
}));

vi.mock('three', async (original) => ({
  ...(await original<typeof ThreeModule>()),
  // Retain the real controls, camera, raycaster, geometry and lights without starting WebGL.
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    render(_scene: ThreeModule.Scene, camera: ThreeModule.PerspectiveCamera) {
      graphics.camera = camera;
      graphics.renders += 1;
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = () => true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  graphics.frames.clear();
  graphics.camera = undefined;
  graphics.renders = 0;
});

function frames(count = 1) {
  act(() => {
    for (let index = 0; index < count; index += 1) {
      const pending = [...graphics.frames.values()];
      graphics.frames.clear();
      for (const callback of pending) callback(performance.now());
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

async function preview(extension: string, values = new Map<string, unknown>(), essential = false) {
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
    toolbar: essential ? 'essential' : 'all',
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
  // The button enables in the loaded render; the commands register in that render's effect,
  // which a loader finishing outside act can run later.
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Frame model' }).disabled).toBe(
      false,
    );
    expect(commands.find((command) => command.id === 'model-frame')?.available).toBe(true);
  });
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
    command(id: string) {
      return commands.find((command) => command.id === id);
    },
  };
}

describe.each(['stl', 'obj'])('%s model preview', (extension) => {
  it('picks two unmoved measure clicks while drags rotate, including a drag back to its start', async () => {
    const view = await preview(extension);
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByRole('status').textContent).toContain('Click two surface points');
    // A press that moves past 4 px is a drag, even a short one ending 5 px away.
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 405, 300);
    pointer(view.canvas, 'pointerup', 405, 300);
    expect(view.values.get('model.measurement') ?? []).toHaveLength(0);
    // Within 4 px it is still a click.
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 403, 300);
    pointer(view.canvas, 'pointerup', 403, 300);
    expect(view.values.get('model.measurement')).toHaveLength(1);
    view.run('model-frame');
    const before = graphics.camera!.position.clone();
    const moving = vi.fn();
    document.addEventListener('pointermove', moving);
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 520, 420);
    frames(2);
    pointer(view.canvas, 'pointermove', 400, 300);
    pointer(view.canvas, 'pointerup', 400, 300);
    document.removeEventListener('pointermove', moving);
    expect(moving).toHaveBeenCalledTimes(2);
    expect(view.values.get('model.measurement')).toHaveLength(1);
    expect(graphics.camera!.position.distanceTo(before)).toBeGreaterThan(0.01);
    view.run('model-frame');
    pointer(view.canvas, 'pointerdown', 420, 300);
    pointer(view.canvas, 'pointerup', 420, 300);
    expect(view.values.get('model.measurement')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toContain('Distance:');
  });

  it('keeps initiation inside the canvas, lets moves bubble and redraws until damping settles', async () => {
    const view = await preview(extension);
    const start = vi.fn();
    const move = vi.fn();
    view.container.addEventListener('pointerdown', start);
    view.container.addEventListener('pointermove', move);
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 500, 430);
    expect(start).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledOnce();
    expect(graphics.frames.size).toBeGreaterThan(0);
    frames();
    pointer(view.canvas, 'pointerup', 500, 430);
    const renders = graphics.renders;
    frames(2);
    expect(graphics.renders).toBeGreaterThan(renders);
    frames(350);
    expect(graphics.frames.size).toBe(0);
  });

  it('restores a camera and its up vector on reopening, and resets all orientation with Frame', async () => {
    const view = await preview(extension);
    const initial = graphics.camera!.position.toArray();
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 620, 510);
    frames(3);
    pointer(view.canvas, 'pointerup', 620, 510);
    act(() => {
      window.dispatchEvent(new Event('viewer-preview-flush'));
    });
    const saved = view.values.get('model.camera') as ModelCamera;
    expect(saved.position).not.toEqual(initial);
    view.unmount();
    const reopened = await preview(extension, view.values);
    expect(graphics.camera!.up.toArray()).toEqual(saved.up);
    for (let index = 0; index < 3; index += 1)
      expect(graphics.camera!.position.toArray()[index]).toBeCloseTo(saved.position[index], 12);
    expect(reopened.command('model-frame')?.aliases).toContain('reset view');
    reopened.run('model-frame');
    frames(350);
    expect(graphics.camera!.up.toArray()).toEqual(extension === 'stl' ? [0, 0, 1] : [0, 1, 0]);
    expect(graphics.camera!.position.toArray()).toEqual(initial);
    expect(graphics.frames.size).toBe(0);
  });

  it('suspends input when inactive and resumes it with the current rotation mode', async () => {
    const view = await preview(extension);
    view.rerender(<ModelPreview {...view.context} interactive={false} />);
    const before = graphics.camera!.position.toArray();
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 600, 450);
    pointer(view.canvas, 'pointerup', 600, 450);
    frames(2);
    expect(graphics.camera!.position.toArray()).toEqual(before);
    view.rerender(<ModelPreview {...view.context} active={false} />);
    expect(graphics.frames.size).toBe(0);
    view.rerender(<ModelPreview {...view.context} />);
    pointer(view.canvas, 'pointerdown', 400, 300);
    pointer(view.canvas, 'pointermove', 600, 450);
    frames(2);
    expect(graphics.camera!.position.toArray()).not.toEqual(before);
  });
});

it('switches rotation from the toolbar and palette without reloading or moving the view', async () => {
  const view = await preview('stl');
  const before = graphics.camera!.position.toArray();
  const up = graphics.camera!.up.toArray();
  expect(screen.getByRole('button', { name: /^Rotation\b/ }).textContent).toContain('Free');
  fireEvent.click(screen.getByRole('button', { name: /^Rotation\b/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Turntable' }));
  expect((view.values.get('model.camera') as ModelCamera).rotation).toBe('turntable');
  expect(graphics.camera!.position.toArray()).toEqual(before);
  expect(graphics.camera!.up.toArray()).toEqual(up);
  expect(view.command('model-rotation')?.label).toBe('Use free rotation');
  view.run('model-rotation');
  expect((view.values.get('model.camera') as ModelCamera).rotation).toBe('free');
  expect(fetch).toHaveBeenCalledOnce();
  view.unmount();
  await preview('stl', view.values);
  expect(screen.getByRole('button', { name: /^Rotation\b/ }).textContent).toContain('Free');
});

it('keeps Essential headers quiet and the rotation command available', async () => {
  const view = await preview('obj', new Map(), true);
  expect(screen.queryByRole('button', { name: /^Rotation\b/ })).toBeNull();
  expect(view.command('model-rotation')?.label).toBe('Use free rotation');
  view.run('model-rotation');
  expect((view.values.get('model.camera') as ModelCamera).rotation).toBe('free');
  fireEvent.keyDown(view.canvas, { key: 'Home' });
  expect(graphics.camera!.up.toArray()).toEqual([0, 1, 0]);
});

it('remembers a non-default rotation for each file independently', async () => {
  const cadView = await preview('stl');
  cadView.run('model-rotation');
  const cadValues = cadView.values;
  cadView.unmount();
  const sceneView = await preview('obj');
  expect(screen.getByRole('button', { name: /^Rotation\b/ }).textContent).toContain('Turntable');
  sceneView.run('model-rotation');
  const sceneValues = sceneView.values;
  sceneView.unmount();
  const reopenedCad = await preview('stl', cadValues);
  expect(screen.getByRole('button', { name: /^Rotation\b/ }).textContent).toContain('Turntable');
  reopenedCad.run('model-frame');
  expect((cadValues.get('model.camera') as ModelCamera).rotation).toBe('turntable');
  reopenedCad.unmount();
  await preview('obj', sceneValues);
  expect(screen.getByRole('button', { name: /^Rotation\b/ }).textContent).toContain('Free');
});
