import { panePresentation } from '../../domain/preferences/folder-presentation';
import { registerFolderHandle } from './folder-handles';
import { matchesQuery } from '../../domain/search/query';
import { useFileQuery } from './useFileQuery';
import { nativeOpening } from './opening';
import { SearchCoverage } from './SearchCoverage';
import { markStartup } from '../app/startup';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import type { FileEntry, FolderPane } from '../../domain/contracts';
import {
  groupEntries,
  indexEntries,
  reconcileSelection,
  sortEntries,
} from '../../domain/files/entries';
import {
  activeWorkspace,
  getState,
  historyNavigate,
  navigate,
  report,
  refreshClipboard,
  setActivePane,
  updatePane,
  useViewer,
  useFolderPresentation,
} from '../state/store';
import { browseSession, updateBrowseSession, useBrowseField } from '../workspace/sessions';
import { useWorkspace } from '../workspace/context';
import { IconButton, Empty, Loading } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { FolderAccessButton, needsFolderAccess } from '../ui/permissions/FolderAccessButton';
import { ColumnsView, GalleryView, GridView, ListView, type FileViewProps } from './views';
import { refreshFolder, useFolder } from './useFolder';
import { folderCommandPath } from '../commands/folder-target';
import { recordScroll, useScrollRestore } from './scroll-restore';
import { mouseHistoryDirection, mouseHistoryTarget } from './mouse-navigation';
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
import { FILE_DRAG, rememberDrag, useFileDrop } from './file-drop';
import { folderDragNavigation } from './folder-drag';
import { blankFileSpace, useFileKeyboard, useFileSelection, type FileModifiers } from './selection';
import { useContextPublish } from './context-publish';
import { useLensGrouping } from './folder-sections';
import { fixedSections, gridRows, gridStep, type ViewSection } from './sections';
import { lensCommands, lensGroupMenuIDs } from '../commands/lenses';
import { useLensDialogs } from './LensDialogs';
import { MapView, type MapControls } from './map/MapView';
import { activeLens } from '../state/lenses';
import { resolveLens } from '../../domain/files/lenses';

