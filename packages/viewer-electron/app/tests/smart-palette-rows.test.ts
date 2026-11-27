// @vitest-environment jsdom
/** Late smart results must not move the command the person is about to choose. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { expandPath } from '../src/domain/command-line/lex';
import { parseCommandLine } from '../src/domain/command-line/verbs';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { CommandsContext } from '../src/renderer/commands/context';
import type { CommandContext, CommandDefinition } from '../src/renderer/commands/registry';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import { activeWorkspace, initialize } from '../src/renderer/state/store';
import { getState, savePatch, update } from '../src/renderer/state/core';
import type { FileEntry } from '../src/domain/contracts';
import type {
  DefinitionCatalog,
  WorkspaceDefinition,
} from '../src/domain/workspaces/definitions/schema';
import { sampleDefinition } from './workspace-definition-fixtures';

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
const show = (
  definitions: CommandDefinition[] = [],
  directory = '/fixtures',
  selection: FileEntry[] = [],
  subject?: FileEntry,
) => {
  const registry = new CommandRegistry();
  const context = {
    scope: 'window',
    workspaceID: activeWorkspace().id,
    paneID: activeWorkspace().panes[0]!.id,
    directory: subject ? undefined : directory,
    subject,
    selection,
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
  await choose('New Folder “Drafts”');
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

describe('the workspace offer in Suggested', () => {
  const root = '/fixtures/code/inbox';
  const definition = (): WorkspaceDefinition => {
    const base = sampleDefinition('sample/inbox', { root, name: 'inbox' });
    return { ...base, remembered: { at: Date.now(), basis: base.basis, planes: 5 } };
  };
  const definitionRow: CommandDefinition = {
    id: 'defined:sample/inbox',
    label: 'inbox',
    group: 'Workspaces',
    remember: false,
    when: () => true,
    run: vi.fn(),
  };
  // a row the palette lists with nothing typed, so an empty Suggested is seen, not waited for
  const rows: CommandDefinition[] = [
    definitionRow,
    {
      id: 'frame-all',
      label: 'Frame all planes',
      group: 'Space',
      primary: true,
      when: () => true,
      run: vi.fn(),
    },
  ];
  beforeEach(() => {
    const catalog: DefinitionCatalog = {
      revision: 1,
      file: { path: '/data/workspaces.jsonc', state: 'absent' },
      projectManager: {
        path: '/source/projects.json',
        state: 'off',
        enabled: false,
        projects: 0,
        missing: 0,
        disabled: 0,
        remote: 0,
        duplicateKeys: 0,
      },
      definitions: [definition()],
      diagnostics: [],
    };
    Object.assign(viewer, { workspaceDefinitionFile: vi.fn(async () => catalog) });
    const state = getState();
    update({ ...state, bootstrap: { ...state.bootstrap, definitions: catalog } });
  });
  const offered = (view: ReturnType<typeof show>['view']) =>
    view
      .queryAllByRole('option')
      .find((option) => option.textContent?.includes('Remembers 5 planes'));

  it('offers the folder’s workspace with its reason before anything is typed', async () => {
    const { view, type } = show(rows, root + '/src');
    await waitFor(() => expect(offered(view)?.textContent).toContain('inbox'));
    expect(view.container.textContent).toContain('Suggested');
    type('inb');
    await waitFor(() => expect(offered(view)).toBeUndefined());
  });

  it('leaves it out once the card is dismissed for its root, or with suggestions off', async () => {
    const state = getState();
    update({
      ...state,
      bootstrap: {
        ...state.bootstrap,
        definitions: { ...state.bootstrap.definitions!, dismissedOffers: [root] },
      },
    });
    const dismissed = show(rows, root + '/src');
    await waitFor(() => expect(dismissed.view.getAllByRole('option').length).toBeGreaterThan(0));
    expect(offered(dismissed.view)).toBeUndefined();
    cleanup();
    update({
      ...getState(),
      bootstrap: { ...getState().bootstrap, definitions: state.bootstrap.definitions },
    });
    const { settings } = getState();
    update({
      ...getState(),
      settings: {
        ...settings,
        settings: {
          ...settings.settings,
          browsing: { ...settings.settings.browsing, suggestions: false },
        },
      },
    });
    const off = show(rows, root + '/src');
    await waitFor(() => expect(off.view.getAllByRole('option').length).toBeGreaterThan(0));
    expect(offered(off.view)).toBeUndefined();
  });
  it('lists three suggestions in all, the offer included', async () => {
    // the person's usual choices for PDFs fill Suggested, and the offer takes one of the three
    const pdf: FileEntry = {
      ...entry('Scan.pdf', false),
      extension: 'pdf',
      kind: 'file',
      size: 1000,
      modified: Date.now(),
      created: Date.now(),
      mime: 'application/pdf',
      identity: 'scan',
    };
    const usual = ['first', 'second', 'third'].map((id): CommandDefinition => ({
      id,
      label: id,
      group: 'Files',
      when: () => true,
      run: vi.fn(),
    }));
    savePatch({
      ui: { ...getState().saved.ui, suggestionHistory: { pdf: ['first', 'second', 'third'] } },
    });
    const { view } = show([...rows, ...usual], root + '/src', [pdf]);
    await waitFor(() => expect(offered(view)).toBeTruthy());
    const reasons = view
      .getAllByRole('option')
      .filter((option) => /Your usual choice|Remembers 5 planes/.test(option.textContent ?? ''));
    expect(reasons).toHaveLength(3);
    expect(reasons.at(-1)).toBe(offered(view));
  });
});

it('opens the virtual Trash through the Go to row', async () => {
  const { type, view } = show();
  type('go viewer://trash');
  fireEvent.click(await view.findByRole('option', { name: /Go to/ }));
  await waitFor(() => expect(openPath).toHaveBeenCalledWith('viewer://trash', expect.anything()));
  expect(viewer.stat).not.toHaveBeenCalledWith('viewer://trash');
});

it('shows Go to and New File as commands and shortens home in the destination', async () => {
  const { type, view } = show();
  for (const [query, label] of [
    ['go ~/Downloads', 'Go to ~/Downloads'],
    ['new file notes.pdf', 'New File “notes.pdf”'],
  ]) {
    type(query);
    const result = await view.findByText(label!);
    expect(result.closest('.file-name-label')).toBeNull();
    if (query === 'go ~/Downloads')
      expect(result.closest('[role=option]')?.querySelector('small')?.textContent).toBe(
        ':e ~/Downloads',
      );
  }
});

it('suggests Optimize for a large PDF open in a preview plane', () => {
  const subject = {
    ...entry('Report.pdf', false),
    kind: 'file' as const,
    mime: 'application/pdf',
    extension: 'pdf',
    size: 20 * 1024 * 1024,
  };
  const { view } = show(
    [{ id: 'optimize-files', label: 'Optimize', group: 'Files', when: () => true, run: vi.fn() }],
    undefined,
    [],
    subject,
  );
  expect(view.getByText('Suggested')).toBeTruthy();
  expect(view.getByRole('option', { name: /Optimize/ }).textContent).toContain('PDF');
});

it('opens the displayed Go to destination when its path needs quotes', async () => {
  const { type, view } = show([], '/fixtures/work');
  type('go ~/Job Files');
  const label = await view.findByText('Go to ~/Job Files');
  const hint = label.closest('[role=option]')!.querySelector('small')!.textContent!;
  expect(hint).toMatch(/^:e ~\//);
  const word = parseCommandLine(hint)[0]!.words[0]!;
  expect(expandPath(word, { home: '/fixtures', folder: '/fixtures/work' })).toBe(
    '/fixtures/Job Files',
  );
});
