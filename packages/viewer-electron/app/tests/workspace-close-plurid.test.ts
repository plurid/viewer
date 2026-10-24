// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { pluridStateModules, usePluridPlane } from '@plurid/plurid-react';
import {
  configurationWith,
  flushFrames,
  installFrameClock,
  installMatchMedia,
  installPointerEvents,
  renderPlurid,
  type RenderedPlurid,
} from '@plurid/plurid-react/testing';
import {
  activeWorkspace,
  addPane,
  addTerminalPane,
  flushState,
  getState,
  initialize,
  setActivePane,
  storageAdapter,
} from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { flattenTree, hostID, paneRoute } from '../src/renderer/workspace/tree';

let rendered: RenderedPlurid | undefined;
let clock: ReturnType<typeof installFrameClock> | undefined;

function Page() {
  const plane = usePluridPlane();
  return createElement(
    'div',
    { 'data-viewer-pane': plane.parameters.id },
    createElement('div', { className: 'folder-explorer', tabIndex: 0 }, 'Generated plane content'),
  );
}

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

beforeEach(() => {
  installMatchMedia();
  installPointerEvents();
  vi.stubGlobal('localStorage', memoryStorage());
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  clock?.restore();
  clock = undefined;
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('returns a docked Git result to its actual Plurid parent with keyboard ownership and one Undo step', async () => {
  const unrelated = activeWorkspace().panes[0]!;
  const parent = addPane('/fixture/project', 'folder', true);
  rendered = await renderPlurid({
    id: 'close-linked-result',
    planes: [
      { route: '/folders/:id', component: Page },
      { route: '/terminals/:id', component: Page },
    ],
    view: activeWorkspace().roots.map((id) => paneRoute('folder', id)),
    configuration: configurationWith({
      elements: { plane: { width: 800, height: 480 } },
      space: {
        gestures: { wheel: 'click-to-scroll' },
        navigation: { motion: { duration: 0 } },
      },
    }),
    useLocalStorage: true,
    storageAdapter: storageAdapter(activeWorkspace().id),
  });
  const child = addTerminalPane('/fixture/project', '@viewer-git', false, {
    id: crypto.randomUUID(),
    gitAction: 'status',
  });
  const parentNode = rendered.handle.tree.get().find((item) => hostID(item) === parent.id)!;
  await act(async () => {
    rendered!.handle.tree.spawn(paneRoute('terminal', child.id), parentNode.planeID);
  });
  const childNode = flattenTree(rendered.handle.tree.get()).find(
    (item) => hostID(item) === child.id,
  )!;
  await act(async () => {
    rendered!.api.store.dispatch(
      pluridStateModules.space.actions.setViewSize({ width: 1000, height: 600 }),
    );
    rendered!.api.store.dispatch(
      pluridStateModules.space.actions.setPlaneSizes(
        flattenTree(rendered!.handle.tree.get()).map((item) => ({
          planeID: item.planeID,
          width: 800,
          height: 480,
        })),
      ),
    );
    rendered!.handle.camera.dock(childNode.planeID, { animate: false });
    rendered!.api.store.dispatch(pluridStateModules.ui.actions.setScrollPlaneID(childNode.planeID));
    setActivePane(child.id);
  });
  expect(rendered.handle.camera.docked()).toBe(childNode.planeID);
  const before = rendered.handle.history.get().undoDepth;
  clock = installFrameClock();
  const engine = { current: rendered.handle };
  const controller = renderHook(() =>
    useWorkspaceController({ engine, surface: { current: null }, readyRef: { current: true } }),
  ).result.current;

  await act(async () => controller.closePane(child.id));
  await flushFrames(80);
  expect(getState().activePane).toBe(parent.id);
  expect(getState().activePane).not.toBe(unrelated.id);
  expect(rendered.handle.camera.docked()).toBe(parentNode.planeID);
  expect(
    (rendered.api.store.getState() as { ui: { scrollPlaneID: string } }).ui.scrollPlaneID,
  ).toBe(parentNode.planeID);
  const content = rendered.container.querySelector<HTMLElement>(
    `[data-viewer-pane="${parent.id}"] .folder-explorer`,
  );
  expect(content).not.toBeNull();
  expect(document.activeElement).toBe(content);
  expect(rendered.handle.history.get().undoDepth).toBe(before + 1);
  expect(flattenTree(rendered.handle.tree.get()).some((item) => hostID(item) === child.id)).toBe(
    false,
  );

  await act(async () => controller.undo());
  expect(activeWorkspace().panes.find((pane) => pane.id === child.id)).toMatchObject({
    type: 'terminal',
    profileID: '@viewer-git',
    gitAction: 'status',
  });
  expect(flattenTree(rendered.handle.tree.get()).some((item) => hostID(item) === child.id)).toBe(
    true,
  );
  await act(async () => controller.redo());
  expect(activeWorkspace().panes.some((pane) => pane.id === child.id)).toBe(false);
});
