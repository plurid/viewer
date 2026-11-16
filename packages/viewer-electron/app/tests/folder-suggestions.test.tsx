// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry, SavedState } from '../src/domain/contracts';
import type { FolderVisitSave } from '../src/domain/files/folder-visit-changes';
import type { CommandContext } from '../src/renderer/commands/registry';
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
import { addPane, historyNavigate, navigate } from '../src/renderer/state/panes';
import { remember, clearRecentFolders } from '../src/renderer/state/places';
import { receiveFileChanges } from '../src/renderer/state/file-changes';
import { flushState } from '../src/renderer/state/persistence';

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
  it('counts initial folders, navigation and history without changing the recents order', () => {
    const pane = activeWorkspace().panes[0]!;
    expect(getState().saved.visits?.['/fixtures']?.count).toBe(1);
    navigate(pane.id, '/fixtures/Documents');
    navigate(pane.id, '/fixtures/Documents');
    navigate(pane.id, '/fixtures/Design');
    const recents = getState().saved.recents;
    historyNavigate(pane.id, -1);
    expect(getState().saved.recents).toEqual(recents);
    expect(getState().saved.visits?.['/fixtures/Documents']).toEqual({ count: 2, last: now });
    historyNavigate(pane.id, 1);
    expect(getState().saved.visits?.['/fixtures/Design']?.count).toBe(2);
    addPane('/fixtures/Documents', 'folder', true);
    expect(getState().saved.visits?.['/fixtures/Documents']?.count).toBe(3);
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
});

describe('Go to folder suggestions', () => {
  it('starts empty, ranks daily folders, and hides unavailable folders without forgetting them', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    expect((field() as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options()[0]?.textContent).toContain('Drafts');
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    expect(screen.getByRole('listbox', { name: 'Folder suggestions' })).toBeTruthy();
    expect(getState().saved.visits?.['/Volumes/Offline/Design']).toBeDefined();
  });

  it('matches a parent fragment and a misspelled folder name', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    fireEvent.change(field(), { target: { value: 'design' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]?.textContent).toContain('Drafts');
    fireEvent.change(field(), { target: { value: 'documetns' } });
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0]?.textContent).toContain('Documents');
  });

  it('opens a keyboard choice with arrows and Return while keeping focus in the field', async () => {
    history();
    render(<GoToFolderDialog onOpen={open} onClose={close} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(open).toHaveBeenCalledWith('/fixtures/Documents'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('prefers a typed existing path, including home expansion, over the highlighted suggestion', async () => {
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
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Folder unavailable.');
    expect(document.activeElement).toBe(field());
    expect((field() as HTMLInputElement).readOnly).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
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
    expect(check).toHaveBeenCalledTimes(folderSuggestionChecks);
    expect(maximum).toBe(4);
    expect(result).toEqual(paths.slice(1, 40));
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
  function palette(command = true) {
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
      definitions: () =>
        command
          ? [
              {
                id: 'document-action',
                label: 'Documents action',
                group: 'Navigation',
                when: () => true,
                run: vi.fn(),
              },
            ]
          : [],
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
});
