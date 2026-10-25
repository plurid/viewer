// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Resource } from '../src/domain/contracts';
import { useResource } from '../src/renderer/previews/useResource';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('survives mount replay and never publishes a stale file completion', async () => {
  const pending: ((value: Resource) => void)[] = [];
  const release = vi.fn(async () => {});
  Object.assign(window, {
    viewer: {
      release,
      resource: vi.fn(() => new Promise<Resource>((resolve) => pending.push(resolve))),
    },
  });
  function Probe({ path }: { path: string }) {
    const load = useResource(path, undefined, true, 0);
    return createElement('div', null, load.resource?.id ?? 'waiting');
  }
  const view = render(createElement(StrictMode, null, createElement(Probe, { path: '/a' })));
  expect(pending).toHaveLength(2);
  view.rerender(createElement(StrictMode, null, createElement(Probe, { path: '/b' })));
  await act(async () => {
    pending[0]!({ id: 'replayed' } as Resource);
    pending[1]!({ id: 'old-file' } as Resource);
    pending[2]!({ id: 'current-file' } as Resource);
  });
  await waitFor(() => expect(view.container.textContent).toBe('current-file'));
  expect(release).toHaveBeenCalledWith('replayed');
  expect(release).toHaveBeenCalledWith('old-file');
  view.unmount();
  expect(release).toHaveBeenCalledWith('current-file');
});
it('exposes a recoverable timeout and cancels its pending native request', async () => {
  vi.useFakeTimers();
  const release = vi.fn(async () => {});
  Object.assign(window, { viewer: { release, resource: vi.fn(() => new Promise(() => {})) } });
  function Probe() {
    const load = useResource('/file', undefined, true, 0);
    return createElement('div', null, load.error);
  }
  const view = render(createElement(Probe));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15001);
  });
  expect(view.container.textContent).toContain('Try again');
  expect(release).toHaveBeenCalledTimes(1);
});
