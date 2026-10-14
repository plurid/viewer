import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry, Resource } from '../../domain/contracts';
import type { TrashItem, TrashSnapshot } from '../../domain/trash';
import { trashName } from '../../domain/trash';
import { formatBytes } from '../../domain/files';
import { useViewer } from '../state/store';
import { FileIcon } from '../explorer/views';
import { FileSelection } from '../explorer/selection';
import { PreviewHost } from '../previews/PreviewHost';
import type { ResolvedCommand } from '../commands/registry';
import { Dialog, Empty, IconButton, Loading } from './primitives';
import { ContextMenuResults } from './ContextMenuResults';
import { Icon, type IconName } from './Icon';

const asFile = (item: TrashItem): FileEntry => ({
  path: item.id,
  parent: '',
  name: item.name,
  extension: item.directory ? '' : item.name.split('.').slice(1).at(-1)?.toLowerCase() || '',
  kind: item.directory
    ? 'directory'
    : item.symbolicLink
      ? 'symlink'
      : item.previewable === false
        ? 'other'
        : 'file',
  directory: item.directory,
  size: item.size,
  modified: item.modified || 0,
  created: 0,
  hidden: item.name.startsWith('.'),
  mime: '',
  identity: item.id,
});
const date = (value?: string | number) => {
  if (!value) return '—';
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? '—' : time.toLocaleDateString();
};
type MenuAction = { id: string; label: string; icon: IconName; shortcut?: string; run(): void };

/** This menu stays inside the native dialog's top layer. It is deliberately not
 * registered in the command catalog: agents cannot publish or invoke its UI. */
