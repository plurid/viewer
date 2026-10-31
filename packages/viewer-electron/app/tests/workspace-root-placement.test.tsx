// @vitest-environment jsdom
/**
 * WHERE NEW ROOTS OPEN, on the real engine: Plurid's application (0.0.0-43) mounted as the
 * workspace surface mounts it, its roots from the workspace and `placeRoots` over it. The engine
 * lays roots out by count, so without it each new root moved the earlier ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { createElement, createRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { PluridApplication, pluridStateModules } from '@plurid/plurid-react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { TreePlane, TreePlaneLocation } from '@plurid/plurid-data';
import {
  configurationWith,
  installMatchMedia,
  installPointerEvents,
} from '@plurid/plurid-react/testing';
import type { FileEntry, SavedState } from '../src/domain/contracts';
import {
  activeWorkspace,
  addPane,
  flushState,
  getState,
  initialize,
  setActivePane,
  storageAdapter,
  useViewer,
} from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { besideLocation, placeRoots } from '../src/renderer/workspace/root-placement';
import { flattenTree, hostID, surfaceRoutes } from '../src/renderer/workspace/tree';

const width = 800;
const height = 480;
const gap = 50;
const file = (path: string): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: path.replace(/\/[^/]*$/, ''),
  extension: path.split('.').at(-1)!,
  kind: 'file',
  directory: false,
  identity: '1:2',
  modified: 1_761_800_000_000,
  size: 100,
  created: 1,
  hidden: false,
  mime: 'text/plain',
});
// Node's own `localStorage` hides jsdom's; the engine needs a working one.
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
const Page = () => createElement('div', null, 'plane');
const planes = [
  { route: '/folders/:id', component: Page },
  { route: '/previews/:id', component: Page },
];
/**
 * The workspace surface's engine: its roots follow the workspace and `placeRoots` holds them, as
 * `WorkspaceSurface` does. Without `place`, it is the surface of a Viewer before root placement.
 */
function Surface({
  engine,
  place,
}: {
  engine: RefObject<PluridApplicationHandle | null>;
  place: boolean;
}) {
  const space = useViewer(activeWorkspace);
  const routes = surfaceRoutes(space);
  const view = useMemo(() => (routes ? routes.split('\n') : []), [routes]);
  const configuration = useMemo(
    () =>
      configurationWith({
        elements: { plane: { width, height } },
        space: { navigation: { motion: { duration: 0 } } },
      }),
    [],
  );
  const storage = useMemo(() => storageAdapter(space.id), [space.id]);
  useEffect(() => {
    if (place && engine.current) return placeRoots(engine.current);
  }, [engine, place]);
  return createElement(PluridApplication, {
    ref: engine,
    id: `viewer-${space.id}`,
    planes,
    view,
    configuration,
    useLocalStorage: true,
    storageAdapter: storage,
  });
}

type Controller = ReturnType<typeof useWorkspaceController>;
let unmount: (() => void) | undefined;
async function mount(place = true) {
  const engine = createRef<PluridApplicationHandle>();
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => root.render(createElement(Surface, { engine, place })));
  unmount = () => {
    root.unmount();
    container.remove();
  };
  const controller = renderHook(() =>
    useWorkspaceController({
      engine,
      surface: { current: container },
      readyRef: { current: true },
    }),
  ).result.current;
  return { handle: engine.current!, controller };
}
/** Quits, as far as the arrangement goes: saves it as the engine stores it, then opens it again. */
async function reopen() {
  await act(async () => flushState(true));
  const state: SavedState = structuredClone(getState().saved);
  act(() => unmount?.());
  initialize({ home: '/Jobs', platform: 'darwin', state, locations: [], openPaths: [] });
  const mounted = await mount();
  await settle();
  return mounted;
}
const settle = () => act(async () => {});
const node = (handle: PluridApplicationHandle, id: string) =>
  flattenTree(handle.tree.get()).find((plane) => hostID(plane) === id)!;
/** Each root's place, by its pane. */
const places = (handle: PluridApplicationHandle) =>
  Object.fromEntries(handle.tree.get().map((root) => [hostID(root), { ...root.location }]));
