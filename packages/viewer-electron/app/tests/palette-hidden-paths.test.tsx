// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry } from '../src/domain/contracts';
import type { CommandContext } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { activeWorkspace, initialize } from '../src/renderer/state/store';

afterEach(cleanup);
it.each([['~/Li', '/fixtures/Home', 'Library'], ['/us', '/', 'usr'], ['/Vol', '/', 'Volumes']])('completes a flag-hidden folder in the palette: %s', async (query, parent, name) => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const file: FileEntry = { name: name!, parent: parent!, path: parent === '/' ? '/' + name : parent + '/' + name, directory: true, hidden: true, kind: 'directory', identity: '1:2', created: 0, modified: 0, size: 0, extension: '', mime: 'application/octet-stream' };
  Object.assign(window, { viewer: { save: vi.fn(async () => {}), list: vi.fn(async () => ({ path: parent!, parent: '/', entries: [file] })), stat: vi.fn(async () => file) } });
  initialize({ home: '/fixtures/Home', platform: 'darwin', state: null, locations: [], openPaths: [] });
  const registry = new CommandRegistry();
  const context = { scope: 'window', workspaceID: activeWorkspace().id, paneID: activeWorkspace().panes[0]!.id, directory: '/fixtures/Home', selection: [], jobs: [], clipboard: null } as CommandContext;
  registry.register('window', { context: () => ({ ...context }), definitions: () => [] });
  const openPath = vi.fn(async () => {});
  const view = render(<CommandsContext.Provider value={registry}><WorkspaceContext.Provider value={{ openPath } as unknown as WorkspaceController}><CommandPalette mode="commands" onMode={() => {}} onClose={() => {}} /></WorkspaceContext.Provider></CommandsContext.Provider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), { target: { value: query } });
  const row = await waitFor(() => {
    const found = [...view.container.querySelectorAll<HTMLElement>('.command-result')].find((item) => item.textContent?.includes(name!));
    expect(found).toBeTruthy();
    return found!;
  });
  fireEvent.click(row);
  await waitFor(() => expect(openPath).toHaveBeenCalledWith(file.path, expect.anything()));
});
