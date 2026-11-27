// @vitest-environment jsdom
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Resource } from '../src/domain/contracts';
import { initialize } from '../src/renderer/state/store';
import ImageDiff from '../src/renderer/diff/ImageDiff';
import { useComparisonSession } from '../src/renderer/diff/useComparisonSession';
afterEach(cleanup);
it('compares SVG source and explains missing raster dimensions', async () => {
  initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const file = { id: 'svg', entry: { mime: 'image/svg+xml', size: 50 } } as Resource;
  Object.assign(window, {
    viewer: {
      resource: vi.fn(async () => file),
      read: vi.fn(async () => ({ text: '<svg/>' })),
      onEvent: () => () => {},
      release: vi.fn(async () => {}),
      watch: vi.fn(async () => {}),
      unwatch: vi.fn(async () => {}),
    },
  });
  const { result } = renderHook(() =>
    useComparisonSession(
      'pane',
      { kind: 'empty', name: 'empty' },
      { kind: 'file', path: '/fixture/icon.svg' },
      0,
    ),
  );
  await waitFor(() =>
    expect(result.current).toMatchObject({
      status: 'ready',
      content: { image: false, text: '<svg/>' },
    }),
  );
  render(
    <ImageDiff
      left={null}
      right={{ ...file, entry: { ...file.entry, mime: 'image/tiff' } }}
      mode="side"
    />,
  );
  expect(screen.getByText(/dimensions unavailable/i)).toBeTruthy();
});
