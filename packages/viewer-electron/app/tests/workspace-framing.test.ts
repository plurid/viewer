// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { TreePlane } from '@plurid/plurid-data';
import {
  cancelWorkspaceFraming,
  frameWorkspace,
  refitWorkspace,
} from '../src/renderer/workspace/framing';

const frames = new Map<number, FrameRequestCallback>();
const mounted: PluridApplicationHandle[] = [];
let frameID = 0;
let clock = 0;

beforeEach(() => {
  frames.clear();
  frameID = 0;
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameID, callback);
    return frameID;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  for (const api of mounted.splice(0)) cancelWorkspaceFraming(api);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function nextFrame(milliseconds = 16) {
  clock += milliseconds;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(clock);
}

function advance(count = 5) {
  for (let index = 0; index < count; index++) nextFrame();
}

function fixture() {
  const element = document.createElement('div');
  document.body.append(element);
  const viewport = { width: 1000, height: 700 };
  const inspection = { view: { ...viewport }, motion: 'idle' };
  Object.defineProperties(element, {
    clientWidth: { get: () => viewport.width },
    clientHeight: { get: () => viewport.height },
  });
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, viewport.width, viewport.height),
  );
  const nodes = ['folder', 'chat'].map((id) => ({
    planeID: `engine-${id}`,
    show: true,
    width: 800,
    height: 500,
    children: [],
    location: { translateX: id === 'folder' ? 0 : 1200, translateY: 0, translateZ: 0 },
    routeDivisions: { plane: { parameters: { id } }, path: { parameters: {} } },
  })) as unknown as TreePlane[];
  let viewpoint = 'initial';
  let motion = 'idle';
  let resolved = true;
  for (const node of nodes) {
    const plane = document.createElement('section');
    plane.dataset.pluridPlane = node.planeID;
    Object.defineProperties(plane, {
      offsetWidth: { get: () => node.width },
      offsetHeight: { get: () => node.height },
    });
    vi.spyOn(plane, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(viewpoint === node.planeID ? 80 : 1200, 80, node.width, node.height),
    );
    element.append(plane);
  }
  const frame = vi.fn((target: { planeID: string }) => {
    viewpoint = target.planeID;
  });
  const fit = vi.fn(() => {
    viewpoint = 'all';
  });
  const open = vi.fn((id: string) => {
    const node = nodes.find((item) => item.planeID === id);
    if (node) node.show = true;
  });
  const api = {
    inspect: () => inspection,
    tree: { get: () => nodes, open },
    getSnapshot: () => ({ space: { resolvedLayout: resolved } }),
    getViewpoint: () => viewpoint,
    camera: { frame, fit, dock: vi.fn(), docked: () => '', motion: () => motion, moveBy: vi.fn() },
    pubsub: { publish: vi.fn() },
  } as unknown as PluridApplicationHandle;
  mounted.push(api);
  return {
    api,
    frame,
    fit,
    open,
    nodes,
    viewport,
    inspection,
    element,
    engine: { current: api as PluridApplicationHandle | null },
    surface: { current: element as HTMLDivElement | null },
    setViewpoint: (value: string) => {
      viewpoint = value;
    },
    setResolved: (value: boolean) => {
      resolved = value;
    },
    setMotion: (value: string) => {
      motion = value;
      inspection.motion = value;
    },
  };
}

