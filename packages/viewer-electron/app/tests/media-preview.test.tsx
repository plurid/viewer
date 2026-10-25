// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MediaPreview from '../src/renderer/previews/modules/MediaPreview';
import type { PreviewContext } from '../src/renderer/previews/contracts';
vi.mock('../src/renderer/ui/navigation/NativeOpenActions', () => ({
  NativeOpenActions: () => null,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
