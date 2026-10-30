// @vitest-environment jsdom
/**
 * A TOUR THROUGH THE REAL CONTROLLER: a stop's evidence replaces the last one even when it has
 * none, the stop it leaves loses its mark, a tour or project file never opens, and on Plurid's
 * anchors a stop's plane opens without framing, so nothing races the stage's one anchored move.
 */
import type * as FramingModule from '../src/renderer/workspace/framing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import type { TreePlane } from '@plurid/plurid-data';
import type { FileEntry, Pane } from '../src/domain/contracts';
import type { EvidenceNavigation } from '../src/domain/files/inspection';
import type { TourRequest, TourStop } from '../src/domain/tours/tour';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { useWorkspaceController } from '../src/renderer/workspace/controller';
import { frameWorkspace } from '../src/renderer/workspace/framing';
import { playTour, stopTour, tourPlayback } from '../src/renderer/workspace/tour';

vi.mock('../src/renderer/workspace/framing', async (original) => ({
  ...(await original<typeof FramingModule>()),
  frameWorkspace: vi.fn(),
}));

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
  mime: 'application/octet-stream',
});
const evidence = (path: string): EvidenceNavigation => ({
  path,
  version,
  anchor: { kind: 'dxf', entities: ['3'] },
  quote: '',
});
const requests: TourRequest[] = [];
const ipc: string[] = [];

