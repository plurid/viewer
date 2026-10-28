// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BrowserPlane from '../src/renderer/browser/BrowserPlane';
import { initialize, flushState } from '../src/renderer/state/store';
import { CURRENT_STATE_VERSION, type DesktopEvent } from '../src/domain/contracts';
import type { BrowserRequest, BrowserSnapshot } from '../src/domain/previews/browser';

vi.mock('../src/renderer/browser/runtime', () => ({ connectBrowsers() {} }));
vi.mock('../src/renderer/browser/frames', () => ({ browserFrames: () => () => {} }));
vi.mock('../src/renderer/local-servers/runtime', () => ({
  localServerSessions: () => ({
    subscribeAll: () => () => {},
    generation: () => 0,
    snapshot: () => ({}),
  }),
}));
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});

it('does not let a delayed open reply replace a newer loaded-page event', async () => {
  const listeners = new Set<(event: DesktopEvent) => void>();
  let resolveOpen!: (snapshot: BrowserSnapshot) => void;
  const opening = new Promise<BrowserSnapshot>((resolve) => {
    resolveOpen = resolve;
  });
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      browser: vi.fn((request: BrowserRequest) =>
        request.kind === 'open' ? opening : Promise.resolve(),
      ),
      onEvent: (listener: (event: DesktopEvent) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const pane = {
    id: 'browser',
    type: 'browser' as const,
    path: '/fixture',
    url: 'http://127.0.0.1:1234/',
  };
  initialize({
    home: '/fixture',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: {
      version: CURRENT_STATE_VERSION,
      look: 'dark',
      activeWorkspace: 'workspace',
      favorites: [],
      recents: [],
      workspaces: [
        {
          id: 'workspace',
          name: 'Generated workspace',
          roots: [pane.id],
          panes: [pane],
          arrangement: {},
        },
      ],
    },
  });
  render(<BrowserPlane pane={pane} active />);
  const loaded: BrowserSnapshot = {
    id: pane.id,
    url: pane.url,
    title: 'Loaded generated page',
    loading: false,
    back: false,
    forward: false,
    zoom: 1,
    transport: 'bitmap',
  };
  act(() => {
    for (const listener of listeners) listener({ type: 'browser', browser: loaded });
  });
  await act(async () => {
    resolveOpen({ ...loaded, title: '', loading: true });
    await opening;
  });
  expect(screen.queryByRole('button', { name: 'Reload page' })).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Stop loading' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open page in window' }));
  expect(window.viewer.browser).toHaveBeenCalledWith({
    kind: 'action',
    id: pane.id,
    action: 'native-window',
  });
});
