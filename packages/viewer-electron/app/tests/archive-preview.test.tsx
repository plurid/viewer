// @vitest-environment jsdom
/**
 * ArchivePreview child view: opening an entry keeps its name visible in the preview's footer
 * details alongside the parent archive's identity.
 */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Resource } from '../src/domain/contracts';
import type { PreviewContext } from '../src/renderer/previews/contracts';
import { PreviewFrameContext } from '../src/renderer/previews/controls';
import ArchivePreview from '../src/renderer/previews/modules/ArchivePreview';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { initialize } from '../src/renderer/state/store';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(): number }) => ({
    measureElement: () => {},
    scrollToIndex: () => {},
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

beforeAll(() => {
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(window, {
    viewer: {
      read: vi.fn(async () => ({ text: 'inside archive', binary: false, truncated: false })),
      release: vi.fn(async () => {}),
      onEvent: vi.fn(() => () => {}),
    },
  });
});

afterEach(() => {
  cleanup();
});

it('keeps the opened archive entry name visible in footer details or toolbar', async () => {
  const archive: Resource = {
    id: 'zip-1',
    url: 'viewer-resource://zip-1/asset/bundle.zip',
    entry: {
      path: '/fixtures/bundle.zip',
      name: 'bundle.zip',
      parent: '/fixtures',
      extension: 'zip',
      kind: 'file',
      directory: false,
      size: 256,
      modified: 1,
      created: 1,
      hidden: false,
      mime: 'application/zip',
      identity: 'zip-1',
    },
  };
  const child: Resource = {
    id: 'entry-1',
    url: 'viewer-resource://entry-1/asset/report.txt',
    entry: {
      path: '/fixtures/bundle.zip -> report.txt',
      name: 'report.txt',
      parent: '/fixtures',
      extension: 'txt',
      kind: 'file',
      directory: false,
      size: 14,
      modified: 1,
      created: 1,
      hidden: false,
      mime: 'text/plain',
      identity: 'entry-1',
    },
  };
  const context = {
    resource: archive,
    active: true,
    interactive: true,
    look: 'dark',
    signal: new AbortController().signal,
    services: {
      archive: async () => ({
        entries: [{ name: 'report.txt', size: 14, directory: false, previewable: true }],
        truncated: false,
      }),
      archiveEntry: async () => child,
      release: async () => {},
    },
  } as unknown as PreviewContext;
  const recorded = new Map<string, readonly string[]>();
  const frame = {
    details: (id: string, values: readonly string[]) => {
      recorded.set(id, values);
      return () => {
        recorded.delete(id);
      };
    },
  };
  const { container } = render(
    <CommandsContext.Provider value={new CommandRegistry()}>
      <PreviewFrameContext value={frame}>
        <ArchivePreview {...context} />
      </PreviewFrameContext>
    </CommandsContext.Provider>,
  );
  const row = await waitFor(() => {
    const button = container.querySelector<HTMLButtonElement>('.archive-row');
    if (!button) throw new Error('waiting for row');
    return button;
  });
  fireEvent.click(row);
  const toolbar = await waitFor(() => {
    const back = container.querySelector('button[aria-label="Back to archive"]');
    if (!back) throw new Error('waiting for child view');
    return back.closest('.preview-toolbar')!;
  });
  const footerDetails = [...recorded.values()].flat();
  const visible =
    (toolbar.textContent ?? '').includes('report.txt') ||
    footerDetails.some((detail) => detail.includes('report.txt'));
  expect(visible).toBe(true);
});
