// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { DesktopEvent, ServerPane as Pane, ViewerAPI } from '../src/domain/contracts';
import type { LocalServer, LocalServerLog } from '../src/domain/previews/web';
import ServerPlane from '../src/renderer/local-servers/ServerPlane';
import { addServerPane, removePanes } from '../src/renderer/state/panes';
import { initialize, flushState } from '../src/renderer/state/store';
vi.mock('../src/renderer/workspace/context', () => ({
  useWorkspace: () => ({ openBrowser: vi.fn() }),
}));

let pane: Pane;
let api: ReturnType<typeof nativeAPI>;
const logs: LocalServerLog[] = [
  {
    sequence: 1,
    timestamp: 1000,
    method: 'GET',
    path: '/index.html',
    status: 200,
    durationMs: 2.5,
    bytes: 20,
  },
  {
    sequence: 2,
    timestamp: 1001,
    method: 'HEAD',
    path: '/missing.css',
    status: 404,
    durationMs: 1.2,
    bytes: 0,
  },
];

function nativeAPI() {
  let current: LocalServer | undefined;
  let requests = [...logs];
  const listeners = new Set<(event: DesktopEvent) => void>();
  const changed = () => {
    for (const listener of listeners)
      listener({ type: 'local-servers', servers: current ? [current] : [] });
  };
  return {
    save: vi.fn(async () => {}),
    onEvent: vi.fn<ViewerAPI['onEvent']>((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    localServers: vi.fn<ViewerAPI['localServers']>(async () => (current ? [current] : [])),
    localServerStart: vi.fn<ViewerAPI['localServerStart']>(async (root, paneID) => {
      current = {
        id: 'native-server',
        root,
        paneID,
        url: 'http://127.0.0.1:43110/',
        port: 43110,
        started: 1,
        state: 'running',
      };
      changed();
      return current;
    }),
    localServerInspect: vi.fn<ViewerAPI['localServerInspect']>(async () => ({
      server: current!,
      logs: requests,
    })),
    localServerAction: vi.fn<ViewerAPI['localServerAction']>(async (_id, action) => {
      if (action === 'stop') current = { ...current!, state: 'stopped' };
      if (action === 'restart') current = { ...current!, state: 'running' };
      if (action === 'clear-log') requests = [];
      if (action === 'close') current = undefined;
      changed();
    }),
  };
}

beforeEach(() => {
  api = nativeAPI();
  Object.assign(window, { viewer: api });
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  pane = addServerPane('/fixture', '1:2');
});
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.useRealTimers();
});

describe('local server plane', () => {
  it('reopens stopped, starts explicitly and exposes URL, filters and memory-log controls', async () => {
    render(createElement(ServerPlane, { pane, active: true }));
    await act(async () => {});
    expect(api.localServerStart).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Stopped');
    expect(
      (screen.getByRole('button', { name: 'Copy server URL' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })));
    expect(screen.getByRole('status').textContent).toBe('Running');
    expect((screen.getByRole('textbox', { name: 'Server URL' }) as HTMLInputElement).value).toBe(
      'http://127.0.0.1:43110/',
    );
    expect(screen.getByText('/index.html')).toBeTruthy();
    expect(screen.getByText('/missing.css')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request status' }));
    const statusMenu = screen.getByRole('dialog', { name: 'Request status' });
    fireEvent.click(statusMenu.querySelector<HTMLElement>('[data-menu-id="choice:client-error"]')!);
    expect(screen.queryByText('/index.html')).toBeNull();
    expect(screen.getByText('/missing.css')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy server URL' })));
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Open server in browser' })),
    );
    expect(api.localServerAction).toHaveBeenCalledWith('native-server', 'copy-url');
    expect(api.localServerAction).toHaveBeenCalledWith('native-server', 'open-browser');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Clear request log' })),
    );
    expect(screen.queryByText('/missing.css')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));
    expect(screen.getByRole('status').textContent).toBe('Stopped');
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(api.localServerStart).toHaveBeenCalledTimes(1);
  });

  it('keeps serving through component culling and saved-view closure', async () => {
    const mounted = render(createElement(ServerPlane, { pane, active: true }));
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })));
    mounted.unmount();
    expect(api.localServerAction).not.toHaveBeenCalledWith('native-server', 'close');
    const restored = render(createElement(ServerPlane, { pane, active: true }));
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('Running');
    expect(api.localServerStart).toHaveBeenCalledTimes(1);
    restored.unmount();
    act(() => removePanes([pane.id]));
    expect(api.localServerAction).not.toHaveBeenCalledWith('native-server', 'close');
  });

  it('polls visible following logs and suspends polling while its plane is culled', async () => {
    vi.useFakeTimers();
    const mounted = render(createElement(ServerPlane, { pane, active: true }));
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })));
    api.localServerInspect.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(api.localServerInspect).toHaveBeenCalledTimes(2);
    mounted.rerender(createElement(ServerPlane, { pane, active: false }));
    api.localServerInspect.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(api.localServerInspect).not.toHaveBeenCalled();
    expect(api.localServerAction).not.toHaveBeenCalledWith('native-server', 'stop');
    expect(api.localServerAction).not.toHaveBeenCalledWith('native-server', 'close');
  });
});
