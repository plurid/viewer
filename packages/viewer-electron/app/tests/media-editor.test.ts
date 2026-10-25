// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { MediaPane, OperationJob, ViewerAPI } from '../src/domain/contracts';
import { mediaTransformSchema } from '../src/domain/operations/transforms';
import type { MediaDraft } from '../src/domain/media/documents';
import { initialize, flushState, receiveJob } from '../src/renderer/state/store';
import { flushMediaDrafts } from '../src/renderer/media/drafts';
import MediaPlaneView from '../src/renderer/media/MediaPlane';
vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openPath: vi.fn() }),
}));
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});
it('mounts with the real store, saves range edits and keeps them when an editor view is culled and restored', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  let draft: MediaDraft = {
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    sources: [
      {
        path: '/fixture/movie.mp4',
        version: { identity: '1:2', modified: 1, size: 3 },
        info: {
          duration: 5,
          extension: 'mp4',
          width: 640,
          height: 360,
          fps: 30,
          video: true,
          audio: false,
        },
      },
    ],
    plan: mediaTransformSchema.parse({
      kind: 'media',
      format: 'mp4',
      segments: [{ source: 0, start: 0, end: 5 }],
    }),
  };
  const media = vi.fn<ViewerAPI['media']>(async (request) => {
    if (request.kind === 'get') return structuredClone(draft);
    if (request.kind === 'update') {
      expect(request.revision).toBe(draft.revision);
      draft = {
        ...draft,
        revision: draft.revision + 1,
        plan: mediaTransformSchema.parse(request.plan),
      };
      return structuredClone(draft);
    }
    if (request.kind === 'frame')
      return {
        id: crypto.randomUUID(),
        url: 'fixture:frame',
        entry: { path: '/fixture/movie.mp4' },
      } as Awaited<ReturnType<ViewerAPI['resource']>>;
    if (request.kind === 'export') return { jobs: ['export-job'] };
  });
  const api = {
    media,
    save: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
    resource: vi.fn(async () => ({
      id: 'resource',
      url: 'fixture:video',
      entry: { path: '/fixture/movie.mp4' },
    })),
    release: vi.fn(async () => {}),
  } as unknown as ViewerAPI;
  Object.assign(window, { viewer: api });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const pane: MediaPane = {
    id: 'editor',
    type: 'media',
    path: '/fixture/movie.mp4',
    draftID: draft.id,
  };
  const first = render(createElement(MediaPlaneView, { pane, active: true }));
  await screen.findByRole('region', { name: 'Media editor' });
  const start = screen.getByLabelText('In');
  fireEvent.change(start, { target: { value: '00:00.750' } });
  fireEvent.blur(start);
  await act(() => flushMediaDrafts());
  expect(draft.plan.segments[0].start).toBe(0.75);
  first.unmount();
  render(createElement(MediaPlaneView, { pane, active: true }));
  expect((await screen.findByLabelText<HTMLInputElement>('In')).value).toBe('00:00.750');
  expect(media.mock.calls.filter(([request]) => request.kind === 'get')).toHaveLength(1);
  await waitFor(() =>
    expect(document.querySelector('video')?.getAttribute('src')).toBe('fixture:video'),
  );
  fireEvent.error(document.querySelector('video')!);
  await screen.findByText('Playback unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry playback' }));
  await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
  expect(api.resource).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: 'Export sequence' }));
  await screen.findByText('Preparing export…');
  const job = {
    id: 'export-job',
    kind: 'convert',
    status: 'running',
    revision: 1,
    sources: ['/fixture/movie.mp4'],
    completed: [],
    errors: [],
    itemsDone: 0,
    itemsTotal: 1,
  } as unknown as OperationJob;
  act(() => receiveJob(job));
  expect(screen.getByText('Exporting · 0 / 1 files')).toBeTruthy();
  act(() =>
    receiveJob({
      ...job,
      revision: 2,
      status: 'completed',
      completed: [
        { source: '/fixture/movie.mp4', destination: '/fixture/movie edited.mp4' },
      ] as OperationJob['completed'],
    }),
  );
  expect(screen.getByText('Exported 1 file · movie edited.mp4')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open movie edited.mp4' })).toBeTruthy();
  act(() => receiveJob({ ...job, revision: 3, status: 'cancelled' }));
  expect(screen.getByText('Export cancelled · 0 files created')).toBeTruthy();
  act(() =>
    receiveJob({
      ...job,
      revision: 4,
      status: 'failed',
      errors: [{ path: '/fixture/movie.mp4', message: 'Processor failed' }],
    }),
  );
  expect(screen.getByText('Export failed · Processor failed')).toBeTruthy();
});
