// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
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
  useFolderSuggestions,
  existingFolders,
  folderSuggestionChecks,
} from '../src/renderer/explorer/useFolderSuggestions';
import { getState, savePatch, activeWorkspace, update } from '../src/renderer/state/core';
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
  pairPanes,
  setPairSync,
} from '../src/renderer/state/panes';
import { newWorkspace } from '../src/renderer/state/workspaces';
import {
  resetKnownFolders,
  knownFolderPaths,
  knowFolder,
  learnFolderAliases,
} from '../src/renderer/explorer/folder-availability';
import {
  remember,
  clearRecentFolders,
  undoClearRecentFolders,
  forgetUnavailableFolder,
  dismissFolderRecovery,
} from '../src/renderer/state/places';
import { receiveFileChanges } from '../src/renderer/state/file-changes';
import { flushState } from '../src/renderer/state/persistence';
import { folderCheckTimeout, checkFolderCandidates } from '../src/domain/files/folder-checks';
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
    expect(document.activeElement?.textContent).toContain('Recent');
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

  it('describes failed history checks without asking for a first visit', async () => {
    history();
    available.clear();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Some folders could not be checked. Enter a folder path or try again.',
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
  it('holds lower ranks briefly, then publishes available folders within the check bound', async () => {
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
      expect(updates.at(-1)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(updates.at(-1)).toHaveLength(8);
      expect(updates.at(-1)).not.toContain('/fixtures/slow');
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

  it('does not recheck an equal history object delivered independently of the save merge', async () => {
    history();
    const hook = renderHook(() => useFolderSuggestions(''));
    await waitFor(() => expect(hook.result.current.checking).toBe(false));
    const paths = hook.result.current.paths;
    const calls = stat.mock.calls.length;
    act(() => savePatch({ visits: structuredClone(getState().saved.visits) }));
    expect(hook.result.current.paths).toBe(paths);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(stat).toHaveBeenCalledTimes(calls);
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
  it('checks at most 40 paths, two at a time, and rejects files', async () => {
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
    expect(maximum).toBe(2);
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
    await waitFor(() =>
      expect(getState().notice).toBe(
        'This folder is no longer available. You can forget it from folder history.',
      ),
    );
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
  it('deduplicates a Recent link against its frequent target using verified folder identity', async () => {
    manyFolders();
    const link = '/fixtures/Documents shortcut';
    const target = '/fixtures/Documents 0';
    learnFolderAliases({ [link]: target });
    knowFolder(link);
    palette(false, [
      {
        id: `location:${link}`,
        label: 'Documents shortcut',
        detail: link,
        group: 'Places',
        when: () => true,
        run: vi.fn(),
      },
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: 'documents' },
    });
    await waitFor(() => expect(options()).toHaveLength(5));
    expect(options().some((option) => option.textContent?.includes(target))).toBe(false);
  });

  it('keeps an open plane once, ahead of duplicate habit results', async () => {
    manyFolders();
    const path = '/fixtures/Documents 0';
    palette(false, [
      {
        id: 'plane:documents',
        label: 'Documents 0',
        detail: path,
        group: 'Open planes',
        when: () => true,
        run: vi.fn(),
      },
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: 'documents' },
    });
    await waitFor(() => expect(options()).toHaveLength(5));
    expect(options().filter((option) => option.textContent?.includes(path))).toHaveLength(1);
    expect(options()[0]?.textContent).toContain('Documents 0');
  });

  it.each(['= 6 * 7', 'z documents', '/fixtures/'])(
    'keeps smart rows outside a command folder: %s',
    async (query) => {
      manyFolders();
      resetKnownFolders([...available]);
      palette(false, [
        {
          id: 'nested',
          label: 'Nested action',
          group: 'Actions',
          paletteFolder: ['Tools'],
          when: () => true,
          run: vi.fn(),
        },
      ]);
      fireEvent.click(await screen.findByRole('option', { name: /Tools/ }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Search Tools' }), {
        target: { value: query },
      });
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(options()).toHaveLength(0);
    },
  );

  it('retains permission recovery when a checked z folder needs access', async () => {
    manyFolders();
    resetKnownFolders([...available]);
    palette(false);
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'z documents' } });
    stat.mockRejectedValueOnce(
      new Error('Allow access to this folder using the folder picker, then try again.'),
    );
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(getState().notice).toBe(
        'Allow access to this folder using the folder picker, then try again.',
      ),
    );
    expect(getState().unavailableFolder).toBeUndefined();
    expect(getState().saved.visits?.['/fixtures/Documents 0']).toBeDefined();
  });

  it('gives a sentence and a forget action when a checked z destination disappears', async () => {
    manyFolders();
    resetKnownFolders([...available]);
    palette(false);
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'z documents' } });
    stat.mockRejectedValueOnce(
      new Error('ENOENT: no such file or directory, lstat /fixtures/Documents 0'),
    );
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(getState().unavailableFolder).toBe('/fixtures/Documents 0'));
    expect(getState().notice).toBe(
      'This folder is no longer available. You can forget it from folder history.',
    );
    act(() => forgetUnavailableFolder());
    expect(getState().saved.visits?.['/fixtures/Documents 0']).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('second review interaction regressions', () => {
  it.each(['doc', '.config', 'proj/2026', ''])(
    'announces the first fragment result that Return opens: %s',
    async (query) => {
      const path = !query || query === 'doc' ? '/fixtures/Documents' : `/fixtures/${query}`;
      savePatch({ visits: { [path]: { count: 1, last: now } } });
      available.add(path);
      render(<GoToFolderDialog onOpen={open} onClose={close} />);
      fireEvent.change(field(), { target: { value: query } });
      await waitFor(() => expect(options()).toHaveLength(1));
      expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
      expect(field().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
      fireEvent.keyDown(field(), { key: 'Enter' });
      await waitFor(() => expect(open).toHaveBeenCalledWith(path));
    },
  );

  it('reports incomplete coverage when a remembered volume root could not be checked', async () => {
    savePatch({ visits: { '/Volumes/Unknown/Documents': { count: 10, last: now } } });
    Object.assign(window.viewer, {
      folderCheck: vi.fn(async () => ({ directory: false, unavailable: true })),
    });
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Some folders could not be checked.',
      ),
    );
    expect(options()).toHaveLength(0);
    expect(getState().saved.visits?.['/Volumes/Unknown/Documents']?.count).toBe(10);
  });

  it('describes incomplete checks without claiming that every remembered folder is absent', async () => {
    savePatch({ visits: { '/fixtures/Downloads': { count: 10, last: now } } });
    Object.assign(window.viewer, {
      folderCheck: vi.fn(async () => ({ directory: false, unavailable: true, timedOut: true })),
    });
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: 'downl' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Some folders could not be checked.',
      ),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Some folders could not be checked. Enter a folder path or try again.',
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('retains the visible rows and arrowed choice across a peer visit and re-rank', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const active = field().getAttribute('aria-activedescendant');
    act(() =>
      savePatch({
        visits: { ...getState().saved.visits, '/fixtures/New': { count: 100, last: now } },
      }),
    );
    available.add('/fixtures/New');
    expect(options()).toHaveLength(2);
    expect(field().getAttribute('aria-activedescendant')).toBe(active);
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(field().getAttribute('aria-activedescendant')).toBe(active);
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Documents'));
  });

  it('keeps a valid arrowed path while its visit record is canonicalized or evicted', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const selected = field().getAttribute('aria-activedescendant');
    const visits = { ...getState().saved.visits };
    delete visits['/fixtures/Documents'];
    act(() => savePatch({ visits }));
    expect(field().getAttribute('aria-activedescendant')).toBe(selected);
    expect(options()[1]?.textContent).toContain('Documents');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Documents'));
  });

  it('does not resurrect shown folders after clearing and recording a different folder', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    act(() => clearRecentFolders());
    expect(options()).toHaveLength(0);
    available.add('/fixtures/New');
    act(() => remember('/fixtures/New'));
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]?.textContent).toContain('/fixtures/New');
  });

  it('offers Undo after clearing and restores both lists with sensible focus', async () => {
    history();
    const visits = getState().saved.visits;
    savePatch({ recents: ['/fixtures/Documents'] });
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent folders' }));
    expect(document.activeElement).toBe(field());
    fireEvent.click(screen.getByRole('button', { name: 'Undo clear recent folders' }));
    expect(getState().saved.visits).toEqual(visits);
    expect(getState().saved.recents).toEqual(['/fixtures/Documents']);
    expect(document.activeElement).toBe(field());
  });

  it('clears the existence cache when a peer window clears history', () => {
    remember('/fixtures/Documents');
    expect(knownFolderPaths().has('/fixtures/Documents')).toBe(true);
    receiveWorkspaces({ ...getState().saved, visits: {}, recents: [] }, undefined, undefined, 1);
    expect(knownFolderPaths().size).toBe(0);
  });

  it('Undo adds the cleared visits to navigation performed after clearing, exactly once', async () => {
    remember('/fixtures/Documents');
    remember('/fixtures/Documents');
    clearRecentFolders();
    await flushState(false);
    remember('/fixtures/Documents');
    undoClearRecentFolders();
    undoClearRecentFolders();
    expect(getState().saved.visits?.['/fixtures/Documents']?.count).toBe(3);
  });

  it('does not count pair following or pair swaps', async () => {
    const first = activeWorkspace().panes[0]!;
    const other = addPane('/fixtures/Other', 'folder', true);
    pairPanes(first.id, other.id);
    setPairSync(first.id, true);
    available.add('/fixtures/Other/child');
    navigate(first.id, '/fixtures/child');
    await waitFor(() =>
      expect(activeWorkspace().panes.find((pane) => pane.id === other.id)?.path).toBe(
        '/fixtures/Other/child',
      ),
    );
    expect(getState().saved.visits?.['/fixtures/Other/child']).toBeUndefined();
    const visits = getState().saved.visits;
    navigate(first.id, '/fixtures/Other/child', true);
    navigate(other.id, '/fixtures/child', true);
    expect(getState().saved.visits).toEqual(visits);
  });

  it.each([true, false])(
    'merges case aliases at record time only when filesystem resolution agrees: %s',
    async (insensitive) => {
      Object.assign(window.viewer, {
        folderCheck: vi.fn(async (path: string) => ({
          directory: true,
          path: insensitive ? path.replace('/documents', '/Documents') : path,
        })),
      });
      const pane = getState().activePane;
      navigate(pane, '/fixtures/Documents');
      navigate(pane, '/fixtures/documents');
      await waitFor(() =>
        expect(Object.keys(getState().saved.visits ?? {})).toHaveLength(insensitive ? 1 : 2),
      );
      if (insensitive) expect(getState().saved.visits?.['/fixtures/Documents']?.count).toBe(2);
      else expect(getState().saved.visits?.['/fixtures/documents']?.count).toBe(1);
      expect(activeWorkspace().panes.find((item) => item.id === pane)?.path).toBe(
        '/fixtures/documents',
      );
    },
  );

  it('shares check capacity between two real hooks and uses the history endpoint', async () => {
    savePatch({
      visits: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `/fixtures/${i < 4 ? 'alpha' : 'beta'}${i}`,
          { count: 8 - i, last: now },
        ]),
      ),
    });
    const pending: (() => void)[] = [];
    let active = 0;
    let maximum = 0;
    const check = vi.fn(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active--;
      return { directory: true };
    });
    Object.assign(window.viewer, { folderCheck: check });
    const hooks = renderHook(() => [useFolderSuggestions('alpha'), useFolderSuggestions('beta')]);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(maximum).toBe(2);
    expect(stat).not.toHaveBeenCalled();
    hooks.unmount();
    await act(async () => {
      for (const resolve of pending) resolve();
    });
  });
});