export const FolderExplorer = memo(function FolderExplorer({ id }: { id: string }) {
  const storedPane = useViewer((state) =>
    activeWorkspace(state).panes.find((item) => item.id === id),
  ) as FolderPane | undefined;
  const workspace = useWorkspace();
  const registry = useCommands();
  const activeID = useViewer((state) => state.activePane);
  const recipes = useViewer((state) => state.settings.settings.recipes);
  const presentation = useFolderPresentation(storedPane?.path || '');
  const pane = useMemo(
    () => (storedPane ? { ...storedPane, ...panePresentation(presentation) } : undefined),
    [storedPane, presentation],
  );
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
  const selectionCache = session.cache;
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
  // Typing stays responsive in large folders; the filtered list follows a moment later.
  const filter = useDeferredValue(query);
  // the file query language (domain/search/query.ts): ext:md, size>10mb, modified<7d, tag:red
  const filterQuery = useFileQuery(filter, path);
  const visible = useMemo(() => {
    return sort
      ? sortEntries(
          sources.filter(
            (entry) =>
              (showHidden || !entry.hidden) &&
              (subtree || matchesQuery(filterQuery.query, entry, filterQuery.facts)),
          ),
          sort,
          descending ?? false,
          foldersFirst,
        )
      : [];
  }, [sources, showHidden, sort, descending, subtree, filterQuery, foldersFirst]);
  const hasRows = visible.length > 0;
  useEffect(() => {
    if (hasRows) markStartup('viewer:first-rows');
  }, [hasRows]);
  // Results from subfolders are not this folder's items, so a lens cannot group them.
  const groupBy =
    presentation.group === 'lens' && subtree && query.trim() ? 'none' : presentation.group;
  const lensDialogs = useLensDialogs();
  const sectionContext = useCallback(
    (section: Pick<ViewSection, 'group' | 'label'>, event: MouseEvent) => {
      setActivePane(id);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        request: {
          paneID: id,
          scope: 'folder',
          ids: lensGroupMenuIDs,
          context: {
            selection: [],
            directory: path,
            lensGroup: { id: section.group ?? null, label: section.label },
          },
        },
      });
    },
    [id, path],
  );
  const lensGrouping = useLensGrouping(
    path,
    listing.entries,
    visible,
    { group: groupBy, lens: presentation.lens },
    !!filter.trim(),
    sectionContext,
  );
  // The Map and the Gallery have no heading to expand, so a group collapsed in the list keeps its
  // items there; they left the Map, and the Gallery lost the group's label as well.
  const collapsing = pane?.mode !== 'map' && pane?.mode !== 'gallery';
  const baseEntries = useMemo(
    () =>
      groupBy === 'lens'
        ? ((collapsing ? lensGrouping.entries : lensGrouping.ordered) ?? visible)
        : groupEntries(visible, groupBy),
    [groupBy, collapsing, lensGrouping.entries, lensGrouping.ordered, visible],
  );
  // The Map shows the chosen lens even when the list is grouped another way.
  const mapDocument = activeLens(lensGrouping.view.data, {
    group: 'lens',
    lens: presentation.lens,
  });
  const commandLens = lensGrouping.document ?? mapDocument;
  const commandResolved = useMemo(
    () =>
      commandLens === lensGrouping.document
        ? lensGrouping.resolved
        : commandLens && resolveLens(commandLens.lens, listing.entries),
    [commandLens, lensGrouping.document, lensGrouping.resolved, listing.entries],
  );
  const mapControls = useRef<MapControls | null>(null);
  const tree = useListNavigation(
    id,
    path,
    baseEntries,
    pane?.mode === 'list' && !query && !listing.loading && !listing.unavailable,
  );
  const entries = pane?.mode === 'list' ? tree.entries : baseEntries;
  const sections = useMemo(
    () =>
      groupBy === 'lens'
        ? lensGrouping.sections
        : pane?.mode === 'map'
          ? undefined
          : fixedSections(entries, groupBy, tree.depths),
    [groupBy, lensGrouping.sections, pane?.mode, entries, tree.depths],
  );
  const selected = useMemo(
    () =>
      selection
        .map((path) => sourceIndex.paths.get(path) || selectionCache.get(path))
        .filter((entry): entry is FileEntry => !!entry),
    [sourceIndex, selection, selectionCache],
  );
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const columns = useColumnNavigation(
    id,
    path,
    entries,
    pane?.mode === 'columns' && !listing.loading && !listing.unavailable,
    selecting,
  );
  const chooseColumn = columns.choose;
  const dragNavigation = useMemo(() => folderDragNavigation(id), [id]);
  const drops = useFileDrop(
    () => (pane?.mode === 'columns' ? columns.directory() : path),
    dragNavigation,
  );
  useEffect(() => {
    if (listing.loading || listing.unavailable) return;
    setSelection((value) => {
      const next = reconcileSelection(value, selectionCache, path, listingIndex);
      return next.length === value.length && next.every((file, index) => file === value[index])
        ? value
        : next;
    });
  }, [listingIndex, listing.loading, listing.unavailable, path, selectionCache, setSelection]);
  useScrollRestore(surface, session, pane?.mode, !listing.loading && !listing.unavailable);
  const opening = useViewer((state) => state.settings.settings.fileOpening);
  const open = useCallback(
    (entry: FileEntry, linked = false, another = false) => {
      // an application starts rather than opening as a folder (nativeOpening)
      if (nativeOpening(entry, opening, linked)) {
        void window.viewer.openExternal(entry.path).catch(report);
      } else if (entry.directory && !linked) navigate(id, entry.path);
      else {
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
      if (pane?.mode === 'columns') chooseColumn(entry, event, scope);
      else selecting.click(entry, event, scope);
    },
    [entries, id, selecting, pane?.mode, chooseColumn],
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
      definitions: () => [
        ...folderCommands({
          open: (entries, linked, another) => {
            for (const entry of entries) open(entry, linked, another);
          },
          contents: (entry) => navigate(id, entry.path),
          ...fileDialogs.actions,
          search: (context) => {
            const target = folderCommandPath(context) || path;
            if (target !== path) {
              navigate(id, target);
              browseSession(id, target);
              updateBrowseSession(id, target, { searchOpen: true });
              return;
            }
            if (searchOpen) closeSearch();
            else setSearchOpen(true);
          },
          path: (context) => {
            const target = folderCommandPath(context) || path;
            if (target !== path) {
              navigate(id, target);
              browseSession(id, target);
              updateBrowseSession(id, target, { pathOpen: true });
            } else setPathOpen((value) => !value);
          },
          refresh: (context) => refreshFolder(folderCommandPath(context) || path),
          selectAll: () => {
            const scope = pane?.mode === 'columns' ? columns.scope() : entries;
            selecting.all(scope);
          },
          invertSelection: () =>
            selecting.invert(pane?.mode === 'columns' ? columns.scope() : entries),
        }),
        ...lensCommands({
          folder: () => path,
          data: () => lensGrouping.view.data,
          document: () => commandLens,
          resolved: () => commandResolved,
          prompt: lensDialogs.open,
          selectGroup: (group) =>
            selecting.all(
              entries.filter(
                (entry) => (commandResolved?.placements.get(entry.path)?.group ?? null) === group,
              ),
            ),
        }),
      ],
      valid: (invocation, live) =>
        invocation.workspaceID === live.workspaceID &&
        invocation.path === live.path &&
        !!live.folder,
    },
    [
      pane,
      selected,
      entries,
      searchOpen,
      recipes,
      lensGrouping.view.data,
      commandLens,
      commandResolved,
    ],
  );
  // what :select and :deselect reach: the items shown and the selection
  const handleState = useRef({ entries, selected, selecting, path });
  handleState.current = { entries, selected, selecting, path };
  useEffect(
    () =>
      registerFolderHandle(id, {
        path: () => handleState.current.path,
        entries: () => handleState.current.entries,
        selected: () => handleState.current.selected,
        select: (chosen) => handleState.current.selecting.all(chosen),
      }),
    [id],
  );
  useContextPublish(id, activeID === id, selected, path);
  const command = (name: string) => {
    setMenu(null);
    void (async () => {
      if (name === 'paste' || name === 'paste-move') await refreshClipboard();
      await registry.invoke(name, { paneID: id });
    })().catch(report);
  };
  const handleKey = useFileKeyboard(id, (event) => {
    if (!pane) return;
    // On the Map, Option-arrows nudge the selection; Command-[ and ] still go back and forward.
    const direction = (
      { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const
    )[event.key as 'ArrowLeft'];
    if (
      pane.mode === 'map' &&
      direction &&
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      selection.length &&
      !editable(event.target)
    ) {
      event.preventDefault();
      event.stopPropagation();
      mapControls.current?.nudge(direction, event.shiftKey ? 64 : 8);
      return;
    }
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
        const page = Math.max(
          1,
          Math.floor(
            (surface.current?.querySelector('.file-scroll')?.clientHeight || 360) /
              (surface.current?.querySelector('[data-file-path]')?.getBoundingClientRect().height ||
                36),
          ),
        );
        if (pane.mode === 'map') mapControls.current?.move(key, range);
        else if (pane.mode === 'columns') columns.move(key, range);
        else if (
          pane.mode === 'grid' &&
          ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(key)
        ) {
          // By row and column, as the grid lays its groups out; a page is the rows that fit.
          const current = entries.findIndex((entry) => entry.path === session.cursor);
          const rowsAway =
            (['ArrowUp', 'PageUp'].includes(key) ? -1 : 1) * (key.startsWith('Page') ? page : 1);
          const columnCount =
            Number(surface.current?.querySelector<HTMLElement>('.grid-scroll')?.dataset.columns) ||
            1;
          const target = gridStep(gridRows(entries, sections, columnCount), current, rowsAway);
          const distance = target === undefined ? 1 : Math.abs(target - current);
          if (target === current) return;
          selecting.move(entries, key, range, distance, distance);
        } else selecting.move(entries, key, range, 1, page);
      },
    });
  });
  if (!pane) return <Empty title="Folder is unavailable" />;
  const viewProps: FileViewProps = {
    paneID: id,
    entries,
    presentation,
    depths: tree.depths,
    expanded: tree.expanded,
    toggle: tree.toggle,
    selection,
    cursor: session.cursor,
    selectionSet,
    select,
    region: (found, base) => selecting.region(found, base),
    open,
    showHidden: pane.showHidden,
    sections,
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
        rememberDrag(
          files.flatMap((path) => selectionCache.get(path) || sourceIndex.paths.get(path) || []),
        );
        void window.viewer.fileDragStart(files).catch(report);
        return;
      }
      event.dataTransfer.setData(FILE_DRAG, JSON.stringify(files));
      event.dataTransfer.effectAllowed = 'copyMove';
      const shortcuts = files.flatMap((path) => {
        const item = selectionCache.get(path) || sourceIndex.paths.get(path);
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
        if (pane) recordScroll(session, pane.mode, event.target as HTMLElement);
      }}
      tabIndex={0}
      aria-label={`Folder ${path}`}
      onFocus={() => setActivePane(id)}
      onPointerDown={() => setActivePane(id)}
      // The mouse's side buttons go back and forward, as in Finder.
      onMouseDown={(event) => {
        if (mouseHistoryDirection(event.button)) event.preventDefault();
      }}
      onMouseUp={(event) => {
        const direction = mouseHistoryDirection(event.button);
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        setActivePane(id);
        const current = activeWorkspace().panes.find((item) => item.id === id);
        const target = current?.type === 'folder' && mouseHistoryTarget(current, direction);
        if (!target) return;
        if ('history' in target) historyNavigate(id, target.history);
        else navigate(id, target.parent);
      }}
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
            placeholder={
              subtree
                ? 'Search subfolders: name ext:md size>10mb modified<7d tag:red'
                : 'Filter: name ext:md size>10mb modified<7d tag:red'
            }
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
          <button
            disabled={!query.trim()}
            onClick={() => {
              workspace.newSearch(query, query, path, subtree, true);
            }}
          >
            Search contents
          </button>
          {search.running && (
            <IconButton icon="pause" label="Cancel search" onClick={search.cancel} />
          )}
        </div>
      )}
      {searchOpen && query && filterQuery.problem && (
        <p className="search-problem" role="status">
          {filterQuery.problem}
        </p>
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
      {subtree && query.trim() && (
        <SearchCoverage
          result={search.indexed}
          streamed={search.streamed}
          cancelled={search.cancelled}
          request={{ query, root: path, showHidden: pane.showHidden, recursive: true }}
        />
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
          ) : listing.unavailable && !query ? (
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
                    : subtree && search.partial
                      ? 'No matches in the available search data'
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
          ) : pane.mode === 'map' ? (
            <MapView
              {...viewProps}
              path={path}
              document={mapDocument}
              listing={listing.entries}
              controls={mapControls}
              prompt={lensDialogs.open}
              regionContext={(region, event) =>
                sectionContext({ group: region.id, label: region.name }, event)
              }
            />
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
          {entries.length.toLocaleString()} {entries.length === 1 ? 'item' : 'items'}
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
      {lensDialogs.content}
    </div>
  );
});
