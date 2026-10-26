// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import MediaPreview from '../src/renderer/previews/modules/MediaPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
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
  const view = render(<MediaPreview {...context} />);
  fireEvent.error(view.container.querySelector('video')!);
  await screen.findByText('Compatibility copy · up to 720p');
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
  await screen.findByText('Preparing a compatible video copy…');
  fireEvent.click(screen.getByText('Cancel'));
  await screen.findByText('Video conversion cancelled.');
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
  expect(screen.queryByText('No video picture is available. Audio can still play.')).toBeNull();
  Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
  fireEvent.canPlay(video);
  const audio = result.container.querySelector('audio');
  expect(audio).toBeTruthy();
  fireEvent.loadedData(audio!);
  expect(screen.getByText('No video picture is available. Audio can still play.')).toBeTruthy();
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
  await screen.findByText('No video picture is available. Audio can still play.');
  expect(result.container.querySelector('audio')).toBeTruthy();
  expect(result.container.querySelector('.media-loading')).toBeNull();
});
