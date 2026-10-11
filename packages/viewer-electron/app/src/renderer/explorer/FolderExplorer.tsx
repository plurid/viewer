import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { FileEntry, FolderPane } from '../../domain/contracts';
import {
  formatBytes,
  indexEntries,
  reconcileSelection,
  selectedRange,
  sortEntries,
} from '../../domain/files';
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
import { useWorkspace } from '../workspace/context';
import { IconButton, Empty, Loading, NameDialog, Dialog } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { ColumnsView, GalleryView, GridView, ListView, type FileViewProps } from './views';
import { useFolder } from './useFolder';
import { useSearch } from './useSearch';
import { ContextMenu } from '../ui/ContextMenu';
import { useCommands, useCommandSource } from '../commands/context';
import { folderCommands } from '../commands/folder';
import { editable } from '../commands/editing';
import type { CommandContext, CommandRequest } from '../commands/registry';
import { DestinationDialog } from '../commands/DestinationDialog';
import { FileInformation } from './FileInformation';

export function FolderExplorer({ id, engineID }: { id: string; engineID?: string }) {
  const pane = useViewer((state) => activeWorkspace(state).panes.find((item) => item.id === id)) as
    FolderPane | undefined;
  const workspace = useWorkspace();
  const registry = useCommands();
  const listing = useFolder(pane?.path || getState().bootstrap.home);
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef('');
  const [query, setQuery] = useState('');
  const [subtree, setSubtree] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const selectionCache = useRef(new Map<string, FileEntry>());
  const columnScope = useRef<FileEntry[] | null>(null);
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'mkdir' | 'go-to';
    context: CommandContext;
  } | null>(null);
  const [destination, setDestination] = useState<{
    kind: 'copy' | 'move';
    context: CommandContext;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const [trash, setTrash] = useState<CommandContext | null>(null);
  const [info, setInfo] = useState<CommandContext | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; request: CommandRequest } | null>(null);
  const [dropping, setDropping] = useState(false);
  const path = pane?.path || '';
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
        )
      : [];
  }, [sources, showHidden, sort, descending, subtree, query]);
  const selected = useMemo(
    () =>
      selection
        .map((path) => sourceIndex.paths.get(path) || selectionCache.current.get(path))
        .filter((entry): entry is FileEntry => !!entry),
    [sourceIndex, selection],
  );
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  useEffect(() => {
    setSelection([]);
    anchor.current = '';
    setQuery('');
    setMenu(null);
    selectionCache.current.clear();
    columnScope.current = null;
  }, [path]);
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
  const open = useCallback(
    (entry: FileEntry, linked = false, another = false) => {
      if (entry.directory && !linked) navigate(id, entry.path);
      else workspace.open(entry, engineID, { another });
    },
    [workspace, engineID, id],
  );
  const select = useCallback(
    (entry: FileEntry, event: MouseEvent, scope = entries) => {
      columnScope.current = scope;
      for (const item of scope) selectionCache.current.set(item.path, item);
      selectionCache.current.set(entry.path, entry);
      setActivePane(id);
      surface.current?.focus({ preventScroll: true });
      if (event.shiftKey)
        setSelection((value) => [
          ...new Set([
            ...(event.metaKey || event.ctrlKey ? value : []),
            ...selectedRange(scope, anchor.current, entry.path),
          ]),
        ]);
      else if (event.metaKey || event.ctrlKey) {
        anchor.current = entry.path;
        setSelection((value) =>
          value.includes(entry.path)
            ? value.filter((path) => path !== entry.path)
            : [...value, entry.path],
        );
      } else {
        anchor.current = entry.path;
        setSelection([entry.path]);
      }
    },
    [entries, id],
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
          dialog: (kind, context) => setDialog({ kind, context }),
          trash: setTrash,
          info: setInfo,
          destination: (kind, context) => setDestination({ kind, context }),
          search: () => {
            if (searchOpen) closeSearch();
            else setSearchOpen(true);
          },
          path: () => setPathOpen((value) => !value),
          refresh: listing.refresh,
          selectAll: () => {
            const scope = pane?.mode === 'columns' ? columnScope.current || entries : entries;
            for (const entry of scope) selectionCache.current.set(entry.path, entry);
            setSelection(scope.map((entry) => entry.path));
          },
        }),
      valid: (invocation, live) =>
        invocation.workspaceID === live.workspaceID &&
        invocation.path === live.path &&
        !!live.folder,
    },
    [pane, selected, entries, searchOpen],
  );
  const command = (name: string) => {
    void registry.invoke(name, { paneID: id }).catch(report);
    setMenu(null);
  };
  if (!pane || pane.type !== 'folder') return <Empty title="Folder plane is unavailable" />;
  const viewProps: FileViewProps = {
    entries,
    selection,
    selectionSet,
    select,
    open,
    showHidden: pane.showHidden,
    context: (entry, event) => {
      event.preventDefault();
      selectionCache.current.set(entry.path, entry);
      if (!selectionSet.has(entry.path)) {
        setSelection([entry.path]);
        anchor.current = entry.path;
      }
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
      tabIndex={0}
      aria-label={`Folder ${path}`}
      onFocus={() => setActivePane(id)}
      onPointerDown={() => setActivePane(id)}
      onKeyDown={(event) => {
        if (editable(event.target) || document.querySelector('dialog[open], .context-menu')) return;
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
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          (pane.mode !== 'list' && ['ArrowLeft', 'ArrowRight'].includes(event.key))
        ) {
          event.preventDefault();
          event.stopPropagation();
          const index = scope.findIndex((entry) => entry.path === selection.at(-1));
          const stride =
            pane.mode === 'grid' && ['ArrowDown', 'ArrowUp'].includes(event.key)
              ? surface.current?.querySelector('.grid-row')?.childElementCount || 1
              : 1;
          const delta = ['ArrowDown', 'ArrowRight'].includes(event.key) ? stride : -stride;
          const entry = scope[Math.max(0, Math.min(scope.length - 1, index + delta))];
          if (entry) {
            selectionCache.current.set(entry.path, entry);
            if (event.shiftKey) {
              if (!anchor.current) anchor.current = entry.path;
              setSelection(selectedRange(scope, anchor.current, entry.path));
            } else {
              anchor.current = entry.path;
              setSelection([entry.path]);
            }
          }
        } else if (mod && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          for (const entry of scope) selectionCache.current.set(entry.path, entry);
          setSelection(scope.map((entry) => entry.path));
        } else if (mod && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          command(
            ({ c: 'copy', x: 'cut', v: 'paste' } as Record<string, string>)[
              event.key.toLowerCase()
            ],
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
          command('open-selection');
        } else if (mod && event.key.toLowerCase() === 'i') {
          event.preventDefault();
          command('info');
        } else if (event.key === 'Escape') {
          setSelection([]);
          setMenu(null);
        } else if (mod && event.key === 'Backspace') {
          event.preventDefault();
          command('trash');
        }
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
      <div
        className="folder-content"
        onContextMenu={(event) => {
          if (event.defaultPrevented || (event.target as HTMLElement).closest('[data-file-path]'))
            return;
          event.preventDefault();
          setActivePane(id);
          void refreshClipboard().catch(report);
          setMenu({
            x: event.clientX,
            y: event.clientY,
            request: { paneID: id, scope: 'folder', context: { selection: [], directory: path } },
          });
        }}
      >
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
        <span>
          {search.summary ||
            (selected.length
              ? formatBytes(
                  selected.reduce((size, entry) => size + (entry.directory ? 0 : entry.size), 0),
                )
              : pane.showHidden
                ? 'Hidden files shown'
                : '')}
        </span>
      </footer>
      {menu && (
        <ContextMenu
          position={menu}
          request={menu.request}
          label="File actions"
          onClose={() => setMenu(null)}
        />
      )}
      {dialog && (
        <NameDialog
          title={
            dialog.kind === 'rename'
              ? 'Rename file'
              : dialog.kind === 'mkdir'
                ? 'New folder'
                : 'Go to folder'
          }
          label={dialog.kind === 'go-to' ? 'Folder path' : 'Name'}
          maxLength={dialog.kind === 'go-to' ? 32768 : 255}
          initial={
            dialog.kind === 'rename'
              ? dialog.context.selection[0]?.name
              : dialog.kind === 'go-to'
                ? path
                : ''
          }
          action={dialog.kind === 'rename' ? 'Rename' : dialog.kind === 'mkdir' ? 'Create' : 'Go'}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog.kind === 'go-to') {
              const resolved =
                name === '~' || name.startsWith('~/')
                  ? getState().bootstrap.home + name.slice(1)
                  : name;
              const entry = await window.viewer.stat(resolved);
              if (!entry.directory) throw new Error('Choose a folder path.');
              navigate(id, entry.path);
            } else
              await operate(dialog.kind === 'rename' ? 'rename' : 'mkdir', {
                name,
                sources: dialog.context.selection.map((entry) => entry.path),
                destination: dialog.kind === 'mkdir' ? dialog.context.directory : undefined,
              });
          }}
        />
      )}
      {destination && (
        <DestinationDialog
          kind={destination.kind}
          context={destination.context}
          onClose={() => setDestination(null)}
        />
      )}
      {info && <FileInformation entries={[...info.selection]} onClose={() => setInfo(null)} />}
      {trash && (
        <Dialog title="Move to Trash?" onClose={() => setTrash(null)}>
          <p className="dialog-copy">
            Move{' '}
            {trash.selection.length === 1
              ? `“${trash.selection[0]?.name}”`
              : `${trash.selection.length} items`}{' '}
            to the macOS Trash?
          </p>
          <footer>
            <button onClick={() => setTrash(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() => {
                void operate('trash', {
                  sources: trash.selection.map((entry) => entry.path),
                }).catch(report);
                setTrash(null);
              }}
            >
              Move to Trash
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