it('continues past four slow folders on a mounted disk with a separate abandoned-read bound', async () => {
  const release: (() => void)[] = [];
  let outstanding = 0;
  let maximum = 0;
  const paths = [
    ...Array.from({ length: 45 }, (_, i) => `/Volumes/Sleeping/${i}`),
    ...Array.from({ length: 455 }, (_, i) => `/fixtures/${i}`),
  ];
  const incomplete = vi.fn();
  const check = vi.fn(async (path: string) => {
    maximum = Math.max(maximum, ++outstanding);
    if (path.startsWith('/Volumes/Sleeping/'))
      await new Promise<void>((resolve) => release.push(resolve));
    outstanding--;
    return { directory: true };
  });
  try {
    const result = await checkFolderCandidates(paths, check, new AbortController().signal, {
      onIncomplete: incomplete,
    });
    expect(result).toEqual(paths.slice(45, 53));
    expect(incomplete).toHaveBeenCalled();
    expect(check.mock.calls.filter(([path]) => path.startsWith('/Volumes/Sleeping/'))).toHaveLength(
      2,
    );
    expect(maximum).toBeLessThanOrEqual(4);
  } finally {
    for (const resolve of release) resolve();
  }
});

it('waits for the best ranked folder instead of activating a faster weak match', async () => {
  vi.useFakeTimers();
  try {
    const best = '/fixtures/Projects';
    const weak = '/fixtures/Old/Projects-archive';
    available.add(best);
    available.add(weak);
    savePatch({ visits: { [best]: { count: 30, last: now }, [weak]: { count: 2, last: now } } });
    Object.assign(window.viewer, {
      folderCheck: vi.fn(async (path: string) => {
        if (path === best) await new Promise((resolve) => setTimeout(resolve, 40));
        return entry(path);
      }),
    });
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: 'proj' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(81);
    });
    expect(options()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(options()[0]?.textContent).toContain(best);
    fireEvent.keyDown(field(), { key: 'Enter' });
    await act(async () => {});
    expect(open).toHaveBeenCalledWith(best);
  } finally {
    vi.useRealTimers();
  }
});

