import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry } from '../../../domain/contracts';
import type { TrashItem, TrashSnapshot, TrashSortKey } from '../../../domain/files/trash';
import {
  originalTrashFolder,
  sortTrashItems,
  trashDateColumn,
  trashName,
} from '../../../domain/files/trash';
import { formatBytes } from '../../../domain/files/entries';
import { activeWorkspace, getState, useViewer } from '../../state/store';
import { useWorkspace } from '../../workspace/context';
import { openWorkspacePath } from '../../workspace/open-path';
import { FileIcon } from '../../explorer/views';
import { FileSelection } from '../../explorer/selection';
import { Dialog, Empty, IconButton, Loading } from '../primitives';
import { Icon } from '../Icon';
import { asFile, originUnavailable, trashDate } from './items';
import { TrashMenu } from './TrashMenu';
import { TrashPreview } from './TrashPreview';
import { TrashInformation } from './TrashInformation';
import { trashMenuActions } from './menu-actions';
import { errorMessage } from '../../../domain/errors';

export function Trash({ onClose }: { onClose(): void }) {
  const workspace = useWorkspace();
  const platform = useViewer((state) => state.bootstrap.platform);
  const title = trashName(platform);
  const rowID = useId();
  const [snapshot, setSnapshot] = useState<TrashSnapshot>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: TrashSortKey; descending: boolean }>({
    key: 'name',
    descending: false,
  });
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] }>();
  const [preview, setPreview] = useState<{ items: TrashItem[]; index: number }>();
  const [information, setInformation] = useState<TrashItem>();
  const scroll = useRef<HTMLDivElement>(null);
  const live = useRef(true),
    reading = useRef(false),
    queued = useRef(false);
  const folder = useRef<string | undefined>(undefined);
  const focusAfterRead = useRef(true);
  const selectionState = useRef({
    selection: [] as string[],
    anchor: '',
    cursor: '',
    cache: new Map<string, FileEntry>(),
  });
  const selection = useMemo(
    () =>
      new FileSelection(selectionState.current, (ids) => {
        selectionState.current.selection = ids;
        setSelected(ids);
      }),
    [],
  );
  const refresh = useCallback(async () => {
    if (reading.current) {
      queued.current = true;
      return;
    }
    reading.current = true;
    const requested = folder.current;
    try {
      const value = await window.viewer.trashList(requested);
      if (live.current && requested === folder.current) {
        setSnapshot(value);
        setError('');
        const present = new Set(value.items.map((item) => item.id));
        const remaining = selectionState.current.selection.filter((id) => present.has(id));
        selectionState.current.selection = remaining;
        setSelected(remaining);
      }
    } catch (error) {
      if (live.current && requested === folder.current) {
        setError(errorMessage(error));
        setSnapshot(undefined);
      }
    } finally {
      reading.current = false;
      if (live.current && requested === folder.current) setLoading(false);
      if (live.current && queued.current) {
        queued.current = false;
        void refresh();
      }
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!reading.current) void refresh();
    }, 5000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      live.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const dateKind = trashDateColumn(snapshot?.items ?? []);
  const sortKey = sort.key === 'date' && !dateKind ? 'name' : sort.key;
  const items = useMemo(
    () =>
      sortTrashItems(
        (snapshot?.items ?? []).filter((item) =>
          item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        ),
        sortKey,
        sort.descending,
        dateKind,
      ),
    [snapshot, query, sortKey, sort.descending, dateKind],
  );
  const files = useMemo(() => items.map(asFile), [items]);
  const selectedIDs = useMemo(() => new Set(selected), [selected]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIDs.has(item.id)),
    [items, selectedIDs],
  );
  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : undefined;
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 40,
    overscan: 8,
  });
  const unavailable =
    snapshot?.locations.filter((location) => location.state === 'unavailable') ?? [];
  const ancestors = snapshot?.ancestors ?? [];
  useEffect(() => {
    if (!loading && focusAfterRead.current && scroll.current) {
      focusAfterRead.current = false;
      scroll.current.focus({ preventScroll: true });
    }
  }, [loading]);
  const go = (id?: string) => {
    focusAfterRead.current = true;
    folder.current = id;
    selection.clear();
    setMenu(undefined);
    setQuery('');
    setLoading(true);
    setActionError('');
    setNotice('');
    void refresh();
  };
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await work();
    } catch (error) {
      if (live.current) setActionError(errorMessage(error));
    } finally {
      await refresh();
      if (live.current) setBusy(false);
    }
  }
  async function restore(ids: string[], destination: 'original' | 'choose') {
    const value = await window.viewer.trashRestore(ids, destination);
    if (value.cancelled) return false;
    if (live.current) {
      setNotice(`${value.restored} ${value.restored === 1 ? 'item restored' : 'items restored'}.`);
      selection.clear();
      await refresh();
    }
    return true;
  }
  async function openOriginal(item: TrashItem) {
    if (!item.originalPath) return;
    const workspaceID = activeWorkspace().id;
    let opened: boolean;
    try {
      opened = await openWorkspacePath(
        originalTrashFolder(item.originalPath),
        {
          workspaceID,
          another: true,
          directory: true,
        },
        workspace,
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT' || code === 'ENOTDIR')
        throw new Error(
          'The original folder no longer exists. Use Restore to… to choose another folder.',
        );
      throw error;
    }
    if (!live.current) return;
    if (!opened) {
      setNotice('Opening the original folder was cancelled.');
      return;
    }
    const paneID = getState().activePane;
    onClose();
    requestAnimationFrame(() => {
      if (activeWorkspace().id === workspaceID && paneID) workspace.focusPane(paneID);
    });
  }
  const sortHeading = (key: TrashSortKey, label: string) => {
    const active = sortKey === key;
    const direction = sort.descending ? 'descending' : 'ascending';
    return (
      <button
        aria-pressed={active}
        aria-label={
          active
            ? `${label}: sorted ${direction}. Sort ${sort.descending ? 'ascending' : 'descending'}`
            : `${label}: sort ascending`
        }
        onClick={() => setSort({ key, descending: active ? !sort.descending : false })}
      >
        {label}
        {active && <Icon name={sort.descending ? 'down' : 'up'} size={12} />}
      </button>
    );
  };
  const showPreview = (ids: string[]) => {
    const wanted = new Set(ids);
    const chosen = items.filter(
      (item) => wanted.has(item.id) && !item.directory && item.previewable !== false,
    );
    if (chosen.length) setPreview({ items: chosen, index: 0 });
  };
  const open = (item: TrashItem) => (item.directory ? go(item.id) : showPreview([item.id]));
  const closeMenu = () => {
    setMenu(undefined);
    scroll.current?.focus({ preventScroll: true });
  };
  const menuIDs = new Set(menu?.ids);
  const menuItems = menu ? items.filter((item) => menuIDs.has(item.id)) : [];
  const menuActions = trashMenuActions(menuItems, menu?.ids ?? [], {
    go,
    showPreview,
    act: (work) => void action(work),
    restore,
    openOriginal,
    information: setInformation,
  });
  return (
    <>
      <Dialog title={title} onClose={onClose} className="trash-dialog">
        <div className={`trash-toolbar ${folder.current ? 'has-parent' : ''}`}>
          {folder.current && (
            <>
              <IconButton
                icon="left"
                label="Back to parent folder"
                disabled={loading}
                onClick={() => go(ancestors.at(-2)?.id)}
              />
              <nav className="trash-breadcrumbs" aria-label="Trash path">
                <button onClick={() => go()}>
                  <Icon name="trash" size={16} />
                  {title}
                </button>
                {ancestors.map((item, index) => (
                  <span key={item.id}>
                    <Icon name="right" size={12} />
                    <button
                      onClick={() => go(item.id)}
                      aria-current={index === ancestors.length - 1 ? 'page' : undefined}
                      title={item.name}
                    >
                      {item.name}
                    </button>
                  </span>
                ))}
              </nav>
            </>
          )}
          <div className="trash-selection-actions">
            <IconButton
              icon="eye"
              label="Quick Look"
              disabled={
                busy || !selectedItems.some((item) => !item.directory && item.previewable !== false)
              }
              onClick={() => showPreview(selected)}
            />
            <button
              disabled={busy || !selectedItems.length || !window.viewerNative}
              onClick={() =>
                void action(() =>
                  restore(
                    selected,
                    selectedItems.every((item) => item.originalPath) ? 'original' : 'choose',
                  ),
                )
              }
            >
              {selectedItems.length && selectedItems.every((item) => item.originalPath)
                ? 'Restore'
                : 'Restore to…'}
            </button>
          </div>
          <label className="trash-search">
            <Icon name="search" size={16} />
            <input
              aria-label="Search Trash"
              placeholder="Search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                selection.clear();
              }}
            />
          </label>
        </div>
        <div className="trash-body">
          {loading && <Loading label={`Loading ${title}…`} />}
          {(error || actionError) && (
            <p className="error trash-message" role="alert">
              {actionError || error}
            </p>
          )}
          {unavailable.length > 0 && (
            <div className="trash-access" aria-label="Unavailable Trash locations">
              {unavailable.map((location) => (
                <div key={location.id}>
                  <div>
                    <strong>{location.name}</strong>
                    <p>{location.message}</p>
                  </div>
                  {location.canRequestAccess && (
                    <button
                      disabled={busy}
                      onClick={() => void action(() => window.viewer.trashAccess(location.id))}
                    >
                      {location.access === 'privacy'
                        ? 'Open Privacy Settings…'
                        : 'Allow folder access…'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <Empty
              icon={ancestors.length ? 'folder' : 'trash'}
              title={
                query
                  ? 'No matching files'
                  : ancestors.length
                    ? 'Folder is empty'
                    : unavailable.length
                      ? `${title} is unavailable`
                      : `${title} is empty`
              }
            />
          )}
          {!loading && items.length > 0 && (
            <div className={`trash-inventory ${dateKind ? 'with-date' : ''}`}>
              <div className="trash-row trash-heading" role="group" aria-label="Sort Trash">
                {sortHeading('name', 'Name')}
                {sortHeading('originalPath', 'Original location')}
                {dateKind &&
                  sortHeading('date', dateKind === 'deleted' ? 'Date deleted' : 'Date added')}
                {sortHeading('size', 'Size')}
              </div>
              <div
                className="trash-scroll"
                ref={scroll}
                tabIndex={0}
                role="listbox"
                aria-label={`${title} items`}
                aria-multiselectable
                aria-activedescendant={
                  items.some((item) => item.id === selectionState.current.cursor)
                    ? `${rowID}-${selectionState.current.cursor}`
                    : undefined
                }
                onClick={(event) => {
                  if (
                    event.target === event.currentTarget ||
                    (event.target as Element).classList.contains('trash-rows')
                  )
                    selection.clear();
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || menu) return;
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                    event.preventDefault();
                    selection.all(files);
                  } else if (
                    event.key === 'ContextMenu' ||
                    (event.key === 'F10' && event.shiftKey)
                  ) {
                    event.preventDefault();
                    const target = document.getElementById(
                      `${rowID}-${selectionState.current.cursor}`,
                    );
                    if (selected.length && target) {
                      const rect = target.getBoundingClientRect();
                      setMenu({ x: rect.left + 24, y: rect.bottom, ids: selected });
                    }
                  } else if (
                    (event.key === 'Backspace' || (event.key === 'ArrowUp' && event.altKey)) &&
                    folder.current
                  ) {
                    event.preventDefault();
                    go(ancestors.at(-2)?.id);
                  } else if (
                    ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    selection.move(
                      files,
                      event.key,
                      event.shiftKey,
                      1,
                      Math.max(1, Math.floor((scroll.current?.clientHeight || 400) / 40)),
                    );
                    const index = files.findIndex(
                      (entry) => entry.path === selectionState.current.cursor,
                    );
                    if (index >= 0) rows.scrollToIndex(index);
                  } else if (event.key === ' ' && !event.metaKey && !event.ctrlKey) {
                    event.preventDefault();
                    showPreview(selected);
                  } else if (
                    event.key === 'Enter' &&
                    selectedItems.length === 1 &&
                    selectedItems[0]
                  ) {
                    event.preventDefault();
                    open(selectedItems[0]);
                  } else if (event.key === 'Escape' && selected.length) {
                    event.preventDefault();
                    event.stopPropagation();
                    selection.clear();
                  } else if (
                    event.key.length === 1 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey
                  ) {
                    const matched = selection.type(files, event.key);
                    if (matched) rows.scrollToIndex(files.indexOf(matched));
                  }
                  event.stopPropagation();
                }}
              >
                <div
                  className="trash-rows"
                  style={{ height: rows.getTotalSize(), position: 'relative' }}
                >
                  {rows.getVirtualItems().map((row) => {
                    const item = items[row.index],
                      file = files[row.index];
                    if (!item || !file) return null;
                    return (
                      <div
                        role="option"
                        aria-selected={selectedIDs.has(item.id)}
                        id={`${rowID}-${item.id}`}
                        data-trash-id={item.id}
                        className={`trash-row ${selectedIDs.has(item.id) ? 'is-selected' : ''}`}
                        key={item.id}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: row.size,
                          transform: `translateY(${row.start}px)`,
                        }}
                        onClick={(event) => {
                          scroll.current?.focus({ preventScroll: true });
                          selection.click(file, event, files);
                        }}
                        onDoubleClick={() => open(item)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selection.target(file);
                          setMenu({
                            x: event.clientX,
                            y: event.clientY,
                            ids: [...selectionState.current.selection],
                          });
                        }}
                      >
                        <span className="trash-filename" title={item.name}>
                          <FileIcon entry={file} size={18} />
                          <span>{item.name}</span>
                          {item.directory && <Icon name="right" size={12} />}
                        </span>
                        <span
                          className="muted"
                          title={
                            item.originalPath
                              ? originalTrashFolder(item.originalPath)
                              : originUnavailable
                          }
                        >
                          {item.originalPath
                            ? originalTrashFolder(item.originalPath)
                            : 'Unavailable'}
                        </span>
                        {dateKind && (
                          <span
                            title={
                              dateKind === 'added'
                                ? 'macOS date added to this Trash folder, not a recorded deletion time.'
                                : undefined
                            }
                          >
                            {trashDate(dateKind === 'deleted' ? item.deleted : item.addedToTrash)}
                          </span>
                        )}
                        <span>{item.directory ? '—' : formatBytes(item.size)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {snapshot?.truncated && (
            <p className="trash-message" role="status">
              Showing the first {items.length.toLocaleString()} items. The list is incomplete.
            </p>
          )}
          {notice && (
            <p className="trash-message" role="status">
              {notice}
            </p>
          )}
        </div>
        {selectedItem && (
          <section className="trash-origin-details" aria-label="Original location details">
            <div>
              <span className="muted">Original location</span>
              {selectedItem.originalPath ? (
                <p className="trash-original-path">{selectedItem.originalPath}</p>
              ) : (
                <p>{originUnavailable}</p>
              )}
            </div>
            {selectedItem.originalPath ? (
              <button disabled={busy} onClick={() => void action(() => openOriginal(selectedItem))}>
                Open original folder in plane
              </button>
            ) : (
              <button
                disabled={busy || !window.viewerNative}
                onClick={() => void action(() => restore([selectedItem.id], 'choose'))}
              >
                Restore to…
              </button>
            )}
          </section>
        )}
        <footer className="trash-footer">
          <span className="muted" role="status">
            {snapshot
              ? `${items.length.toLocaleString()} ${items.length === 1 ? 'item' : 'items'}${selected.length ? ` · ${selected.length} selected` : ''}`
              : ''}
          </span>
          <button
            className="danger trash-empty"
            disabled={busy || loading || !snapshot?.canEmpty || !window.viewerNative}
            onClick={(event) => {
              // Synthetic click()/dispatchEvent cannot start a destructive UI.
              // The bridge only presents native confirmation; it cannot approve.
              if (event.nativeEvent.isTrusted && snapshot)
                void action(() => window.viewer.trashConfirmation(snapshot.revision));
            }}
          >
            Empty {title}…
          </button>
          <div className="trash-utility-actions">
            <button disabled={busy || loading} onClick={() => void refresh()}>
              Refresh
            </button>
            <button onClick={onClose}>Done</button>
          </div>
        </footer>
        {menu && !busy && <TrashMenu position={menu} actions={menuActions} onClose={closeMenu} />}
      </Dialog>
      {preview && (
        <TrashPreview
          items={preview.items}
          initial={preview.index}
          restore={restore}
          onClose={() => setPreview(undefined)}
        />
      )}
      {information && (
        <TrashInformation
          item={information}
          busy={busy}
          onClose={() => setInformation(undefined)}
          openOriginal={(item) => void action(() => openOriginal(item))}
          restore={(item) =>
            void action(() => restore([item.id], item.originalPath ? 'original' : 'choose'))
          }
        />
      )}
    </>
  );
}
