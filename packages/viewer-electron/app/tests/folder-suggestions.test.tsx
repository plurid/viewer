// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry, SavedState } from '../src/domain/contracts';
import type { FolderVisitSave } from '../src/domain/files/folder-visit-changes';
import type { CommandContext, CommandDefinition } from '../src/renderer/commands/registry';
import type { WorkspaceController } from '../src/renderer/workspace/context';
import { WorkspaceContext } from '../src/renderer/workspace/context';
import { CommandsContext } from '../src/renderer/commands/context';
import { CommandRegistry } from '../src/renderer/commands/registry';
import { CommandPalette } from '../src/renderer/commands/CommandPalette';
import { GoToFolderDialog } from '../src/renderer/explorer/GoToFolderDialog';
import {
  existingFolders,
  folderSuggestionChecks,
} from '../src/renderer/explorer/useFolderSuggestions';
import { getState, savePatch, activeWorkspace } from '../src/renderer/state/core';
import {
  initialize,
  receiveWorkspaces,
  appendRestoredWorkspaces,
} from '../src/renderer/state/workspaces';
import {
  addPane,
  addContentPane,
  historyNavigate,
  navigate,
  updatePane,
} from '../src/renderer/state/panes';
import { newWorkspace } from '../src/renderer/state/workspaces';
import { resetKnownFolders } from '../src/renderer/explorer/folder-availability';
import { remember, clearRecentFolders } from '../src/renderer/state/places';
import { receiveFileChanges } from '../src/renderer/state/file-changes';
import { flushState } from '../src/renderer/state/persistence';
import {
  folderCheckTimeout,
  checkFolderCandidates,
  FolderCheckPool,
} from '../src/domain/files/folder-checks';
import { catalogCommands } from '../src/renderer/commands/window-commands/catalog';
import { navigationCommands } from '../src/renderer/commands/window-commands/navigation';
import { windowScopes } from '../src/renderer/commands/window-commands/scope';
import type { WindowActions } from '../src/renderer/commands/window-commands/scope';
import { Sidebar } from '../src/renderer/ui/navigation/Sidebar';

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
HTMLElement.prototype.scrollIntoView ??= function () {};

const now = Date.UTC(2026, 10, 1, 12);
const day = 86_400_000;
const available = new Set<string>();
const stat = vi.fn<(path: string) => Promise<FileEntry>>();
const save = vi.fn<(state: SavedState, visitSave?: FolderVisitSave) => Promise<void>>();
const open = vi.fn(async (_path: string) => true);
const close = vi.fn();
const entry = (path: string, directory = true): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  parent: path.slice(0, path.lastIndexOf('/')) || '/',
  directory,
  kind: directory ? 'directory' : 'file',
  extension: '',
  size: 0,
  modified: 0,
  created: 0,
  hidden: false,
  mime: 'application/octet-stream',
  identity: 'fixture',
});

beforeEach(() => {
  available.clear();
  stat.mockReset().mockImplementation(async (path) => {
    if (!available.has(path)) throw new Error('Folder unavailable.');
    return entry(path);
  });
  save.mockReset().mockResolvedValue();
  open.mockClear();
  close.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  Object.assign(window, {
    viewer: {
      stat,
      save,
      list: vi.fn(async () => ({ entries: [] })),
      onEvent: () => () => {},
      settingsPatch: vi.fn(async () => getState().settings),
    },
  });
  initialize({ home: '/fixtures', platform: 'darwin', state: null, locations: [], openPaths: [] });
});
afterEach(async () => {
  cleanup();
  await flushState(false);
  vi.restoreAllMocks();
});

function history() {
  savePatch({
    visits: {
      '/fixtures/Design/Drafts': { count: 30, last: now - day },
      '/fixtures/Documents': { count: 1, last: now },
      '/Volumes/Offline/Design': { count: 100, last: now },
    },
  });
  available.add('/fixtures/Design/Drafts');
  available.add('/fixtures/Documents');
}
const field = () => screen.getByRole('combobox', { name: 'Folder path or name' });
const options = () => screen.queryAllByRole('option');

