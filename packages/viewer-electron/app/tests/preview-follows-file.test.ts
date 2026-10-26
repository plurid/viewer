// @vitest-environment jsdom
/**
 * A preview plane follows its file: saved in another app (VS Code), the plane shows the
 * new version; an unrelated change in its folder, or Viewer's own save, changes nothing.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { DesktopEvent, FileEntry, Resource } from '../src/domain/contracts';

vi.mock('../src/renderer/previews/registry', () => ({
  choosePreview: () => ({
    id: 'probe',
    label: 'Probe',
    formats: [],
    detect: () => 100,
    load: async () => ({ default: () => null }),
  }),
}));
import { PreviewHost } from '../src/renderer/previews/PreviewHost';
import { registerEditingPlane } from '../src/renderer/editing/planes';
import { initialize } from '../src/renderer/state/store';
import { formatBytes } from '../src/domain/files/entries';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';

const entry = (modified: number, size = 4): FileEntry =>
  ({
    path: '/fixtures/notes.md',
    name: 'notes.md',
    parent: '/fixtures',
    extension: 'md',
    mime: 'text/markdown',
    size,
    kind: 'file',
    directory: false,
    identity: '1:1',
    modified,
    created: 1,
    hidden: false,
  }) as FileEntry;
let listeners: ((event: DesktopEvent) => void)[] = [];
let onDisk = entry(1);
const viewer = {
  resource: vi.fn(async (): Promise<Resource> => ({
    id: crypto.randomUUID(),
    url: '',
    entry: onDisk,
  })),
  release: vi.fn(async () => {}),
  watch: vi.fn(async () => {}),
  unwatch: vi.fn(async () => {}),
  stat: vi.fn(async () => onDisk),
  onEvent: (listener: (event: DesktopEvent) => void) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((item) => item !== listener);
    };
  },
};
const changed = (path = '/fixtures') =>
  act(async () => {
    for (const listener of listeners) listener({ type: 'folder-changed', path });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
beforeEach(() => {
  listeners = [];
  onDisk = entry(1);
  for (const method of Object.values(viewer)) if ('mockClear' in method) method.mockClear();
  (window as unknown as { viewer: typeof viewer }).viewer = viewer;
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
});
afterEach(cleanup);
const host = () =>
  render(
    createElement(
      CommandsContext.Provider,
      { value: new CommandRegistry() },
      createElement(PreviewHost, { path: '/fixtures/notes.md', paneID: 'plane', editable: true }),
    ),
  );

it('watches its folder while shown, and stops when it closes', async () => {
  const view = host();
  await waitFor(() => expect(viewer.watch).toHaveBeenCalledWith('/fixtures', 'preview:plane'));
  view.unmount();
  expect(viewer.unwatch).toHaveBeenCalledWith('preview:plane');
});
it('opens the new version when the file changed, and only then', async () => {
  const view = host();
  await waitFor(() => expect(view.container.querySelector('.preview-host')).not.toBeNull());
  await changed();
  expect(viewer.resource).toHaveBeenCalledTimes(1);
  await changed('/elsewhere');
  onDisk = entry(2);
  await changed('/elsewhere');
  expect(viewer.resource).toHaveBeenCalledTimes(1);
  await changed();
  await waitFor(() => expect(viewer.resource).toHaveBeenCalledTimes(2));
});
it('tells an editing plane instead, which keeps unsaved edits', async () => {
  const view = host();
  await waitFor(() => expect(view.container.querySelector('.preview-host')).not.toBeNull());
  const changedOnDisk = vi.fn();
  const off = registerEditingPlane('plane', { dirty: () => true, changedOnDisk });
  onDisk = entry(2, 2048);
  await changed();
  expect(changedOnDisk).toHaveBeenCalledOnce();
  // the footer shows the file as it is now, not as it was opened
  await waitFor(() =>
    expect(view.container.querySelector('.preview-file-details')?.textContent).toContain(
      formatBytes(2048),
    ),
  );
  expect(viewer.resource).toHaveBeenCalledTimes(1);
  // that version is now seen: an unrelated change in the folder does not tell it again
  await changed();
  expect(changedOnDisk).toHaveBeenCalledOnce();
  off();
});