/** The rectangle a face-on plane covers. */
const covers = (plane: TreePlane) => ({
  left: plane.location.translateX,
  right: plane.location.translateX + plane.width,
  top: plane.location.translateY,
  bottom: plane.location.translateY + plane.height,
});
function expectApart(roots: TreePlane[]) {
  for (const [index, a] of roots.entries())
    for (const b of roots.slice(index + 1)) {
      const [one, two] = [covers(a), covers(b)];
      const overlap =
        one.left < two.right &&
        two.left < one.right &&
        one.top < two.bottom &&
        two.top < one.bottom;
      expect(overlap, `${hostID(a)} and ${hostID(b)} overlap`).toBe(false);
    }
}
/** Opens a file as a new root from the active plane, as **Open in another plane** does. */
async function openRoot(controller: Controller, name: string) {
  await act(async () => controller.open(file(`/Jobs/${name}`)));
  await settle();
  return activeWorkspace().roots.at(-1)!;
}
/** Adds roots as a Viewer before root placement did, for the engine to lay out by count. */
async function addRoots(names: string[]) {
  for (const name of names) {
    await act(async () => {
      addPane(`/Jobs/${name}`, 'preview', true);
    });
    await settle();
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installMatchMedia();
  installPointerEvents();
  vi.stubGlobal('localStorage', memoryStorage());
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  act(() => unmount?.());
  unmount = undefined;
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});

describe('a new root', () => {
  it('opens beside the active plane, and the roots before it stay where they were', async () => {
    const { handle, controller } = await mount();
    const folder = activeWorkspace().roots[0]!;
    const opened: string[] = [];
    // a second to a fifth root; the fourth opens from the folder, whose right is taken by then
    for (const name of ['Brief.txt', 'Plate.txt', 'Quote.txt', 'Invoice.txt']) {
      if (name === 'Quote.txt') act(() => setActivePane(folder));
      const before = places(handle);
      const anchor = structuredClone(node(handle, getState().activePane).location);
      const id = await openRoot(controller, name);
      opened.push(id);
      const { [id]: location, ...rest } = places(handle);
      expect(rest).toEqual(before);
      // facing the way the active plane faces, its top level with it, a gap to its right or left
      expect(location!.rotateY).toBe(anchor.rotateY);
      expect(location!.translateY).toBe(anchor.translateY);
      expect(location!.translateZ).toBe(anchor.translateZ);
      expect([anchor.translateX + width + gap, anchor.translateX - width - gap]).toContain(
        location!.translateX,
      );
      expectApart(handle.tree.get());
    }
    expect(opened.map((id) => node(handle, id).location.translateX)).toEqual([
      850, 1700, -850, -1700,
    ]);
  });

  it('faces the way a turned linked plane faces when that plane is the active one', async () => {
    const { handle, controller } = await mount();
    const folder = activeWorkspace().roots[0]!;
    await act(async () => controller.open(file('/Jobs/Notes.txt'), folder));
    await settle();
    const child = structuredClone(node(handle, getState().activePane));
    expect(child.parentPlaneID).toBe(node(handle, folder).planeID);
    expect(child.location.rotateY).not.toBe(0);
    const id = await openRoot(controller, 'Drawing.txt');
    const placed = node(handle, id).location;
    const turn = (child.location.rotateY * Math.PI) / 180;
    const along = (child.width || width) + gap;
    expect(placed.rotateY).toBe(child.location.rotateY);
    expect(placed.translateY).toBe(child.location.translateY);
    expect(placed.translateX).toBeCloseTo(child.location.translateX + Math.cos(turn) * along);
    expect(placed.translateZ).toBeCloseTo(child.location.translateZ - Math.sin(turn) * along);
  });

  it('is one arrangement step, and Undo leaves the other roots where they are', async () => {
    const { handle, controller } = await mount();
    await openRoot(controller, 'Brief.txt');
    const two = places(handle);
    const depth = handle.history.get().undoDepth;
    await openRoot(controller, 'Plate.txt');
    expect(handle.history.get().undoDepth).toBe(depth + 1);
    act(() => controller.undo());
    await settle();
    expect(places(handle)).toEqual(two);
    act(() => controller.redo());
    await settle();
    expect(activeWorkspace().roots).toHaveLength(3);
    expectApart(handle.tree.get());
  });
});

