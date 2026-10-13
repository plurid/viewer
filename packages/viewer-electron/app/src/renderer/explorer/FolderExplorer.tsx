import { nativeOpening } from './opening';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry, FolderPane } from '../../domain/contracts';
import { groupEntries, indexEntries, reconcileSelection, sortEntries } from '../../domain/files';
import {
  activeWorkspace,
  getState,
  navigate,
  report,
  refreshClipboard,
  setActivePane,
  updatePane,
  useViewer,
  useFolderPresentation,
} from '../state/store';
import { browseSession, useBrowseField } from '../workspace/sessions';
import { useWorkspace } from '../workspace/context';
import { IconButton, Empty, Loading } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { FolderAccessButton, needsFolderAccess } from '../ui/FolderAccessButton';
import { ColumnsView, GalleryView, GridView, ListView, type FileViewProps } from './views';
import { useFolder } from './useFolder';
import { useSearch } from './useSearch';
import { ContextMenu } from '../ui/ContextMenu';
import { useCommands, useCommandSource } from '../commands/context';
import { folderCommands } from '../commands/folder';
import { editable } from '../commands/editing';
import { useListNavigation } from './ListNavigation';
import { routeExplorerInput } from './input';
import type { CommandRequest } from '../commands/registry';
import { revealFile } from './anchors';
import { SelectionSize } from './sizes';
import { useFileDialogs } from './FileDialogs';
import { FileTable } from './FileTable';
import { useColumnNavigation } from './column-navigation';
import { FILE_DRAG, useFileDrop } from './file-drop';
import { folderDragNavigation } from './folder-drag';
import { blankFileSpace, useFileKeyboard, useFileSelection, type FileModifiers } from './selection';

