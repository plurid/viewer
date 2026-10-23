// @vitest-environment jsdom
/**
 * THE SMART PALETTE IN USE (2026-10-23): its rows come first, and choosing one does what it says:
 * copies a calculation, opens a typed path, creates a folder by name, jumps to a frecent folder.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry, type CommandContext } from '../src/renderer/commands/registry';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import { savePatch } from '../src/renderer/state/core';
import type { FileEntry } from '../src/domain/contracts';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};
const entry = (name: string, directory = true): FileEntry =>
  ({
    path: '/fixtures/' + name,
    parent: '/fixtures',
    name,
    directory,
    extension: '',
    hidden: name.startsWith('.'),
  }) as FileEntry;
const viewer = {
  save: vi.fn(async () => {}),
  list: vi.fn(async () => ({
    path: '/fixtures',
    parent: '/',
    entries: [entry('docs'), entry('downloads'), entry('.hidden')],
  })),
  stat: vi.fn(async (path: string) => ({ ...entry(path.split('/').pop()!), path })),
  operate: vi.fn(async () => 'job'),
};
const writeText = vi.fn(async () => {});
const openPath = vi.fn(async () => {});
beforeEach(() => {
  for (const method of Object.values(viewer)) method.mockClear();
  writeText.mockClear();
  openPath.mockClear();
  Object.assign(window, { viewer });
  Object.assign(navigator, { clipboard: { writeText } });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(cleanup);
const show = () => {
  const registry = new CommandRegistry();
  const context = {
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: activeWorkspace().panes[0]!.id,
    directory: '/fixtures',
    selection: [],
    jobs: [],
    clipboard: null,
  } as unknown as CommandContext;
  // a fresh object each time, as the app's sources give: the rows must still settle
  registry.register('window', { context: () => ({ ...context }), definitions: () => [] });
  const view = render(
    createElement(
      CommandsContext.Provider,
      { value: registry },
      createElement(
        WorkspaceContext.Provider,
        { value: { openPath } as unknown as WorkspaceController },
        createElement(CommandPalette, { mode: 'commands', onMode: vi.fn(), onClose: vi.fn() }),
      ),
    ),
  );
  const search = view.getByRole('combobox', { name: 'Search commands' });
  const type = (text: string) => fireEvent.change(search, { target: { value: text } });
  const choose = async (label: string) => {
    const row = await waitFor(() => {
      const found = Array.from(
        view.container.querySelectorAll<HTMLElement>('.command-result'),
      ).find((item) => item.textContent?.includes(label));
      if (!found) throw new Error('No row ' + label);
      return found;
    });
    fireEvent.click(row);
  };
  return { type, choose };
};

it('copies a calculation', async () => {
  const { type, choose } = show();
  type('= 2 * 21');
  await choose('= 42');
  expect(writeText).toHaveBeenCalledWith('42');
});
it('lists a typed path’s folder and opens what is chosen', async () => {
  const { type, choose } = show();
  type('/fixtures/do');
  await waitFor(() => expect(viewer.list).toHaveBeenCalledWith('/fixtures'));
  await choose('docs');
  await waitFor(() =>
    expect(openPath).toHaveBeenCalledWith('/fixtures/docs', expect.objectContaining({})),
  );
});
it('creates a folder by the name typed after the command', async () => {
  const { type, choose } = show();
  type('new folder Drafts');
  await choose('New folder “Drafts”');
  await waitFor(() =>
    expect(viewer.operate).toHaveBeenCalledWith({
      kind: 'mkdir',
      name: 'Drafts',
      sources: [],
      destination: '/fixtures',
    }),
  );
});
it('jumps to a frecent folder with z', async () => {
  savePatch({
    visits: {
      '/Users/me/Downloads': { count: 9, last: Date.now() },
      '/Users/me/Documents': { count: 3, last: Date.now() },
    },
  });
  const { type, choose } = show();
  type('z dow');
  await choose('Downloads');
  await waitFor(() =>
    expect(openPath).toHaveBeenCalledWith('/Users/me/Downloads', expect.objectContaining({})),
  );
});