describe('a saved workspace', () => {
  /** Each root's place and size, by its pane. */
  const geometry = (handle: PluridApplicationHandle) =>
    handle.tree.get().map((root) => [hostID(root), root.location, root.width, root.height]);

  it('opens with its roots where they were, at their size', async () => {
    const { handle, controller } = await mount();
    const folder = activeWorkspace().roots[0]!;
    await openRoot(controller, 'Brief.txt');
    // left of the folder, where the engine's layout never puts a root
    act(() => setActivePane(folder));
    await openRoot(controller, 'Plate.txt');
    const before = geometry(handle);
    expect(before.map(([, location]) => (location as TreePlaneLocation).translateX)).toEqual([
      0, 850, -850,
    ]);
    expect(geometry((await reopen()).handle)).toEqual(before);
  });

  it('saved before root placement opens as it was, and its next root moves none', async () => {
    const { handle } = await mount(false);
    await addRoots(['Brief.txt', 'Plate.txt', 'Quote.txt']);
    const before = places(handle);
    // the engine's layout by count: two columns of two, which a fifth root makes columns of three
    expect(Object.values(before).map((at) => [at.translateX, at.translateY])).toEqual([
      [0, 0],
      [0, 530],
      [850, 0],
      [850, 530],
    ]);
    const reopened = await reopen();
    expect(places(reopened.handle)).toEqual(before);
    const id = await openRoot(reopened.controller, 'Invoice.txt');
    const { [id]: placed, ...rest } = places(reopened.handle);
    expect(rest).toEqual(before);
    expect(placed).toBeDefined();
    expectApart(reopened.handle.tree.get());
  });

  it('saved before root placement keeps a root’s linked plane with it', async () => {
    const { handle, controller } = await mount(false);
    await addRoots(['Brief.txt']);
    // the second root, which a third would move under the first, with a plane linked to it
    const brief = activeWorkspace().roots[1]!;
    await act(async () => controller.open(file('/Jobs/Notes.txt'), brief));
    await settle();
    const linked = getState().activePane;
    const spots = (handle: PluridApplicationHandle) =>
      [brief, linked].map((id) => ({ ...node(handle, id).location }));
    const before = spots(handle);
    const reopened = await reopen();
    act(() => setActivePane(activeWorkspace().roots[0]!));
    await openRoot(reopened.controller, 'Plate.txt');
    expect(spots(reopened.handle)).toEqual(before);
  });
});

describe('closing a root', () => {
  /** A window resize: the engine lays its roots out again. */
  const resize = (handle: PluridApplicationHandle) =>
    act(async () => {
      handle.store.dispatch(
        pluridStateModules.space.actions.setViewSize({ width: 1500, height: 900 }),
      );
    });

  it('moves none of the others, then or at the next layout', async () => {
    // five roots laid out by count, in a workspace saved before root placement
    const { handle } = await mount(false);
    await addRoots(['Brief.txt', 'Plate.txt', 'Quote.txt', 'Invoice.txt']);
    const before = places(handle);
    const { controller, handle: reopened } = await reopen();
    expect(places(reopened)).toEqual(before);
    const closing = activeWorkspace().roots[1]!;
    const { [closing]: gone, ...rest } = before;
    expect(gone).toBeDefined();
    act(() => controller.closePane(closing));
    await settle();
    expect(places(reopened)).toEqual(rest);
    await resize(reopened);
    expect(places(reopened)).toEqual(rest);
  });

  it('of roots it placed moves none of the others either', async () => {
    const { handle, controller } = await mount();
    for (const name of ['Brief.txt', 'Plate.txt', 'Quote.txt']) await openRoot(controller, name);
    const closing = activeWorkspace().roots[2]!;
    const { [closing]: gone, ...rest } = places(handle);
    expect(gone).toBeDefined();
    act(() => controller.closePane(closing));
    await settle();
    expect(places(handle)).toEqual(rest);
    await resize(handle);
    expect(places(handle)).toEqual(rest);
  });
});

describe('besideLocation', () => {
  const box = (translateX: number, translateY = 0, rotateY = 0, translateZ = 0) => ({
    location: { translateX, translateY, translateZ, rotateX: 0, rotateY },
    width,
    height,
  });
  const size = { width, height };
  const at = (location: TreePlaneLocation) => [location.translateX, location.translateY];

  it('takes the first side with room: right, left, below, above, then further out', () => {
    const anchor = box(0);
    expect(at(besideLocation(anchor, size, [anchor]))).toEqual([850, 0]);
    expect(at(besideLocation(anchor, size, [anchor, box(850)]))).toEqual([-850, 0]);
    expect(at(besideLocation(anchor, size, [anchor, box(850), box(-850)]))).toEqual([0, 530]);
    const ringed = [anchor, box(850), box(-850), box(0, 530), box(0, -530)];
    expect(at(besideLocation(anchor, size, ringed))).toEqual([1700, 0]);
  });

  it('keeps clear of a plane turned across the place, at any depth', () => {
    const anchor = box(0);
    // a linked plane leaving the anchor's right edge, turned to run back into the space
    const linked = box(900, 0, 90.1, -40);
    expect(at(besideLocation(anchor, size, [anchor, linked]))).toEqual([-850, 0]);
  });

  it('goes past every plane on the right when large planes surround the anchor', () => {
    const anchor = box(0);
    const wall = { ...box(-5000, -5000, 0, -2000), width: 12_000, height: 12_000 };
    expect(at(besideLocation(anchor, size, [anchor, wall]))).toEqual([7050, 0]);
  });
});
