// @vitest-environment jsdom
/**
 * THE SPACE'S VIEWS AND TOUR: ⌃⌥⌘1–9 saves the camera as view 1–9 and ⌥⌘1–9 flies back;
 * views can be named; Tour flies through them in turn, Escape stops it and a click pauses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { windowCommands } from '../src/renderer/commands/window';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { defaultShortcuts } from '../src/domain/preferences/shortcuts';
import { initialize } from '../src/renderer/state/store';
import { startTour, stopTour, tourActive, tourPlayback } from '../src/renderer/workspace/tour';
import { workspaceStage } from '../src/renderer/workspace/tours/stage';

let views: { name: string; label: string }[] = [];
const flights: string[] = [];
let settle: (() => void) | undefined;
const controller = {
  parentPaneID: () => undefined,
  isDocked: () => false,
  arrangementHistory: () => ({ canUndo: false, canRedo: false }),
  hasRepeatedPreviews: () => false,
  bookmarks: () => views,
  saveBookmark: vi.fn((name: string) => {
    views = [...views.filter((view) => view.name !== name), { name, label: name }];
  }),
  goBookmark: vi.fn((name: string, options?: { onSettle?: () => void }) => {
    if (!views.some((view) => view.name === name)) return false;
    flights.push(name);
    settle = options?.onSettle;
    return true;
  }),
  // the camera comes to rest only when a flight settles here: an abort ends the wait
  whenAtRest: (signal?: AbortSignal) =>
    new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve())),
  tourStage: () => workspaceStage(actions.workspace as WorkspaceController, () => true),
} as Record<string, unknown>;
const actions = {
  workspace: new Proxy(controller, { get: (target, key: string) => target[key] ?? vi.fn() }),
  ready: true,
  tool: null,
  viewDialog: vi.fn(),
} as unknown as WindowActions;
const context = { scope: 'window', workspaceID: '', selection: [] } as unknown as CommandContext;
const find = (id: string) => windowCommands(actions).find((command) => command.id === id);
beforeEach(() => {
  views = [];
  flights.length = 0;
  vi.useFakeTimers();
  Object.assign(window, { viewer: { save: vi.fn(async () => {}) } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(() => {
  stopTour();
  vi.useRealTimers();
});

describe('views', () => {
  it('saves the camera as a numbered view and flies back to it', async () => {
    expect(defaultShortcuts['bookmark.save.3']).toBe('Ctrl+Cmd+Alt+3');
    expect(defaultShortcuts['bookmark.3']).toBe('Cmd+Alt+3');
    expect(find('bookmark.3')!.when(context)).toBe(false);
    expect(find('bookmark.save.3')!.label).toBe('Save view as 3');
    await find('bookmark.save.3')!.run(context);
    expect(find('bookmark.save.3')!.label).toBe('Replace view 3 with this one');
    expect(find('bookmark.3')!.when(context)).toBe(true);
    await find('bookmark.3')!.run(context);
    expect(flights).toEqual(['3']);
  });
  it('offers each named view, and Views… once there is one', async () => {
    expect(find('bookmark-manage')!.when(context)).toBe(false);
    views = [{ name: 'Overview', label: 'Overview' }];
    expect(find('bookmark:Overview')!.label).toBe('Go to view “Overview”');
    expect(find('bookmark-manage')!.when(context)).toBe(true);
    await find('bookmark-save')!.run(context);
    expect(actions.viewDialog).toHaveBeenCalledWith('save');
  });
});

describe('Tour the views', () => {
  const workspace = actions.workspace as WorkspaceController;
  // the player continues after a view settles in a promise: let it run
  const settled = () => act(async () => settle?.());
  it('flies through the views in turn, waiting at each, and starts again', async () => {
    views = ['1', '2', 'Overview'].map((name) => ({ name, label: name }));
    startTour(workspace, { dwell: 1000, duration: 500, loop: true });
    expect(flights).toEqual(['1']);
    await settled();
    act(() => vi.advanceTimersByTime(999));
    expect(flights).toEqual(['1']);
    act(() => vi.advanceTimersByTime(1));
    expect(flights).toEqual(['1', '2']);
    for (let step = 0; step < 2; step++) {
      await settled();
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(flights).toEqual(['1', '2', 'Overview', '1']);
    expect(tourActive()).toBe(true);
    expect(tourPlayback()).toMatchObject({ index: 0, status: 'travelling' });
    // Escape stops it
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(tourActive()).toBe(false);
    await settled();
    act(() => vi.advanceTimersByTime(5000));
    expect(flights).toHaveLength(4);
  });
  it('pauses for a click in the space, and resumes at the same view', async () => {
    views = ['1', '2'].map((name) => ({ name, label: name }));
    const surface = document.body.appendChild(document.createElement('div'));
    surface.className = 'workspace-surface';
    startTour(workspace, { dwell: 1000, duration: 500, loop: false });
    await settled();
    act(() => vi.advanceTimersByTime(0));
    act(() => surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(tourPlayback()).toMatchObject({ index: 0, paused: true, status: 'showing' });
    act(() => vi.advanceTimersByTime(5000));
    expect(flights).toEqual(['1']);
    // the person moved away: resuming flies back to the view, then waits there again
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
    expect(flights).toEqual(['1', '1']);
    await settled();
    act(() => vi.advanceTimersByTime(1000));
    expect(flights).toEqual(['1', '1', '2']);
    surface.remove();
  });
  it('stops after the last view unless it loops, and needs a view to start', async () => {
    expect(() => startTour(workspace, { dwell: 10, duration: 10, loop: false })).toThrow(
      'Save a view',
    );
    views = [{ name: '1', label: '1' }];
    startTour(workspace, { dwell: 10, duration: 10, loop: false });
    await settled();
    act(() => vi.advanceTimersByTime(10));
    expect(tourActive()).toBe(false);
    expect(tourPlayback()).toMatchObject({ status: 'ended', skipped: 0 });
  });
});
