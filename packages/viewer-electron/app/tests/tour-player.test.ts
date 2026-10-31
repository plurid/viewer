// @vitest-environment jsdom
/**
 * PLAYING A TOUR: each stop's file opened at its anchor and brought into view, then held for its
 * dwell. A missing stop shows its card and is skipped; a changed one opens without its anchor and
 * says so. Paused, nothing moves on. The tour only opens files and moves the camera: nothing runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import type { SourceVersion } from '../src/domain/files/inspection';
import type { TourLookup, TourRequest, TourStop } from '../src/domain/tours/tour';
import {
  TourPlayer,
  skipDelay,
  type PlayableTour,
  type TourPorts,
} from '../src/renderer/workspace/tours/player';
import {
  workspaceStage,
  type StageDestination,
  type TourStage,
} from '../src/renderer/workspace/tours/stage';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import {
  activeWorkspace,
  addPane,
  deleteWorkspace,
  getState,
  initialize,
  newWorkspace,
  removePanes,
  setActivePane,
} from '../src/renderer/state/store';
import { playTour, stopTour, tourPlayback } from '../src/renderer/workspace/tour';

const recorded: SourceVersion = { identity: '1:10', modified: 1_761_800_000_000, size: 1000 };
const entry = (path: string, change: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: path.replace(/\/[^/]*$/, ''),
  extension: path.split('.').at(-1)!,
  kind: 'file',
  directory: false,
  size: recorded.size,
  modified: recorded.modified,
  created: 1,
  hidden: false,
  mime: 'application/octet-stream',
  // a copy of the job on another computer: same size and date, new identity
  identity: '7:70',
  ...change,
});
const stop = (id: string, path: string, change: Partial<TourStop> = {}): TourStop => ({
  id,
  caption: `Look at ${path}`,
  source: 'check',
  target: {
    kind: 'file',
    path,
    version: recorded,
    anchor: {
      kind: 'pdf',
      page: 2,
      region: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.3, 0.2],
      ],
    },
    quote: '48',
  },
  ...change,
});
const tour: PlayableTour = {
  name: 'Job',
  root: '/Jobs/Recca',
  dwell: 2000,
  stops: [
    stop('drawing', 'Bracket.pdf'),
    stop('gone', 'Old/Plate.dxf'),
    stop('photo', 'Bracket photo.pdf'),
  ],
};
const files = new Map<string, FileEntry>([
  ['/Jobs/Recca/Bracket.pdf', entry('/Jobs/Recca/Bracket.pdf')],
  // edited after the stop was recorded
  ['/Jobs/Recca/Bracket photo.pdf', entry('/Jobs/Recca/Bracket photo.pdf', { size: 1200 })],
]);
const lookUp = async (root: string, path: string): Promise<TourLookup> => {
  const found = files.get(`${root}/${path}`);
  return found ? { state: 'found', entry: found } : { state: 'missing' };
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  stopTour();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the tour player, with a fake stage', () => {
  const travelled: StageDestination[] = [];
  const stage: TourStage = {
    frames: false,
    travel: async (destination) => {
      travelled.push(destination);
      return 'arrived';
    },
  };
  const opened: { path: string; evidence: unknown }[] = [];
  const ports: TourPorts = {
    lookup: lookUp,
    open: (file, evidence) => {
      opened.push({ path: file.path, evidence });
      return 'pane-' + file.name;
    },
    leave: () => {},
    views: () => [],
    timing: () => ({ dwell: 3000, duration: 600, loop: false }),
    reducedMotion: () => false,
  };
  beforeEach(() => {
    travelled.length = 0;
    opened.length = 0;
  });
  it('opens each ready stop at its anchor, skips a missing one and opens a changed one plainly', async () => {
    const states: string[] = [];
    const player = new TourPlayer(stage, ports, tour, (playback) =>
      states.push(`${playback.index}:${playback.status}`),
    );
    player.play();
    await vi.advanceTimersByTimeAsync(0);
    // bound to the file as it is now, so the preview keeps the anchor for the copied file
    expect(opened).toEqual([
      {
        path: '/Jobs/Recca/Bracket.pdf',
        evidence: {
          path: '/Jobs/Recca/Bracket.pdf',
          version: { identity: '7:70', modified: recorded.modified, size: 1000 },
          anchor: tour.stops[0]!.target.kind === 'file' ? tour.stops[0]!.target.anchor : undefined,
          quote: '48',
        },
      },
    ]);
    expect(travelled).toEqual([{ kind: 'plane', paneID: 'pane-Bracket.pdf', pose: undefined }]);
    expect(player.playback).toMatchObject({ index: 0, status: 'showing', notice: undefined });
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.playback).toMatchObject({
      index: 1,
      status: 'skipping',
      skipped: 1,
      notice: { state: 'missing', text: 'Old/Plate.dxf is not in “Recca”. Skipping this stop.' },
    });
    expect(opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(skipDelay);
    // the key is there and empty: the plane loses an earlier stop's outline
    expect(opened.at(-1)).toEqual({ path: '/Jobs/Recca/Bracket photo.pdf', evidence: undefined });
    expect(player.playback).toMatchObject({
      index: 2,
      status: 'showing',
      notice: {
        state: 'changed',
        text: 'Bracket photo.pdf opens as it is now; this stop pointed at the outline on page 2.',
      },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.playback).toMatchObject({ status: 'ended', skipped: 1 });
    expect(states).toContain('1:skipping');
  });
  it('waits for Next on a stop without a dwell, and steps back and forth', async () => {
    const player = new TourPlayer(
      stage,
      ports,
      { ...tour, dwell: null, stops: [tour.stops[0]!, tour.stops[2]!] },
      () => {},
    );
    player.play();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(player.playback).toMatchObject({ index: 0, status: 'showing' });
    player.next();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.playback.index).toBe(1);
    player.previous();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.playback.index).toBe(0);
    expect(opened.map((item) => item.path)).toEqual([
      '/Jobs/Recca/Bracket.pdf',
      '/Jobs/Recca/Bracket photo.pdf',
      '/Jobs/Recca/Bracket.pdf',
    ]);
  });
  it('looks a skipped stop up again on Resume without counting it twice', async () => {
    const player = new TourPlayer(
      stage,
      ports,
      { ...tour, stops: [tour.stops[0]!, tour.stops[1]!] },
      () => {},
    );
    player.play();
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.playback).toMatchObject({ index: 1, status: 'skipping', skipped: 1 });
    player.pause();
    player.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.playback).toMatchObject({ index: 1, status: 'skipping', skipped: 1 });
    await vi.advanceTimersByTimeAsync(skipDelay);
    expect(player.playback).toMatchObject({ status: 'ended', skipped: 1 });
  });
  it('holds a stop found missing while paused, until Resume', async () => {
    let release!: () => void;
    const player = new TourPlayer(
      stage,
      {
        ...ports,
        lookup: (root, path) =>
          path === 'Old/Plate.dxf'
            ? new Promise<TourLookup>((resolve) => (release = () => resolve({ state: 'missing' })))
            : lookUp(root, path),
      },
      { ...tour, stops: [tour.stops[1]!, tour.stops[0]!] },
      () => {},
    );
    player.play();
    // the reader pauses while the first stop is still being looked up
    player.pause();
    release();
    await vi.advanceTimersByTimeAsync(skipDelay * 3);
    expect(player.playback).toMatchObject({ index: 0, status: 'skipping', paused: true });
    expect(opened).toEqual([]);
    player.resume();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(skipDelay);
    expect(player.playback).toMatchObject({ index: 1, status: 'showing', paused: false });
  });
  it('moves on when the plane showing a stop closes, and skips one closed on the way', async () => {
    const player = new TourPlayer(
      stage,
      ports,
      { ...tour, dwell: null, stops: [tour.stops[0]!, tour.stops[2]!] },
      () => {},
    );
    player.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.shownPane).toBe('pane-Bracket.pdf');
    player.closed('another pane');
    expect(player.playback.notice).toBeUndefined();
    player.closed('pane-Bracket.pdf');
    expect(player.playback).toMatchObject({
      index: 0,
      notice: { state: 'closed', text: 'Bracket.pdf was closed.' },
    });
    await vi.advanceTimersByTimeAsync(skipDelay);
    expect(player.playback).toMatchObject({ index: 1, status: 'showing' });
    // a stage that finds the plane gone at rest skips the stop
    const closing = new TourPlayer(
      { frames: false, travel: async () => 'gone' },
      ports,
      { ...tour, stops: [tour.stops[0]!, tour.stops[2]!] },
      () => {},
    );
    closing.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(closing.playback).toMatchObject({
      status: 'skipping',
      notice: { text: 'Bracket.pdf was closed before it was shown. Skipping this stop.' },
    });
    // one the space never placed, while it stayed open, says so
    const unplaced = new TourPlayer(
      { frames: false, travel: async () => 'unplaced' },
      ports,
      { ...tour, stops: [tour.stops[0]!, tour.stops[2]!] },
      () => {},
    );
    unplaced.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(unplaced.playback).toMatchObject({
      status: 'skipping',
      notice: { text: 'The space did not show Bracket.pdf in time. Skipping this stop.' },
    });
  });
  it('opens nothing for a stop it has left, nor after Stop', async () => {
    let release!: () => void;
    const player = new TourPlayer(
      stage,
      {
        ...ports,
        lookup: (root, path) =>
          new Promise<TourLookup>((resolve) => (release = () => void resolve(lookUp(root, path)))),
      },
      { ...tour, stops: [tour.stops[0]!, tour.stops[2]!] },
      () => {},
    );
    player.play();
    const first = release;
    player.next();
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toEqual([]);
    player.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toEqual([]);
    expect(player.playback.status).toBe('ended');
  });
  it('never opens a tour or project file, and reads a stop’s hash only when it has one', async () => {
    const asked: [string, boolean][] = [];
    const player = new TourPlayer(
      stage,
      {
        ...ports,
        lookup: async (root, path, hash) => {
          asked.push([path, hash]);
          return lookUp(root, path);
        },
      },
      {
        ...tour,
        stops: [
          stop('itself', 'Job.viewer-tour.jsonc'),
          stop('hashed', 'Bracket.pdf', {
            target: {
              kind: 'file',
              path: 'Bracket.pdf',
              version: { ...recorded, sha256: 'a'.repeat(64) },
            },
          }),
        ],
      },
      () => {},
    );
    player.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.playback).toMatchObject({
      status: 'skipping',
      notice: {
        text: 'Job.viewer-tour.jsonc is a tour or project file, which a tour never opens. Skipping this stop.',
      },
    });
    await vi.advanceTimersByTimeAsync(skipDelay);
    expect(asked).toEqual([['Bracket.pdf', true]]);
    expect(opened.map((item) => item.path)).toEqual(['/Jobs/Recca/Bracket.pdf']);
  });
  it('ends with a summary when no stop can be shown', async () => {
    const player = new TourPlayer(
      stage,
      { ...ports, lookup: async () => ({ state: 'missing' }) },
      { ...tour, stops: [tour.stops[1]!] },
      () => {},
    );
    player.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.playback).toMatchObject({ status: 'ended', skipped: 1 });
    expect(travelled).toEqual([]);
  });
});

describe('a tour played in the workspace', () => {
  const stubViewer = (ipc: string[]) =>
    vi.stubGlobal(
      'viewer',
      new Proxy(
        {
          tour: async (request: TourRequest) => {
            if (request.kind !== 'stat') throw new Error(`A tour asked to ${request.kind}.`);
            return lookUp(request.root, request.path);
          },
          save: async () => {},
        },
        {
          get(target, key: string) {
            ipc.push(key);
            if (key !== 'tour' && key !== 'save') throw new Error(`A tour called ${key}.`);
            return target[key as 'tour' | 'save'];
          },
        },
      ),
    );
  const fake = () => {
    const allowed: Partial<WorkspaceController> = {
      open: (file) => {
        const pane = addPane(file.path, 'preview', true);
        setActivePane(pane.id);
      },
      bookmarks: () => [],
      goBookmark: () => false,
      whenAtRest: async () => {},
      isDocked: () => false,
      dock: () => {},
      focusPane: () => {},
    };
    // called on the controller as the session holds it, so its moves are counted too
    allowed.tourStage = function (this: WorkspaceController) {
      return workspaceStage(this, (id) => activeWorkspace().panes.some((pane) => pane.id === id));
    };
    return allowed;
  };
  it('only opens files and moves the camera, through the controller and its stop lookup', async () => {
    initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
    const used: string[] = [];
    // Every other controller method is refused, and every IPC method but the stop lookup and the
    // state save that an opened plane makes: a tour that ran, edited or wrote anything would fail.
    const workspace = new Proxy(fake(), {
      get(target, key: string) {
        used.push(key);
        const value = target[key as keyof WorkspaceController];
        if (!value) throw new Error(`A tour used ${key}.`);
        return value;
      },
    }) as WorkspaceController;
    const ipc: string[] = [];
    stubViewer(ipc);
    playTour(
      workspace,
      { ...tour, stops: [tour.stops[0]!, tour.stops[2]!] },
      {
        dwell: 1000,
        duration: 600,
        loop: false,
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(tourPlayback()).toMatchObject({ index: 0, status: 'showing' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(tourPlayback()).toMatchObject({ index: 1, notice: { state: 'changed' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(tourPlayback()).toMatchObject({ status: 'ended', skipped: 0 });
    expect(new Set(used)).toEqual(new Set(['tourStage', 'open', 'whenAtRest', 'isDocked']));
    expect(ipc).toContain('tour');
    expect(ipc.filter((key) => key !== 'tour' && key !== 'save')).toEqual([]);
  });
  it('stops when its workspace is deleted or replaced, and goes on when its plane closes', async () => {
    initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
    stubViewer([]);
    const timing = { dwell: 60_000, duration: 0, loop: false };
    const workspace = fake() as WorkspaceController;
    playTour(workspace, { ...tour, dwell: null, stops: [tour.stops[0]!, tour.stops[2]!] }, timing);
    await vi.advanceTimersByTimeAsync(0);
    expect(tourPlayback()).toMatchObject({ index: 0, status: 'showing' });
    // the person closes the plane: the bar says so, then the tour goes on
    removePanes([getState().activePane]);
    expect(tourPlayback()?.notice).toEqual({ state: 'closed', text: 'Bracket.pdf was closed.' });
    await vi.advanceTimersByTimeAsync(skipDelay);
    expect(tourPlayback()).toMatchObject({ index: 1, status: 'showing' });
    // deleting the workspace it plays in ends it; no stop opens in the one that replaces it
    await deleteWorkspace(activeWorkspace().id);
    expect(tourPlayback()).toBeNull();
    playTour(workspace, tour, timing);
    await vi.advanceTimersByTimeAsync(0);
    await newWorkspace('Another');
    expect(tourPlayback()).toBeNull();
  });
});
