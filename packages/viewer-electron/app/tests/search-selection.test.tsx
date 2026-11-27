// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry, SearchPane } from '../src/domain/contracts';
import type { IndexedResult } from '../src/domain/services';
import { itemIdentity, temporalIdentity } from '../src/domain/files/item-identity';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandsContext } from '../src/renderer/commands/context';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { SearchExplorer } from '../src/renderer/explorer/SearchExplorer';

const oldReport: FileEntry = {
  path: '/Users/test/old-report.pdf',
  parent: '/Users/test',
  name: 'old-report.pdf',
  extension: 'pdf',
  mime: 'application/pdf',
  kind: 'file',
  directory: false,
  size: 1024,
  modified: Date.now(),
  created: Date.now(),
  hidden: false,
  identity: itemIdentity({ dev: 1n, ino: 10n }),
};
const newDraft: FileEntry = {
  path: '/Users/test/new-draft.pdf',
  parent: '/Users/test',
  name: 'new-draft.pdf',
  extension: 'pdf',
  mime: 'application/pdf',
  kind: 'file',
  directory: false,
  size: 2048,
  modified: Date.now(),
  created: Date.now(),
  hidden: false,
  identity: itemIdentity({ dev: 1n, ino: 11n }),
};

function makeResult(entries: FileEntry[], evidencePath?: string): IndexedResult {
  return {
    indexed: true,
    entries,
    more: false,
    status: {
      running: false,
      roots: [{ path: '/Users/test', status: 'ready', count: entries.length, errors: 0 }],
    } as IndexedResult['status'],
    evidence: evidencePath
      ? [
          {
            path: evidencePath,
            quote: 'matching passage text',
            coverage: 'complete',
            version: {
              identity: temporalIdentity('1:10'),
              modified: oldReport.modified,
              size: oldReport.size,
            },
            anchor: { kind: 'pdf', page: 1 },
          },
        ]
      : [],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

async function mountSearch() {
  const indexedQuery = vi.fn(async ({ query }: { query: string }) => {
    if (query === 'report') return makeResult([oldReport], oldReport.path);
    return makeResult([newDraft], newDraft.path);
  });
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      viewer: {
        indexedQuery,
        onEvent: () => () => {},
        publishContext: vi.fn(async () => {}),
      },
    }),
  );
  initialize({
    home: '/Users/test',
    platform: 'darwin',
    locations: [],
    openPaths: [],
    state: null,
  });
  const pane: SearchPane = {
    id: 'search-1',
    type: 'search',
    path: '/Users/test',
    name: 'Search',
    query: 'report',
    content: true,
    recursive: true,
    allLocations: false,
  };
  const space = activeWorkspace();
  space.panes = [pane];
  space.roots = [pane.id];
  const registry = new CommandRegistry();
  const workspace = {
    linkedPaneID: () => undefined,
    subscribe: () => () => {},
  } as unknown as WorkspaceController;
  const view = render(
    <WorkspaceContext.Provider value={workspace}>
      <CommandsContext.Provider value={registry}>
        <SearchExplorer id="search-1" />
      </CommandsContext.Provider>
    </WorkspaceContext.Provider>,
  );
  await act(async () => {
    vi.advanceTimersByTime(200);
    await Promise.resolve();
  });
  return { view, registry };
}

describe('Search plane selection', () => {
  it('pressing Escape clears selection and removes 1 selected from footer', async () => {
    const { registry } = await mountSearch();
    const option = screen.getByRole('option', { name: /old-report\.pdf/ });
    fireEvent.click(option);
    expect(registry.context('search-1')?.selection?.map((e) => e.path)).toEqual([oldReport.path]);
    const explorer = screen.getByRole('group', { name: 'Search' });
    fireEvent.keyDown(explorer, { key: 'Escape' });
    expect(registry.context('search-1')?.selection).toEqual([]);
    expect(screen.queryByText(/1 selected/)).toBeNull();
  });

  it('editing the search query clears prior selection so invisible old-report.pdf is not targeted', async () => {
    const { registry } = await mountSearch();
    const option = screen.getByRole('option', { name: /old-report\.pdf/ });
    fireEvent.click(option);
    expect(registry.context('search-1')?.selection?.map((e) => e.path)).toEqual([oldReport.path]);

    const input = screen.getByRole('textbox', { name: 'Search query' });
    fireEvent.change(input, { target: { value: 'draft' } });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect({
      selectedPaths: registry.context('search-1')?.selection?.map((e) => e.path),
      showsSelectedInFooter: !!screen.queryByText(/1 selected/),
      showsMissingPassage: !!screen.queryByText('No source passage is available for this match.'),
    }).toEqual({
      selectedPaths: [],
      showsSelectedInFooter: false,
      showsMissingPassage: false,
    });
  });
});
