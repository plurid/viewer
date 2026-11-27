// @vitest-environment jsdom
/**
 * Quick Preview Cmd+E routing: edits only the visible text file, never a previous file after
 * stepping onto a folder, a failed file, or while a hidden incoming layer is still loading.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { FileEntry, Resource } from '../src/domain/contracts';
import { QuickPreview, quickPreviewEdit } from '../src/renderer/previews/QuickPreview';
import { WorkspaceContext } from '../src/renderer/workspace/context';
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

const textResource = (name: string): Resource => ({
  id: `res-${name}`,
  url: `viewer-resource://res-${name}/asset/${name}`,
  entry: {
    path: `/fixtures/${name}`,
    name,
    parent: '/fixtures',
    extension: 'txt',
    kind: 'file',
    directory: false,
    size: 32,
    modified: 1,
    created: 1,
    hidden: false,
    mime: 'text/plain',
    identity: `res-${name}`,
  },
});

const subFolder: FileEntry = {
  path: '/fixtures/sub',
  name: 'sub',
  parent: '/fixtures',
  extension: '',
  kind: 'directory',
  directory: true,
  size: 0,
  modified: 1,
  created: 1,
  hidden: false,
  mime: 'inode/directory',
  identity: 'sub-dir',
};

const openPath = vi.fn(async () => {});
const workspaceMock = {
  openPath,
  focusPane: vi.fn(),
} as unknown as Parameters<typeof WorkspaceContext.Provider>[0]['value'];

beforeAll(() => {
  initialize({ home: '/fixtures', platform: 'darwin', locations: [], state: null, openPaths: [] });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  openPath.mockClear();
});

function setupViewer(options: { slowSecond?: boolean } = {}) {
  const notes = textResource('notes.txt');
  const second = textResource('second.txt');
  let resolveSecondRead!: (value: { text: string; binary: boolean; truncated: boolean }) => void;
  Object.assign(window, {
    viewer: {
      resource: vi.fn(async (file: string) => {
        if (file === '/fixtures/notes.txt') return notes;
        if (file === '/fixtures/second.txt') return second;
        throw new Error('Permission denied');
      }),
      read: vi.fn(async (id: string) => {
        if (id === second.id && options.slowSecond)
          return new Promise<{ text: string; binary: boolean; truncated: boolean }>((resolve) => {
            resolveSecondRead = resolve;
          });
        return {
          text: 'This is a long enough preview body to mark ready.',
          binary: false,
          truncated: false,
        };
      }),
      release: vi.fn(async () => {}),
      watch: vi.fn(async () => {}),
      unwatch: vi.fn(async () => {}),
      stat: vi.fn(async () => notes.entry),
      onEvent: vi.fn(() => () => {}),
      openExternal: vi.fn(async () => {}),
      applications: vi.fn(async () => []),
    },
  });
  return {
    finishSecond: () =>
      resolveSecondRead?.({
        text: 'Second file body long enough to be shown.',
        binary: false,
        truncated: false,
      }),
  };
}

describe('QuickPreview Cmd+E routing', () => {
  beforeEach(() => {
    setupViewer();
  });

  it('returns false after moving from a text file to a folder', async () => {
    const registry = new CommandRegistry();
    const view = render(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspaceMock}>
          <QuickPreview
            session={{
              workspaceID: 'ws-1',
              paneID: 'pane-1',
              paths: ['/fixtures/notes.txt'],
              index: 0,
            }}
          />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() => expect(view.getByRole('button', { name: 'Edit' })).toBeTruthy());
    view.rerender(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspaceMock}>
          <QuickPreview
            session={{
              workspaceID: 'ws-1',
              paneID: 'pane-1',
              paths: ['/fixtures/sub'],
              index: 0,
              folders: [subFolder],
            }}
          />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() => expect(document.querySelector('.quick-preview-folder')).toBeTruthy());
    expect(quickPreviewEdit()).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('returns false after moving from a text file to a failed file', async () => {
    const registry = new CommandRegistry();
    const view = render(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspaceMock}>
          <QuickPreview
            session={{
              workspaceID: 'ws-1',
              paneID: 'pane-1',
              paths: ['/fixtures/notes.txt'],
              index: 0,
            }}
          />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() => expect(view.getByRole('button', { name: 'Edit' })).toBeTruthy());
    view.rerender(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspaceMock}>
          <QuickPreview
            session={{
              workspaceID: 'ws-1',
              paneID: 'pane-1',
              paths: ['/fixtures/denied.txt'],
              index: 0,
            }}
          />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(
      () => {
        expect(document.querySelectorAll('.held-preview-layer')).toHaveLength(1);
        expect(document.body.textContent).toContain('Viewer needs permission to read this file.');
      },
      { timeout: 2500 },
    );
    expect(quickPreviewEdit()).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('keeps targeting the visible text file while a waiting layer loads behind it', async () => {
    const { finishSecond } = setupViewer({ slowSecond: true });
    const registry = new CommandRegistry();
    const view = render(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspaceMock}>
          <QuickPreview
            session={{
              workspaceID: 'ws-1',
              paneID: 'pane-1',
              paths: ['/fixtures/notes.txt'],
              index: 0,
            }}
          />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() => expect(view.getByRole('button', { name: 'Edit' })).toBeTruthy());
    view.rerender(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspaceMock}>
          <QuickPreview
            session={{
              workspaceID: 'ws-1',
              paneID: 'pane-1',
              paths: ['/fixtures/second.txt'],
              index: 0,
            }}
          />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
    await waitFor(() => expect(document.querySelectorAll('.held-preview-layer')).toHaveLength(2));
    // Wait a tick for the hidden waiting layer's resource grant to resolve while still hidden.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(quickPreviewEdit()).toBe(true);
    expect(openPath).toHaveBeenCalledWith(
      '/fixtures/notes.txt',
      expect.objectContaining({ edit: true }),
    );
    finishSecond();
  });
});
