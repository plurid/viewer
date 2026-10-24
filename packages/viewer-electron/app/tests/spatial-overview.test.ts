// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  solveOverviewPlacement,
  solveProtectedOverlayPlacement,
} from '../src/renderer/workspace/overlays/placement';
import { SpatialOverview } from '../src/renderer/workspace/overlays/SpatialOverview';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { arrangementCommands } from '../src/renderer/commands/window-commands/arrangement';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { replaceState } from '../src/renderer/state/core';

const viewport = { x: 0, y: 0, width: 1000, height: 600 };
const size = { width: 172, height: 120 };

describe('spatial overview placement', () => {
  it('uses a safe edge between protected bands and retains its position when the bands move', () => {
    const moved = solveProtectedOverlayPlacement({
      viewport: { x: 0, y: 56, width: 1280, height: 844 },
      bounds: { x: 1130, y: 725, width: 150, height: 175 },
      obstacles: [
        { x: 51, y: 123, width: 1178, height: 140 },
        { x: 51, y: 657, width: 1178, height: 175 },
        { x: 488, y: 840, width: 304, height: 46 },
      ],
    });
    expect(moved).toEqual({ x: 1114, y: 474, width: 150, height: 175 });
    expect(
      solveProtectedOverlayPlacement({
        viewport: { x: 0, y: 56, width: 1280, height: 844 },
        bounds: moved!,
        obstacles: [],
      }),
    ).toEqual(moved);
  });

  it('returns no unsafe placement on a narrow viewport or invalid geometry', () => {
    expect(
      solveProtectedOverlayPlacement({
        viewport: { x: 0, y: 56, width: 780, height: 504 },
        bounds: { x: 630, y: 297, width: 150, height: 175 },
        obstacles: [
          { x: 0, y: 56, width: 780, height: 180 },
          { x: 0, y: 360, width: 780, height: 200 },
        ],
      }),
    ).toBeUndefined();
    expect(
      solveProtectedOverlayPlacement({
        viewport,
        bounds: { x: NaN, y: 0, width: 150, height: 175 },
        obstacles: [],
      }),
    ).toBeUndefined();
  });

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
  function cube(view: ReturnType<typeof fixture>) {
    const element = document.createElement('div');
    element.dataset.pluridOverlay = 'viewcube';
    element.style.right = '0px';
    element.style.bottom = '0px';
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'view from front middleCenter');
    element.append(button);
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () =>
        new DOMRect(
          element.style.left ? Number.parseFloat(element.style.left) : 850,
          element.style.top ? Number.parseFloat(element.style.top) : 425,
          150,
          175,
        ),
    );
    view.root.append(element);
    return element;
  }

  function protectedArea(view: ReturnType<typeof fixture>, bounds: DOMRect) {
    const element = document.createElement('footer');
    element.setAttribute('data-viewer-overlay-protected', 'chat-composer');
    const rectangle = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
    view.root.append(element);
    return { element, rectangle };
  }

  it('keeps a visible Viewcube above a full-width composer when the minimap is disabled', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    protectedArea(view, new DOMRect(0, 440, 1000, 160));
    frame();
    expect(element.style.left).toBe('834px');
    expect(element.style.top).toBe('257px');
    expect(element.style.visibility).not.toBe('hidden');
    expect(element.querySelector('button')?.getAttribute('aria-label')).toBe(
      'view from front middleCenter',
    );
    expect(view.adapter.snapshot().available).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('temporarily conceals a cube with no safe space and restores it after a frame geometry change', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    protectedArea(view, new DOMRect(0, 0, 1000, 200));
    const footer = protectedArea(view, new DOMRect(0, 350, 1000, 250));
    frame();
    expect(element.style.visibility).toBe('hidden');
    expect(element.querySelector('button')).not.toBeNull();
    footer.rectangle.mockReturnValue(new DOMRect(0, 500, 1000, 100));
    for (let event = 0; event < 50; event++) view.emit();
    expect(frames.size).toBe(1);
    frame();
    expect(element.style.visibility).toBe('');
    expect(Number.parseFloat(element.style.top) + 175).toBeLessThanOrEqual(492);
    expect(frames.size).toBe(0);
  });

  it('does not reveal deliberately hidden or docked cube chrome and restores its original styles', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    element.style.display = 'none';
    protectedArea(view, new DOMRect(0, 440, 1000, 160));
    frame();
    expect(element.style.left).toBe('');
    element.style.display = '';
    view.emit();
    frame();
    expect(element.style.top).toBe('257px');
    view.docked.mockReturnValue(true);
    view.emit();
    frame();
    expect(element.style.left).toBe('');
    expect(element.style.top).toBe('');
    expect(element.style.right).toBe('0px');
    view.adapter.destroy();
    expect(element.style.bottom).toBe('0px');
    expect(element.style.visibility).toBe('');
    expect(element.style.transition).toBe('');
  });

  it('remeasures cube protection on viewport resize without moving a pressed control', () => {
    let resized!: () => void;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = () => callback([], this as unknown as ResizeObserver);
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    const bounds = vi.mocked(view.root.getBoundingClientRect);
    bounds.mockReturnValue(new DOMRect(0, 0, 180, 200));
    frame();
    expect(element.style.visibility).toBe('hidden');
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    bounds.mockReturnValue(new DOMRect(0, 0, 1000, 600));
    resized();
    expect(frames.size).toBe(0);
    window.dispatchEvent(new MouseEvent('pointerup'));
    frame();
    expect(element.style.visibility).toBe('');
    expect(element.style.left).toBe('834px');
    expect(element.style.top).toBe('409px');
    expect(frames.size).toBe(0);
  });

  it.each([true, false])(
    'keeps Overview available through the real command registry when every corner is blocked and titlebar=%s',
    async (titlebar) => {
      Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
      initialize({
        home: '/fixture',
        platform: 'darwin',
        state: null,
        locations: [],
        openPaths: [],
      });
      const state = getState();
      replaceState({
        ...state,
        saved: {
          ...state.saved,
          ui: { ...state.saved.ui, titlebar: { ...state.saved.ui.titlebar, visible: titlebar } },
        },
      });
      const view = fixture();
      const controls = document.createElement('footer');
      controls.setAttribute('data-viewer-overlay-protected', 'test-controls');
      vi.spyOn(controls, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
      view.root.append(controls);
      frame();
      expect(view.adapter.snapshot()).toEqual({
        available: true,
        collapsed: true,
        expanded: false,
      });
      const actions = {
        workspace: { isDocked: () => false },
        ready: true,
        overviewAvailable: view.adapter.snapshot().available,
        overview: () => view.adapter.open(),
      } as unknown as WindowActions;
      const context: CommandContext = {
        scope: 'window',
        workspaceID: activeWorkspace().id,
        selection: [],
        jobs: [],
        clipboard: null,
      };
      const registry = new CommandRegistry();
      registry.register('window', {
        context: () => context,
        definitions: () =>
          arrangementCommands(windowScopes(actions)).filter((command) => command.id === 'overview'),
      });
      expect(await registry.invoke('overview', {})).toBe(true);
      expect(view.show).toHaveBeenCalledTimes(1);
      expect(view.adapter.snapshot().expanded).toBe(true);
      expect(document.activeElement).toBe(view.button);
      expect(view.root.querySelectorAll('[data-plurid-overlay="minimap"]')).toHaveLength(1);
    },
  );

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

  it('keeps the minimap off an explicitly protected composer and its Send button', async () => {
    const view = fixture();
    const header = document.createElement('div');
    header.className = 'plane-controls';
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 0, 300, 65));
    view.root.append(header);
    frame();
    expect(view.map.style.top).toBe('464px');

    const footer = document.createElement('footer');
    footer.setAttribute('data-viewer-overlay-protected', 'chat-composer');
    vi.spyOn(footer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 440, 1000, 160));
    const send = document.createElement('button');
    send.textContent = 'Send';
    footer.append(send);
    view.root.append(footer);
    await Promise.resolve();
    expect(frames.size).toBe(1);
    frame();
    expect(view.map.style.left).toBe('16px');
    expect(view.map.style.top).toBe('16px');
    expect(view.adapter.snapshot().collapsed).toBe(false);

    const row = document.createElement('div');
    row.className = 'file-row';
    view.root.append(row);
    row.textContent = 'An ordinary changing file row';
    await Promise.resolve();
    expect(frames.size).toBe(0);
  });

  it('rechecks explicit protection added or removed on an existing area without idle polling', async () => {
    const view = fixture();
    const area = document.createElement('footer');
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
    view.root.append(area);
    frame();
    expect(view.adapter.snapshot().collapsed).toBe(false);

    area.setAttribute('data-viewer-overlay-protected', 'composer');
    await Promise.resolve();
    expect(frames.size).toBe(1);
    frame();
    expect(view.adapter.snapshot().collapsed).toBe(true);
    area.removeAttribute('data-viewer-overlay-protected');
    await Promise.resolve();
    expect(frames.size).toBe(1);
    frame();
    expect(view.adapter.snapshot().collapsed).toBe(false);
    expect(view.map.style.left).toBe('812px');
    expect(frames.size).toBe(0);
  });

  it('remeasures a resized composer once and ignores its hidden footprint', () => {
    let resized!: () => void;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = () => callback([], this as unknown as ResizeObserver);
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      },
    );
    const view = fixture();
    const header = document.createElement('div');
    header.className = 'plane-controls';
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 0, 300, 65));
    const footer = document.createElement('footer');
    footer.setAttribute('data-viewer-overlay-protected', 'chat-composer');
    const bounds = vi
      .spyOn(footer, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 600, 1000, 160));
    view.root.append(header, footer);
    frame();
    expect(view.map.style.top).toBe('464px');
    expect(observe).toHaveBeenCalledWith(footer);

    bounds.mockReturnValue(new DOMRect(0, 440, 1000, 160));
    for (let event = 0; event < 100; event++) resized();
    expect(frames.size).toBe(1);
    frame();
    expect(view.map.style.top).toBe('16px');
    expect(frames.size).toBe(0);

    bounds.mockReturnValue(new DOMRect(0, 0, 1000, 600));
    resized();
    frame();
    expect(view.adapter.snapshot().collapsed).toBe(true);
    footer.style.display = 'none';
    view.emit();
    frame();
    expect(view.adapter.snapshot().collapsed).toBe(false);
    view.adapter.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
