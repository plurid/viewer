// @vitest-environment jsdom
/**
 * THE TOUR BAR: this stop's caption and where it is, how far along, the finding's grade, what is
 * not as recorded, and Previous, Pause, Next and Stop with their keys.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileEntry } from '../src/domain/contracts';
import type { TourDocument, TourRequest, TourStop } from '../src/domain/tours/tour';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { TourBar } from '../src/renderer/workspace/tours/TourBar';
import { activeWorkspace, addPane, initialize, setActivePane } from '../src/renderer/state/store';
import {
  playableTour,
  playTour,
  rememberTour,
  stopTour,
  tourPlayback,
} from '../src/renderer/workspace/tour';
import { skipDelay } from '../src/renderer/workspace/tours/player';
import { workspaceStage } from '../src/renderer/workspace/tours/stage';
import {
  changeDraft,
  closeDraft,
  editTour,
  tourDraft,
} from '../src/renderer/workspace/tours/recorder';

const version = { identity: '1:10', modified: 1_761_800_000_000, size: 1000 };
const file = (path: string, size = 1000): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: '/Jobs/Recca',
  extension: 'pdf',
  kind: 'file',
  directory: false,
  size,
  modified: version.modified,
  created: 1,
  hidden: false,
  mime: 'application/pdf',
  identity: '1:10',
});
const files = new Map([
  ['/Jobs/Recca/Bracket.pdf', file('/Jobs/Recca/Bracket.pdf')],
  ['/Jobs/Recca/Plate.pdf', file('/Jobs/Recca/Plate.pdf', 2000)],
]);
const stop = (id: string, path: string, change: Partial<TourStop> = {}): TourStop => ({
  id,
  caption: `${id} caption`,
  source: 'check',
  target: { kind: 'file', path, version, anchor: { kind: 'pdf', page: 2 }, quote: '' },
  ...change,
});
const workspace = {
  open: (entry: FileEntry) => setActivePane(addPane(entry.path, 'preview', true).id),
  bookmarks: () => [],
  goBookmark: () => false,
  whenAtRest: async () => {},
  isDocked: () => false,
  dock: () => {},
  focusPane: () => {},
  tourStage: () =>
    workspaceStage(workspace, (id) => activeWorkspace().panes.some((pane) => pane.id === id)),
} as unknown as WorkspaceController;

beforeEach(() => {
  vi.useFakeTimers();
  initialize({ home: '/Jobs', platform: 'darwin', state: null, locations: [], openPaths: [] });
  vi.stubGlobal('viewer', {
    save: async () => {},
    tour: async (request: TourRequest) => {
      if (request.kind !== 'stat') throw new Error('Only lookups are expected.');
      const entry = files.get(`${request.root}/${request.path}`);
      return entry ? { state: 'found', entry } : { state: 'missing' };
    },
  });
});
afterEach(() => {
  stopTour();
  closeDraft();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows the stop, its place and grade, then what changed, then the summary', async () => {
  render(<TourBar />);
  expect(screen.queryByRole('region')).toBeNull();
  act(() =>
    playTour(
      workspace,
      {
        name: 'Job',
        root: '/Jobs/Recca',
        dwell: 1000,
        stops: [
          stop('Hole pitch', 'Bracket.pdf', {
            note: 'Viewer measured 48.00 mm.',
            finding: { id: 'pitch', grade: 'refuted' },
          }),
          stop('Gone', 'Old.pdf'),
          stop('Plate', 'Plate.pdf'),
        ],
      },
      { dwell: 1000, duration: 600, loop: false },
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  const bar = screen.getByRole('region', { name: 'Tour “Job”' });
  expect(bar.textContent).toContain('1 / 3');
  expect(screen.getByText('Hole pitch caption')).toBeTruthy();
  expect(screen.getByText('Viewer measured 48.00 mm.')).toBeTruthy();
  expect(screen.getByText('Refuted').dataset.grade).toBe('refuted');
  expect(screen.getByText('Bracket.pdf · page 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous stop (←)' })).toHaveProperty(
    'disabled',
    true,
  );
  // a click pauses; the bar offers Resume
  fireEvent.click(screen.getByRole('button', { name: 'Pause tour (Space)' }));
  expect(screen.getByRole('button', { name: 'Resume tour (Space)' })).toBeTruthy();
  expect(bar.textContent).toContain('Paused');
  fireEvent.click(screen.getByRole('button', { name: 'Resume tour (Space)' }));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('Old.pdf is not in “Recca”. Skipping this stop.')).toBeTruthy();
  expect(bar.textContent).toContain('Skipped');
  await act(() => vi.advanceTimersByTimeAsync(skipDelay));
  expect(bar.textContent).toContain('3 / 3');
  expect(bar.textContent).toContain('Changed since recorded.');
  expect(bar.textContent).toContain(
    'Changed since recorded. Plate.pdf opens as it is now; this stop pointed at page 2.',
  );
  // the place no longer claims the anchor it opened without
  expect(screen.getByText('Plate.pdf')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'End tour (→)' })).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText('End of “Job”')).toBeTruthy();
  expect(screen.getByText('2 of 3 stops shown · 1 skipped')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play again' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close tour (Esc)' }));
  expect(tourPlayback()).toBeNull();
  expect(screen.queryByRole('region')).toBeNull();
});

it('steps with the arrow keys and stops with Escape, unless a dialog has it', async () => {
  render(<TourBar />);
  act(() =>
    playTour(
      workspace,
      {
        name: 'Job',
        root: '/Jobs/Recca',
        dwell: null,
        stops: [stop('First', 'Bracket.pdf'), stop('Second', 'Bracket.pdf')],
      },
      { dwell: 1000, duration: 600, loop: true },
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('First caption')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('Second caption')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back to the first stop (→)' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('First caption')).toBeTruthy();
  // an open dialog, such as the palette, keeps its Escape
  const dialog = document.body.appendChild(document.createElement('dialog'));
  dialog.setAttribute('open', '');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByText('First caption')).toBeTruthy();
  dialog.remove();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region')).toBeNull();
});

const announcer = () => screen.getByRole('status');
const twoStops = () =>
  act(() =>
    playTour(
      workspace,
      {
        name: 'Job',
        root: '/Jobs/Recca',
        dwell: 1000,
        stops: [stop('First', 'Bracket.pdf'), stop('Gone', 'Old.pdf')],
      },
      { dwell: 1000, duration: 600, loop: false },
    ),
  );

it('reads each stop, a skip and the end aloud from one live region that is always there', async () => {
  render(<TourBar />);
  // there before the tour, so its first stop is read as well
  expect(announcer().textContent).toBe('');
  twoStops();
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(announcer().textContent).toBe('Stop 1 of 2: First caption.');
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(announcer().textContent).toBe(
    'Stop 2 of 2 skipped. Old.pdf is not in “Recca”. Skipping this stop.',
  );
  await act(() => vi.advanceTimersByTimeAsync(skipDelay));
  expect(announcer().textContent).toBe('End of “Job”. 1 of 2 stops shown · 1 skipped.');
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

it('leaves every key but Escape to the window once the tour has ended', async () => {
  render(<TourBar />);
  twoStops();
  await act(() => vi.advanceTimersByTimeAsync(1000 + skipDelay));
  expect(tourPlayback()?.status).toBe('ended');
  for (const key of ['ArrowRight', 'ArrowLeft', ' ']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(tourPlayback()).toBeNull();
});

it('leaves Space to a focused button, and gives focus back when the tour closes', async () => {
  const before = document.body.appendChild(document.createElement('button'));
  before.textContent = 'Where the person was';
  before.focus();
  render(<TourBar />);
  twoStops();
  await act(() => vi.advanceTimersByTimeAsync(0));
  const stopButton = screen.getByRole('button', { name: 'Stop tour (Esc)' });
  stopButton.focus();
  const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  stopButton.dispatchEvent(space);
  expect(space.defaultPrevented).toBe(false);
  expect(tourPlayback()?.paused).toBe(false);
  // elsewhere, Space pauses
  const elsewhere = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  document.body.dispatchEvent(elsewhere);
  expect(elsewhere.defaultPrevented).toBe(true);
  expect(tourPlayback()?.paused).toBe(true);
  fireEvent.click(stopButton);
  expect(document.activeElement).toBe(before);
  before.remove();
});

it('keeps the draft being edited when Edit stops is chosen at the end of playing it', async () => {
  const saved: TourDocument = {
    file: '/Jobs/Recca/Job.viewer-tour.jsonc',
    root: '/Jobs/Recca',
    revision: 'r1',
    definition: { version: 1, name: 'Job', stops: [stop('First', 'Bracket.pdf')] },
  };
  rememberTour(saved);
  editTour(saved);
  changeDraft((draft) => ({
    ...draft,
    stops: draft.stops.map((item) => ({ ...item, caption: 'Edited' })),
  }));
  render(<TourBar />);
  act(() =>
    playTour(
      workspace,
      { ...playableTour(saved), dwell: 500 },
      { dwell: 500, duration: 0, loop: false },
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  fireEvent.click(screen.getByRole('button', { name: 'Edit stops' }));
  expect(tourPlayback()).toBeNull();
  expect(tourDraft()?.stops[0]?.caption).toBe('Edited');
});
