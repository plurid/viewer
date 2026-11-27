// @vitest-environment jsdom
import { afterEach } from 'vitest';
import { CollectionExplorer } from '../src/renderer/explorer/CollectionExplorer';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandsContext } from '../src/renderer/commands/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import { CollectionControls } from '../src/renderer/ui/collections/Collections';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { itemIdentity, temporalIdentity } from '../src/domain/files/item-identity';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('checks basket files concurrently and updates reachable versions after a failed read', async () => {
  initialize({ home: '/files', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const paths = Array.from({ length: 24 }, (_, i) => '/files/' + i);
  activeWorkspace().basket = paths.map((path) => ({
    path,
    version: { identity: temporalIdentity('1:1'), modified: 1, size: 1 },
  }));
  let active = 0,
    peak = 0;
  const stat = vi.fn(async (path: string) => {
    active++;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (path === paths[1]) throw new Error('Missing file');
    return { path, modified: 2, size: 2, identity: itemIdentity({ dev: 1n, ino: 3n }) };
  });
  vi.stubGlobal('viewer', { stat, save: async () => {} });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  render(
    <WorkspaceContext.Provider value={{} as never}>
      <CollectionControls />
    </WorkspaceContext.Provider>,
  );
  fireEvent(window, new CustomEvent('viewer:collections'));
  fireEvent.click(screen.getByRole('button', { name: 'Check Files Again' }));
  await waitFor(() => expect(screen.getByText(/Missing file/)).toBeTruthy());
  expect(stat).toHaveBeenCalledTimes(paths.length);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
  expect(activeWorkspace().basket?.at(-1)?.version.modified).toBe(2);
});

it('uses the file opening preference and clears a collection selection on blank space', async () => {
  initialize({ home: '/files', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const space = activeWorkspace(),
    id = 'picked',
    source = '/files/Viewer.app';
  space.collections = [{ id, name: 'Picked', kind: 'explicit', sources: [source] }];
  space.panes = [{ id, type: 'collection', collectionID: id, path: '/files' }];
  const external = vi.fn(async () => {}),
    open = vi.fn();
  vi.stubGlobal('viewer', {
    appIcon: async () => '',
    stat: async () => ({
      path: source,
      name: 'Viewer.app',
      extension: 'app',
      parent: '/files',
      directory: true,
      kind: 'directory',
      size: 2,
      modified: 2,
      created: 1,
      mime: '',
      hidden: false,
      identity: '1:2',
    }),
    openExternal: external,
    save: async () => {},
    publishContext: async () => {},
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const field of ['offsetHeight', 'clientHeight', 'offsetWidth', 'clientWidth'])
    Object.defineProperty(HTMLElement.prototype, field, { configurable: true, value: 500 });
  const registry = new CommandRegistry();
  const view = render(
    <WorkspaceContext.Provider
      value={{ open, linkedPaneID: () => undefined, subscribe: () => () => {} } as never}
    >
      <CommandsContext.Provider value={registry}>
        <CollectionExplorer id={id} />
      </CommandsContext.Provider>
    </WorkspaceContext.Provider>,
  );
  const row = await screen.findByRole('option', { name: /Viewer.app/ });
  fireEvent.doubleClick(row);
  expect(external).toHaveBeenCalledWith(source);
  fireEvent.doubleClick(row, { altKey: true });
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(row);
  expect(registry.context(id)?.selection).toHaveLength(1);
  expect(
    document.getElementById(
      view.container.querySelector('[data-file-owner]')!.getAttribute('aria-activedescendant')!,
    ),
  ).toBe(row);
  fireEvent.click(view.container.querySelector('.file-scroll')!);
  expect(registry.context(id)?.selection).toHaveLength(0);
});