describe('recording folder views', () => {
  it('counts deliberate opens, excluding launch, reload, Back, Forward and restored planes', async () => {
    const pane = activeWorkspace().panes[0]!;
    expect(getState().saved.visits?.['/fixtures']).toBeUndefined();
    navigate(pane.id, '/fixtures/Documents');
    navigate(pane.id, '/fixtures/Documents');
    navigate(pane.id, '/fixtures/Design');
    const recents = getState().saved.recents;
    historyNavigate(pane.id, -1);
    expect(getState().saved.recents).toEqual(recents);
    expect(getState().saved.visits?.['/fixtures/Documents']).toEqual({ count: 1, last: now });
    historyNavigate(pane.id, 1);
    expect(getState().saved.visits?.['/fixtures/Design']?.count).toBe(1);
    addPane('/fixtures/Documents', 'folder', true);
    expect(getState().saved.visits?.['/fixtures/Documents']?.count).toBe(2);
    const before = getState().saved.visits;
    for (let index = 0; index < 5; index++)
      initialize({ ...getState().bootstrap, state: getState().saved });
    expect(getState().saved.visits).toEqual(before);
    addContentPane({ ...activeWorkspace().panes[0]!, id: 'restored' } as Parameters<
      typeof addContentPane
    >[0]);
    await newWorkspace('Another');
    expect(getState().saved.visits).toEqual(before);
  });

  it('skips repeated history entries so Back and Forward cannot stick', () => {
    const pane = activeWorkspace().panes[0]!;
    updatePane(pane.id, {
      path: '/fixtures/A',
      history: ['/fixtures/X', '/fixtures/A', '/fixtures/A'],
      historyIndex: 2,
    });
    historyNavigate(pane.id, -1);
    expect(activeWorkspace().panes[0]).toMatchObject({ path: '/fixtures/X', historyIndex: 0 });
    historyNavigate(pane.id, 1);
    expect(activeWorkspace().panes[0]).toMatchObject({ path: '/fixtures/A', historyIndex: 1 });
    expect(getState().saved.visits ?? {}).toEqual({});
  });

  it('retains the existing recents bound and exclusions and never counts preview files', () => {
    for (let index = 0; index < 60; index++) remember(`/fixtures/${index}`);
    expect(getState().saved.recents).toHaveLength(50);
    expect(getState().saved.recents[0]).toBe('/fixtures/59');
    addPane('/fixtures/Preview.txt', 'preview', true);
    expect(getState().saved.visits?.['/fixtures/Preview.txt']).toBeUndefined();
    const previous = getState().saved;
    addPane('/fixtures/Exploded', 'folder', false, { remember: false });
    for (const path of ['viewer://trash', 'archive://fixture.zip/nested', '/fixtures/.Trash/old'])
      remember(path);
    expect(getState().saved.recents).toEqual(previous.recents);
    expect(getState().saved.visits).toEqual(previous.visits);
  });

  it('clears, saves and receives visits alongside recents, retaining unrelated history', async () => {
    remember('/fixtures/Documents');
    savePatch({ lineHistory: ['help'] });
    clearRecentFolders();
    await flushState(false);
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      recents: [],
      visits: {},
      lineHistory: ['help'],
    });
    const shared = { ...getState().saved, visits: { '/fixtures/Peer': { count: 5, last: now } } };
    receiveWorkspaces(shared);
    expect(getState().saved.visits).toEqual(shared.visits);
  });

  it('remaps visits with recents and merges restored backup history', async () => {
    remember('/fixtures/Documents');
    receiveFileChanges([{ source: '/fixtures/Documents', destination: '/fixtures/Renamed' }]);
    expect(getState().saved.recents).toEqual(['/fixtures/Renamed']);
    expect(getState().saved.visits?.['/fixtures/Renamed']?.count).toBe(1);
    expect(getState().saved.visits?.['/fixtures/Documents']).toBeUndefined();
    const imported = structuredClone(getState().saved);
    imported.workspaces[0]!.id = 'restored';
    imported.activeWorkspace = 'restored';
    imported.visits = { '/fixtures/Backup': { count: 10, last: now } };
    imported.recents = ['/fixtures/Backup'];
    await appendRestoredWorkspaces(imported);
    expect(getState().saved.visits?.['/fixtures/Backup']?.count).toBe(10);
    expect(getState().saved.visits?.['/fixtures/Renamed']?.count).toBe(1);
    expect(getState().saved.recents).toEqual(['/fixtures/Renamed', '/fixtures/Backup']);
  });

  it('preserves recents and visits added while a save acknowledgement is pending', async () => {
    remember('/fixtures/First');
    let complete!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const flushing = flushState(false);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const [sent, metadata] = save.mock.calls[0]!;
    remember('/fixtures/Second');
    receiveWorkspaces(sent, metadata!.id);
    expect(getState().saved.recents).toEqual(['/fixtures/Second', '/fixtures/First']);
    expect(getState().saved.visits?.['/fixtures/Second']?.count).toBe(1);
    complete();
    await flushing;
    expect(save.mock.calls.at(-1)?.[0].recents).toEqual(['/fixtures/Second', '/fixtures/First']);
  });

  it('offers recents as Places and Clear recent folders in the palette and Recent section', async () => {
    remember('/fixtures/Documents');
    const scopes = windowScopes({
      ready: true,
      workspace: { openPath: open },
    } as unknown as WindowActions);
    const places = catalogCommands(scopes);
    expect(places.find((command) => command.id === 'location:/fixtures/Documents')).toMatchObject({
      group: 'Places',
      label: 'Documents',
    });
    const clearing = navigationCommands(scopes).find(
      (command) => command.id === 'clear-recent-folders',
    )!;
    const context = { scope: 'window', selection: [] } as unknown as CommandContext;
    expect(clearing.when?.(context)).toBe(true);
    expect(clearing.when?.({ ...context, scope: 'sidebar', sidebar: { section: 'recents' } })).toBe(
      true,
    );
    updatePane(getState().activePane, { sidebar: { visible: true, width: 210 } });
    render(
      <WorkspaceContext.Provider value={{ openPath: open } as unknown as WorkspaceController}>
        <Sidebar paneID={getState().activePane} />
      </WorkspaceContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent folders' }));
    expect(getState().saved.recents).toEqual([]);
    expect(getState().saved.visits).toEqual({});
    remember('/fixtures/Documents');
    clearing.run(context);
    expect(getState().saved.visits).toEqual({});
  });
});

