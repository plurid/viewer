// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { initialize } from '../src/renderer/state/store';
import { useFolder } from '../src/renderer/explorer/useFolder';
import { sendWindowEvent } from '../src/renderer/app/window-events';

it('refreshes sharing when a folder opens, on return and on request, but not on listing events', async () => {
  const path = '/fixtures/Sharing trigger';
  const sharing = vi.fn(async () => ({ status: 'ready', shares: [], folders: [], service: 'off', host: '', ipv4: [] }));
  let changed: (event: { type: 'folder-changed'; path: string }) => void = () => {};
  Object.assign(window, { viewer: {
    networkSharing: sharing, save: vi.fn(async () => {}), list: vi.fn(async () => ({ path, parent: '/fixtures', entries: [] })),
    stat: vi.fn(async () => ({ identity: '1:2' })), watch: vi.fn(async () => {}), unwatch: vi.fn(async () => {}),
    onEvent: (listener: typeof changed) => { changed = listener; return () => {}; },
  } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [], networkSharingAvailable: true });
  const view = renderHook(() => useFolder(path));
  await waitFor(() => expect(sharing).toHaveBeenCalledTimes(1));
  act(() => changed({ type: 'folder-changed', path }));
  await waitFor(() => expect(window.viewer.list).toHaveBeenCalledTimes(2));
  expect(sharing).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(sharing).toHaveBeenCalledTimes(2));
  act(() => sendWindowEvent('viewer:refresh', { paths: [path] }));
  await waitFor(() => expect(sharing).toHaveBeenCalledTimes(3));
  view.unmount();
});
