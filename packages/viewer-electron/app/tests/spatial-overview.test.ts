// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  overlaysIntersect,
  solveOverviewPlacement,
} from '../src/renderer/workspace/overlays/placement';
import type { MinimapCorner } from '../src/domain/contracts';
import { SpatialOverview } from '../src/renderer/workspace/overlays/SpatialOverview';
import type { CommandContext } from '../src/renderer/commands/registry';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { arrangementCommands } from '../src/renderer/commands/window-commands/arrangement';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import { activeWorkspace, getState, initialize } from '../src/renderer/state/store';
import { replaceState } from '../src/renderer/state/core';
import { useSpatialOverview } from '../src/renderer/workspace/overlays/useSpatialOverview';
import {
  minimapShown,
  surfaceConfiguration,
} from '../src/renderer/workspace/surface-configuration';
import { normalizePreferences } from '../src/domain/preferences/ui';

const viewport = { x: 0, y: 0, width: 1000, height: 600 };
const size = { width: 172, height: 120 };

describe('spatial overview placement', () => {
  it.each([
    ['bottom-right', 812, 464],
    ['bottom-left', 16, 464],
    ['top-right', 812, 16],
    ['top-left', 16, 16],
  ] as const)('keeps %s despite obstacles and a different current corner', (corner, x, y) => {
    expect(
      solveOverviewPlacement({
        viewport,
        size,
        obstacles: [viewport],
        current: 'top-left',
        corner,
      }),
    ).toEqual({ kind: 'corner', corner, bounds: { x, y, ...size } });
    expect(
      solveOverviewPlacement({
        viewport: { ...viewport, width: 200, height: 140 },
        size,
        obstacles: [],
        corner,
      }),
    ).toEqual({ kind: 'fallback' });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function frame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}
function fixture(options: { minimapShown?: boolean; corner?: MinimapCorner } = {}) {
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
  // jsdom has no Popover API and leaves a closed popover's contents unfocusable;
  // like a browser, opening one must render it.
  const show = vi.fn(() => {
    map.style.display = 'block';
  });
  const hide = vi.fn(() => {
    map.style.removeProperty('display');
  });
  Object.assign(map, { showPopover: show, hidePopover: hide });
  let engineChanged = () => {};
  const unsubscribe = vi.fn();
  const changed = vi.fn();
  const navigate = vi.fn();
  const docked = vi.fn(() => false);
  const hasPlanes = vi.fn(() => true);
  const minimapApplied = vi.fn(() => false);
  const minimapShown = vi.fn(() => options.minimapShown ?? true);
  const viewcubeConcealed = vi.fn((): boolean | undefined => undefined);
  const corner = vi.fn(() => options.corner ?? 'automatic');
  const requestMinimap = vi.fn();
  const adapter = new SpatialOverview(root, {
    subscribeEngine: (listener) => {
      engineChanged = listener;
      return unsubscribe;
    },
    isDocked: docked,
    hasPlanes,
    minimapApplied,
    minimapShown,
    viewcubeConcealed,
    corner,
    requestMinimap,
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
    hasPlanes,
    minimapApplied,
    minimapShown,
    viewcubeConcealed,
    corner,
    requestMinimap,
    changed,
    unsubscribe,
    navigate,
    emit: () => engineChanged(),
  };
}

describe('engine overlay adapter', () => {
  it('refuses an empty space without leaving a forced map request', () => {
    const view = fixture({ minimapShown: false });
    view.hasPlanes.mockReturnValue(false);
    frame();
    view.adapter.open();
    expect(view.requestMinimap).not.toHaveBeenCalledWith(true);
    expect(view.adapter.snapshot().available).toBe(false);
    expect(view.show).not.toHaveBeenCalled();
  });

  it('cancels a pending open after configuration is applied without a map', async () => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    frame();
    view.adapter.open();
    frame();
    view.adapter.invalidate();
    frame();
    frame();
    expect(view.requestMinimap).toHaveBeenLastCalledWith(true);
    view.minimapApplied.mockReturnValue(true);
    view.emit();
    frame();
    frame();
    expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
    view.root.append(view.map);
    await Promise.resolve();
    frame();
    expect(view.show).not.toHaveBeenCalled();
  });

  it('cancels a pending open on Escape outside the absent map', async () => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    frame();
    view.adapter.open();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    frame();
    expect(escape.defaultPrevented).toBe(true);
    expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
    view.root.append(view.map);
    await Promise.resolve();
    frame();
    expect(view.show).not.toHaveBeenCalled();
  });

  it('lets the engine receive a mouse click before releasing its forced map', () => {
    const view = fixture({ minimapShown: false });
    frame();
    view.adapter.open();
    view.requestMinimap.mockImplementation((shown: boolean) => {
      // A synchronous React flush can unmount the map between its native listener and the root.
      if (!shown) view.map.remove();
    });
    const engineNavigation = vi.fn();
    view.root.addEventListener('click', () => {
      if (view.button.isConnected) engineNavigation();
    });
    view.button.click();
    expect(engineNavigation).toHaveBeenCalledTimes(1);
    expect(view.requestMinimap).toHaveBeenLastCalledWith(true);
    expect(view.adapter.snapshot().expanded).toBe(false);
    frame();
    expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
  });

  it('does not release a reopened map from an older deferred close', () => {
    const view = fixture({ minimapShown: false });
    frame();
    view.adapter.open();
    view.adapter.close();
    view.adapter.open();
    view.requestMinimap.mockClear();
    frame();
    expect(view.adapter.snapshot().expanded).toBe(true);
    expect(view.requestMinimap).not.toHaveBeenCalledWith(false);
  });

  it('cancels the old scheduled release when reopened', () => {
    const view = fixture({ minimapShown: false });
    frame();
    view.adapter.open();
    const releaseID = nextFrame + 1;
    view.adapter.close();
    expect(frames.has(releaseID)).toBe(true);
    view.adapter.open();
    expect(frames.has(releaseID)).toBe(false);
  });

  it('guards a release callback already dequeued before reopening', () => {
    const view = fixture({ minimapShown: false });
    frame();
    view.adapter.open();
    view.adapter.close();
    // Cancellation cannot recall a callback already handed to the event loop.
    const dequeued = [...frames.values()];
    frames.clear();
    view.adapter.open();
    view.requestMinimap.mockClear();
    for (const callback of dequeued) callback(0);
    expect(view.adapter.snapshot().expanded).toBe(true);
    expect(view.requestMinimap).not.toHaveBeenCalledWith(false);
  });

  it.each(['automatic', 'bottom-right'] as const)(
    'leaves another plane focused after light dismissal with %s placement',
    (corner) => {
      const view = fixture({ corner });
      frame();
      const opener = document.createElement('button');
      const destination = document.createElement('button');
      let activePlane = 'A';
      opener.addEventListener('focus', () => {
        activePlane = 'A';
      });
      destination.addEventListener('focus', () => {
        activePlane = 'B';
      });
      document.body.append(opener, destination);
      opener.focus();
      view.adapter.open();
      destination.focus();
      view.map.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' }));
      expect(document.activeElement).toBe(destination);
      expect(activePlane).toBe('B');
    },
  );

  it('replaces an expanded fixed corner after resize, layout and a corner change', () => {
    const view = fixture({ corner: 'bottom-right' });
    frame();
    view.adapter.open();
    vi.mocked(view.root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 700, 400));
    window.dispatchEvent(new Event('resize'));
    frame();
    expect(view.map.style.left).toBe('512px');
    expect(view.map.style.top).toBe('264px');
    vi.mocked(view.root.getBoundingClientRect).mockReturnValue(new DOMRect(200, 50, 500, 300));
    view.emit();
    frame();
    expect(view.map.style.left).toBe('512px');
    expect(view.map.style.top).toBe('214px');
    view.corner.mockReturnValue('top-left');
    view.adapter.invalidate();
    frame();
    expect(view.map.style.left).toBe('216px');
    expect(view.map.style.top).toBe('66px');
  });

  it('leaves Escape in another control alone while light dismissal is queued', () => {
    const view = fixture();
    frame();
    view.adapter.open();
    const destination = document.createElement('button');
    document.body.append(destination);
    destination.focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    destination.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(destination);
    view.map.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' }));
    expect(view.adapter.snapshot().expanded).toBe(false);
  });

  it('measures no obstacles when both overlays are absent', () => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    const controls = document.createElement('div');
    controls.className = 'plane-controls';
    const measured = vi.spyOn(controls, 'getBoundingClientRect');
    view.root.append(controls);
    frame();
    measured.mockClear();
    vi.mocked(view.root.getBoundingClientRect).mockClear();
    const queries = vi.spyOn(view.root, 'querySelectorAll');
    const styles = vi.spyOn(window, 'getComputedStyle');
    for (let index = 0; index < 60; index++) {
      view.emit();
      frame();
    }
    expect(measured).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
    expect(view.root.getBoundingClientRect).not.toHaveBeenCalled();
    expect(queries).not.toHaveBeenCalled();
  });

  it('expands a requested map despite the overview-only visibility rule', async () => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    frame();
    view.adapter.open();
    view.map.style.visibility = 'hidden';
    view.root.append(view.map);
    await Promise.resolve();
    frame();
    expect(view.show).toHaveBeenCalledOnce();
    expect(view.adapter.snapshot().expanded).toBe(true);
  });

  it.each(['dock', 'destroy'] as const)('releases a pending open on %s', async (reason) => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    frame();
    view.adapter.open();
    if (reason === 'dock') {
      view.docked.mockReturnValue(true);
      view.emit();
      frame();
    } else view.adapter.destroy();
    frame();
    expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
    view.docked.mockReturnValue(false);
    view.root.append(view.map);
    await Promise.resolve();
    view.emit();
    frame();
    expect(view.show).not.toHaveBeenCalled();
  });

  it('does not start a pending request when docked', () => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    view.docked.mockReturnValue(true);
    frame();
    view.adapter.open();
    expect(view.requestMinimap).not.toHaveBeenCalledWith(true);
  });

  it.each([false, true])(
    'closes Overview and focuses the empty surface, map removed=%s',
    (removed) => {
      const view = fixture({ minimapShown: false });
      view.root.tabIndex = -1;
      frame();
      view.adapter.open();
      if (removed) view.map.remove();
      view.hasPlanes.mockReturnValue(false);
      view.emit();
      frame();
      expect(view.adapter.snapshot().expanded).toBe(false);
      expect(document.activeElement).toBe(view.root);
      frame();
      expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
    },
  );

  it('treats an unknown corner as automatic while expanded', () => {
    const view = fixture();
    view.corner.mockReturnValue('unknown' as MinimapCorner);
    frame();
    view.adapter.open();
    expect(view.map.style.left).toBe('50%');
    expect(view.map.style.top).toBe('50%');
  });

  it('keeps a pending request out of the next workspace before effect cleanup', () => {
    const view = fixture({ minimapShown: false });
    view.adapter.destroy();
    view.map.remove();
    const root = { current: view.root };
    const renders: { epoch: string; requested: boolean }[] = [];
    const hook = renderHook(
      ({ epoch }) => {
        const overview = useSpatialOverview({
          root,
          enabled: true,
          epoch,
          subscribeEngine: () => () => {},
          isDocked: view.docked,
          minimapShown: view.minimapShown,
          corner: view.corner,
          labelForPlane: () => undefined,
        });
        renders.push({ epoch, requested: overview.requested });
        return overview;
      },
      { initialProps: { epoch: 'first' } },
    );
    stop = () => hook.unmount();
    act(frame);
    act(() => hook.result.current.open());
    expect(hook.result.current.requested).toBe(true);
    hook.rerender({ epoch: 'second' });
    expect(
      renders.filter(({ epoch }) => epoch === 'second').every(({ requested }) => !requested),
    ).toBe(true);
    act(frame);
    expect(hook.result.current.requested).toBe(false);
    hook.rerender({ epoch: 'first' });
    expect(hook.result.current.requested).toBe(false);
  });

  it.each([false, true])(
    'requests the engine minimap without changing its preference, automatic=%s',
    async (automatic) => {
      const view = fixture({ minimapShown: false });
      view.adapter.destroy();
      view.map.remove();
      const root = { current: view.root };
      const preferences = {
        ...normalizePreferences().space,
        minimap: automatic,
        minimapAuto: automatic,
      };
      const original = { ...preferences };
      const hook = renderHook(
        ({ epoch }) => {
          const visible = minimapShown(preferences, 1);
          const overview = useSpatialOverview({
            root,
            enabled: true,
            epoch,
            subscribeEngine: () => () => {},
            isDocked: view.docked,
            minimapShown: () => visible,
            corner: view.corner,
            labelForPlane: () => ({ label: 'Projects' }),
          });
          const configuration = surfaceConfiguration({
            look: 'dark',
            size,
            preferences,
            minimap: visible || overview.requested,
          });
          return { overview, configuration };
        },
        { initialProps: { epoch: 'first' } },
      );
      stop = () => hook.unmount();
      act(frame);
      expect(hook.result.current.configuration.elements?.minimap?.show).toBe(false);
      act(() => hook.result.current.overview.open());
      expect(hook.result.current.configuration.elements?.minimap?.show).toBe(true);
      await act(async () => {
        view.root.append(view.map);
        await Promise.resolve();
        frame();
      });
      expect(hook.result.current.overview.expanded).toBe(true);
      act(() => hook.result.current.overview.close());
      expect(hook.result.current.configuration.elements?.minimap?.show).toBe(true);
      act(frame);
      expect(hook.result.current.configuration.elements?.minimap?.show).toBe(false);
      expect(preferences).toEqual(original);
      act(() => hook.result.current.overview.open());
      hook.rerender({ epoch: 'second' });
      expect(hook.result.current.configuration.elements?.minimap?.show).toBe(false);
      hook.rerender({ epoch: 'first' });
      expect(hook.result.current.configuration.elements?.minimap?.show).toBe(false);
    },
  );

  it('cancels a pending open before the engine mounts the map', async () => {
    const view = fixture({ minimapShown: false });
    view.map.remove();
    frame();
    view.adapter.open();
    view.adapter.open();
    frame();
    expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
    view.root.append(view.map);
    await Promise.resolve();
    frame();
    expect(view.show).not.toHaveBeenCalled();
    expect(view.adapter.snapshot().expanded).toBe(false);
  });

  it.each(['Escape', 'outside', 'plane', 'command'] as const)(
    'opens a hidden minimap on demand and returns to hidden after %s',
    async (dismissal) => {
      const view = fixture({ minimapShown: false });
      view.map.remove();
      frame();
      expect(view.adapter.snapshot().available).toBe(true);
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      view.adapter.open();
      expect(view.requestMinimap).toHaveBeenLastCalledWith(true);
      expect(view.show).not.toHaveBeenCalled();
      view.root.append(view.map);
      await Promise.resolve();
      frame();
      expect(view.show).toHaveBeenCalledTimes(1);
      expect(view.adapter.snapshot().expanded).toBe(true);
      expect(document.activeElement).toBe(view.button);

      if (dismissal === 'Escape')
        view.button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (dismissal === 'outside')
        view.map.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' }));
      else if (dismissal === 'plane') view.button.click();
      else view.adapter.open();

      expect(view.adapter.snapshot().expanded).toBe(false);
      expect(view.requestMinimap).toHaveBeenLastCalledWith(true);
      if (dismissal === 'plane') expect(view.navigate).toHaveBeenCalledWith('engine-plane');
      else expect(document.activeElement).toBe(opener);
      frame();
      expect(view.requestMinimap).toHaveBeenLastCalledWith(false);
      expect(view.map.getAttribute('popover')).toBe('auto');
      expect(view.adapter.snapshot().available).toBe(true);
    },
  );

  it('keeps a fixed corner when controls appear over it, including expanded Overview', async () => {
    const view = fixture({ corner: 'bottom-right' });
    frame();
    expect(view.map.style.left).toBe('812px');
    expect(view.map.style.top).toBe('464px');
    const header = document.createElement('div');
    header.className = 'plane-controls';
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 400, 300, 200));
    view.root.append(header);
    await Promise.resolve();
    frame();
    expect(view.map.style.left).toBe('812px');
    expect(view.map.style.top).toBe('464px');
    expect(view.adapter.snapshot().collapsed).toBe(false);
    view.adapter.open();
    expect(view.map.style.left).toBe('812px');
    expect(view.map.style.top).toBe('464px');
  });

  function cube(view: ReturnType<typeof fixture>, animated = false) {
    const element = document.createElement('div');
    element.dataset.pluridOverlay = 'viewcube';
    element.style.right = '0px';
    element.style.bottom = '0px';
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'view from front middleCenter');
    element.append(button);
    let shown = '';
    if (animated) {
      const computedStyle = globalThis.getComputedStyle;
      vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((target, pseudo) => {
        const style = computedStyle(target, pseudo);
        if (target !== element) return style;
        return new Proxy(style, {
          get: (value, property) =>
            property === 'translate' ? shown : Reflect.get(value, property),
        });
      });
    }
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
      const translation = (animated ? shown : element.style.translate)
        .split(/\s+/)
        .map(Number.parseFloat);
      return new DOMRect(
        (translation[0] || 0) +
          (element.style.left
            ? Number.parseFloat(element.style.left)
            : view.root.getBoundingClientRect().right -
              150 -
              Number.parseFloat(element.style.right)),
        (translation[1] || 0) +
          (element.style.top
            ? Number.parseFloat(element.style.top)
            : view.root.getBoundingClientRect().bottom -
              175 -
              Number.parseFloat(element.style.bottom)),
        150,
        175,
      );
    });
    view.root.append(element);
    return Object.assign(element, {
      arrive: () => {
        if (shown === element.style.translate) return false;
        // A transition keeps reporting its previous box until it reaches its new translation.
        shown = element.style.translate;
        element.dispatchEvent(new Event('transitionend'));
        return true;
      },
    });
  }

  function protectedArea(view: ReturnType<typeof fixture>, bounds: DOMRect) {
    const element = document.createElement('footer');
    element.setAttribute('data-viewer-overlay-protected', 'chat-composer');
    const rectangle = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
    view.root.append(element);
    return { element, rectangle };
  }

  it('moves the cube around a fixed map and restores its engine anchors and translation', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view);
    element.style.setProperty('translate', '2px 3px', 'important');
    frame();
    const mapBounds = { x: 812, y: 464, width: 172, height: 120 };
    expect(overlaysIntersect(element.getBoundingClientRect(), mapBounds)).toBe(false);
    expect(element.style.visibility).toBe('');
    expect(element.style.right).toBe('0px');
    expect(element.style.bottom).toBe('0px');
    expect(element.style.left).toBe('');
    expect(element.style.top).toBe('');
    view.adapter.open();
    view.emit();
    frame();
    expect(overlaysIntersect(element.getBoundingClientRect(), mapBounds)).toBe(false);
    view.adapter.close();
    frame();
    view.corner.mockReturnValue('top-left');
    view.emit();
    frame();
    expect(element.style.translate).toBe('2px 3px');
    expect(element.style.getPropertyPriority('translate')).toBe('important');
    view.corner.mockReturnValue('bottom-right');
    view.emit();
    frame();
    view.adapter.destroy();
    expect(element.style.translate).toBe('2px 3px');
    expect(element.style.visibility).toBe('');
  });

  it('keeps a concealed viewcube in its engine position through reveal', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    element.style.right = '-100px';
    element.style.bottom = '-90px';
    frame();
    element.arrive();
    const tucked = element.getBoundingClientRect();
    expect(tucked.right > 1000 || tucked.x < 0 || tucked.bottom > 600 || tucked.y < 0).toBe(true);
    element.style.right = '0px';
    element.style.bottom = '0px';
    const revealing = element.getBoundingClientRect();
    const visibleArea = (bounds: DOMRect) =>
      Math.max(0, Math.min(bounds.right, 1000) - Math.max(bounds.x, 0)) *
      Math.max(0, Math.min(bounds.bottom, 600) - Math.max(bounds.y, 0));
    expect(visibleArea(revealing)).toBeGreaterThan(visibleArea(tucked));
    element.dispatchEvent(new Event('transitionend'));
    frame();
    expect(element.arrive()).toBe(false);
    frame();
    const revealed = element.getBoundingClientRect();
    expect(revealed.x).toBeGreaterThanOrEqual(0);
    expect(revealed.y).toBeGreaterThanOrEqual(0);
    expect(revealed.right).toBeLessThanOrEqual(1000);
    expect(revealed.bottom).toBeLessThanOrEqual(600);
    expect(element.style.visibility).toBe('');
    expect(element.arrive()).toBe(false);
  });

  it('settles after moving clear of the map with delayed transition geometry', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    const styles = vi.spyOn(element.style, 'setProperty');
    frame();
    let transitions = 0;
    for (let step = 0; step < 8 && element.arrive(); step++) {
      transitions++;
      frame();
    }
    expect(transitions).toBe(1);
    expect(overlaysIntersect(element.getBoundingClientRect(), { x: 812, y: 464, ...size })).toBe(
      false,
    );
    expect(element.arrive()).toBe(false);
    expect(styles.mock.calls.filter(([property]) => property === 'translate')).toHaveLength(1);
  });

  it('keeps the horizontal tuck even when the vertical offset is already revealed', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    element.style.right = '-100px';
    frame();
    expect(element.style.translate).toBe('');
    expect(element.getBoundingClientRect().x).toBe(950);
    element.style.right = '0px';
    element.dispatchEvent(new Event('transitionend'));
    frame();
    element.arrive();
    frame();
    expect(element.getBoundingClientRect().x).toBe(850);
    expect(element.arrive()).toBe(false);
  });

  it('keeps a concealed viewcube under the pointer that reveals it', async () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    element.style.right = '-100px';
    element.style.bottom = '-90px';
    element.dataset.pluridHover = 'false';
    frame();
    const pointer = { x: 990, y: 590 };
    const underPointer = () => {
      const bounds = element.getBoundingClientRect();
      return (
        pointer.x >= bounds.x &&
        pointer.x <= bounds.right &&
        pointer.y >= bounds.y &&
        pointer.y <= bounds.bottom
      );
    };
    expect(underPointer()).toBe(true);
    element.style.right = '0px';
    element.style.bottom = '0px';
    element.dataset.pluridHover = 'true';
    await Promise.resolve();
    frame();
    for (let step = 0; step < 4 && element.arrive(); step++) frame();
    expect(underPointer()).toBe(true);
    expect(element.style.translate).toBe('');
    expect(element.style.visibility).toBe('');
    expect(element.arrive()).toBe(false);
  });

  it('respects the conceal setting while revealed and resumes placement when it is off', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    view.viewcubeConcealed.mockReturnValue(true);
    frame();
    expect(element.style.translate).toBe('');
    expect(element.style.visibility).toBe('');
    view.viewcubeConcealed.mockReturnValue(false);
    view.emit();
    frame();
    element.arrive();
    frame();
    expect(element.getBoundingClientRect()).toEqual(new DOMRect(834, 16, 150, 175));
    view.viewcubeConcealed.mockReturnValue(true);
    view.emit();
    frame();
    element.arrive();
    frame();
    expect(element.getBoundingClientRect()).toEqual(new DOMRect(850, 425, 150, 175));
    expect(element.style.visibility).toBe('');
    expect(element.arrive()).toBe(false);
  });

  it('subtracts its settled translation when the map changes corners', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    frame();
    element.arrive();
    frame();
    view.corner.mockReturnValue('top-right');
    view.emit();
    frame();
    expect(element.style.translate).toBe('');
    element.arrive();
    frame();
    expect(element.getBoundingClientRect()).toEqual(new DOMRect(850, 425, 150, 175));
    expect(element.arrive()).toBe(false);
  });

  it('uses the current transition offset when the viewport changes before arrival', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    frame();
    vi.mocked(view.root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 1000, 400));
    view.emit();
    frame();
    element.arrive();
    frame();
    expect(element.getBoundingClientRect()).toEqual(new DOMRect(834, 16, 150, 175));
    expect(element.arrive()).toBe(false);
  });

  it('can move again before a restoration transition reaches the engine position', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    frame();
    element.arrive();
    frame();
    view.corner.mockReturnValue('top-right');
    view.emit();
    frame();
    view.corner.mockReturnValue('bottom-right');
    view.emit();
    frame();
    element.arrive();
    frame();
    expect(element.getBoundingClientRect()).toEqual(new DOMRect(834, 16, 150, 175));
    expect(element.style.visibility).toBe('');
    expect(element.arrive()).toBe(false);
  });

  it('reveals a fixed-map cube once a corner becomes clear without resizing', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    const obstacle = protectedArea(view, new DOMRect(0, 0, 1000, 600));
    frame();
    expect(element.style.visibility).toBe('hidden');
    obstacle.element.remove();
    view.emit();
    frame();
    element.arrive();
    frame();
    expect(element.style.visibility).toBe('');
    expect(overlaysIntersect(element.getBoundingClientRect(), { x: 812, y: 464, ...size })).toBe(
      false,
    );
    expect(element.arrive()).toBe(false);
  });

  it('holds its chosen corner when a control appears over it', () => {
    const view = fixture({ corner: 'bottom-right' });
    const element = cube(view, true);
    frame();
    element.arrive();
    frame();
    const translation = element.style.translate;
    const obstacle = protectedArea(view, new DOMRect(800, 0, 200, 200));
    view.emit();
    frame();
    expect(element.style.translate).toBe(translation);
    expect(element.style.visibility).toBe('hidden');
    obstacle.element.remove();
    view.emit();
    frame();
    expect(element.style.visibility).toBe('');
    expect(element.arrive()).toBe(false);
  });

  it('protects a composer without overriding the engine Viewcube position', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    protectedArea(view, new DOMRect(0, 440, 1000, 160));
    frame();
    expect(element.style.left).toBe('');
    expect(element.style.top).toBe('');
    expect(element.style.right).toBe('0px');
    expect(element.style.bottom).toBe('0px');
    expect(element.style.visibility).toBe('hidden');
    expect(element.querySelector('button')?.getAttribute('aria-label')).toBe(
      'view from front middleCenter',
    );
    expect(view.adapter.snapshot().available).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('keeps clear of a plane footer, where a plane keeps its actions', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    const plane = document.createElement('section');
    plane.dataset.pluridPlane = 'engine-plane';
    const footer = document.createElement('footer');
    vi.spyOn(footer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 560, 1000, 40));
    plane.append(footer);
    view.root.append(plane);
    frame();
    expect(element.style.visibility).toBe('hidden');
  });

  it('leaves corner anchoring to the engine when an obstacle closes and the window grows', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    const footer = protectedArea(view, new DOMRect(0, 440, 1000, 160));
    frame();
    expect(element.style.visibility).toBe('hidden');

    footer.element.remove();
    vi.mocked(view.root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 1400, 1000));
    view.emit();
    frame();

    const bounds = element.getBoundingClientRect();
    expect(bounds.right).toBe(1400);
    expect(bounds.bottom).toBe(1000);
    expect(element.style.visibility).toBe('');
    expect(element.style.transition).toBe('');
    expect(frames.size).toBe(0);
  });

  it('ignores the toolbar click-through band but protects its actual controls', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    const band = document.createElement('div');
    band.dataset.pluridEntity = 'PluridToolbar';
    band.style.pointerEvents = 'none';
    vi.spyOn(band, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 525, 1000, 75));
    const button = document.createElement('button');
    button.dataset.pluridControl = 'toolbar-more';
    const bounds = vi
      .spyOn(button, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(600, 535, 40, 46));
    band.append(button);
    view.root.append(band);
    frame();
    expect(element.style.visibility).toBe('');
    expect(element.style.left).toBe('');
    expect(element.style.top).toBe('');

    bounds.mockReturnValue(new DOMRect(900, 535, 40, 46));
    view.emit();
    frame();
    expect(element.style.visibility).toBe('hidden');

    bounds.mockReturnValue(new DOMRect(600, 535, 40, 46));
    view.emit();
    frame();
    expect(element.style.visibility).toBe('');
  });

  it('preserves the engine conceal offsets and reveals its expanded cube only when safe', () => {
    const view = fixture();
    view.map.remove();
    const element = cube(view);
    element.style.right = '-100px';
    element.style.bottom = '-90px';
    element.dataset.pluridHover = 'false';
    protectedArea(view, new DOMRect(400, 440, 500, 160));
    frame();
    expect(element.style.right).toBe('-100px');
    expect(element.style.bottom).toBe('-90px');
    expect(element.style.left).toBe('');
    expect(element.style.top).toBe('');
    expect(element.style.visibility).toBe('');

    element.style.right = '0px';
    element.style.bottom = '0px';
    element.dataset.pluridHover = 'true';
    element.dispatchEvent(new Event('transitionend'));
    frame();
    expect(element.style.visibility).toBe('hidden');
    expect(element.querySelector('button')).not.toBeNull();

    element.style.right = '-100px';
    element.style.bottom = '-90px';
    element.dataset.pluridHover = 'false';
    element.dispatchEvent(new Event('transitionend'));
    frame();
    expect(element.style.visibility).toBe('');
    expect(element.style.right).toBe('-100px');
    expect(element.style.bottom).toBe('-90px');
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
    expect(element.style.visibility).toBe('hidden');
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
    const footer = protectedArea(view, new DOMRect(0, 0, 1000, 600));
    frame();
    expect(element.style.visibility).toBe('hidden');
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    footer.element.remove();
    bounds.mockReturnValue(new DOMRect(0, 0, 1000, 600));
    resized();
    expect(frames.size).toBe(0);
    window.dispatchEvent(new MouseEvent('pointerup'));
    frame();
    expect(element.style.visibility).toBe('');
    expect(element.style.left).toBe('');
    expect(element.style.top).toBe('');
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
