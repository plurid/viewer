/**
 * THE TOUR'S STAGE: what moves the camera to a stop. On Plurid's anchors (0.0.0-43), one anchored
 * move at the stop's pose to the plane open now, never to a plane the tour file names; without
 * them, framing, docking and undocking. Either reports a plane gone, and an abort ends the wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { PluridApplicationHandle } from '@plurid/plurid-react';
import {
  hasAnchorCamera,
  pluridStage,
  stageRestLimit,
  workspaceStage,
  type AnchorCamera,
  type StageWorkspace,
} from '../src/renderer/workspace/tours/stage';
import { whenWorkspaceAtRest } from '../src/renderer/workspace/framing';

const motion = { duration: 600, reduced: false };
const live = () => new AbortController().signal;

function engine(found = true) {
  const rest: { resolve?: (value: boolean) => void } = {};
  const handle = {
    camera: {
      anchor: vi.fn((_anchor: { path: string; pose?: unknown }, _options?: unknown) => ({
        ok: found,
      })),
    },
    bookmarks: { go: vi.fn() },
    whenAtRest: vi.fn(() => new Promise<boolean>((resolve) => (rest.resolve = resolve))),
  } satisfies AnchorCamera;
  return { handle, rest };
}

describe('the stage on Plurid’s anchors', () => {
  it('is chosen only for an engine with anchors and rest', () => {
    expect(hasAnchorCamera(engine().handle)).toBe(true);
    // the installed engine's handle is one, so a change to it fails the type check, not a tour
    const installed: (handle: PluridApplicationHandle) => AnchorCamera = (handle) => handle;
    expect(installed).toBeTypeOf('function');
    // an engine without them, as 0.0.0-42 was
    expect(hasAnchorCamera({ camera: { dock: () => {} }, bookmarks: { go: () => {} } })).toBe(
      false,
    );
    expect(hasAnchorCamera(null)).toBe(false);
  });
  it('moves to the plane open now at the stop’s pose alone, then waits for rest', async () => {
    const { handle, rest } = engine();
    const stage = pluridStage(handle, (id) =>
      id === 'pane-1' ? 'plurid://viewer/previews/pane-1' : undefined,
    );
    expect(stage.frames).toBe(true);
    const travel = stage.travel({ kind: 'plane', paneID: 'pane-1', pose: 'dock' }, motion, live());
    expect(handle.camera.anchor).toHaveBeenCalledExactlyOnceWith(
      { path: 'plurid://viewer/previews/pane-1', pose: 'dock' },
      { animate: true, duration: 600 },
    );
    rest.resolve!(true);
    expect(await travel).toBe(true);
    // a stop without a pose is framed, as the engine frames by default
    void stage.travel({ kind: 'plane', paneID: 'pane-1' }, { ...motion, reduced: true }, live());
    expect(handle.camera.anchor).toHaveBeenLastCalledWith(
      { path: 'plurid://viewer/previews/pane-1', pose: 'frame' },
      { animate: false, duration: 0 },
    );
  });
  it('never sends a saved plane path or occurrence', async () => {
    const { handle, rest } = engine();
    const stage = pluridStage(handle, () => '/previews/now');
    // a destination carrying more than its pose, as an old file might
    const destination = {
      kind: 'plane' as const,
      paneID: 'pane-1',
      pose: 'frame' as const,
      path: '/previews/recorded-elsewhere',
      occurrence: 3,
    };
    const travel = stage.travel(destination, motion, live());
    rest.resolve!(true);
    await travel;
    expect(handle.camera.anchor.mock.calls[0]![0]).toEqual({
      path: '/previews/now',
      pose: 'frame',
    });
  });
  it('reports a closed or hidden plane, and an abort, without waiting', async () => {
    const closed = engine();
    expect(
      await pluridStage(closed.handle, () => undefined).travel(
        { kind: 'plane', paneID: 'gone' },
        motion,
        live(),
      ),
    ).toBe(false);
    expect(closed.handle.camera.anchor).not.toHaveBeenCalled();
    const hidden = engine(false);
    expect(
      await pluridStage(hidden.handle, () => '/previews/x').travel(
        { kind: 'plane', paneID: 'x' },
        motion,
        live(),
      ),
    ).toBe(false);
    expect(hidden.handle.whenAtRest).not.toHaveBeenCalled();
    // aborted while the camera flies: the travel ends at once, the rest it waited for is dropped
    const flying = engine();
    const abort = new AbortController();
    const travel = pluridStage(flying.handle, () => '/previews/x').travel(
      { kind: 'plane', paneID: 'x' },
      motion,
      abort.signal,
    );
    abort.abort();
    expect(await travel).toBe(false);
    // the plane closed while the camera flew
    let open = true;
    const late = engine();
    const closing = pluridStage(late.handle, () => (open ? '/previews/x' : undefined)).travel(
      { kind: 'plane', paneID: 'x' },
      motion,
      live(),
    );
    open = false;
    late.rest.resolve!(true);
    expect(await closing).toBe(false);
  });
  it('flies to a saved view and waits for rest', async () => {
    const { handle, rest } = engine();
    const travel = pluridStage(handle, () => undefined).travel(
      { kind: 'view', bookmark: 'Overview' },
      motion,
      live(),
    );
    expect(handle.bookmarks.go).toHaveBeenCalledWith('Overview', { animate: true, duration: 600 });
    expect(handle.whenAtRest).toHaveBeenCalledWith({ timeout: stageRestLimit });
    rest.resolve!(false);
    expect(await travel).toBe(true);
  });
});

describe('the stage without anchors', () => {
  function workspace(docked: boolean) {
    const state = { docked };
    const calls: string[] = [];
    const stage: StageWorkspace = {
      goBookmark: vi.fn(() => true),
      whenAtRest: vi.fn(async () => {}),
      isDocked: () => state.docked,
      dock: vi.fn((id?: string) => {
        calls.push(`dock ${id}`);
        state.docked = !state.docked;
      }),
      focusPane: vi.fn((id: string) => void calls.push(`frame ${id}`)),
    };
    return { stage, calls };
  }
  it('docks a dock stop, and brings a frame stop out of a docked page', async () => {
    const docked = workspace(true);
    const stage = workspaceStage(docked.stage, () => true);
    expect(stage.frames).toBe(false);
    expect(await stage.travel({ kind: 'plane', paneID: 'p', pose: 'frame' }, motion, live())).toBe(
      true,
    );
    expect(docked.calls).toEqual(['dock p', 'frame p']);
    const framed = workspace(false);
    await workspaceStage(framed.stage, () => true).travel(
      { kind: 'plane', paneID: 'p', pose: 'dock' },
      motion,
      live(),
    );
    expect(framed.calls).toEqual(['dock p']);
    // already as it asks, or no pose: nothing moves but the opening's own framing
    const still = workspace(true);
    await workspaceStage(still.stage, () => true).travel(
      { kind: 'plane', paneID: 'p', pose: 'dock' },
      motion,
      live(),
    );
    await workspaceStage(still.stage, () => true).travel(
      { kind: 'plane', paneID: 'p' },
      motion,
      live(),
    );
    expect(still.calls).toEqual([]);
  });
  it('reports a plane closed before the camera came to rest', async () => {
    const { stage } = workspace(false);
    expect(
      await workspaceStage(stage, () => false).travel(
        { kind: 'plane', paneID: 'p' },
        motion,
        live(),
      ),
    ).toBe(false);
  });
  it('ends a saved view’s flight at rest, when the engine never says it settled', async () => {
    const { stage } = workspace(false);
    // `onSettle` is never called: the flight was cut short
    expect(
      await workspaceStage(stage, () => true).travel(
        { kind: 'view', bookmark: '1' },
        motion,
        live(),
      ),
    ).toBe(true);
    expect(stage.goBookmark).toHaveBeenCalledWith('1', expect.objectContaining({ duration: 600 }));
    const missing = workspace(false);
    vi.mocked(missing.stage.goBookmark).mockReturnValue(false);
    expect(
      await workspaceStage(missing.stage, () => true).travel(
        { kind: 'view', bookmark: '9' },
        motion,
        live(),
      ),
    ).toBe(false);
  });
});

describe('waiting for the camera to rest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // a hidden window draws no frames
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const moving = {
    current: { camera: { motion: () => 'tween' } },
  } as unknown as RefObject<PluridApplicationHandle | null>;
  it('gives up after its limit even when no frame is drawn', async () => {
    let done = false;
    void whenWorkspaceAtRest(moving, undefined, 1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
  it('ends at once when aborted', async () => {
    const abort = new AbortController();
    let done = false;
    void whenWorkspaceAtRest(moving, abort.signal).then(() => (done = true));
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});