function TrashMenu({
  position,
  actions,
  onClose,
}: {
  position: { x: number; y: number };
  actions: MenuAction[];
  onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = root.current?.querySelector<HTMLElement>('.context-menu');
    if (element) {
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(position.x, innerWidth - rect.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(position.y, innerHeight - rect.height - 8))}px`;
    }
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close.current();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [position]);
  const commands: ResolvedCommand[] = actions.map((action) => ({
    ...action,
    source: 'trash-ui',
    group: 'Files',
    aliases: [],
    primary: true,
    context: { scope: 'files', workspaceID: '', selection: [], jobs: [], clipboard: null },
  }));
  return (
    <div
      ref={root}
      className="trash-context-menu"
      style={{ '--menu-left': `${position.x}px`, '--menu-top': `${position.y}px` } as CSSProperties}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ContextMenuResults
        commands={commands}
        recent={[]}
        focused
        onClose={onClose}
        onSelect={(command) => {
          onClose();
          requestAnimationFrame(() => actions.find((action) => action.id === command.id)?.run());
        }}
      />
    </div>
  );
}

function TrashPreview({
  items,
  initial,
  onClose,
  restore,
}: {
  items: TrashItem[];
  initial: number;
  onClose(): void;
  restore(ids: string[], destination: 'original' | 'choose'): Promise<boolean>;
}) {
  const [index, setIndex] = useState(initial);
  const [resource, setResource] = useState<Resource>();
  const [error, setError] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [busy, setBusy] = useState(false);
  const item = items[index];
  useEffect(() => {
    let closed = false,
      owned: Resource | undefined;
    setResource(undefined);
    setError('');
    setRestoreError('');
    void window.viewer
      .trashPreview(item.id)
      .then((value) => {
        if (closed) {
          void window.viewer.release(value.id);
          return;
        }
        owned = value;
        setResource(value);
      })
      .catch((error) => {
        if (!closed) setError((error as Error).message);
      });
    return () => {
      closed = true;
      if (owned) void window.viewer.release(owned.id);
    };
  }, [item.id]);
  const step = (delta: number) => setIndex((index + delta + items.length) % items.length);
  const footer = (size: number, label?: string) => (
    <>
      {restoreError && (
        <p className="error trash-message" role="alert">
          {restoreError}
        </p>
      )}
      <footer className="quick-preview-footer">
        <span className="quick-preview-metadata">
          {label && <>{label} · </>}
          {formatBytes(size)} · {item.location}
        </span>
        <div className="quick-preview-actions">
          {items.length > 1 && (
            <div className="quick-preview-navigation">
              <IconButton icon="left" label="Previous file" onClick={() => step(-1)} />
              <span>
                {index + 1} / {items.length}
              </span>
              <IconButton icon="right" label="Next file" onClick={() => step(1)} />
            </div>
          )}
          <button
            disabled={busy || !window.viewerNative}
            onClick={() => {
              setBusy(true);
              setRestoreError('');
              void restore([item.id], item.originalPath ? 'original' : 'choose')
                .then((restored) => {
                  if (restored) onClose();
                })
                .catch((error) => setRestoreError((error as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {item.originalPath ? 'Restore' : 'Restore to…'}
          </button>
        </div>
      </footer>
    </>
  );
  return (
    <Dialog
      title={item.name}
      className="quick-preview-dialog trash-preview-dialog"
      onClose={onClose}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('input, textarea, select, button')
        )
          return;
        if (items.length > 1 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          step(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div className="quick-preview">
        {error ? (
          <Empty icon="warning" title="File unavailable" detail={error} />
        ) : resource ? (
          <PreviewHost
            resource={resource}
            renderFooter={(loaded, module) => footer(loaded.entry.size, module.label)}
          />
        ) : (
          <Loading label="Opening preview…" />
        )}
      </div>
      {(!resource || error) && footer(item.size)}
    </Dialog>
  );
}

export function Trash({ onClose }: { onClose(): void }) {
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
        const remaining = selectionState.current.selection.filter((id) =>
          value.items.some((item) => item.id === id),
        );
        selectionState.current.selection = remaining;
        setSelected(remaining);
      }
    } catch (error) {
      if (live.current && requested === folder.current) {
        setError((error as Error).message);
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
  const items = useMemo(
    () =>
      (snapshot?.items ?? [])
        .filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .toSorted(
          (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
        ),
    [snapshot, query],
  );
  const files = useMemo(() => items.map(asFile), [items]);
  const hasOrigins = items.some((item) => !!item.originalPath);
  const selectedItems = items.filter((item) => selected.includes(item.id));
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
      if (live.current) setActionError((error as Error).message);
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
  const showPreview = (ids: string[]) => {
    const chosen = items.filter(
      (item) => ids.includes(item.id) && !item.directory && item.previewable !== false,
    );
    if (chosen.length) setPreview({ items: chosen, index: 0 });
  };
  const open = (item: TrashItem) => (item.directory ? go(item.id) : showPreview([item.id]));
  const closeMenu = () => {
    setMenu(undefined);
    scroll.current?.focus({ preventScroll: true });
  };
  const menuItems = items.filter((item) => menu?.ids.includes(item.id));
  const menuActions: MenuAction[] = menuItems.length
    ? [
        ...(menuItems.length === 1 && menuItems[0].directory
          ? [
              {
                id: 'open-selection',
                label: 'Open folder',
                icon: 'folder' as const,
                run: () => go(menuItems[0].id),
              },
            ]
          : []),
        ...(menuItems.some((item) => !item.directory && item.previewable !== false)
          ? [
              {
                id: 'quick-preview',
                label: 'Quick Look',
                icon: 'eye' as const,
                shortcut: 'Space',
                run: () => showPreview(menu!.ids),
              },
            ]
          : []),
        ...(menuItems.every((item) => item.originalPath) && window.viewerNative
          ? [
              {
                id: 'restore',
                label: 'Restore',
                icon: 'restore' as const,
                run: () => void action(() => restore(menu!.ids, 'original')),
              },
            ]
          : []),
        ...(window.viewerNative
          ? [
              {
                id: 'restore-to',
                label: 'Restore to…',
                icon: 'folder' as const,
                run: () => void action(() => restore(menu!.ids, 'choose')),
              },
            ]
          : []),
        {
          id: 'copy-path',
          label: menuItems.length === 1 ? 'Copy Path' : 'Copy Paths',
          icon: 'copy',
          run: () => void action(() => window.viewer.trashCopyPaths(menu!.ids)),
        },
        ...(menuItems.length === 1
          ? [
              {
                id: 'info',
                label: 'Get Info',
                icon: 'info' as const,
                run: () => setInformation(menuItems[0]),
              },
            ]
          : []),
      ]
    : [];
  return (
    <>
      <Dialog title={title} onClose={onClose} className="trash-dialog">
        <div className="trash-toolbar">
          <IconButton
            icon="left"
            label="Back to parent folder"
            disabled={loading || !folder.current}
            onClick={() => go(ancestors.at(-2)?.id)}
          />
          <nav className="trash-breadcrumbs" aria-label="Trash path">
            <button onClick={() => go()} aria-current={!ancestors.length ? 'page' : undefined}>
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
            <div className={`trash-inventory ${hasOrigins ? 'with-origins' : ''}`}>
              <div className="trash-row trash-heading" aria-hidden="true">
                <span>
                  Name <Icon name="up" size={12} />
                </span>
                {hasOrigins && <span>Original location</span>}
                <span>Date deleted</span>
                <span>Size</span>
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
                  } else if (event.key === 'Enter' && selectedItems.length === 1) {
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
                    const item = items[row.index];
                    return (
                      <div
                        role="option"
                        aria-selected={selected.includes(item.id)}
                        id={`${rowID}-${item.id}`}
                        data-trash-id={item.id}
                        className={`trash-row ${selected.includes(item.id) ? 'is-selected' : ''}`}
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
                          selection.click(files[row.index], event, files);
                        }}
                        onDoubleClick={() => open(item)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selection.target(files[row.index]);
                          setMenu({
                            x: event.clientX,
                            y: event.clientY,
                            ids: [...selectionState.current.selection],
                          });
                        }}
                      >
                        <span className="trash-filename" title={item.name}>
                          <FileIcon entry={files[row.index]} size={18} />
                          <span>{item.name}</span>
                          {item.directory && <Icon name="right" size={12} />}
                        </span>
                        {hasOrigins && (
                          <span className="muted" title={item.originalPath}>
                            {item.originalPath || '—'}
                          </span>
                        )}
                        <span>{date(item.deleted)}</span>
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
        <Dialog
          title={information.name}
          className="trash-info-dialog"
          onClose={() => setInformation(undefined)}
        >
          <dl>
            <dt>Kind</dt>
            <dd>
              {information.directory
                ? 'Folder'
                : information.symbolicLink
                  ? 'Symbolic link'
                  : information.previewable === false
                    ? 'Other'
                    : 'File'}
            </dd>
            <dt>Size</dt>
            <dd>{information.directory ? 'Not calculated' : formatBytes(information.size)}</dd>
            <dt>Modified</dt>
            <dd>{date(information.modified)}</dd>
            <dt>Deleted</dt>
            <dd>{date(information.deleted)}</dd>
            <dt>Original location</dt>
            <dd>{information.originalPath || 'Unavailable — use Restore to…'}</dd>
            <dt>Trash location</dt>
            <dd>{information.location}</dd>
          </dl>
          <footer>
            <button
              disabled={!window.viewerNative}
              onClick={() => {
                const item = information;
                setInformation(undefined);
                void action(() => restore([item.id], item.originalPath ? 'original' : 'choose'));
              }}
            >
              {information.originalPath ? 'Restore' : 'Restore to…'}
            </button>
            <button onClick={() => setInformation(undefined)}>Done</button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
