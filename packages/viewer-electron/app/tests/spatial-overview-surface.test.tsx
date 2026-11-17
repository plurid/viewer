// @vitest-environment jsdom
/**
 * The real engine exposes React's click boundary and retained empty views, which a detached DOM
 * fixture cannot reproduce. The handle is the same one used by the Overview command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import { installMatchMedia, installPointerEvents } from '@plurid/plurid-react/testing';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { update } from '../src/renderer/state/core';
import { WorkspaceSurface } from '../src/renderer/workspace/WorkspaceSurface';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import type { SpatialOverviewHandle } from '../src/renderer/workspace/overlays/useSpatialOverview';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

let handle: SpatialOverviewHandle | undefined;
let engineHandle: { current: PluridApplicationHandle | null } | undefined;
let unmount: (() => void) | undefined;
let controllerHandle: ReturnType<typeof useWorkspaceController> | undefined;
const shown = vi.fn();

function Harness() {
  const engine = useRef<PluridApplicationHandle>(null);
  const surface = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  engineHandle = engine;
  const controller = useWorkspaceController({ engine, surface, readyRef });
  controllerHandle = controller;
  const registry = useRef(new CommandRegistry()).current;
  return createElement(
    CommandsContext.Provider,
    { value: registry },
    createElement(
      WorkspaceContext.Provider,
      { value: controller },
      createElement(WorkspaceSurface, {
        engine,
        surface,
        onReady: () => {
          readyRef.current = true;
        },
        onOverviewChange: (next) => {
          handle = next;
        },
      }),
    ),
  );
}

function setSpace(
  space: Record<string, unknown>,
  workspace: { roots: string[]; panes?: unknown[] },
): void {
  const state = getState();
  const current = activeWorkspace();
  act(() =>
    update({
      ...state,
      saved: {
        ...state.saved,
        ui: { ...state.saved.ui, space: { ...state.saved.ui.space, ...space } },
        workspaces: state.saved.workspaces.map((item) =>
          item.id === current.id
            ? {
                ...item,
                roots: workspace.roots,
                panes: (workspace.panes ?? []) as typeof item.panes,
                layout: undefined,
                arrangement: {},
              }
            : item,
        ),
      },
    }),
  );
}

const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

async function mount(): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  unmount = () => root.unmount();
  await settle(120);
  return container;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installMatchMedia();
  installPointerEvents();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom has no Popover API: open renders, close queues the toggle event as Chromium does
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      shown(this);
      this.dataset.reviewOpen = 'true';
      this.style.display = 'block';
    },
    hidePopover(this: HTMLElement) {
      if (this.dataset.reviewOpen !== 'true') return;
      delete this.dataset.reviewOpen;
      this.style.removeProperty('display');
      setTimeout(() =>
        this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' })),
      );
    },
  });
  Object.assign(window, {
    viewer: new Proxy({}, { get: () => vi.fn(async () => undefined) }),
  });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  handle = undefined;
  shown.mockClear();
});
afterEach(async () => {
  act(() => unmount?.());
  unmount = undefined;
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});

describe('Overview on the real engine', () => {
  it.each([false, true])('S1 an empty space: Overview from ⌘K, minimap=%s', async (minimap) => {
    setSpace({ minimap, minimapAuto: false }, { roots: [] });
    await mount();
    expect(handle).toBeDefined();
    expect(handle!.available).toBe(false);
    act(() => handle!.open());
    await settle();
    expect(handle!.requested).toBe(false);

    // A later plane must not inherit an earlier request made in an empty space.
    await settle(300);

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();

    setSpace({ minimap, minimapAuto: false }, { roots: ['ghost-1'] });
    await settle(300);

    expect(handle!.requested).toBe(false);
    expect(shown).not.toHaveBeenCalled();
  });

  it.each([
    ['forced (minimap off)', false, true],
    ['forced (minimap off)', false, false],
    ['shown (minimap on)', true, true],
  ])(
    'S2 choosing a plane in Overview, %s, minimap=%s checkpoint=%s',
    async (_label, minimap, checkpoint) => {
      setSpace({ minimap, minimapAuto: false }, { roots: ['ghost-1', 'ghost-2'] });
      const container = await mount();
      const surface = container.querySelector<HTMLElement>('.workspace-surface')!;
      act(() => handle!.open());
      await settle();
      expect(handle!.expanded).toBe(true);
      const store = engineHandle!.current!.store;
      const buttons = [
        ...container.querySelectorAll<HTMLButtonElement>('[data-plurid-minimap-plane]'),
      ];
      const activeBefore = store.getState().space.activePlaneID;
      const target = buttons.find((button) => button.dataset.pluridMinimapPlane !== activeBefore)!;
      expect(target).toBeDefined();
      // Chromium runs a microtask checkpoint after each listener of a user's click; React's
      // scheduled sync work runs there. A listener between the map and React's root emulates it.
      const flush = () => flushSync(() => {});
      if (checkpoint) surface.addEventListener('click', flush);
      act(() => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      });
      surface.removeEventListener('click', flush);
      await settle();
      const activeAfter = store.getState().space.activePlaneID;

      expect(activeAfter).toBe(target.dataset.pluridMinimapPlane);
    },
  );

  it.each([
    ['forced (minimap off)', false],
    ['shown (minimap on)', true],
  ])('S3 the last plane closes while Overview is open, %s', async (_label, minimap) => {
    setSpace({ minimap, minimapAuto: false }, { roots: ['ghost-1'] });
    const container = await mount();
    act(() => handle!.open());
    await settle();
    expect(handle!.expanded).toBe(true);
    // ⌥⌘W reaches the window while focus is in the popup
    setSpace({ minimap, minimapAuto: false }, { roots: [] });
    await settle(200);
    expect(handle!.expanded).toBe(false);
    expect(handle!.requested).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('.workspace-surface'));

    setSpace({ minimap, minimapAuto: false }, { roots: ['ghost-2'] });
    await settle(200);

    expect(handle!.expanded).toBe(false);
    expect(handle!.requested).toBe(false);
  });

  it.each([false, true])(
    'S4 opening and closing Overview keeps the spatial tool and the camera, minimap=%s',
    async (minimap) => {
      setSpace({ minimap, minimapAuto: false }, { roots: ['ghost-1', 'ghost-2'] });
      const container = await mount();
      const store = engineHandle!.current!.store;
      act(() => controllerHandle!.setTransformTool('rotate'));
      await settle();
      const camera = () => JSON.stringify(store.getState().space.camera ?? null);
      const before = {
        mode: store.getState().configuration.space.transformMode,
        camera: camera(),
        toolbar: store.getState().configuration.elements.toolbar.show,
      };
      act(() => handle!.open());
      await settle();
      expect(handle!.expanded).toBe(true);
      const button = container.querySelector<HTMLElement>('[data-plurid-minimap-plane]')!;
      act(() => {
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await settle(200);
      const after = {
        mode: store.getState().configuration.space.transformMode,
        camera: camera(),
        toolbar: store.getState().configuration.elements.toolbar.show,
      };

      expect(after).toEqual(before);
    },
  );

  it('S5 choosing a plane with Enter in a forced Overview navigates', async () => {
    setSpace({ minimap: false, minimapAuto: false }, { roots: ['ghost-1', 'ghost-2'] });
    const container = await mount();
    act(() => handle!.open());
    await settle();
    expect(handle!.expanded).toBe(true);
    const store = engineHandle!.current!.store;
    const activeBefore = store.getState().space.activePlaneID;
    const target = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-plurid-minimap-plane]'),
    ].find((button) => button.dataset.pluridMinimapPlane !== activeBefore)!;
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();

    expect(store.getState().space.activePlaneID).toBe(target.dataset.pluridMinimapPlane);
  });
});