describe('Go to folder suggestions', () => {
  it('starts with the selected current path and shows top folders without claiming a choice', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    expect((field() as HTMLInputElement).value).toBe('/fixtures');
    expect((field() as HTMLInputElement).selectionStart).toBe(0);
    expect((field() as HTMLInputElement).selectionEnd).toBe('/fixtures'.length);
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options()[0]?.textContent).toContain('Drafts');
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
    expect(options().every((option) => option.getAttribute('aria-selected') === 'false')).toBe(
      true,
    );
    expect(screen.getByRole('listbox', { name: 'Folder suggestions' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /\/fixtures\/Design\/Drafts/ })).toBeTruthy();
    expect(getState().saved.visits?.['/Volumes/Offline/Design']).toBeDefined();
  });

  it('matches a parent fragment and a misspelled folder name', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: 'design' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]?.textContent).toContain('Drafts');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('1 suggested folder.'),
    );
    fireEvent.change(field(), { target: { value: 'documetns' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]?.textContent).toContain('Documents');
  });

  it('describes unavailable remembered history without asking for a first visit', async () => {
    history();
    available.clear();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'No remembered folders are available. Enter a folder path.',
      ),
    );
    expect(options()).toHaveLength(0);
    expect(getState().saved.visits?.['/fixtures/Documents']).toBeDefined();
  });

  it('opens a keyboard choice with arrows and Return while keeping focus in the field', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Documents'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('prefers a typed existing path, including home expansion, without an arrowed choice', async () => {
    history();
    available.add('/fixtures/Design');
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: '/fixtures/Design' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Design'));
    fireEvent.change(field(), { target: { value: '~/Documents' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Documents'));
  });

  it('rechecks a vanished selection and reports the error without opening another folder', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    available.delete('/fixtures/Design/Drafts');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Folder unavailable.');
    expect(document.activeElement).toBe(field());
    expect((field() as HTMLInputElement).readOnly).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'opens the arrowed suggestion even if the typed path is a folder: %s',
    async (directory) => {
      history();
      available.add('/fixtures/Design');
      if (!directory)
        stat.mockImplementation(async (path) => entry(path, path !== '/fixtures/Design'));
      render(<GoToFolderDialog onOpen={open} onClose={close} />);
      fireEvent.change(field(), { target: { value: '/fixtures/Design' } });
      await waitFor(() => expect(options()).toHaveLength(1));
      fireEvent.keyDown(field(), { key: 'ArrowDown' });
      fireEvent.keyDown(field(), { key: 'Enter' });
      await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Design/Drafts'));
    },
  );

  it('keeps a mistyped path error instead of opening a near-match folder', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: '/fixtures/Documetns' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Folder unavailable.');
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('waits for an immediate fragment submission and opens its result without a schema error', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: 'documetns' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Documents'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(stat.mock.calls.every(([path]) => path.startsWith('/'))).toBe(true);
  });

  it('clears counts and recents in the dialog and retains input focus', async () => {
    history();
    savePatch({ recents: ['/fixtures/Documents'] });
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent folders' }));
    expect(getState().saved.visits).toEqual({});
    expect(getState().saved.recents).toEqual([]);
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(field());
  });

  it('discards checks for an older query and refuses to open after cancellation', async () => {
    history();
    let resolve!: (value: FileEntry) => void;
    stat.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(stat).toHaveBeenCalled());
    fireEvent.change(field(), { target: { value: 'documents' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    await act(async () => resolve(entry('/Volumes/Offline/Design')));
    expect(options()[0]?.textContent).toContain('Documents');
    stat.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.keyDown(field(), { key: 'Enter' });
    view.unmount();
    await act(async () => resolve(entry('/fixtures/Documents')));
    expect(open).not.toHaveBeenCalled();
  });
});

describe('bounded existence checks', () => {
  it('shares four outstanding reads across a cancelled query and the next query', async () => {
    vi.useFakeTimers();
    try {
      const pool = new FolderCheckPool();
      const pending = new Map<string, () => void>();
      let active = 0;
      let maximum = 0;
      const check = vi.fn(async (path: string) => {
        maximum = Math.max(maximum, ++active);
        if (path.startsWith('/slow/'))
          await new Promise<void>((resolve) => pending.set(path, resolve));
        active--;
        return { directory: true };
      });
      const first = new AbortController();
      const old = checkFolderCandidates(
        ['/slow/a', '/slow/b', '/slow/c', '/slow/d'],
        (path) => pool.run(path, check, first.signal),
        first.signal,
      );
      await vi.advanceTimersByTimeAsync(0);
      first.abort();
      const next = new AbortController();
      const fresh = checkFolderCandidates(
        ['/fresh/a', '/fresh/b', '/fresh/c'],
        (path) => pool.run(path, check, next.signal),
        next.signal,
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(check).toHaveBeenCalledTimes(4);
      pending.get('/slow/a')!();
      await vi.advanceTimersByTimeAsync(0);
      expect(await fresh).toEqual(['/fresh/a', '/fresh/b', '/fresh/c']);
      expect(maximum).toBe(4);
      for (const resolve of pending.values()) resolve();
      await vi.advanceTimersByTimeAsync(folderCheckTimeout);
      expect(await old).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('publishes available folders before a slow check times out, keeping outstanding checks bounded', async () => {
    vi.useFakeTimers();
    try {
      const updates: string[][] = [];
      let active = 0;
      let maximum = 0;
      const check = vi.fn(async (path: string) => {
        maximum = Math.max(maximum, ++active);
        if (path === '/fixtures/slow') await new Promise((resolve) => setTimeout(resolve, 3000));
        active--;
        return { directory: true };
      });
      const done = checkFolderCandidates(
        ['/fixtures/slow', ...Array.from({ length: 30 }, (_, index) => `/fixtures/${index}`)],
        check,
        new AbortController().signal,
        { onUpdate: (paths) => updates.push(paths) },
      );
      await vi.advanceTimersByTimeAsync(folderCheckTimeout - 1);
      expect(updates.at(-1)).toHaveLength(8);
      expect(updates.at(-1)).not.toContain('/fixtures/slow');
      await vi.advanceTimersByTimeAsync(1);
      expect(await done).toHaveLength(8);
      expect(maximum).toBeLessThanOrEqual(4);
      expect(check.mock.calls.length).toBeLessThanOrEqual(folderSuggestionChecks);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks an absent volume once and continues past 45 unavailable folders to fill the list', async () => {
    const paths = [
      ...Array.from({ length: 45 }, (_, index) => `/Volumes/Offline/${index}`),
      ...Array.from({ length: 455 }, (_, index) => `/fixtures/${index}`),
    ];
    const check = vi.fn(async (path: string) => {
      if (path === '/Volumes/Offline') throw new Error('Volume is not mounted.');
      return { directory: true };
    });
    expect(await existingFolders(paths, check, new AbortController().signal)).toEqual(
      paths.slice(45, 53),
    );
    expect(check.mock.calls.filter(([path]) => path.startsWith('/Volumes/Offline'))).toEqual([
      ['/Volumes/Offline'],
    ]);
    expect(check.mock.calls.length).toBeLessThanOrEqual(folderSuggestionChecks);
  });

  it('keeps an open list and its checks stable across an equal saved history snapshot', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toContain('Checking'));
    const calls = stat.mock.calls.length;
    await act(async () => {
      await flushState(false);
    });
    expect(options()).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(stat).toHaveBeenCalledTimes(calls);
  });
  it('checks at most 40 paths, four at a time, and rejects files', async () => {
    let running = 0;
    let maximum = 0;
    const check = vi.fn(async (path: string) => {
      running++;
      maximum = Math.max(maximum, running);
      await Promise.resolve();
      running--;
      return { directory: path !== '/fixtures/0' };
    });
    const paths = Array.from({ length: 100 }, (_, index) => `/fixtures/${index}`);
    const result = await existingFolders(paths, check, new AbortController().signal);
    expect(check.mock.calls.length).toBeLessThanOrEqual(folderSuggestionChecks);
    expect(maximum).toBe(4);
    expect(result).toEqual(paths.slice(1, 9));
  });

  it('stops scheduling checks when the query is cancelled', async () => {
    const controller = new AbortController();
    const check = vi.fn(async () => {
      controller.abort();
      return { directory: true };
    });
    expect(await existingFolders(['/a', '/b', '/c'], check, controller.signal)).toEqual([]);
    expect(check).toHaveBeenCalledOnce();
  });
});

describe('palette folder results', () => {
  function palette(command = true, extra: CommandDefinition[] = []) {
    const registry = new CommandRegistry();
    const context = (): CommandContext => ({
      scope: 'window',
      workspaceID: activeWorkspace().id,
      paneID: getState().activePane,
      directory: '/fixtures',
      selection: [],
      jobs: [],
      clipboard: null,
    });
    registry.register('window', {
      context,
      definitions: () => [
        ...extra,
        ...(command
          ? [
              {
                id: 'document-action',
                label: 'Documents action',
                group: 'Navigation',
                when: () => true,
                run: vi.fn(),
              },
            ]
          : []),
      ],
    });
    const workspace = { openPath: open } as unknown as WorkspaceController;
    return render(
      <CommandsContext.Provider value={registry}>
        <WorkspaceContext.Provider value={workspace}>
          <CommandPalette mode="commands" onMode={vi.fn()} onClose={close} />
        </WorkspaceContext.Provider>
      </CommandsContext.Provider>,
    );
  }
  function manyFolders() {
    savePatch({
      visits: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => {
          const path = `/fixtures/Documents ${index}`;
          available.add(path);
          return [path, { count: 20 - index, last: now }];
        }),
      ),
    });
  }
  it('keeps Documents above Duplicate document when habit results arrive, including Return', async () => {
    manyFolders();
    const documents = '/fixtures/Documents';
    available.add(documents);
    savePatch({ visits: { ...getState().saved.visits, [documents]: { count: 40, last: now } } });
    const choose = vi.fn();
    const duplicate = vi.fn();
    palette(false, [
      {
        id: `location:${documents}`,
        label: 'Documents',
        detail: documents,
        group: 'Places',
        when: () => true,
        run: choose,
      },
      {
        id: 'duplicate',
        label: 'Duplicate document',
        group: 'Files',
        when: () => true,
        run: duplicate,
      },
    ]);
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'docu' } });
    expect(options()[0]?.textContent).toContain('Documents');
    const active = search.getAttribute('aria-activedescendant');
    await waitFor(() => expect(options()).toHaveLength(6));
    expect(options()[0]?.textContent).toContain('Documents');
    expect(search.getAttribute('aria-activedescendant')).toBe(active);
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(choose).toHaveBeenCalledOnce());
    expect(duplicate).not.toHaveBeenCalled();
  });
  it('retains a favorite ranked fifth through eighth in history when only four habits fit', async () => {
    manyFolders();
    const favorite = '/fixtures/Documents 6';
    palette(true, [
      {
        id: `location:${favorite}`,
        label: 'Documents favorite',
        detail: favorite,
        group: 'Places',
        when: () => true,
        run: vi.fn(),
      },
    ]);
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'documents' } });
    await waitFor(() => expect(options()).toHaveLength(6));
    expect(
      options().filter((option) => option.textContent?.includes('Documents favorite')),
    ).toHaveLength(1);
    expect(options()[0]?.textContent).toContain('Documents');
  });
  it('offers ranked fragments after commands, capped at four, and opens the keyboard choice', async () => {
    manyFolders();
    palette();
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'documetns' } });
    await waitFor(() => expect(options()).toHaveLength(5));
    expect(options()[0]?.textContent).toContain('Documents action');
    expect(options()[1]?.textContent).toContain('Documents 0');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('/fixtures/Documents 0', expect.any(Object)),
    );
  });
  it('offers eight alone and omits unavailable folders', async () => {
    manyFolders();
    available.delete('/fixtures/Documents 0');
    palette(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: 'documents' },
    });
    await waitFor(() => expect(options()).toHaveLength(8));
    expect(options()[0]?.textContent).toContain('Documents 1');
    expect(getState().saved.visits?.['/fixtures/Documents 0']).toBeDefined();
  });
  it('rechecks that a selected frequent destination is still a folder', async () => {
    manyFolders();
    palette(false);
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'documents' } });
    await waitFor(() => expect(options()).toHaveLength(8));
    stat.mockResolvedValueOnce(entry('/fixtures/Documents 0', false));
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(getState().notice).toBe('This folder is no longer available.'));
    expect(open).not.toHaveBeenCalled();
  });
  it('does not check history for an ordinary command query with no meaningful folder matches', async () => {
    manyFolders();
    palette(false, [{ id: 'copy', label: 'Copy', group: 'Files', when: () => true, run: vi.fn() }]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: 'copy' },
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(options()).toHaveLength(1);
    expect(stat).not.toHaveBeenCalled();
  });
  it('answers z immediately with ten literal ordered matches and no per-query stat calls', () => {
    manyFolders();
    resetKnownFolders([...available]);
    palette(false);
    stat.mockClear();
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'z documents' } });
    expect(options()).toHaveLength(10);
    expect(stat).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: 'z documetns' } });
    expect(options()).toHaveLength(0);
  });
});
