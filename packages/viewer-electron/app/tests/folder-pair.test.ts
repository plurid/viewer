// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { pluridStateModules } from '@plurid/plurid-react';
import { PLURID_ENTITY_TOOLBAR, PLURID_PUBSUB_TOPIC } from '@plurid/plurid-data';
import {
  configurationWith,
  flushFrames,
  installFrameClock,
  installMatchMedia,
  installPointerEvents,
  renderPlurid,
  type RenderedPlurid,
} from '@plurid/plurid-react/testing';
import type { FolderPane } from '../src/domain/contracts';
import { stateSchema } from '../src/desktop/storage';
import {
  activeWorkspace,
  addPane,
  flushState,
  getState,
  initialize,
  navigate,
  receiveSettings,
  storageAdapter,
  updatePane,
} from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { folderPairArea, folderPairGeometry } from '../src/renderer/workspace/folder-pair';
import { browseSession, clearSessions } from '../src/renderer/workspace/sessions';
import { flattenTree, hostID, paneRoute } from '../src/renderer/workspace/tree';
import { arrangementCommands } from '../src/renderer/commands/window-commands/arrangement';
import { planeLayoutCommands } from '../src/renderer/commands/window-commands/plane-layout';
import { planeLayoutGeometry } from '../src/renderer/workspace/plane-layout';
import { windowScopes, type WindowActions } from '../src/renderer/commands/window-commands/scope';
import { contextMenuSections } from '../src/renderer/commands/menu';
import {
  CommandRegistry,
  rankCommands,
  type CommandContext,
} from '../src/renderer/commands/registry';