beforeEach(() => {
  requests.length = 0;
  ipc.length = 0;
  vi.mocked(frameWorkspace).mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal(
    'viewer',
    new Proxy(
      {
        save: async () => {},
        tour: async (request: TourRequest) => {
          requests.push(request);
          if (request.kind !== 'stat') throw new Error(`A tour asked to ${request.kind}.`);
          return { state: 'found', entry: file(`${request.root}/${request.path}`) };
        },
      },
      {
        get(target, key: string) {
          ipc.push(key);
          return target[key as 'save' | 'tour'];
        },
      },
    ),
  );
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  stopTour();
  cleanup();
  await flushState(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The real controller over an engine whose tree is the workspace's planes, with or without anchors. */
function mount(options: { anchors?: boolean; hidden?: string[] } = {}) {
  const node = (pane: Pane): TreePlane =>
    ({
      planeID: `engine-${pane.id}`,
      route: `plurid://viewer/previews/${pane.id}`,
      show: !options.hidden?.includes(pane.path),
      children: [],
      routeDivisions: { plane: { parameters: { id: pane.id } }, path: { parameters: {} } },
    }) as unknown as TreePlane;
  const open = vi.fn();
  const anchor = vi.fn(() => ({ ok: true }));
  const handle = {
    tree: { get: () => activeWorkspace().panes.map(node), open, spawn: vi.fn() },
    camera: {
      docked: () => '',
      dock: vi.fn(),
      motion: () => 'idle',
      ...(options.anchors ? { anchor } : {}),
    },
    bookmarks: { get: () => [], go: vi.fn() },
    store: { dispatch: vi.fn(), subscribe: () => () => {} },
    history: { transaction: (work: () => void) => work() },
    ...(options.anchors ? { whenAtRest: vi.fn(async () => true) } : {}),
  };
  const engine = { current: handle as unknown as PluridApplicationHandle };
  const surface = { current: document.createElement('div') };
  const controller = renderHook(() =>
    useWorkspaceController({ engine, surface, readyRef: { current: true } }),
  ).result.current;
  return { controller, open, anchor };
}
const paneAt = (path: string) => {
  const pane = activeWorkspace().panes.find((item) => item.path === path);
  return pane?.type === 'preview' ? pane : undefined;
};
const stop = (id: string, path: string, anchored = true): TourStop => ({
  id,
  caption: id,
  source: 'recorded',
  target: {
    kind: 'file',
    path,
    version,
    ...(anchored ? { anchor: { kind: 'dxf' as const, entities: ['3'] } } : {}),
  },
});
const timing = { dwell: 1000, duration: 0, loop: false };
/** Lets the lookups, the camera's rest and `ms` of the tour's time pass. */
const settle = (ms = 200) => vi.advanceTimersByTimeAsync(ms);

describe('opening a stop’s file', () => {
  it('replaces the evidence whenever the key is given, even with none', () => {
    const { controller } = mount();
    const path = '/Jobs/Plate.dxf';
    controller.open(file(path), undefined, { evidence: evidence(path) });
    expect(paneAt(path)?.evidence?.anchor).toEqual({ kind: 'dxf', entities: ['3'] });
    // opened again without the key, as a click does: the evidence stays
    controller.open(file(path));
    expect(paneAt(path)?.evidence).toBeDefined();
    // a stop without an anchor, or at a changed file: no highlight from the stop before
    controller.open(file(path), undefined, { evidence: undefined });
    expect(paneAt(path)?.evidence).toBeUndefined();
  });
  it('leaves the camera alone when asked, and shows a closed plane again where it is', () => {
    const { controller, open } = mount({ hidden: ['/Jobs/Hidden.pdf'] });
    controller.open(file('/Jobs/Plate.dxf'), undefined, { frame: false });
    expect(frameWorkspace).not.toHaveBeenCalled();
    expect(getState().activePane).toBe(paneAt('/Jobs/Plate.dxf')?.id);
    controller.open(file('/Jobs/Hidden.pdf'));
    expect(frameWorkspace).toHaveBeenCalledTimes(1);
    controller.open(file('/Jobs/Hidden.pdf'), undefined, { frame: false });
    expect(open).toHaveBeenCalledWith(`engine-${paneAt('/Jobs/Hidden.pdf')!.id}`);
    expect(frameWorkspace).toHaveBeenCalledTimes(1);
  });
  it('chooses the stage on the engine’s anchors only when the engine has them', () => {
    expect(mount().controller.tourStage().frames).toBe(false);
    expect(mount({ anchors: true }).controller.tourStage().frames).toBe(true);
  });
});

describe('a tour through the controller', () => {
  it('clears the mark of the stop it leaves, and of one without an anchor in the same file', async () => {
    const { controller } = mount();
    playTour(
      controller,
      {
        name: 'Job',
        root: '/Jobs',
        dwell: 500,
        stops: [
          stop('drawing', 'Plate.dxf'),
          stop('again', 'Plate.dxf', false),
          stop('pdf', 'Sheet.pdf'),
        ],
      },
      timing,
    );
    await settle();
    expect(paneAt('/Jobs/Plate.dxf')?.evidence?.anchor).toEqual({ kind: 'dxf', entities: ['3'] });
    await settle(500);
    expect(tourPlayback()?.index).toBe(1);
    expect(paneAt('/Jobs/Plate.dxf')?.evidence).toBeUndefined();
    // and when the tour moves to another file, the drawing's highlight goes
    stopTour();
    playTour(
      controller,
      {
        name: 'Job',
        root: '/Jobs',
        dwell: 500,
        stops: [stop('drawing', 'Plate.dxf'), stop('pdf', 'Sheet.pdf')],
      },
      timing,
    );
    await settle();
    expect(paneAt('/Jobs/Plate.dxf')?.evidence).toBeDefined();
    await settle(500);
    expect(tourPlayback()?.index).toBe(1);
    expect(paneAt('/Jobs/Plate.dxf')?.evidence).toBeUndefined();
    expect(paneAt('/Jobs/Sheet.pdf')?.evidence).toBeDefined();
  });
  it('never opens a tour or project file, so it neither plays nor installs one', async () => {
    const { controller } = mount();
    playTour(
      controller,
      {
        name: 'Draft',
        root: '/Jobs',
        stops: [
          stop('itself', 'Job.viewer-tour.jsonc', false),
          stop('project', 'viewer.project.jsonc', false),
        ],
      },
      timing,
    );
    await settle(4000);
    expect(tourPlayback()).toMatchObject({ status: 'ended', skipped: 2 });
    expect(ipc.filter((key) => key !== 'save')).toEqual([]);
    expect(activeWorkspace().panes.some((pane) => pane.path.endsWith('.jsonc'))).toBe(false);
  });
  it('on Plurid’s anchors, opens without framing and moves once to the plane at its pose', async () => {
    const { controller, anchor } = mount({ anchors: true });
    playTour(
      controller,
      {
        name: 'Job',
        root: '/Jobs',
        stops: [
          {
            ...stop('drawing', 'Plate.dxf'),
            view: { path: '/previews/old', occurrence: 2, pose: 'dock' },
          },
        ],
      },
      timing,
    );
    await settle();
    expect(tourPlayback()).toMatchObject({ index: 0, status: 'showing' });
    expect(frameWorkspace).not.toHaveBeenCalled();
    expect(anchor).toHaveBeenCalledExactlyOnceWith(
      { path: `plurid://viewer/previews/${paneAt('/Jobs/Plate.dxf')!.id}`, pose: 'dock' },
      { animate: true, duration: 0 },
    );
    expect(requests).toEqual([{ kind: 'stat', root: '/Jobs', path: 'Plate.dxf', hash: false }]);
  });
});
