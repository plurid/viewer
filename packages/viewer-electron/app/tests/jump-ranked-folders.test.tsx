// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { initialize, getState } from '../src/renderer/state/store';
import { update } from '../src/renderer/state/core';
import { resetKnownFolders } from '../src/renderer/explorer/folder-availability';
import { useFolderSuggestions } from '../src/renderer/explorer/useFolderSuggestions';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

function setupVisits(paths: string[], known: string[]) {
  initialize({
    home: '/Users/test',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: null,
  });
  const now = Date.now();
  const visits = Object.fromEntries(
    paths.map((p, index) => [p, { count: 100 - index * 5, last: now - index * 1000 }]),
  );
  const current = getState();
  update({ ...current, saved: { ...current.saved, visits } });
  resetKnownFolders(known);
}

function Probe({
  query,
  onState,
}: {
  query: string;
  onState: (state: ReturnType<typeof useFolderSuggestions>) => void;
}) {
  const result = useFolderSuggestions(query, true, 'jump');
  onState(result);
  return null;
}

describe('z jump suggestions when rank 0 is unknown and ranks 1..10 are known', () => {
  it('when the top 10 matching folders are known, jump suggestions return all 10 with checking false', async () => {
    vi.useFakeTimers();
    const paths = Array.from({ length: 11 }, (_, i) => `/Users/test/proj-${i}`);
    setupVisits(paths, paths.slice(0, 10));
    const folderCheck = vi.fn(async () => ({ directory: false }));
    vi.stubGlobal('window', Object.assign(window, { viewer: { folderCheck } }));
    let latest!: ReturnType<typeof useFolderSuggestions>;
    render(
      <Probe
        query="proj"
        onState={(state) => {
          latest = state;
        }}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(latest.paths).toHaveLength(10);
    expect(latest.checking).toBe(false);
  });

  it('when rank 0 is unknown (unmounted) and ranks 1..10 are known, suggestions populate and checking ends', async () => {
    vi.useFakeTimers();
    const unmounted = '/Volumes/Offline/proj-top';
    const localTen = Array.from({ length: 10 }, (_, i) => `/Users/test/proj-${i + 1}`);
    setupVisits([unmounted, ...localTen], localTen);
    const folderCheck = vi.fn(async (p: string) => ({ directory: !unmounted.startsWith(p) }));
    vi.stubGlobal('window', Object.assign(window, { viewer: { folderCheck } }));
    let latest!: ReturnType<typeof useFolderSuggestions>;
    render(
      <Probe
        query="proj"
        onState={(state) => {
          latest = state;
        }}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect({
      count: latest.paths.length,
      checking: latest.checking,
      checksCalled: folderCheck.mock.calls.length,
    }).toEqual({
      count: 10,
      checking: false,
      checksCalled: 1,
    });
  });
});
