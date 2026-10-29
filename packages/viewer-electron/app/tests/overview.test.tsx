// @vitest-environment jsdom
/**
 * Overview: searches of the filename index for what may need a look. Each card counts its
 * matches and names a few; Show all opens them as a search. The plane changes no file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { FileEntry, OverviewPane, ViewerAPI } from '../src/domain/contracts';
import type { IndexedQuery, IndexStatus } from '../src/domain/services';
import { matchesQuery, parseFileQuery } from '../src/domain/search/query';
import {
  extractedFolder,
  overviewQueries,
  overviewRoot,
  summarize,
  type OverviewQuery,
} from '../src/domain/suggestions/overview';
import { paneTitle } from '../src/domain/workspaces/planes';
import { stateSchema } from '../src/desktop/persistence/storage';
import { activeWorkspace, flushState, getState, initialize } from '../src/renderer/state/store';
import { addContentPane } from '../src/renderer/state/panes';
import { WorkspaceContext, type WorkspaceController } from '../src/renderer/workspace/context';
import OverviewPlane from '../src/renderer/overview/OverviewPlane';

const now = Date.UTC(2026, 9, 29);
const day = 24 * 60 * 60 * 1000;
const entry = (path: string, extra: Partial<FileEntry> = {}): FileEntry => {
  const name = path.split('/').at(-1)!;
  return {
    path,
    parent: path.slice(0, -name.length - 1),
    name,
    extension: name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '',
    kind: 'file',
    directory: false,
    size: 1000,
    modified: now - day,
    created: now - day,
    hidden: false,
    mime: '',
    identity: path,
    ...extra,
  };
};
const query = (id: string): OverviewQuery => overviewQueries.find((item) => item.id === id)!;
const matches = (id: string, file: FileEntry) =>
  matchesQuery(parseFileQuery(query(id).query, now), file);

describe('overview searches', () => {
  it('are valid queries with unique ids', () => {
    // a query that does not parse throws, naming what is wrong
    for (const item of overviewQueries) expect(() => parseFileQuery(item.query)).not.toThrow();
    expect(new Set(overviewQueries.map((item) => item.id)).size).toBe(overviewQueries.length);
  });

  it('find what each card names, and not its neighbours', () => {
    const old = { modified: now - 30 * day };
    expect(matches('downloads.installers', entry('/u/Downloads/Setup.dmg', old))).toBe(true);
    expect(matches('downloads.installers', entry('/u/Downloads/Setup.dmg'))).toBe(false);
    expect(matches('downloads.installers', entry('/u/Downloads/Notes.pdf', old))).toBe(false);
    expect(matches('files.large', entry('/u/Movie.mov', { size: 3 * 1024 ** 3 }))).toBe(true);
    expect(matches('files.large', entry('/u/Movie.mov', { size: 500 * 1024 ** 2 }))).toBe(false);
    expect(matches('desktop.screenshots', entry('/u/Desktop/Screenshot 2026-10-21.png'))).toBe(
      true,
    );
    expect(matches('desktop.screenshots', entry('/u/Desktop/My Screenshot.png'))).toBe(false);
    expect(
      matches('downloads.stale', entry('/u/Downloads/a.zip', { modified: now - 120 * day })),
    ).toBe(true);
    expect(matches('downloads.stale', entry('/u/Downloads/a.zip', old))).toBe(false);
    expect(matches('pdfs.large', entry('/u/Scan.pdf', { size: 20 * 1024 ** 2 }))).toBe(true);
    expect(matches('names.copies', entry('/u/Report copy.pdf'))).toBe(true);
    expect(matches('names.copies', entry('/u/Report copy 2.pdf'))).toBe(true);
    expect(matches('names.copies', entry('/u/Report (1).pdf'))).toBe(true);
    expect(matches('names.copies', entry('/u/Copywriting.pdf'))).toBe(false);
    expect(matches('photos.heic', entry('/u/IMG_1.HEIC'))).toBe(true);
    expect(matches('files.recent', entry('/u/notes.md'))).toBe(true);
    expect(matches('files.recent', entry('/u/notes.md', old))).toBe(false);
    expect(
      matches('files.recent', entry('/u/Folder', { kind: 'directory', directory: true })),
    ).toBe(false);
  });

  it('name the folder Extract here makes beside an archive', () => {
    expect(extractedFolder(entry('/u/Downloads/Photos.zip'))).toBe('/u/Downloads/Photos');
    expect(extractedFolder(entry('/u/backup.tar.gz'))).toBe('/u/backup');
    expect(extractedFolder(entry('/u/notes.txt.gz'))).toBeUndefined();
    expect(extractedFolder(entry('/u/Photos', { kind: 'directory', directory: true }))).toBe(
      undefined,
    );
  });

  it('look in Downloads, the Desktop or every indexed location', () => {
    expect(overviewRoot('downloads', '/Users/a')).toBe('/Users/a/Downloads');
    expect(overviewRoot('desktop', '/Users/a/')).toBe('/Users/a/Desktop');
    expect(overviewRoot('downloads', 'C:\\Users\\a')).toBe('C:\\Users\\a\\Downloads');
    expect(overviewRoot('everywhere', '/Users/a')).toBeUndefined();
  });

  it('count every match, total the files and name the largest or the latest', () => {
    const files = [
      entry('/u/a', { size: 10, modified: 3 }),
      entry('/u/b', { size: 30, modified: 1 }),
      entry('/u/c', { size: 20, modified: 2 }),
      entry('/u/d', { kind: 'directory', directory: true, size: 999 }),
    ];
    const largest = summarize(files, true);
    expect(largest).toMatchObject({ count: 4, more: true, bytes: 60 });
    expect(largest.top.map((file) => file.name)).toEqual(['b', 'c', 'a']);
    expect(summarize(files, false, 'modified', 2).top.map((file) => file.name)).toEqual(['a', 'c']);
  });
});

describe('the Overview plane', () => {
  let pane: OverviewPane;
  const newSearch = vi.fn();
  const openPath = vi.fn(async () => {});
  const openCollection = vi.fn();
  const status: IndexStatus = {
    roots: [{ path: '/fixture', status: 'ready', count: 5000, errors: 0 }],
    count: 5000,
    running: false,
  };
  const indexedQuery = vi.fn<ViewerAPI['indexedQuery']>();
  beforeEach(() => {
    newSearch.mockClear();
    openPath.mockClear();
    openCollection.mockClear();
    indexedQuery.mockReset();
    indexedQuery.mockImplementation(async (request: IndexedQuery) => {
      if (request.query === query('archives.extracted').query)
        return {
          entries: [
            entry('/fixture/Downloads/Trip.zip', { size: 5000 }),
            entry('/fixture/Downloads/Kept.zip', { size: 7000 }),
            entry('/fixture/notes.txt.gz'),
          ],
          more: false,
          indexed: true,
          status,
        };
      const found =
        request.query === query('files.large').query
          ? [
              entry('/fixture/Movies/Trip.mov', { size: 4 * 1024 ** 3 }),
              entry('/fixture/Backup.dmg', { size: 2 * 1024 ** 3 }),
            ]
          : [];
      return {
        entries: found,
        more: false,
        // Downloads is not an index root here
        indexed: request.root !== '/fixture/Downloads',
        status,
      };
    });
    Object.assign(window, {
      viewer: {
        save: vi.fn(async () => {}),
        indexStatus: vi.fn(async () => status),
        // only Trip.zip was extracted beside itself
        stat: vi.fn(async (file: string) => {
          if (file === '/fixture/Downloads/Trip')
            return entry(file, { kind: 'directory', directory: true });
          throw new Error('ENOENT');
        }),
        indexedQuery,
        openSettings: vi.fn(async () => {}),
      },
    });
    initialize({ home: '/fixture', platform: 'darwin', state: null, locations: [], openPaths: [] });
    pane = { id: crypto.randomUUID(), type: 'overview', path: '/fixture' };
    addContentPane(pane);
  });
  afterEach(async () => {
    cleanup();
    await flushState(false);
  });
  const mount = () =>
    render(
      createElement(
        WorkspaceContext.Provider,
        { value: { newSearch, openPath, openCollection } as unknown as WorkspaceController },
        createElement(OverviewPlane, { pane }),
      ),
    );

  it('counts each search, names the largest files and opens one beside it', async () => {
    mount();
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('5,000 items indexed in 1 location');
    const card = screen.getByText('Files over 1 GB').closest('article')!;
    expect(card.textContent).toContain('2 · 6 GB');
    const files = within(card).getAllByRole('button', { name: /mov|dmg/ });
    expect(files.map((button) => button.textContent)).toEqual(['Trip.mov', 'Backup.dmg']);
    fireEvent.click(files[0]!);
    expect(openPath).toHaveBeenCalledWith('/fixture/Movies/Trip.mov', {
      paneID: pane.id,
      linked: true,
      activate: true,
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Show all' }));
    expect(newSearch).toHaveBeenCalledWith('is:file size>1gb', 'Files over 1 GB', undefined, true);
    // never more than one page of matches per card
    for (const [request] of indexedQuery.mock.calls) expect(request.limit).toBe(200);
  });

  it('lists empty searches in one line and offers a search for a folder outside the index', async () => {
    mount();
    await act(async () => {});
    expect(screen.getByText(/^No matches: /).textContent).toContain('Screenshots on the Desktop');
    const installers = screen.getByText('Old installers').closest('article')!;
    expect(installers.textContent).toContain('Downloads is not in the filename index.');
    fireEvent.click(within(installers).getByRole('button', { name: 'Search it now' }));
    expect(newSearch).toHaveBeenCalledWith(
      'ext:dmg,pkg modified>7d',
      'Old installers',
      '/fixture/Downloads',
      true,
    );
  });

  it('pairs archives with their extracted folder and shows exactly those as a collection', async () => {
    mount();
    await act(async () => {});
    const card = screen.getByText('Archives already extracted').closest('article')!;
    expect(card.textContent).toContain('1 · 4.9 KB');
    expect(within(card).getByRole('button', { name: 'Trip.zip' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Kept.zip' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Show all' }));
    const collection = getState()
      .saved.workspaces.flatMap((space) => space.collections ?? [])
      .find((item) => item.name === 'Archives already extracted');
    expect(collection).toMatchObject({
      kind: 'explicit',
      sources: ['/fixture/Downloads/Trip.zip'],
    });
    expect(openCollection).toHaveBeenCalledWith(collection!.id);
    expect(newSearch).not.toHaveBeenCalled();
  });

  it('asks for index locations when there are none', async () => {
    vi.mocked(window.viewer.indexStatus).mockResolvedValue({ roots: [], count: 0, running: false });
    mount();
    await act(async () => {});
    expect(screen.getByText('Nothing indexed yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Search settings' }));
    expect(window.viewer.openSettings).toHaveBeenCalledWith('settings.search');
  });

  it('is saved with the workspace as Overview', () => {
    const restored = stateSchema.parse(getState().saved);
    const saved = restored.workspaces
      .flatMap((space) => space.panes)
      .find((item) => item.id === pane.id);
    expect(saved).toEqual(pane);
    expect(paneTitle(pane)).toBe('Overview');
    expect(activeWorkspace().panes.some((item) => item.id === pane.id)).toBe(true);
  });
});
