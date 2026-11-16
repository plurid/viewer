// @vitest-environment jsdom
/** Late smart results must not move the command the person is about to choose. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import type { CommandContext, CommandDefinition } from '../src/renderer/commands/registry';
import { CommandRegistry } from '../src/renderer/commands/registry';
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
  clipboardWriteText: vi.fn(async () => {}),
  list: vi.fn(async () => ({
    path: '/fixtures',
    parent: '/',
    entries: [entry('docs'), entry('downloads'), entry('.hidden')],
  })),
  stat: vi.fn(async (path: string) => ({ ...entry(path.split('/').pop()!), path })),
  operate: vi.fn(async () => 'job'),
};
const openPath = vi.fn(async () => {});
beforeEach(() => {
  for (const method of Object.values(viewer)) method.mockClear();
  openPath.mockClear();
  Object.assign(window, { viewer });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(cleanup);
const show = (definitions: CommandDefinition[] = []) => {
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
  registry.register('window', { context: () => ({ ...context }), definitions: () => definitions });
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
  return { type, choose, view, search };
};

it('copies a calculation', async () => {
  const { type, choose } = show();
  type('= 2 * 21');
  await choose('= 42');
  expect(viewer.clipboardWriteText).toHaveBeenCalledWith('42');
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

it('appends a late ~/Doc completion below the command and Return runs the visible top row', async () => {
  let finish!: (listing: { path: string; parent: string; entries: FileEntry[] }) => void;
  viewer.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const run = vi.fn();
  const label = '~/Doc command';
  const { type, view, search } = show([
    { id: 'document-command', label, group: 'Actions', when: () => true, run },
  ]);
  type('~/Doc');
  await waitFor(() => expect(viewer.list).toHaveBeenCalledWith('/fixtures'));
  expect(view.getAllByRole('option')).toHaveLength(1);
  expect(view.getAllByRole('option')[0]?.textContent).toContain(label);
  await act(async () => {
    finish({ path: '/fixtures', parent: '/', entries: [entry('Documents')] });
  });
  const rows = view.getAllByRole('option');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain(label);
  expect(rows[1]?.textContent).toContain('Documents');
  expect(rows[1]?.textContent).toContain('/fixtures');
  expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(openPath).not.toHaveBeenCalled();
});
