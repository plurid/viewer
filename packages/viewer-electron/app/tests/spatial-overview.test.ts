// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { solveOverviewPlacement } from '../src/renderer/workspace/overlays/placement';
import { SpatialOverview } from '../src/renderer/workspace/overlays/SpatialOverview';

const viewport = { x: 0, y: 0, width: 1000, height: 600 };
const size = { width: 172, height: 120 };

describe('spatial overview placement', () => {
  it('moves out of a complete plane header and retains a safe corner without reserving canvas width', () => {
    const blocked = solveOverviewPlacement({
      viewport,
      size,
      obstacles: [{ x: 700, y: 0, width: 300, height: 65 }],
    });
    expect(blocked).toEqual({
      kind: 'corner',
      corner: 'bottom-left',
      bounds: { x: 16, y: 464, ...size },
    });
    expect(
      solveOverviewPlacement({ viewport, size, obstacles: [], current: 'bottom-left' }),
    ).toEqual(blocked);
    expect(viewport.width).toBe(1000);
  });

  it('allows exactly eight pixels of clearance and rejects positive overlap', () => {
    const obstacle = { x: 0, y: 16, width: 804, height: 60 };
    expect(solveOverviewPlacement({ viewport, size, obstacles: [obstacle] })).toHaveProperty(
      'corner',
      'top-right',
    );
    expect(
      solveOverviewPlacement({ viewport, size, obstacles: [{ ...obstacle, width: 804.1 }] }),
    ).toHaveProperty('corner', 'bottom-left');
  });

  it('uses the fallback when every corner is occupied or the viewport is too small', () => {
    expect(solveOverviewPlacement({ viewport, size, obstacles: [viewport] })).toEqual({
      kind: 'fallback',
    });
    expect(
      solveOverviewPlacement({
        viewport: { ...viewport, width: 200, height: 140 },
        size,
        obstacles: [],
      }),
    ).toEqual({ kind: 'fallback' });
  });
});

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let stop: (() => void) | undefined;
beforeEach(() => {
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function frame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}
function fixture() {
  const root = document.createElement('div');
  const map = document.createElement('div');
  map.dataset.pluridOverlay = 'minimap';
  map.setAttribute('role', 'group');
  map.setAttribute('aria-label', 'space overview');
  const button = document.createElement('button');
  button.dataset.pluridMinimapPlane = 'engine-plane';
  button.setAttribute('aria-label', 'go to plane opaque-route');
  map.append(button);
  root.append(map);
  document.body.append(root);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
  vi.spyOn(map, 'getBoundingClientRect').mockReturnValue(new DOMRect(812, 16, 172, 120));
  const show = vi.fn();
  const hide = vi.fn();
  Object.assign(map, { showPopover: show, hidePopover: hide });
  let engineChanged = () => {};
  const unsubscribe = vi.fn();
  const changed = vi.fn();
  const navigate = vi.fn();
  const docked = vi.fn(() => false);
  const adapter = new SpatialOverview(root, {
    subscribeEngine: (listener) => {
      engineChanged = listener;
      return unsubscribe;
    },
    isDocked: docked,
    labelForPlane: () => ({ label: 'Projects', path: '/fixtures/Projects' }),
    onNavigate: navigate,
    changed,
  });
  stop = () => adapter.destroy();
  return {
    root,
    map,
    button,
    show,
    hide,
    adapter,
    docked,
    changed,
    unsubscribe,
    navigate,
    emit: () => engineChanged(),
  };
}

describe('engine overlay adapter', () => {
  it('coalesces events into one frame, performs no idle polling and preserves labels and styles on cleanup', () => {
    const view = fixture();
    expect(frames.size).toBe(1);
    for (let event = 0; event < 100; event++) view.emit();
    expect(frames.size).toBe(1);
    frame();
    expect(frames.size).toBe(0);
    expect(view.map.style.left).toBe('812px');
    expect(view.button.getAttribute('aria-label')).toBe('Go to Projects');
    const left = vi.spyOn(view.map.style, 'left', 'set');
    view.emit();
    frame();
    expect(left).not.toHaveBeenCalled();
    expect(view.changed).toHaveBeenCalledTimes(1);
    view.emit();
    view.adapter.destroy();
    expect(frames.size).toBe(0);
    expect(view.unsubscribe).toHaveBeenCalledTimes(1);
    expect(view.map.style.left).toBe('');
    expect(view.button.getAttribute('aria-label')).toBe('go to plane opaque-route');
  });

  it('places a blocked overview in a free corner and defers movement through a pointer press', () => {
    const view = fixture();
    frame();
    const header = document.createElement('div');
    header.className = 'plane-controls';
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 0, 300, 65));
    view.root.append(header);
    view.button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    view.emit();
    expect(frames.size).toBe(0);
    window.dispatchEvent(new MouseEvent('pointerup'));
    frame();
    expect(view.map.style.left).toBe('16px');
    expect(view.map.style.top).toBe('464px');
  });

  it('opens the original map in fallback without duplicating navigation, then restores focus on Escape', () => {
    const view = fixture();
    const header = document.createElement('div');
    header.className = 'plane-controls';
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
    view.root.append(header);
    frame();
    expect(view.adapter.snapshot()).toEqual({ available: true, collapsed: true, expanded: false });
    const opener = document.createElement('button');
    document.body.append(opener);
    view.adapter.open(opener);
    expect(view.show).toHaveBeenCalledTimes(1);
    expect(view.map.getAttribute('role')).toBe('dialog');
    expect(view.map.getAttribute('aria-label')).toBe('Overview');
    expect(document.activeElement).toBe(view.button);
    view.button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(opener);
    const engineNavigation = vi.fn();
    view.button.addEventListener('click', engineNavigation);
    view.adapter.open(opener);
    view.button.click();
    expect(engineNavigation).toHaveBeenCalledTimes(1);
    expect(view.navigate).toHaveBeenCalledWith('engine-plane');
    expect(view.adapter.snapshot().expanded).toBe(false);
    expect(view.map.parentElement).toBe(view.root);
  });

  it('does not offer an automatic fallback for deliberately docked chrome', () => {
    const view = fixture();
    view.docked.mockReturnValue(true);
    frame();
    expect(view.adapter.snapshot().available).toBe(false);
    view.adapter.open();
    expect(view.show).not.toHaveBeenCalled();
  });
});
