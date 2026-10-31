// @vitest-environment jsdom
/**
 * A TOUR ON THE REAL ENGINE: Plurid's application (0.0.0-43) mounted as the workspace surface
 * mounts it, its roots from the workspace, and Viewer's controller and player over it. A stop's
 * file opens as a new root, which reaches the engine's tree only once the surface has rendered it.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { createElement, createRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { PluridApplication, type PluridApplicationHandle } from '@plurid/plurid-react';
import {
  configurationWith,
  installMatchMedia,
  installPointerEvents,
} from '@plurid/plurid-react/testing';
import type { FileEntry } from '../src/domain/contracts';
import type { TourRequest, TourStop } from '../src/domain/tours/tour';
import {
  activeWorkspace,
  flushState,
  initialize,
  storageAdapter,
  useViewer,
} from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { playTour, stopTour, subscribeTour, tourPlayback } from '../src/renderer/workspace/tour';
import { flattenTree, hostID, surfaceRoutes } from '../src/renderer/workspace/tree';

const version = { identity: '1:2', modified: 1_761_800_000_000, size: 100 };
const file = (path: string): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: path.replace(/\/[^/]*$/, ''),
  extension: path.split('.').at(-1)!,
  kind: 'file',
  directory: false,
  ...version,
  created: 1,
  hidden: false,
  mime: 'message/rfc822',
});
const stop = (id: string, path: string): TourStop => ({
  id,
  caption: id,
  source: 'model',
  target: { kind: 'file', path, version },
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
/** The workspace surface's engine: its roots follow the workspace, as `WorkspaceSurface` hands them. */
function Surface({ engine }: { engine: RefObject<PluridApplicationHandle | null> }) {
  const space = useViewer(activeWorkspace);
  const routes = surfaceRoutes(space);
  const view = useMemo(() => (routes ? routes.split('\n') : []), [routes]);
  const configuration = useMemo(
    () =>
      configurationWith({
        elements: { plane: { width: 800, height: 480 } },
        space: { navigation: { motion: { duration: 0 } } },
      }),
    [],
  );
  const storage = useMemo(() => storageAdapter(space.id), [space.id]);
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

let unmount: (() => void) | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installMatchMedia();
  installPointerEvents();
  vi.stubGlobal('localStorage', memoryStorage());
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      tour: vi.fn(async (request: TourRequest) => {
        if (request.kind !== 'stat') throw new Error(`A tour asked to ${request.kind}.`);
        return { state: 'found', entry: file(`${request.root}/${request.path}`) };
      }),
    },
  });
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  stopTour();
  act(() => unmount?.());
  unmount = undefined;
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});

it('shows each stop’s plane, opened as a new root, at rest where the engine anchored it', async () => {
  const engine = createRef<PluridApplicationHandle>();
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => root.render(createElement(Surface, { engine })));
  unmount = () => root.unmount();
  const controller = renderHook(() =>
    useWorkspaceController({
      engine,
      surface: { current: container },
      readyRef: { current: true },
    }),
  ).result.current;
  const handle = engine.current!;
  const anchor = vi.spyOn(handle.camera, 'anchor');
  // each stop as it is shown: its plane, the camera, and where the engine's last anchor put it
  const shown: { stop: string; plane?: string; camera: unknown; anchored: unknown }[] = [];
  const notices: string[] = [];
  const release = subscribeTour(() => {
    const playback = tourPlayback();
    if (playback?.notice) notices.push(playback.notice.text);
    if (playback?.status !== 'showing') return;
    const stop = playback.tour.stops[playback.index]!;
    if (stop.target.kind !== 'file' || shown.some((item) => item.stop === stop.id)) return;
    const path = `/Jobs/1042/${stop.target.path}`;
    const pane = activeWorkspace().panes.find((item) => item.path === path);
    const plane = flattenTree(handle.tree.get()).find((node) => hostID(node) === pane?.id);
    shown.push({
      stop: stop.id,
      plane: plane?.planeID,
      camera: handle.camera.get(),
      anchored: anchor.mock.results.at(-1)?.value,
    });
  });

  await act(async () => {
    playTour(
      controller,
      {
        name: 'Job 1042',
        root: '/Jobs/1042',
        stops: [stop('stop-1', 'Job 1042 request.eml'), stop('stop-2', 'Plate.dxf')],
      },
      { dwell: 400, duration: 0, loop: false },
    );
  });
  await vi.waitFor(() => expect(tourPlayback()?.status).toBe('ended'), {
    timeout: 8000,
    interval: 20,
  });
  release();
  expect(notices).toEqual([]);
  expect(shown.map((item) => item.stop)).toEqual(['stop-1', 'stop-2']);
  for (const item of shown)
    expect(item.anchored).toEqual({ ok: true, planeID: item.plane, camera: item.camera });
  expect(shown[0]!.plane).not.toBe(shown[1]!.plane);
});