describe('workspace framing ownership and scheduling', () => {
  it('reveals an unmeasured target so distance culling cannot prevent its first measurement', () => {
    const view = fixture();
    const target = view.nodes[1]!;
    target.width = 0;
    target.height = 0;
    view.frame.mockImplementationOnce(() => {
      // The engine uses configured geometry to reveal the culled plane; its
      // mounted content can then report the actual dimensions.
      target.width = 800;
      target.height = 500;
    });
    frameWorkspace(view.engine, view.surface, ['chat']);
    advance(12);
    expect(view.frame).toHaveBeenCalledTimes(2);
    expect(view.frame).toHaveBeenLastCalledWith({ planeID: 'engine-chat' }, { animate: true });
    expect(frames.size).toBe(0);
  });

  it('does not repeatedly reveal a target whose content never reports a size', () => {
    const view = fixture();
    view.nodes[1]!.width = 0;
    view.nodes[1]!.height = 0;
    frameWorkspace(view.engine, view.surface, ['chat']);
    advance(200);
    expect(view.frame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('frames the requested plane after a scheduling gap before its first measured frame', () => {
    const view = fixture();
    frameWorkspace(view.engine, view.surface, ['chat']);
    nextFrame(1700);
    advance();
    expect(view.frame).toHaveBeenCalledExactlyOnceWith(
      { planeID: 'engine-chat' },
      { animate: true },
    );
    expect(frames.size).toBe(0);
  });

  it('does not let a resize refit replace a newer explicit plane target', () => {
    const view = fixture();
    frameWorkspace(view.engine, view.surface, ['folder']);
    advance();
    view.frame.mockClear();

    frameWorkspace(view.engine, view.surface, ['chat']);
    refitWorkspace(view.engine, view.surface);
    advance();
    expect(view.frame).toHaveBeenCalledExactlyOnceWith(
      { planeID: 'engine-chat' },
      { animate: true },
    );
  });

  it('relinquishes the old resize owner when the new target cannot be framed', () => {
    const view = fixture();
    frameWorkspace(view.engine, view.surface, ['folder']);
    advance();
    view.frame.mockClear();

    frameWorkspace(view.engine, view.surface, ['missing']);
    advance(200);
    refitWorkspace(view.engine, view.surface);
    advance();
    expect(view.frame).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('waits for the inspected viewport and layout to match live geometry', () => {
    const view = fixture();
    view.viewport.width = 1200;
    view.setResolved(false);
    frameWorkspace(view.engine, view.surface, ['chat']);
    advance(10);
    expect(view.frame).not.toHaveBeenCalled();
    view.inspection.view.width = 1200;
    view.setResolved(true);
    advance();
    expect(view.frame).toHaveBeenCalledExactlyOnceWith(
      { planeID: 'engine-chat' },
      { animate: true },
    );
  });

  it('bounds a recovery request if the engine cannot make its target visible', () => {
    const view = fixture();
    view.nodes[1]!.show = false;
    view.open.mockImplementation(() => {});
    frameWorkspace(view.engine, view.surface, ['chat'], { recover: true });
    advance(200);
    expect(view.frame).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each(['pointerdown', 'wheel'])('yields to new %s input while waiting', (event) => {
    const view = fixture();
    frameWorkspace(view.engine, view.surface, ['chat']);
    window.dispatchEvent(new Event(event));
    advance();
    refitWorkspace(view.engine, view.surface);
    advance();
    expect(view.frame).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('keeps window engines independent when one framing request is superseded', () => {
    const first = fixture();
    const second = fixture();
    frameWorkspace(first.engine, first.surface, ['folder']);
    frameWorkspace(second.engine, second.surface, ['chat']);
    frameWorkspace(first.engine, first.surface, ['chat']);
    advance();
    expect(first.frame).toHaveBeenCalledExactlyOnceWith(
      { planeID: 'engine-chat' },
      { animate: true },
    );
    expect(second.frame).toHaveBeenCalledExactlyOnceWith(
      { planeID: 'engine-chat' },
      { animate: true },
    );
  });

  it('does not refit a placement after a deliberate camera move', () => {
    const view = fixture();
    frameWorkspace(view.engine, view.surface, ['folder']);
    advance();
    view.frame.mockClear();
    view.setViewpoint('user camera');
    refitWorkspace(view.engine, view.surface);
    advance();
    expect(view.frame).not.toHaveBeenCalled();
  });

  it('stops pending work when its engine or surface is detached', () => {
    const view = fixture();
    frameWorkspace(view.engine, view.surface, ['chat']);
    view.engine.current = null;
    view.element.remove();
    advance();
    expect(view.frame).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});