it('inserts a late higher rank without stealing the folder already active after the wait bound', async () => {
  vi.useFakeTimers();
  try {
    const best = '/fixtures/Projects';
    const weak = '/fixtures/Old/Projects-archive';
    available.add(best);
    available.add(weak);
    savePatch({ visits: { [best]: { count: 30, last: now }, [weak]: { count: 2, last: now } } });
    Object.assign(window.viewer, {
      folderCheck: vi.fn(async (path: string) => {
        if (path === best) await new Promise((resolve) => setTimeout(resolve, 220));
        return entry(path);
      }),
    });
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: 'proj' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(231);
    });
    expect(options()).toHaveLength(1);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(70);
    });
    expect(options()[0]?.textContent).toContain(best);
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await act(async () => {});
    expect(open).toHaveBeenCalledWith(weak);
  } finally {
    vi.useRealTimers();
  }
});

it('remaps a shown and arrowed folder when it is renamed', async () => {
  history();
  render(<GoToFolderDialog onOpen={open} onClose={close} />);
  await waitFor(() => expect(options()).toHaveLength(2));
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  available.add('/fixtures/Renamed/Drafts');
  act(() => receiveFileChanges([{ source: '/fixtures/Design', destination: '/fixtures/Renamed' }]));
  expect(options()[0]?.textContent).toContain('/fixtures/Renamed/Drafts');
  expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(field(), { key: 'Enter' });
  await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Renamed/Drafts'));
});

