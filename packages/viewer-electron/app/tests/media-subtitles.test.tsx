// @vitest-environment jsdom
/**
 * A video offers the subtitle files beside it that carry its name, each read through its own
 * authorized resource, bounded and converted to a WebVTT track; the choice is remembered.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MediaPreview from '../src/renderer/previews/modules/MediaPreview';
import type { FileEntry, Resource, ResourceRead } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';

vi.mock('../src/renderer/ui/navigation/NativeOpenActions', () => ({
  NativeOpenActions: () => null,
}));
const blobs = new Map<string, Blob>();
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  let count = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:track-${++count}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  blobs.clear();
});

const entry = (name: string, size = 120, mime = 'text/plain'): FileEntry => ({
  path: `/Movies/${name}`,
  name,
  parent: '/Movies',
  extension: name.split('.').pop()!.toLowerCase(),
  mime,
  size,
  kind: 'file',
  directory: false,
  identity: name,
  modified: 0,
  created: 0,
  hidden: false,
});
const srt = '1\n00:00:00,200 --> 00:00:01,000\nShapes in <i>motion</i>.\n';
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:01.900\nA second pass.\n';

function fixture({
  files = [entry('Movie.srt'), entry('Movie.en.vtt'), entry('Movie.txt'), entry('Other.srt')],
  saved = {},
  reads = { 'Movie.srt': srt, 'Movie.en.vtt': vtt } as Record<string, string | ResourceRead>,
  video = entry('Movie.mp4', 1e8, 'video/mp4'),
}: {
  files?: FileEntry[];
  saved?: Record<string, unknown>;
  reads?: Record<string, string | ResourceRead>;
  video?: FileEntry;
} = {}) {
  const values = new Map(Object.entries(saved));
  const services = {
    list: vi.fn(async (folder: string) => ({
      path: folder,
      parent: '/',
      entries: [video, ...files],
    })),
    resource: vi.fn(
      async (path: string) =>
        ({
          id: 'sidecar:' + path.split('/').pop(),
          url: '',
          entry: entry(path.split('/').pop()!),
        }) as Resource,
    ),
    read: vi.fn(async (id: string): Promise<ResourceRead> => {
      const value = reads[id.slice('sidecar:'.length)] ?? '';
      return typeof value === 'string' ? { text: value, truncated: false, binary: false } : value;
    }),
    release: vi.fn(async () => {}),
    videoRendition: vi.fn(),
    cancelDocument: vi.fn(async () => {}),
  };
  const context = {
    resource: { id: 'video', url: 'viewer-resource://video/Movie.mp4', entry: video },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services,
    state: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
  } as unknown as PreviewContext;
  return { context, services, values };
}
const track = (container: HTMLElement) => container.querySelector('video > track');
async function choose(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
  const menu = await screen.findByRole('dialog', { name: 'Subtitles' });
  const row = [...menu.querySelectorAll<HTMLElement>('.command-result')].find(
    (item) => item.textContent === label,
  );
  fireEvent.click(row!);
}

it('attaches the first subtitle file as a WebVTT track and offers the others', async () => {
  const { context, services } = fixture();
  const view = render(<MediaPreview {...context} />);
  await waitFor(() => expect(track(view.container)?.getAttribute('src')).toBe('blob:track-1'));
  expect(services.list).toHaveBeenCalledWith('/Movies');
  expect(services.resource).toHaveBeenCalledWith('/Movies/Movie.srt');
  expect(services.read).toHaveBeenCalledWith('sidecar:Movie.srt', 2 * 1024 * 1024);
  expect(services.release).toHaveBeenCalledWith('sidecar:Movie.srt');
  const element = track(view.container)!;
  expect(element.getAttribute('kind')).toBe('subtitles');
  expect(element.getAttribute('label')).toBe('Movie.srt');
  expect(await blobs.get('blob:track-1')!.text()).toBe(
    'WEBVTT\n\n1\n00:00:00.200 --> 00:00:01.000\nShapes in <i>motion</i>.\n',
  );
  const button = screen.getByRole('button', { name: 'Subtitles' });
  expect(button.textContent).toContain('Movie.srt');
  fireEvent.click(button);
  const menu = await screen.findByRole('dialog', { name: 'Subtitles' });
  expect([...menu.querySelectorAll('.command-result')].map((row) => row.textContent)).toEqual([
    'Subtitles off',
    'Movie.srt',
    'Movie.en.vtt',
  ]);
});

it('remembers turning subtitles off and choosing another file', async () => {
  const { context, values } = fixture();
  const view = render(<MediaPreview {...context} />);
  await waitFor(() => expect(track(view.container)).toBeTruthy());
  await choose('Subtitles off');
  await waitFor(() => expect(track(view.container)).toBeNull());
  expect(values.get('media.subtitles')).toBe('');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:track-1');
  await choose('Movie.en.vtt');
  await waitFor(() => expect(track(view.container)?.getAttribute('srclang')).toBe('en'));
  expect(values.get('media.subtitles')).toBe('Movie.en.vtt');
  expect(await blobs.get(track(view.container)!.getAttribute('src')!)!.text()).toBe(vtt);
  view.unmount();
  // a reopened view keeps the choice
  const again = fixture({ saved: { 'media.subtitles': 'Movie.en.vtt' } });
  const reopened = render(<MediaPreview {...again.context} />);
  await waitFor(() =>
    expect(track(reopened.container)?.getAttribute('label')).toBe('Movie.en.vtt'),
  );
  expect(again.services.resource).not.toHaveBeenCalledWith('/Movies/Movie.srt');
  reopened.unmount();
  const off = fixture({ saved: { 'media.subtitles': '' } });
  const silent = render(<MediaPreview {...off.context} />);
  await screen.findByRole('button', { name: 'Subtitles' });
  expect(track(silent.container)).toBeNull();
  expect(off.services.resource).not.toHaveBeenCalled();
});

it('leaves out oversized files and labels a file past the limit or without cues', async () => {
  const { context, services } = fixture({
    files: [entry('Movie.srt', 3 * 1024 * 1024), entry('Movie.en.srt'), entry('Movie.fr.srt')],
    reads: {
      'Movie.en.srt': { text: srt, truncated: true, binary: false },
      'Movie.fr.srt': 'Bonjour.\n',
    },
  });
  const view = render(<MediaPreview {...context} />);
  await screen.findByText('Movie.en.srt is larger than the 2 MB subtitle limit.');
  expect(track(view.container)).toBeNull();
  expect(services.resource).not.toHaveBeenCalledWith('/Movies/Movie.srt');
  await choose('Movie.fr.srt');
  await screen.findByText('Movie.fr.srt has no timed subtitles.');
  expect(services.release).toHaveBeenCalledWith('sidecar:Movie.en.srt');
  expect(services.release).toHaveBeenCalledWith('sidecar:Movie.fr.srt');
});

it('keeps the track on a compatibility copy', async () => {
  const { context, services } = fixture({ video: entry('Movie.wmv', 1e8, 'video/x-ms-wmv') });
  services.videoRendition.mockResolvedValue({
    id: 'copy',
    url: 'viewer-resource://copy/Movie.wmv.mp4',
    entry: { name: 'Movie.wmv.mp4', mime: 'video/mp4' },
  });
  const view = render(<MediaPreview {...context} />);
  await waitFor(() => expect(track(view.container)).toBeTruthy());
  fireEvent.error(view.container.querySelector('video')!);
  await screen.findByText('Compatibility copy · up to 720p');
  expect(view.container.querySelector('video')?.getAttribute('src')).toBe(
    'viewer-resource://copy/Movie.wmv.mp4',
  );
  expect(track(view.container)?.getAttribute('src')).toBe('blob:track-1');
  expect(services.list).toHaveBeenCalledTimes(1);
});

it('offers nothing for audio, or for a video inside an archive', async () => {
  const audio = fixture({ video: entry('Movie.mp3', 1e6, 'audio/mpeg') });
  render(<MediaPreview {...audio.context} />);
  const archived = fixture({
    video: { ...entry('Movie.mp4', 1e8, 'video/mp4'), path: '/Movies/Clips.zip → Movie.mp4' },
  });
  render(<MediaPreview {...archived.context} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(audio.services.list).not.toHaveBeenCalled();
  expect(archived.services.list).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Subtitles' })).toBeNull();
});
