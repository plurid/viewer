// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import MediaPreview from '../src/renderer/previews/modules/MediaPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { PreviewFrameFixture } from './support/preview-frame';
vi.mock('../src/renderer/ui/navigation/NativeOpenActions', () => ({
  NativeOpenActions: () => null,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function compatibleContext(read: PreviewContext['services']['videoRendition']) {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  return {
    resource: {
      id: 'source',
      url: 'viewer-resource://source/movie.ogv',
      entry: { name: 'movie.ogv', path: '/fixture/movie.ogv', mime: 'video/ogg' },
    },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: {
      videoRendition: read,
      cancelDocument: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
  } as unknown as PreviewContext;
}
it('automatically obtains a labelled compatible copy after a video decoder failure', async () => {
  const rendition = {
    id: 'copy',
    url: 'viewer-resource://copy/movie.mp4',
    entry: { name: 'movie.mp4', mime: 'video/mp4' },
  } as PreviewContext['resource'];
  const read = vi.fn(async () => rendition),
    context = compatibleContext(read);
  // the label is a fact of the footer's (the Preview Bar Rule)
  const view = render(
    <PreviewFrameFixture>
      <MediaPreview {...context} />
    </PreviewFrameFixture>,
  );
  fireEvent.error(view.container.querySelector('video')!);
  await screen.findByText('Playing a 720p copy');
  expect(read).toHaveBeenCalledWith('source', expect.any(String));
  expect(view.container.querySelector('video')?.getAttribute('src')).toBe(rendition.url);
  view.unmount();
  expect(context.services.release).toHaveBeenCalledWith('copy');
});
it('cancels conversion and releases late bytes without displaying a cancelled copy', async () => {
  let finish!: (resource: PreviewContext['resource']) => void;
  const read = vi.fn(
      () =>
        new Promise<PreviewContext['resource']>((resolve) => {
          finish = resolve;
        }),
    ),
    context = compatibleContext(read);
  const view = render(<MediaPreview {...context} />);
  fireEvent.error(view.container.querySelector('video')!);
  await screen.findByText('Converting video to play here…');
  fireEvent.click(screen.getByText('Cancel'));
  await screen.findByText('Video conversion canceled');
  await act(async () =>
    finish({
      id: 'late',
      url: 'viewer-resource://late/movie.mp4',
      entry: {},
    } as PreviewContext['resource']),
  );
  await waitFor(() => expect(context.services.release).toHaveBeenCalledWith('late'));
  expect(context.services.cancelDocument).toHaveBeenCalledWith('source', expect.any(String));
  expect(view.container.querySelector('video')).toBeNull();
});
it('labels audio-only decode of a video container instead of implying a working video picture', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const context = {
    resource: {
      id: 'video',
      url: 'viewer-resource://fixture/video.ogv',
      entry: { name: 'video.ogv', path: '/fixture/video.ogv', mime: 'video/ogg' },
    },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: {},
  } as unknown as PreviewContext;
  const result = render(<MediaPreview {...context} />),
    video = result.container.querySelector('video')!;
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
  fireEvent.loadedData(video);
  expect(screen.queryByText("Viewer can't show this video's picture. Its sound plays.")).toBeNull();
  Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
  fireEvent.canPlay(video);
  const audio = result.container.querySelector('audio');
  expect(audio).toBeTruthy();
  fireEvent.loadedData(audio!);
  expect(screen.getByText("Viewer can't show this video's picture. Its sound plays.")).toBeTruthy();
});
it('synchronizes native decoded state when a partial video never emits a ready event', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
  const context = {
    resource: {
      id: 'cached',
      url: 'viewer-resource://fixture/partial.ogv',
      entry: { name: 'partial.ogv', path: '/fixture/partial.ogv', mime: 'video/ogg' },
    },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: {},
  } as unknown as PreviewContext;
  const result = render(<MediaPreview {...context} />);
  await screen.findByText("Viewer can't show this video's picture. Its sound plays.");
  expect(result.container.querySelector('audio')).toBeTruthy();
  expect(result.container.querySelector('.media-loading')).toBeNull();
});
it('shows Edit Media only for regular files in supported editable media formats', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const mount = (overrides: Record<string, unknown>) =>
    render(
      <MediaPreview
        {...({
          resource: {
            id: 'media',
            url: 'viewer-resource://fixture/clip',
            entry: {
              name: 'clip.mp4',
              path: '/fixture/clip.mp4',
              extension: 'mp4',
              kind: 'file',
              mime: 'video/mp4',
              ...overrides,
            },
          },
          active: true,
          interactive: true,
          signal: new AbortController().signal,
          look: 'dark',
          editMedia: vi.fn(),
          services: {},
        } as unknown as PreviewContext)}
      />,
    );
  mount({});
  expect(screen.getByRole('button', { name: 'Edit Media…' })).toBeTruthy();
  cleanup();
  for (const ineligible of [
    { kind: 'symlink', name: 'link.mp4', extension: 'mp4', mime: 'video/mp4' },
    { kind: 'file', name: 'clip.wmv', extension: 'wmv', mime: 'video/x-ms-wmv' },
    { kind: 'file', name: 'book.m4b', extension: 'm4b', mime: 'audio/mp4' },
  ]) {
    mount(ineligible);
    expect(screen.queryByRole('button', { name: 'Edit Media…' })).toBeNull();
    cleanup();
  }
});
it('uses audio wording and compatible copy label for converted audio files', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  let finish!: (resource: PreviewContext['resource']) => void;
  const read = vi.fn(
    () =>
      new Promise<PreviewContext['resource']>((resolve) => {
        finish = resolve;
      }),
  );
  const context = {
    resource: {
      id: 'audio-src',
      url: 'viewer-resource://audio-src/voice.wma',
      entry: {
        name: 'voice.wma',
        path: '/fixture/voice.wma',
        extension: 'wma',
        mime: 'audio/x-ms-wma',
      },
    },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services: {
      videoRendition: read,
      cancelDocument: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
  } as unknown as PreviewContext;
  const view = render(
    <PreviewFrameFixture>
      <MediaPreview {...context} />
    </PreviewFrameFixture>,
  );
  fireEvent.error(view.container.querySelector('audio')!);
  await screen.findByText('Converting audio to play here…');
  await act(async () =>
    finish({
      id: 'audio-copy',
      url: 'viewer-resource://audio-copy/voice.m4a',
      entry: { name: 'voice.m4a', extension: 'm4a', mime: 'audio/mp4' },
    } as PreviewContext['resource']),
  );
  await screen.findByText('Playing a compatible copy');
  expect(screen.queryByText('Playing a 720p copy')).toBeNull();
  view.unmount();

  const failing = render(
    <MediaPreview
      {...({
        ...context,
        services: {
          ...context.services,
          videoRendition: vi.fn(async () => {
            throw new Error('Could not convert');
          }),
        },
      } as unknown as PreviewContext)}
    />,
  );
  fireEvent.error(failing.container.querySelector('audio')!);
  await screen.findByText("Can't convert this audio to play here");
  failing.unmount();

  const canceling = render(
    <MediaPreview
      {...({
        ...context,
        services: {
          ...context.services,
          videoRendition: vi.fn(() => new Promise(() => {})),
        },
      } as unknown as PreviewContext)}
    />,
  );
  fireEvent.error(canceling.container.querySelector('audio')!);
  await screen.findByText('Converting audio to play here…');
  fireEvent.click(screen.getByText('Cancel'));
  await screen.findByText('Audio conversion canceled');
  cleanup();

  const wavpack = {
    ...context,
    resource: {
      ...context.resource,
      id: 'res-wv',
      url: 'viewer-resource://res-wv/asset/track.wv',
      entry: {
        ...context.resource.entry,
        path: '/fixtures/track.wv',
        name: 'track.wv',
        extension: 'wv',
        mime: 'application/octet-stream',
      },
    },
    services: {
      ...context.services,
      videoRendition: vi.fn(() => new Promise(() => {})),
    },
  } as unknown as PreviewContext;
  const wvView = render(<MediaPreview {...wavpack} />);
  fireEvent.error(wvView.container.querySelector('audio')!);
  await screen.findByText('Converting audio to play here…');
});
