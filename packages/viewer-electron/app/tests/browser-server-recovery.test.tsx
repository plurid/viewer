// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BrowserPlane from '../src/renderer/browser/BrowserPlane';
import { initialize, flushState } from '../src/renderer/state/store';
import { CURRENT_STATE_VERSION, type DesktopEvent } from '../src/domain/contracts';
import type { BrowserRequest, BrowserSnapshot } from '../src/domain/previews/browser';

const runtime = vi.hoisted(() => ({
  revision: 0,
  server: { id: 'server', url: 'http://127.0.0.1:43210/', state: 'running' },
  listeners: new Set<() => void>(),
  action: vi.fn(async () => {}),
}));
vi.mock('../src/renderer/browser/runtime', () => ({ connectBrowsers() {} }));
vi.mock('../src/renderer/browser/frames', () => ({ browserFrames: () => () => {} }));
vi.mock('../src/renderer/local-servers/runtime', () => ({
  localServerSessions: () => ({
    subscribeAll: (listener: () => void) => {
      runtime.listeners.add(listener);
      return () => runtime.listeners.delete(listener);
    },
    generation: () => runtime.revision,
    snapshot: () => ({ server: runtime.server }),
    action: runtime.action,
  }),
}));
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});
it('recovers a stopped server at the same address and clears the obsolete browser failure', async () => {
  const events = new Set<(event: DesktopEvent) => void>();
  const pane = {
    id: 'browser',
    type: 'browser' as const,
    path: '/fixture',
    url: runtime.server.url,
    serverRuntimeID: 'server',
  };
  const loaded: BrowserSnapshot = {
    id: pane.id,
    url: pane.url,
    title: 'Fixture',
    loading: false,
    back: false,
    forward: false,
    zoom: 1,
    transport: 'bitmap',
  };
  const browser = vi.fn((request: BrowserRequest) =>
    Promise.resolve(
      request.kind === 'open' ? { ...loaded, error: 'Connection refused' } : undefined,
    ),
  );
  Object.assign(window, {
    viewer: {
      save: vi.fn(async () => {}),
      browser,
      onEvent: (listener: (event: DesktopEvent) => void) => {
        events.add(listener);
        return () => events.delete(listener);
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
  initialize({
    home: '/fixture',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: {
      version: CURRENT_STATE_VERSION,
      look: 'dark',
      activeWorkspace: 'work',
      favorites: [],
      recents: [],
      workspaces: [
        { id: 'work', name: 'Fixture', roots: [pane.id], panes: [pane], arrangement: {} },
      ],
    },
  });
  render(<BrowserPlane pane={pane} active />);
  await screen.findByText('Connection refused', { exact: false });
  act(() => {
    runtime.server = { ...runtime.server, state: 'stopped' };
    runtime.revision++;
    for (const listener of runtime.listeners) listener();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start server' }));
  expect(runtime.action).toHaveBeenCalledWith('server', 'restart');
  act(() => {
    runtime.server = { ...runtime.server, state: 'running' };
    runtime.revision++;
    for (const listener of runtime.listeners) listener();
  });
  await waitFor(() =>
    expect(browser).toHaveBeenCalledWith({ kind: 'navigate', id: 'browser', url: pane.url }),
  );
  act(() => {
    for (const event of events) event({ type: 'browser', browser: loaded });
  });
  expect(screen.queryByText('Connection refused', { exact: false })).toBeNull();
});