export const FolderExplorer = memo(function FolderExplorer({ id }: { id: string }) {
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id)) as
    FolderPane | undefined;
  const workspace = useWorkspace();
  const registry = useCommands();
  const activeID = useViewer((state) => state.activePane);
  const recipes = useViewer((state) => state.settings.settings.recipes);
  const presentation = useFolderPresentation(pane?.path || '');
  const foldersFirst = presentation.foldersFirst;
  const listing = useFolder(pane?.path || getState().bootstrap.home);
  const path = pane?.path || '';
  const session = browseSession(id, path);
  const [selection, setSelection] = useBrowseField(id, path, 'selection');
  const selecting = useFileSelection(session, setSelection);
  const [query, setQuery] = useBrowseField(id, path, 'query');
  const [subtree, setSubtree] = useBrowseField(id, path, 'subtree');
  const input = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const selectionCache = { current: session.cache };
  const fileDialogs = useFileDialogs();
  const [searchOpen, setSearchOpen] = useBrowseField(id, path, 'searchOpen');
  const [pathOpen, setPathOpen] = useBrowseField(id, path, 'pathOpen');
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest } | null>(null);
  const search = useSearch(path, query, subtree, pane?.showHidden || false);
  const sources = subtree && query.trim() ? search.entries : listing.entries;
  const sourceIndex = useMemo(() => indexEntries(sources), [sources]);
  const listingIndex = useMemo(() => indexEntries(listing.entries), [listing.entries]);
  const showHidden = pane?.showHidden;
  const sort = pane?.sort;
  const descending = pane?.descending;
  const baseEntries = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return sort
      ? groupEntries(
          sortEntries(
            sources.filter(
              (entry) =>
                (showHidden || !entry.hidden) &&
                (subtree || !query || entry.name.toLocaleLowerCase().includes(needle)),
            ),
            sort,
            descending ?? false,
            foldersFirst,
          ),
          presentation.group,
        )
      : [];
  }, [sources, showHidden, sort, descending, subtree, query, foldersFirst, presentation.group]);
  const tree = useListNavigation(
    id,
    path,
    baseEntries,
    pane?.mode === 'list' && !query && !listing.loading && !listing.error,
  );
  const entries = pane?.mode === 'list' ? tree.entries : baseEntries;
  const selected = useMemo(
    () =>
      selection
        .map((path) => sourceIndex.paths.get(path) || selectionCache.current.get(path))
        .filter((entry): entry is FileEntry => !!entry),
    [sourceIndex, selection],
  );
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const columns = useColumnNavigation(
    id,
    path,
    entries,
    pane?.mode === 'columns' && !listing.loading && !listing.error,
    selecting,
  );
  const dragNavigation = useMemo(() => folderDragNavigation(id), [id]);
  const drops = useFileDrop(
    () => (pane?.mode === 'columns' ? columns.directory() : path),
    dragNavigation,
  );
  useEffect(() => {
    if (listing.loading || listing.error) return;
    setSelection((value) => {
      const next = reconcileSelection(value, selectionCache.current, path, listingIndex);
      return next.length === value.length && next.every((file, index) => file === value[index])
        ? value
        : next;
    });
  }, [listingIndex, listing.loading, listing.error, path]);
  useEffect(() => {
    const content = surface.current?.querySelector('.file-scroll');
    if (content) content.scrollTop = session.scroll;
  }, [id, listing.loading]);
  const opening = useViewer((state) => state.settings.settings.fileOpening);
  const open = useCallback(
    (entry: FileEntry, linked = false, another = false) => {
      if (entry.directory && !linked) navigate(id, entry.path);
      else if (nativeOpening(entry, opening, linked)) {
        void window.viewer.openExternal(entry.path).catch(report);
      } else {
        const origin = activeWorkspace().id;
        void revealFile(id, entry.path)
          .then((link) => {
            if (
              activeWorkspace().id === origin &&
              activeWorkspace().panes.some((pane) => pane.id === id && pane.path === path)
            )
              workspace.open(entry, id, { another, link });
          })
          .catch(report);
      }
    },
    [workspace, id, path, opening],
  );
  const select = useCallback(
    (entry: FileEntry, event: FileModifiers, scope = entries) => {
      setActivePane(id);
      surface.current?.focus({ preventScroll: true });
      if (pane?.mode === 'columns') columns.choose(entry, event, scope);
      else selecting.click(entry, event, scope);
    },
    [entries, id, selecting, pane?.mode, columns.choose],
  );
  useEffect(() => {
    if (searchOpen) input.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    search.cancel();
    setQuery('');
    setSearchOpen(false);
    surface.current?.focus({ preventScroll: true });
  };
  useCommandSource(
    `folder:${id}`,
    {
      context: () => ({
        scope: selected.length ? 'files' : 'folder',
        workspaceID: activeWorkspace().id,
        rootID: workspace.rootID(id),
        paneID: id,
        folder: pane,
        searchOpen,
        directory: pane?.mode === 'columns' ? columns.directory() : path,
        path,
        selection: selected,
        clipboard: getState().clipboard,
        jobs: getState().jobs,
      }),
      definitions: () =>
        folderCommands({
          open: (entries, linked, another) => {
            for (const entry of entries) open(entry, linked, another);
          },
          ...fileDialogs.actions,
          search: () => {
            if (searchOpen) closeSearch();
            else setSearchOpen(true);
          },
          path: () => setPathOpen((value) => !value),
          refresh: listing.refresh,
          selectAll: () => {
            const scope = pane?.mode === 'columns' ? columns.scope() : entries;
            selecting.all(scope);
          },
          invertSelection: () =>
            selecting.invert(pane?.mode === 'columns' ? columns.scope() : entries),
        }),
      valid: (invocation, live) =>
        invocation.workspaceID === live.workspaceID &&
        invocation.path === live.path &&
        !!live.folder,
    },
    [pane, selected, entries, searchOpen, recipes],
  );
  useEffect(() => {
    if (activeID !== id) return;
    const rootID = workspace.rootID(id);
    if (rootID)
      void window.viewer
        .contextPublish({
          workspaceID: activeWorkspace().id,
          paneID: id,
          rootID,
          sources: selected.map((file) => file.path),
          actor: 'user',
        })
        .catch(report);
  }, [activeID, id, path, selected, workspace]);
  const command = (name: string) => {
    setMenu(null);
    void (async () => {
      if (name === 'paste' || name === 'paste-move') await refreshClipboard();
      await registry.invoke(name, { paneID: id });
    })().catch(report);
  };
  const handleKey = useFileKeyboard(id, (event) => {
    if (!pane) return;
    routeExplorerInput(event, {
      settings: getState().settings.settings,
      command,
      clear: () => selecting.clear(),
      type: (text) => {
        const entry = selecting.type(pane.mode === 'columns' ? columns.scope() : entries, text);
        if (entry && pane.mode === 'columns') columns.reveal(entry);
      },
      horizontal:
        pane.mode === 'columns'
          ? (direction) => {
              if (direction === 'right') columns.right();
              else if (!columns.left()) command('parent');
            }
          : pane.mode === 'list'
            ? (direction) =>
                tree.horizontal(direction, (entry) =>
                  selecting.click(
                    entry,
                    { shiftKey: false, metaKey: false, ctrlKey: false },
                    entries,
                  ),
                )
            : undefined,
      move: (key, range) => {
        const stride =
          pane.mode === 'grid' && ['ArrowUp', 'ArrowDown'].includes(key)
            ? surface.current?.querySelector('.grid-row')?.childElementCount || 1
            : 1;
        if (pane.mode === 'columns') columns.move(key, range);
        else
          selecting.move(
            entries,
            key,
            range,
            stride,
            Math.max(
              1,
              Math.floor(
                (surface.current?.querySelector('.file-scroll')?.clientHeight || 360) /
                  (surface.current?.querySelector('[data-file-path]')?.getBoundingClientRect()
                    .height || 36),
              ),
            ),
          );
      },
    });
  });
  if (!pane) return <Empty title="Folder is unavailable" />;
  const viewProps: FileViewProps = {
    entries,
    presentation,
    depths: tree.depths,
    expanded: tree.expanded,
    toggle: tree.toggle,
    selection,
    cursor: session.cursor,
    selectionSet,
    select,
    open,
    showHidden: pane.showHidden,
    context: (entry, event) => {
      event.preventDefault();
      selecting.target(entry);
      if (pane.mode === 'columns') columns.reveal(entry);
      setActivePane(id);
      void refreshClipboard(true);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        request: {
          paneID: id,
          scope: 'files',
          context: {
            selection: selectionSet.has(entry.path) ? selected : [entry],
            directory: pane.mode === 'columns' ? columns.directory() : path,
          },
        },
      });
    },
    drag: (entry, event) => {
      const files = selectionSet.has(entry.path) ? selection : [entry.path];
      if (event.isTrusted) {
        event.preventDefault();
        void window.viewer.fileDragStart(files).catch(report);
        return;
      }
      event.dataTransfer.setData(FILE_DRAG, JSON.stringify(files));
      event.dataTransfer.effectAllowed = 'copyMove';
      const shortcuts = files.flatMap((path) => {
        const item = selectionCache.current.get(path) || sourceIndex.paths.get(path);
        return item?.directory ? [{ path: item.path }] : [];
      });
      if (shortcuts.length)
        event.dataTransfer.setData('application/x-viewer-shortcuts', JSON.stringify(shortcuts));
      event.dataTransfer.setData('text/plain', files.join('\n'));
      event.dataTransfer.effectAllowed = shortcuts.length ? 'all' : 'copyMove';
    },
  };
  const crumbs = path.split(/[\\/]/).filter(Boolean);
  const separator = path.includes('\\') ? '\\' : '/';
  return (
    <div
      className="folder-explorer"
      ref={surface}
      data-file-owner={id}
      onScrollCapture={(event) => {
        if ((event.target as HTMLElement).classList.contains('file-scroll'))
          session.scroll = (event.target as HTMLElement).scrollTop;
      }}
      tabIndex={0}
      aria-label={`Folder ${path}`}
      onFocus={() => setActivePane(id)}
      onPointerDown={() => setActivePane(id)}
      onKeyDownCapture={handleKey}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          blankFileSpace(event.target)
        ) {
          selecting.clear();
          surface.current?.focus({ preventScroll: true });
        }
      }}
      onContextMenu={(event) => {
        if (!blankFileSpace(event.target)) return;
        event.preventDefault();
        setActivePane(id);
        void refreshClipboard(true);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          request: {
            paneID: id,
            scope: 'folder',
            context: {
              selection: [],
              directory: pane.mode === 'columns' ? columns.directory() : path,
            },
          },
        });
      }}
      onCopy={(event) => {
        if (!editable(event.target) && selection.length) {
          event.preventDefault();
          command('copy');
        }
      }}
      onCut={(event) => {
        if (!editable(event.target) && selection.length) {
          event.preventDefault();
          command('cut');
        }
      }}
      onPaste={(event) => {
        if (!editable(event.target)) {
          event.preventDefault();
          command('paste');
        }
      }}
      {...drops}
    >
      {pathOpen && (
        <div className="breadcrumb-row">
          <nav className="breadcrumbs" aria-label="Folder path">
            <button title="Go to root" onClick={() => navigate(id, separator)}>
              {separator}
            </button>
            {crumbs.map((crumb, index) => (
              <span key={index}>
                <Icon name="right" size={12} />
                <button
                  title={separator + crumbs.slice(0, index + 1).join(separator)}
                  onClick={() =>
                    navigate(id, separator + crumbs.slice(0, index + 1).join(separator))
                  }
                >
                  {crumb}
                </button>
              </span>
            ))}
          </nav>
        </div>
      )}
      {searchOpen && (
        <div className="search-row">
          <Icon name="search" size={16} />
          <input
            ref={input}
            aria-label="Find files"
            placeholder={subtree ? 'Search this folder and subfolders' : 'Filter this folder'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className={subtree ? 'selected' : ''}
            aria-pressed={subtree}
            onClick={() => setSubtree(!subtree)}
            title="Include subfolders"
          >
            Subfolders
          </button>
          <IconButton icon="close" label="Close search" onClick={closeSearch} />
          {search.running && (
            <IconButton icon="pause" label="Cancel search" onClick={search.cancel} />
          )}
        </div>
      )}
      {listing.error && (
        <div className="folder-error" role="alert">
          <Icon name="warning" />
          <span>{listing.error}</span>
          {needsFolderAccess(listing.errorCode) ? (
            <FolderAccessButton
              folder={path}
              onGranted={(folder) => {
                if (folder !== path) navigate(id, folder);
                else listing.refresh();
              }}
            />
          ) : (
            <button onClick={listing.refresh}>Retry</button>
          )}
        </div>
      )}
      <div className="folder-content">
        <FileTable
          paneID={id}
          enabled={pane.mode === 'list'}
          sort={pane.sort}
          descending={pane.descending}
          onSort={(sort) =>
            updatePane(id, { sort, descending: pane.sort === sort && !pane.descending })
          }
        >
          {listing.loading && !subtree ? (
            <Loading label="Reading folder…" />
          ) : listing.error && !query ? (
            <Empty
              icon="warning"
              title={
                needsFolderAccess(listing.errorCode)
                  ? 'Folder access required'
                  : 'Folder unavailable'
              }
              detail="Use the controls above to reopen this folder."
            />
          ) : !entries.length ? (
            <Empty
              icon={query ? 'search' : 'folder'}
              title={
                query
                  ? search.running
                    ? 'Searching…'
                    : 'No matching files'
                  : 'This folder is empty'
              }
              detail={
                query
                  ? 'Try a different name or include subfolders.'
                  : 'Create a folder or drop files here.'
              }
            />
          ) : pane.mode === 'grid' ? (
            <GridView {...viewProps} />
          ) : pane.mode === 'columns' ? (
            <ColumnsView path={path} navigation={columns} {...viewProps} />
          ) : pane.mode === 'gallery' ? (
            <GalleryView {...viewProps} />
          ) : (
            <>
              <ListView {...viewProps} />
              {tree.monitors}
            </>
          )}
        </FileTable>
      </div>
      <footer className="folder-status">
        <span>
          {entries.length.toLocaleString()} items
          {selection.length ? ` · ${selection.length} selected` : ''}
        </span>
        <SelectionSize
          entries={selected}
          fallback={search.summary || (pane.showHidden ? 'Hidden files shown' : '')}
        />
      </footer>
      {menu && (
        <ContextMenu
          position={menu}
          request={menu.request}
          label="File actions"
          onClose={() => setMenu(null)}
        />
      )}
      {fileDialogs.content}
    </div>
  );
});
