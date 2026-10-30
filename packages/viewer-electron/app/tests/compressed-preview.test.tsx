// @vitest-environment jsdom
/**
 * A single gzip-compressed file shows, read-only, the preview of the file it holds when that is
 * text, code or data; other kinds are described by name and expanded size.
 */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ArchiveEntry, FileEntry, Resource, ResourceRead } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import CompressedPreview from '../src/renderer/previews/modules/CompressedPreview';
import { initialize } from '../src/renderer/state/store';
import { mockElementBox } from './support/layout';

vi.mock('../src/renderer/ui/navigation/NativeOpenActions', () => ({
  NativeOpenActions: () => null,
}));
beforeAll(() => {
  // the text view reads the editor's font settings
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 800, top: 0, left: 0, right: 800, bottom: 800, x: 0, y: 0 }) as DOMRect;
  mockElementBox(800, 800);
});
afterEach(cleanup);

const file = (name: string, size = 64): FileEntry => ({
  path: `/fixtures/${name}`,
  name,
  parent: '/fixtures',
  extension: name.split('.').pop()!,
  mime: 'application/gzip',
  size,
  kind: 'file',
  directory: false,
  identity: name,
  modified: 1,
  created: 1,
  hidden: false,
});

function fixture(name: string, member: Partial<ArchiveEntry>, text = '') {
  const listed: ArchiveEntry = {
    name: name.replace(/\.gz$/, ''),
    size: text.length,
    directory: false,
    previewable: true,
    ...member,
  };
  const child = {
    id: 'expanded',
    url: 'viewer-resource://expanded/asset/' + listed.name,
    entry: {
      ...file(listed.name, text.length),
      path: `/fixtures/${name} → ${listed.name}`,
      extension: listed.name.split('.').pop()!,
    },
  } as Resource;
  const services = {
    archive: vi.fn(async () => ({ entries: [listed], truncated: false })),
    archiveEntry: vi.fn<(id: string, name: string) => Promise<Resource>>(async () => child),
    read: vi.fn(async (): Promise<ResourceRead> => ({ text, truncated: false, binary: false })),
    release: vi.fn(async () => {}),
  };
  const context = {
    resource: { id: 'source', url: '', entry: file(name) },
    active: true,
    interactive: true,
    signal: new AbortController().signal,
    look: 'dark',
    services,
    editing: { paneID: 'pane' },
  } as unknown as PreviewContext;
  return { context, services };
}

it('shows the expanded text read-only, labelled, and releases it on close', async () => {
  const text = 'Field notes\n\nA short walk, a few photographs and time to look around.\n';
  const { context, services } = fixture('notes.txt.gz', {}, text);
  const view = render(<CompressedPreview {...context} />);
  await screen.findByText('A short walk, a few photographs and time to look around.');
  expect(services.archiveEntry).toHaveBeenCalledWith('source', 'notes.txt');
  expect(services.read).toHaveBeenCalledWith('expanded');
  expect(screen.getByText(`Expanded from gzip · ${text.length} B`)).toBeTruthy();
  // an entry expanded in memory is never edited, even in a workspace plane
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  view.unmount();
  expect(services.release).toHaveBeenCalledWith('expanded');
  expect(services.release).not.toHaveBeenCalledWith('source');
});

it('reads data and rotated logs with the preview of the file they were', async () => {
  const json = fixture('data.json.gz', {}, '{"project": "Field notes", "count": 12}\n');
  const tree = render(<CompressedPreview {...json.context} />);
  await screen.findByRole('button', { name: 'Tree' });
  expect(tree.container.querySelector('.code-scroll')).toBeNull();
  tree.unmount();
  const log = fixture('access.log.2.gz', {}, '127.0.0.1 - - "GET / HTTP/1.1" 200 512\n');
  render(<CompressedPreview {...log.context} />);
  await screen.findByText(/GET \/ HTTP/);
  expect(log.services.archiveEntry).toHaveBeenCalledWith('source', 'access.log.2');
});

it('describes a kind with no text preview by name and expanded size, without expanding it', async () => {
  const { context, services } = fixture('disk.img.gz', { size: 3 * 1000 ** 3 });
  render(<CompressedPreview {...context} />);
  await screen.findByText('disk.img');
  expect(
    screen.getByText(
      'Gzip-compressed, 3 GB expanded. Viewer shows the text, code and data gzip holds.',
    ),
  ).toBeTruthy();
  const image = fixture('Image study.png.gz', { size: 2048 });
  render(<CompressedPreview {...image.context} />);
  await screen.findByText('Image study.png');
  expect(services.archiveEntry).not.toHaveBeenCalled();
  expect(image.services.archiveEntry).not.toHaveBeenCalled();
});

it('describes text past the limit, and names a file refused while expanding', async () => {
  const large = fixture('huge.log.gz', { size: 9_000_000, previewable: false });
  render(<CompressedPreview {...large.context} />);
  await screen.findByText(
    'Gzip-compressed, 9 MB expanded. Viewer expands up to 8 MB for a preview.',
  );
  expect(large.services.archiveEntry).not.toHaveBeenCalled();
  cleanup();
  const bomb = fixture('small.log.gz', { size: 100 });
  bomb.services.archiveEntry.mockRejectedValue(
    new Error('This file expands beyond the 8 MB preview limit.'),
  );
  render(<CompressedPreview {...bomb.context} />);
  await screen.findByText('This file expands beyond the 8 MB preview limit.');
  expect(screen.getByText('small.log')).toBeTruthy();
});

it('releases an expansion that arrives after the view closed', async () => {
  const { context, services } = fixture('notes.txt.gz', {}, 'late');
  let deliver!: (resource: Resource) => void;
  services.archiveEntry.mockImplementation(
    () =>
      new Promise<Resource>((resolve) => {
        deliver = resolve;
      }),
  );
  const view = render(<CompressedPreview {...context} />);
  await waitFor(() => expect(services.archiveEntry).toHaveBeenCalled());
  view.unmount();
  await act(async () => deliver({ id: 'late', url: '', entry: file('notes.txt') }));
  await waitFor(() => expect(services.release).toHaveBeenCalledWith('late'));
});