it('expires the clear recovery and releases its paths after eight seconds', async () => {
  vi.useFakeTimers();
  try {
    remember('/fixtures/Documents');
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent folders' }));
    expect(getState().folderRecovery).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Clear recent folders' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(getState().folderRecovery).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Undo clear recent folders' })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('dismisses clear recovery without restoring it and keeps dialog focus', () => {
  remember('/fixtures/Documents');
  render(<GoToFolderDialog onOpen={open} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear recent folders' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss recent folder Undo' }));
  expect(getState().folderRecovery).toBeUndefined();
  expect(getState().saved.visits).toEqual({});
  expect(document.activeElement).toBe(field());
});

it('remaps cleared visits and recents before Undo', () => {
  remember('/fixtures/A');
  clearRecentFolders();
  receiveFileChanges([{ source: '/fixtures/A', destination: '/fixtures/A2' }]);
  undoClearRecentFolders();
  expect(getState().saved.recents).toEqual(['/fixtures/A2']);
  expect(getState().saved.visits?.['/fixtures/A2']?.count).toBe(1);
  expect(getState().saved.visits?.['/fixtures/A']).toBeUndefined();
});

it('withdraws an Undo offer when another window clears again', async () => {
  remember('/fixtures/A');
  clearRecentFolders();
  await flushState(false);
  receiveWorkspaces({ ...getState().saved, visits: {}, recents: [] }, 'peer-clear', undefined, 1);
  expect(getState().folderRecovery).toBeUndefined();
  undoClearRecentFolders();
  expect(getState().saved.visits).toEqual({});
});

