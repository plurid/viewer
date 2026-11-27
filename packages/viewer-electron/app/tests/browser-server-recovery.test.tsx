// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BrowserPlane from '../src/renderer/browser/BrowserPlane';
import { initialize, flushState, activeWorkspace } from '../src/renderer/state/store';
import { CURRENT_STATE_VERSION, type DesktopEvent } from '../src/domain/contracts';
import type { BrowserRequest, BrowserSnapshot } from '../src/domain/previews/browser';

const runtime = vi.hoisted(() => ({
  revision: 0,
  server: { id: 'server', url: 'http://127.0.0.1:43210/', state: 'running' },
  listeners: new Set<() => void>(),
  present: true,
  retained: true,
  start: vi.fn(async () => {}),
}));
vi.mock('../src/renderer/browser/runtime', () => ({ connectBrowsers() {} }));
vi.mock('../src/renderer/browser/frames', () => ({ browserFrames: () => () => {} }));
vi.mock('../src/renderer/local-servers/runtime', () => ({
  connectLocalServers: vi.fn(),
  localServerSessions: () => ({
    subscribeAll: (listener: () => void) => {
      runtime.listeners.add(listener);
      return () => runtime.listeners.delete(listener);
    },
    generation: () => runtime.revision,
    descriptor: () => (runtime.retained ? { id: 'server' } : undefined),
    start: runtime.start,
    snapshot: () => ({ server: runtime.present ? runtime.server : undefined }),
  }),
}));
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.unstubAllGlobals();
});
it.each([true, false])(
  'restores a stopped server and keeps its link when the port changes: %s',
  async (moved) => {
    runtime.server = { id: 'server', url: 'http://127.0.0.1:43210/', state: 'running' };
    runtime.present = true;
    runtime.retained = true;
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
      runtime.present = !moved;
      runtime.server.state = 'stopped';
      runtime.revision++;
      for (const listener of runtime.listeners) listener();
    });
    if (moved) {
      act(() => {
        runtime.retained = false;
        runtime.revision++;
        for (const listener of runtime.listeners) listener();
      });
      expect(screen.getByRole('status').textContent).toContain('Start Local Server');
      act(() => {
        runtime.retained = true;
        runtime.revision++;
        for (const listener of runtime.listeners) listener();
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Start Server' }));
    expect(runtime.start).toHaveBeenCalledWith('server');
    act(() => {
      runtime.present = true;
      runtime.server = {
        ...runtime.server,
        url: moved ? 'http://127.0.0.1:43211/' : pane.url,
        state: 'running',
      };
      runtime.revision++;
      for (const listener of runtime.listeners) listener();
      for (const event of events)
        event({ type: 'browser', browser: { ...loaded, title: 'Previous port' } });
      expect(activeWorkspace().panes.find((item) => item.id === pane.id)).toMatchObject({
        serverRuntimeID: 'server',
      });
    });
    await waitFor(() =>
      expect(browser).toHaveBeenCalledWith({
        kind: 'navigate',
        id: 'browser',
        url: runtime.server.url,
      }),
    );
    act(() => {
      for (const event of events)
        event({ type: 'browser', browser: { ...loaded, title: 'Previous page' } });
      expect(activeWorkspace().panes.find((item) => item.id === pane.id)).toMatchObject({
        serverRuntimeID: 'server',
      });
      for (const event of events)
        event({ type: 'browser', browser: { ...loaded, url: runtime.server.url } });
    });
    expect(screen.queryByText('Connection refused', { exact: false })).toBeNull();
  },
);