describe('existing plane sizing and positioning', () => {
  it('expands the remaining half without creating a plane, and undoes only that resize', async () => {
    const { controller } = await workspace();
    await act(async () => controller.splitFolder(target(), 'x'));
    const copy = activeWorkspace().panes[1]!;
    await act(async () => controller.closePane(copy.id));
    const before = rendered!.handle.tree.get();
    const source = structuredClone(activeWorkspace().panes[0]);
    const depth = rendered!.handle.history.get().undoDepth;
    await act(async () => controller.layoutPlane(target(), { width: [1, 1] }));
    expect(rendered!.handle.tree.get()[0]).toMatchObject({
      width: 984,
      height: before[0]!.height,
      sizeMode: 'manual',
    });
    expect(activeWorkspace().panes).toEqual([source]);
    expect(rendered!.handle.history.get().undoDepth).toBe(depth + 1);
    const expanded = rendered!.handle.tree.get();
    await act(async () => controller.undo());
    expect(rendered!.handle.tree.get()).toEqual(before);
    expect(activeWorkspace().panes).toHaveLength(1);
    await act(async () => controller.redo());
    expect(rendered!.handle.tree.get()).toEqual(expanded);
  });

  it('tiles three existing roots with composable sizing and alignment, preserving neighbours', async () => {
    addPane('/fixtures/two', 'folder', true);
    addPane('/fixtures/three', 'folder', true);
    const { controller } = await workspace();
    const ids = activeWorkspace().panes.map((pane) => pane.id);
    const positions = [0, 0.5, 1] as const;
    for (const [index, paneID] of ids.entries()) {
      const before = rendered!.handle.tree.get();
      await act(async () => {
        controller.layoutPlane({ workspaceID: activeWorkspace().id, paneID }, { width: [1, 3] });
        controller.layoutPlane(
          { workspaceID: activeWorkspace().id, paneID },
          { x: positions[index]! },
        );
      });
      for (const node of rendered!.handle.tree.get())
        if (hostID(node) !== paneID)
          expect(node).toEqual(before.find((item) => item.planeID === node.planeID));
    }
    const [left, middle, right] = rendered!.handle.tree.get();
    expect([left!.width, middle!.width, right!.width]).toEqual([320, 320, 320]);
    expect(middle!.location.translateX - left!.location.translateX).toBe(332);
    expect(right!.location.translateX - middle!.location.translateX).toBe(332);
    expect(activeWorkspace().panes).toHaveLength(3);
    const tiled = rendered!.handle.tree.get();
    await flushState();
    await rendered!.unmount();
    rendered = undefined;
    await workspace();
    expect(rendered!.handle.tree.get()).toEqual(tiled);
  });

  it('fills and reveals a docked plane at natural scale without losing its folder session', async () => {
    const { controller, element } = await workspace();
    const id = target().paneID;
    const session = browseSession(id, target().path);
    session.selection = ['/fixtures/selected.txt'];
    session.scroll = { list: 120 };
    const planeID = rendered!.handle.tree.get()[0]!.planeID;
    await act(async () => rendered!.handle.camera.dock(planeID, { animate: false }));
    clock = installFrameClock();
    await act(async () => controller.layoutPlane(target(), { width: [1, 1], height: [1, 1] }));
    for (const plane of element.querySelectorAll<HTMLElement>('[data-plurid-plane]'))
      Object.defineProperties(plane, {
        offsetWidth: { configurable: true, get: () => parseFloat(plane.style.width) },
        offsetHeight: { configurable: true, get: () => parseFloat(plane.style.height) },
      });
    await flushFrames(80);
    expect(rendered!.handle.tree.get()[0]).toMatchObject({ width: 984, height: 584 });
    expect(rendered!.handle.camera.get()).toMatchObject({ yaw: 0, pitch: 0, roll: 0, scale: 1 });
    expect(rendered!.handle.camera.docked()).toBe('');
    expect(browseSession(id, target().path)).toBe(session);
    expect(session).toMatchObject({ selection: ['/fixtures/selected.txt'], scroll: { list: 120 } });
  });

  it.each([
    [[1, 2], 486, 286],
    [[1, 3], 320, 560 / 3],
    [[2, 3], 652, 1156 / 3],
    [[1, 4], 237, 137],
    [[3, 4], 735, 435],
  ] as const)('sizes %s of each axis with tiling gutters', async (fraction, width, height) => {
    await workspace();
    const geometry = planeLayoutGeometry(
      { width: 1000, height: 600 },
      { x: 8, y: 8, width: 984, height: 584 },
      rendered!.handle.tree.get()[0]!,
      rendered!.handle.camera.get(),
      { width: fraction, height: fraction, x: 1, y: 1 },
      1,
    );
    expect(geometry.width).toBeCloseTo(width);
    expect(geometry.height).toBeCloseTo(height);
  });

  it.each(['move', 'resize'] as const)(
    'selects only the requested plane for manual %s',
    async (mode) => {
      addPane('/fixtures/two', 'folder', true);
      const { controller } = await workspace();
      const before = rendered!.handle.tree.get();
      await act(async () => {
        rendered!.handle.selection.all();
        controller.setTransformTool('rotate');
        rendered!.api.pubsub.publish({ topic: PLURID_PUBSUB_TOPIC.SPACE_GRAB, data: { on: true } });
        controller.editPlane(target(), mode);
      });
      expect(rendered!.handle.selection.get()).toEqual([before[0]!.planeID]);
      expect(controller.transformTool()).toBe(null);
      expect(rendered!.api.getSnapshot().ui.grabMode).toBe(false);
      expect(rendered!.handle.tree.get()).toEqual(before);
      expect(getState().saved.ui.space).toMatchObject({ planeHeaders: true });
      if (mode === 'resize') {
        expect(
          rendered!.container.querySelector('[data-plurid-control="plane-resize-corner"]'),
        ).not.toBeNull();
      }
    },
  );

  it('resizes by dragging a native corner with one Undo step and no camera change', async () => {
    const { controller } = await workspace();
    await act(async () => controller.editPlane(target(), 'resize'));
    const before = rendered!.handle.tree.get();
    const camera = rendered!.handle.camera.get();
    const depth = rendered!.handle.history.get().undoDepth;
    const corner = rendered!.container.querySelector(
      '[data-plurid-control="plane-resize-corner"]',
    )!;
    await act(async () => {
      fireEvent.pointerDown(corner, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(corner, { pointerId: 1, clientX: 148, clientY: 132 });
      fireEvent.pointerUp(corner, { pointerId: 1 });
    });
    expect(rendered!.handle.tree.get()[0]).toMatchObject({
      width: before[0]!.width + 48 / camera.scale,
      height: before[0]!.height + 32 / camera.scale,
      sizeMode: 'manual',
    });
    expect(rendered!.handle.camera.get()).toEqual(camera);
    expect(rendered!.handle.history.get().undoDepth).toBe(depth + 1);
    await act(async () => controller.undo());
    expect(rendered!.handle.tree.get()).toEqual(before);
  });

  it('rejects stale or unready layout targets without changing geometry or preferences', async () => {
    const { controller, readyRef } = await workspace();
    const before = rendered!.handle.tree.get();
    const ui = structuredClone(getState().saved.ui);
    for (const destination of [
      { ...target(), workspaceID: 'previous-workspace' },
      { ...target(), paneID: 'closed-plane' },
    ]) {
      controller.layoutPlane(destination, { width: [1, 1] });
      controller.editPlane(destination, 'resize');
    }
    readyRef.current = false;
    controller.layoutPlane(target(), { height: [1, 2] });
    controller.editPlane(target(), 'move');
    expect(rendered!.handle.tree.get()).toEqual(before);
    expect(getState().saved.ui).toEqual(ui);
  });

  it('exposes concise sizing commands in searchable, grouped menus for every plane type', async () => {
    const { controller } = await workspace();
    const layout = vi.spyOn(controller, 'layoutPlane').mockImplementation(() => {});
    const context: CommandContext = {
      scope: 'preview',
      workspaceID: activeWorkspace().id,
      paneID: target().paneID,
      selection: [],
      jobs: [],
      clipboard: null,
    };
    const registry = new CommandRegistry();
    const actions = { workspace: controller, ready: true, tool: null } as WindowActions;
    registry.register('window', {
      context: () => context,
      definitions: () => planeLayoutCommands(windowScopes(actions)),
    });
    const commands = registry.list();
    expect(commands).toHaveLength(21);
    expect(commands.every((command) => !command.detail && !command.shortcut)).toBe(true);
    const half = rankCommands(commands, '1/2 width', [])[0]!;
    expect(half.id).toBe('plane-width-half');
    await registry.run(half);
    expect(layout).toHaveBeenCalledWith(
      { workspaceID: context.workspaceID, paneID: context.paneID },
      { width: [1, 2] },
    );
    const menu = contextMenuSections(commands, [], true);
    expect(menu.flatMap((section) => section.entries).map((entry) => entry.id)).toEqual([
      'plane-move',
      'plane-resize',
      'plane-fill',
      'menu.Width',
      'menu.Height',
      'menu.Position',
    ]);
    expect(registry.list({ scope: 'sidebar' })).toEqual([]);
  });
});

describe('saved arrangements', () => {
  const placed = (id: string) =>
    flattenTree(rendered!.handle.tree.get()).find((node) => hostID(node) === id);

  it('restores every saved pose and size over planes that are already pinned', async () => {
    addPane('/fixtures/two', 'folder', true);
    const { controller } = await workspace();
    const [first, second] = activeWorkspace().panes.map((pane) => pane.id);
    const saved = controller.captureLayout();
    // A size preset pins the plane at a new pose; so does a drag or an earlier restore.
    await act(async () =>
      controller.layoutPlane({ workspaceID: activeWorkspace().id, paneID: first! }, { x: 1 }),
    );
    expect(placed(first!)?.manuallyPositioned).toBe(true);
    await act(async () => controller.restoreLayout(saved));
    for (const placement of saved.placements)
      expect(placed(placement.id)).toMatchObject({
        location: placement.location,
        width: placement.width,
        height: placement.height,
      });
    // A second restore starts from planes the first one pinned.
    await act(async () =>
      controller.layoutPlane({ workspaceID: activeWorkspace().id, paneID: second! }, { x: 0 }),
    );
    await act(async () => controller.restoreLayout(saved));
    expect(placed(second!)?.location).toEqual(
      saved.placements.find((placement) => placement.id === second)?.location,
    );
  });

  it('closes planes outside the arrangement and brings them back with arrangement Undo', async () => {
    const { controller } = await workspace();
    const saved = controller.captureLayout();
    await act(async () => controller.splitFolder(target(), 'x'));
    const [first, copy] = activeWorkspace().panes.map((pane) => pane.id);
    await act(async () => controller.restoreLayout(saved));
    expect(activeWorkspace().panes.map((pane) => pane.id)).toEqual([first]);
    expect(activeWorkspace().roots).toEqual([first]);
    expect(placed(copy!)).toBeUndefined();
    await act(async () => controller.undo());
    expect(activeWorkspace().panes.map((pane) => pane.id)).toEqual([first, copy]);
    expect(activeWorkspace().roots).toEqual([first, copy]);
    expect(placed(copy!)).toBeDefined();
  });
});

const planes = [{ route: '/folders/:id', component: () => createElement('div', null, 'folder') }];
const configuration = configurationWith({ elements: { plane: { width: 800, height: 480 } } });
let rendered: RenderedPlurid | undefined;
let clock: ReturnType<typeof installFrameClock> | undefined;
const save = vi.fn();
const origin = { translateX: 100, translateY: -40, translateZ: 300, rotateX: 20, rotateY: 90.1 };

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
const routes = () => activeWorkspace().roots.map((id) => paneRoute('folder', id));
const target = () => {
  const folder = activeWorkspace().panes[0]!;
  return { workspaceID: activeWorkspace().id, paneID: folder.id, path: folder.path };
};
async function workspace(planeConfiguration = configuration) {
  rendered = await renderPlurid({
    id: 'folder-pair',
    planes,
    configuration: planeConfiguration,
    view: routes(),
    useLocalStorage: true,
    storageAdapter: storageAdapter(activeWorkspace().id),
  });
  const element = rendered.container as HTMLDivElement;
  Object.defineProperties(element, {
    clientWidth: { value: 1000, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
  await act(async () =>
    rendered!.api.store.dispatch(
      pluridStateModules.space.actions.setViewSize({ width: 1000, height: 600 }),
    ),
  );
  // jsdom has no layout observer. Supply the sizes that a rendered folder reports
  // before the user can open its menu; retain restored manual sizes verbatim.
  await act(async () =>
    rendered!.api.store.dispatch(
      pluridStateModules.space.actions.setPlaneSizes(
        flattenTree(rendered!.handle.tree.get())
          .filter((node) => !node.width || !node.height)
          .map((node) => ({ planeID: node.planeID, width: 800, height: 480 })),
      ),
    ),
  );
  const engine = { current: rendered.handle };
  const readyRef = { current: true };
  const controller = renderHook(() =>
    useWorkspaceController({ engine, surface: { current: element }, readyRef }),
  ).result.current;
  return { controller, engine, element, readyRef };
}

beforeEach(() => {
  installMatchMedia();
  installPointerEvents();
  vi.stubGlobal('localStorage', memoryStorage());
  Object.defineProperty(window, 'viewer', { configurable: true, value: { save } });
  // This published engine warns for a newly added root before its next render.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
  clearSessions();
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

describe('two-folder geometry', () => {
  it.each(['x', 'y'] as const)(
    'fills equal halves along %s at natural scale, including small windows',
    (axis) => {
      const area = { x: 8, y: 8, width: 584, height: 384 };
      const geometry = folderPairGeometry({ width: 800, height: 500 }, area, origin, axis);
      expect(geometry.width * (axis === 'x' ? 2 : 1) + (axis === 'x' ? 12 : 0)).toBe(area.width);
      expect(geometry.height * (axis === 'y' ? 2 : 1) + (axis === 'y' ? 12 : 0)).toBe(area.height);
      expect(geometry.first).toMatchObject({ rotateX: 0, rotateY: 0, translateZ: 300 });
      expect(geometry.second.translateX - geometry.first.translateX).toBe(
        axis === 'x' ? geometry.width + 12 : 0,
      );
      expect(geometry.second.translateY - geometry.first.translateY).toBe(
        axis === 'y' ? geometry.height + 12 : 0,
      );
      expect(geometry.camera.absolute).toMatchObject({ scale: 1, yaw: 0, pitch: 0, roll: 0 });
    },
  );
  it('uses the full canvas width with spatial aids visible or hidden while docked', async () => {
    const { element } = await workspace();
    const minimap = document.createElement('div');
    minimap.dataset.pluridOverlay = 'minimap';
    vi.spyOn(minimap, 'getBoundingClientRect').mockReturnValue(new DOMRect(804, 16, 180, 120));
    const viewcube = document.createElement('div');
    viewcube.dataset.pluridOverlay = 'viewcube';
    vi.spyOn(viewcube, 'getBoundingClientRect').mockReturnValue(new DOMRect(840, 480, 144, 104));
    const toolbar = element.querySelector<HTMLElement>(
      `[data-plurid-entity="${PLURID_ENTITY_TOOLBAR}"]`,
    )!;
    toolbar.dataset.pluridEntity = PLURID_ENTITY_TOOLBAR;
    Object.defineProperty(toolbar, 'offsetHeight', { value: 75 });
    element.append(minimap, viewcube);
    expect(folderPairArea(element)).toEqual({ x: 8, y: 8, width: 984, height: 509 });
    minimap.style.visibility = 'hidden';
    viewcube.style.visibility = 'hidden';
    expect(folderPairArea(element)).toEqual({ x: 8, y: 8, width: 984, height: 509 });
    expect(() =>
      folderPairGeometry({ width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 }, origin, 'x'),
    ).toThrow('too small');
  });
});

describe('folder pair workspace integration', () => {
  it.each(['x', 'y'] as const)(
    'creates a fresh independent root along %s without changing the source session',
    async (axis) => {
      const folder = activeWorkspace().panes[0] as FolderPane;
      navigate(folder.id, '/fixtures/project');
      updatePane(folder.id, {
        mode: 'gallery',
        sort: 'modified',
        sidebar: { visible: false, width: 170 },
      });
      const session = browseSession(folder.id, '/fixtures/project');
      session.selection = ['/fixtures/project/image.png'];
      session.scroll = { gallery: 240 };
      const settings = structuredClone(getState().settings);
      settings.revision++;
      settings.settings.browsing.newPlaneLocation = 'home';
      receiveSettings(settings);
      const before = structuredClone(activeWorkspace().panes[0]);
      const { controller } = await workspace();
      await act(async () => controller.splitFolder(target(), axis));
      const copy = activeWorkspace().panes[1] as FolderPane;
      expect(activeWorkspace().roots).toEqual([folder.id, copy.id]);
      expect(activeWorkspace().panes[0]).toEqual(before);
      expect(getState().activePane).toBe(folder.id);
      expect(copy).toMatchObject({
        path: '/fixtures/project',
        mode: 'gallery',
        sort: 'modified',
        history: ['/fixtures/project'],
        historyIndex: 0,
        sidebar: { visible: false, width: 170 },
      });
      expect(browseSession(copy.id, copy.path).selection).toEqual([]);
      expect(browseSession(folder.id, '/fixtures/project')).toBe(session);
      expect(session.scroll).toEqual({ gallery: 240 });
      await act(async () => rendered!.rerender({ planes, configuration, view: routes() }));
      const [first, second] = rendered!.handle.tree.get();
      expect(first).toMatchObject({ sizeMode: 'manual', manuallyPositioned: true, show: true });
      expect(second?.width).toBe(first?.width);
      expect(second?.height).toBe(first?.height);
      navigate(copy.id, '/fixtures/elsewhere');
      expect(activeWorkspace().panes[0]!.path).toBe('/fixtures/project');
    },
  );
  it('undoes creation and placement together and redoes the same host/engine copy', async () => {
    const { controller } = await workspace();
    const before = rendered!.handle.tree.get();
    const depth = rendered!.handle.history.get().undoDepth;
    await act(async () => controller.splitFolder(target(), 'x'));
    const copy = activeWorkspace().panes[1]!;
    const paired = rendered!.handle.tree.get();
    expect(rendered!.handle.history.get().undoDepth).toBe(depth + 1);
    await act(async () => controller.undo());
    expect(rendered!.handle.tree.get()).toEqual(before);
    expect(activeWorkspace().panes.map((pane) => pane.id)).not.toContain(copy.id);
    await act(async () => controller.redo());
    expect(rendered!.handle.tree.get()).toEqual(paired);
    expect(activeWorkspace().panes[1]).toEqual(copy);
  });
  it('leaves no host copy or Undo entry if the engine cannot register the new root', async () => {
    const { controller } = await workspace();
    const before = rendered!.handle.tree.get();
    const depth = rendered!.handle.history.get().undoDepth;
    vi.spyOn(rendered!.api.pubsub, 'publish').mockImplementationOnce(() => {});
    await act(async () => {
      expect(() => controller.splitFolder(target(), 'x')).toThrow('could not open');
    });
    expect(activeWorkspace().panes).toHaveLength(1);
    expect(rendered!.handle.tree.get()).toEqual(before);
    expect(rendered!.handle.history.get().undoDepth).toBe(depth);
  });
  it('splits the same pinned source again, keeping the new pair in front and every earlier copy', async () => {
    const { controller } = await workspace();
    await act(async () => {
      controller.splitFolder(target(), 'x');
      controller.splitFolder(target(), 'y');
    });
    await act(async () => rendered!.rerender({ planes, configuration, view: routes() }));
    const [source, earlier, latest] = rendered!.handle.tree.get();
    expect(activeWorkspace().panes).toHaveLength(3);
    expect(source).toMatchObject({ width: 984, height: 286 });
    expect(latest).toMatchObject({ width: 984, height: 286 });
    expect(source!.location.translateZ).toBeGreaterThan(earlier!.location.translateZ);
    expect(latest!.location.translateZ).toBe(source!.location.translateZ);
    expect(latest!.location.translateY - source!.location.translateY).toBe(298);
  });
  it('retains linked parentage and descendants while each invocation adds another root', async () => {
    const { controller } = await workspace();
    const root = activeWorkspace().panes[0]!;
    const child = addPane('/fixtures/child', 'folder', false);
    await act(async () => {
      rendered!.api.pubsub.publish({
        topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
        data: {
          route: paneRoute('folder', child.id),
          parentPlaneID: rendered!.handle.tree.get()[0]!.planeID,
          framing: 'none',
        },
      });
    });
    const childNode = flattenTree(rendered!.handle.tree.get()).find(
      (node) => hostID(node) === child.id,
    )!;
    const grandchild = addPane('/fixtures/grandchild', 'folder', false);
    await act(async () => {
      rendered!.api.pubsub.publish({
        topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
        data: {
          route: paneRoute('folder', grandchild.id),
          parentPlaneID: childNode.planeID,
          framing: 'none',
        },
      });
    });
    await act(async () =>
      controller.splitFolder(
        { workspaceID: activeWorkspace().id, paneID: child.id, path: child.path },
        'x',
      ),
    );
    expect(controller.parentPaneID(child.id)).toBe(root.id);
    expect(controller.parentPaneID(grandchild.id)).toBe(child.id);
    await act(async () => controller.splitFolder(target(), 'y'));
    expect(activeWorkspace().panes).toHaveLength(5);
    expect(activeWorkspace().roots).toHaveLength(3);
    expect(new Set(flattenTree(rendered!.handle.tree.get()).map(hostID)).size).toBe(5);
  });
  it('reveals a docked source and restores the pair through existing workspace storage', async () => {
    const { controller } = await workspace();
    const id = rendered!.handle.tree.get()[0]!.planeID;
    await act(async () => rendered!.handle.camera.dock(id, { animate: false }));
    expect(rendered!.handle.camera.docked()).toBe(id);
    const wrapper = rendered!.container.querySelector('[data-plurid-plane]')!.parentElement!;
    wrapper.scrollTop = 48;
    rendered!.view.scrollTop = 5;
    clock = installFrameClock();
    await act(async () => controller.splitFolder(target(), 'y'));
    for (const plane of rendered!.container.querySelectorAll<HTMLElement>('[data-plurid-plane]')) {
      Object.defineProperties(plane, {
        offsetWidth: { configurable: true, get: () => parseFloat(plane.style.width) },
        offsetHeight: { configurable: true, get: () => parseFloat(plane.style.height) },
      });
    }
    await flushFrames(80);
    expect(wrapper.scrollTop).toBe(0);
    expect(rendered!.view.scrollTop).toBe(0);
    expect({
      docked: rendered!.handle.camera.docked(),
      camera: rendered!.handle.camera.get(),
      view: rendered!.api.inspect().view,
    }).toMatchObject({
      docked: '',
      camera: { scale: 1, yaw: 0, pitch: 0 },
      view: { width: 1000, height: 600 },
    });
    const paired = rendered!.handle.tree.get();
    await flushState();
    expect(stateSchema.safeParse(getState().saved).success).toBe(true);
    await rendered!.unmount();
    rendered = undefined;
    await workspace();
    expect(rendered!.handle.tree.get()).toEqual(paired);
  });
  it.each(['workspace', 'path', 'closed', 'not-ready', 'limit', 'viewport'] as const)(
    'refuses a %s target before creating anything',
    async (condition) => {
      const { controller, readyRef, element } = await workspace();
      const captured = target();
      if (condition === 'workspace') captured.workspaceID = 'stale';
      if (condition === 'path') captured.path = '/stale';
      if (condition === 'closed') captured.paneID = 'closed';
      if (condition === 'not-ready') readyRef.current = false;
      if (condition === 'limit') for (let i = 1; i < 200; i++) addPane('/fixtures', 'folder', true);
      if (condition === 'viewport') Object.defineProperty(element, 'clientWidth', { value: 0 });
      const count = activeWorkspace().panes.length;
      const before = rendered!.handle.tree.get();
      if (condition === 'limit' || condition === 'viewport')
        expect(() => controller.splitFolder(captured, 'x')).toThrow();
      else controller.splitFolder(captured, 'x');
      expect(activeWorkspace().panes).toHaveLength(count);
      expect(rendered!.handle.tree.get()).toBe(before);
    },
  );
});

describe('folder pair commands', () => {
  it('binds the current folder, ranks split aliases, and separates arrangements from view modes', async () => {
    const { controller } = await workspace();
    const split = vi.spyOn(controller, 'splitFolder');
    const folder = activeWorkspace().panes[0] as FolderPane;
    const context: CommandContext = {
      scope: 'folder',
      workspaceID: activeWorkspace().id,
      paneID: folder.id,
      folder,
      path: folder.path,
      selection: [],
      jobs: [],
      clipboard: null,
    };
    const actions = { workspace: controller, ready: true, tool: null } as WindowActions;
    const registry = new CommandRegistry();
    registry.register('window', {
      context: () => context,
      definitions: () => arrangementCommands(windowScopes(actions)),
    });
    const commands = registry
      .list({ paneID: folder.id })
      .filter((command) => command.group === 'View');
    expect(commands.map((command) => command.id)).toEqual(['view-side-by-side', 'view-stacked']);
    expect(rankCommands(commands, 'vertical split', [])[0]?.id).toBe('view-side-by-side');
    expect(rankCommands(commands, 'horizontal split', [])[0]?.id).toBe('view-stacked');
    expect(commands.every((command) => !command.shortcut)).toBe(true);
    const mode = { ...commands[0]!, id: 'view-list', label: 'List' };
    const sections = contextMenuSections([mode, ...commands], [], true);
    expect(sections.map((section) => section.entries.map((entry) => entry.id))).toEqual([
      ['view-list'],
      ['view-side-by-side', 'view-stacked'],
    ]);
    const definitions = arrangementCommands(windowScopes(actions));
    for (const definition of definitions.filter(
      (command) => command.id.startsWith('view-') && command.group === 'View',
    )) {
      expect(definition.when({ ...context, folder: undefined, scope: 'preview' })).toBe(false);
      expect(definition.when({ ...context, scope: 'sidebar' })).toBe(false);
    }
    await act(async () => registry.run(commands[0]!));
    expect(split).toHaveBeenCalledWith(target(), 'x');
  });
});
/**
 * FOLLOWING A LINK ACTIVATES ITS PLANE (2026-10-23): the row's link marker, Go to linked plane and a
 * Markdown link moved the camera to the plane, but the plane clicked from stayed the active one, the
 * one taking the wheel. Plurid's selection, for moving planes, is a different thing and stays.
 */
describe('following a link', () => {
  // Viewer's own wheel mode (`surface-configuration.ts`): the active plane is the wheel's owner
  const clickToScroll = configurationWith({
    elements: { plane: { width: 800, height: 480 } },
    space: { gestures: { wheel: 'click-to-scroll' } },
  });
  const spawnChild = async (path: string) => {
    const child = addPane(path, 'folder', false);
    await act(async () => {
      rendered!.api.pubsub.publish({
        topic: PLURID_PUBSUB_TOPIC.SPACE_SPAWN_PLANE,
        data: {
          route: paneRoute('folder', child.id),
          parentPlaneID: rendered!.handle.tree.get()[0]!.planeID,
          framing: 'none',
        },
      });
    });
    return child;
  };
  const planeID = (id: string) =>
    flattenTree(rendered!.handle.tree.get()).find((node) => hostID(node) === id)!.planeID;
  const scrollOwner = () =>
    (rendered!.api.store.getState() as { ui: { scrollPlaneID: string } }).ui.scrollPlaneID;
  it('makes the plane it shows the active one, where focusing alone does not', async () => {
    const { controller } = await workspace(clickToScroll);
    const root = activeWorkspace().panes[0]!;
    const child = await spawnChild('/fixtures/child');
    await act(async () => {
      rendered!.handle.selection.set([planeID(root.id)]);
      rendered!.api.store.dispatch(
        pluridStateModules.ui.actions.setScrollPlaneID(planeID(root.id)),
      );
    });
    await act(async () => controller.focusPane(child.id));
    expect(scrollOwner()).toBe(planeID(root.id));
    await act(async () => controller.focusPane(child.id, { activate: true }));
    expect(scrollOwner()).toBe(planeID(child.id));
    expect(getState().activePane).toBe(child.id);
    // the selection for moving planes is not the link's to change
    expect(rendered!.handle.selection.get()).toEqual([planeID(root.id)]);
  });
  it('activates a plane it opens, once the plane is there', async () => {
    const { controller } = await workspace(clickToScroll);
    const root = activeWorkspace().panes[0]!;
    const entry = {
      path: '/fixtures/linked',
      name: 'linked',
      parent: '/fixtures',
      extension: '',
      mime: 'inode/directory',
      size: 0,
      kind: 'directory',
      directory: true,
      identity: '1:9',
      modified: 1,
      created: 1,
      hidden: false,
    } as const;
    await act(async () => controller.open(entry, root.id, { activate: true }));
    const opened = activeWorkspace().panes.find((pane) => pane.path === '/fixtures/linked')!;
    await vi.waitFor(() => expect(scrollOwner()).toBe(planeID(opened.id)));
    expect(getState().activePane).toBe(opened.id);
  });
});