it('keeps checked folders unrelated to Forget and Clear immediate for z', () => {
  knowFolder('/fixtures/Unrelated');
  remember('/fixtures/A');
  remember('/fixtures/B');
  act(() => {
    clearRecentFolders();
  });
  expect(knownFolderPaths().has('/fixtures/Unrelated')).toBe(true);
  expect(knownFolderPaths().has('/fixtures/A')).toBe(false);
  remember('/fixtures/A');
  remember('/fixtures/B');
  act(() => {
    const state = getState();
    receiveWorkspaces(state.saved);
  });
  // Forget is an explicit removal of one record, not a cache flush.
  const state = getState();
  update({ ...state, unavailableFolder: '/fixtures/A' });
  forgetUnavailableFolder();
  expect(knownFolderPaths().has('/fixtures/B')).toBe(true);
  expect(knownFolderPaths().has('/fixtures/Unrelated')).toBe(true);
  expect(knownFolderPaths().has('/fixtures/A')).toBe(false);
  dismissFolderRecovery();
});

it('accepts launch check results in an already open window so z has no first-query wait', () => {
  const saved = { ...getState().saved, visits: { '/fixtures/Downloads': { count: 4, last: now } } };
  initialize({ ...getState().bootstrap, state: saved });
  receiveWorkspaces(saved, undefined, 0, 0, { '/fixtures/Downloads': '/fixtures/Downloads' }, [
    '/fixtures/Downloads',
  ]);
  const hook = renderHook(() => useFolderSuggestions('down', true, 'jump'));
  expect(hook.result.current.paths).toEqual(['/fixtures/Downloads']);
  expect(stat).not.toHaveBeenCalled();
});

it('updates an already queried z list as background launch checks arrive', async () => {
  const path = '/fixtures/Downloads';
  const saved = { ...getState().saved, visits: { [path]: { count: 4, last: now } } };
  initialize({ ...getState().bootstrap, state: saved });
  const hook = renderHook(() => useFolderSuggestions('down', true, 'jump'));
  await waitFor(() => expect(hook.result.current.checking).toBe(false));
  expect(hook.result.current.paths).toEqual([]);
  act(() => receiveWorkspaces(saved, undefined, 0, 0, { [path]: path }, [path]));
  expect(hook.result.current.paths).toEqual([path]);
});

it('returns focus to the field when the focused Undo offer expires', async () => {
  vi.useFakeTimers();
  try {
    remember('/fixtures/Documents');
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent folders' }));
    const undo = screen.getByRole('button', { name: 'Undo clear recent folders' });
    act(() => undo.focus());
    expect(document.activeElement).toBe(undo);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(document.activeElement).toBe(field());
  } finally {
    vi.useRealTimers();
  }
});
