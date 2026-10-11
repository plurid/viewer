import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { FileEntry, FolderPane } from '../../domain/contracts';
import { indexEntries, reconcileSelection, sortEntries } from '../../domain/files';
import {
  activeWorkspace,
  getState,
  navigate,
  report,
  refreshClipboard,
  setActivePane,
  updatePane,
  useViewer,
} from '../state/store';
import { browseSession, useBrowseField } from '../workspace/sessions';
import { useWorkspace } from '../workspace/context';
import { IconButton, Empty, Loading } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { ColumnsView, GalleryView, GridView, ListView, type FileViewProps } from './views';
import { useFolder } from './useFolder';
import { useSearch } from './useSearch';
import { ContextMenu } from '../ui/ContextMenu';
import { useCommands, useCommandSource } from '../commands/context';
import { folderCommands } from '../commands/folder';
import { editable } from '../commands/editing';
import type { CommandRequest } from '../commands/registry';
import { revealFile } from './anchors';
import { SelectionSize } from './sizes';
import { useFileDialogs } from './FileDialogs';
import { blankFileSpace, fileControlOwnsKey, useFileKeyboard, useFileSelection } from './selection';

export const FolderExplorer = memo(function FolderExplorer({
  id,
  engineID,
}: {
  id: string;
  engineID?: string;
}) {
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id)) as
    FolderPane | undefined;
  const workspace = useWorkspace();
  const registry = useCommands();
  const activeID = useViewer((state) => state.activePane);
  const recipes = useViewer((state) => state.settings.settings.recipes);
  const foldersFirst = useViewer((state) => state.settings.settings.browsing.foldersFirst);
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
  const columnScope = useRef<FileEntry[] | null>(null);
  const fileDialogs = useFileDialogs();
  const [searchOpen, setSearchOpen] = useBrowseField(id, path, 'searchOpen');
  const [pathOpen, setPathOpen] = useBrowseField(id, path, 'pathOpen');
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest } | null>(null);
  const [dropping, setDropping] = useState(false);
  const search = useSearch(path, query, subtree, pane?.showHidden || false);
  const sources = subtree && query.trim() ? search.entries : listing.entries;
  const sourceIndex = useMemo(() => indexEntries(sources), [sources]);
  const listingIndex = useMemo(() => indexEntries(listing.entries), [listing.entries]);
  const showHidden = pane?.showHidden;
  const sort = pane?.sort;
  const descending = pane?.descending;
  const entries = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return sort
      ? sortEntries(
          sources.filter(
            (entry) =>
              (showHidden || !entry.hidden) &&
              (subtree || !query || entry.name.toLocaleLowerCase().includes(needle)),
          ),
          sort,
          descending ?? false,
          foldersFirst,
        )
      : [];
  }, [sources, showHidden, sort, descending, subtree, query, foldersFirst]);
  const selected = useMemo(
    () =>
      selection
        .map((path) => sourceIndex.paths.get(path) || selectionCache.current.get(path))
        .filter((entry): entry is FileEntry => !!entry),
    [sourceIndex, selection],
  );
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  useEffect(() => {
    if (listing.loading || listing.error) return;
    setSelection((value) => {
      const next = reconcileSelection(value, selectionCache.current, path, listingIndex);
      return next.length === value.length && next.every((file, index) => file === value[index])
        ? value
        : next;
    });
  }, [listingIndex, listing.loading, listing.error, path]);
  const operate = useCallback(
    async (
      kind: 'copy' | 'move' | 'duplicate' | 'rename' | 'mkdir' | 'trash',
      options: { name?: string; destination?: string; sources?: string[] } = {},
    ) => {
      await window.viewer.operate({
        kind,
        sources: options.sources ?? selection,
        destination: options.destination,
        name: options.name,
      });
    },
    [selection],
  );
  useEffect(() => {
    const content = surface.current?.querySelector('.file-scroll');
    if (content) content.scrollTop = session.scroll;
  }, [id, listing.loading]);
  const open = useCallback(
    (entry: FileEntry, linked = false, another = false) => {
      if (entry.directory && !linked) navigate(id, entry.path);
      else {
        const origin = activeWorkspace().id;
        void revealFile(id, entry.path)
          .then((link) => {
            if (
              activeWorkspace().id === origin &&
              activeWorkspace().panes.some((pane) => pane.id === id && pane.path === path)
            )
              workspace.open(entry, engineID, { another, link });
          })
          .catch(report);
      }
    },
    [workspace, engineID, id, path],
  );
  const select = useCallback(
    (entry: FileEntry, event: MouseEvent, scope = entries) => {
      columnScope.current = scope;
      setActivePane(id);
      surface.current?.focus({ preventScroll: true });
      selecting.click(entry, event, scope);
    },
    [entries, id, selecting],
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
        paneID: id,
        folder: pane,
        searchOpen,
        directory: pane?.mode === 'columns' ? selected[0]?.parent || path : path,
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
            const scope = pane?.mode === 'columns' ? columnScope.current || entries : entries;
            selecting.all(scope);
          },
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
    void registry.invoke(name, { paneID: id }).catch(report);
    setMenu(null);
  };
  const handleKey = useFileKeyboard(id, (event) => {
    if (
      !pane ||
      editable(event.target) ||
      fileControlOwnsKey(event) ||
      document.querySelector('dialog[open], .context-menu')
    )
      return;
    const mod = event.metaKey || event.ctrlKey;
    const scope = pane.mode === 'columns' ? columnScope.current || entries : entries;
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      command('back');
    } else if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      command('forward');
    } else if (mod && event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      command('parent');
    } else if (
      [
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const stride =
        pane.mode === 'grid' && ['ArrowDown', 'ArrowUp'].includes(event.key)
          ? surface.current?.querySelector('.grid-row')?.childElementCount || 1
          : 1;
      selecting.move(scope, event.key, event.shiftKey, stride);
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      selecting.all(scope);
    } else if (mod && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      command(
        ({ c: 'copy', x: 'cut', v: 'paste' } as Record<string, string>)[event.key.toLowerCase()],
      );
    } else if (event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      command('quick-preview');
    } else if (event.key === 'Enter' && !mod) {
      event.preventDefault();
      event.stopPropagation();
      command('rename');
    } else if (mod && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      event.stopPropagation();
      command('open-selection');
    } else if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      event.stopPropagation();
      command('info');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      selecting.clear();
      setMenu(null);
    } else if (mod && event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      command('trash');
    }
  });
  if (!pane || pane.type !== 'folder') return <Empty title="Folder plane is unavailable" />;
  const viewProps: FileViewProps = {
    entries,
    selection,
    cursor: session.cursor,
    selectionSet,
    select,
    open,
    showHidden: pane.showHidden,
    context: (entry, event) => {
      event.preventDefault();
      selecting.target(entry);
      setActivePane(id);
      void refreshClipboard().catch(report);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        request: {
          paneID: id,
          scope: 'files',
          context: {
            selection: selectionSet.has(entry.path) ? selected : [entry],
            directory: pane.mode === 'columns' ? entry.parent : path,
          },
        },
      });
    },
    drag: (entry, event) => {
      const files = selectionSet.has(entry.path) ? selection : [entry.path];
      event.dataTransfer.setData('application/x-viewer-files', JSON.stringify(files));
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
      className={`folder-explorer ${dropping ? 'drop-target' : ''}`}
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
          columnScope.current = null;
          surface.current?.focus({ preventScroll: true });
        }
      }}
      onContextMenu={(event) => {
        if (!blankFileSpace(event.target)) return;
        event.preventDefault();
        setActivePane(id);
        void refreshClipboard().catch(report);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          request: { paneID: id, scope: 'folder', context: { selection: [], directory: path } },
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
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-viewer-files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
          setDropping(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        const data = event.dataTransfer.getData('application/x-viewer-files');
        if (!data) return;
        try {
          const files: unknown = JSON.parse(data);
          if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) return;
          void operate(event.altKey ? 'copy' : 'move', { sources: files, destination: path }).catch(
            report,
          );
        } catch {
          report('The dragged file selection could not be read.');
        }
      }}
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
          <button onClick={listing.refresh}>Retry</button>
        </div>
      )}
      {pane.mode === 'list' && (
        <div className="file-head">
          <button
            onClick={() =>
              updatePane(id, { sort: 'name', descending: pane.sort === 'name' && !pane.descending })
            }
          >
            Name {pane.sort === 'name' && (pane.descending ? '↓' : '↑')}
          </button>
          <button
            onClick={() =>
              updatePane(id, {
                sort: 'modified',
                descending: pane.sort === 'modified' && !pane.descending,
              })
            }
          >
            Date modified
          </button>
          <button
            onClick={() =>
              updatePane(id, { sort: 'kind', descending: pane.sort === 'kind' && !pane.descending })
            }
          >
            Kind
          </button>
          <button
            onClick={() =>
              updatePane(id, { sort: 'size', descending: pane.sort === 'size' && !pane.descending })
            }
          >
            Size
          </button>
        </div>
      )}
      <div className="folder-content">
        {listing.loading && !subtree ? (
          <Loading label="Reading folder…" />
        ) : !entries.length ? (
          <Empty
            icon={query ? 'search' : 'folder'}
            title={
              query ? (search.running ? 'Searching…' : 'No matching files') : 'This folder is empty'
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
          <ColumnsView path={path} {...viewProps} />
        ) : pane.mode === 'gallery' ? (
          <GalleryView {...viewProps} />
        ) : (
          <ListView {...viewProps} />
        )}
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
