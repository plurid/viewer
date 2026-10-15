import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type DragEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry, ListColumn } from '../../domain/contracts';
import { visibleListColumns } from '../../domain/list-columns';
import { getState, useFolderPresentation, useViewer } from '../state/store';
import { fileFamily, fileGroup, formatBytes, sortEntries } from '../../domain/files';
import { Icon, type IconName } from '../ui/Icon';
import { PreviewHost } from '../previews/PreviewHost';
import { useFolder } from './useFolder';
import { Empty, Loading } from '../ui/primitives';
import { FolderAccessButton, needsFolderAccess } from '../ui/FolderAccessButton';
import { useFileReveal } from './anchors';
import type { ColumnNavigation } from './column-navigation';
import type { FileModifiers } from './selection';

import type { FolderPresentation } from '../../domain/folder-presentation';
import { BrowserColumn } from './BrowserColumn';
import { FolderSizeValue } from './sizes';
import { LinkedPlaneButton } from '../workspace/LinkedPlaneButton';
import { rowsUnder, tilesUnder, useMarquee, type MarqueeSelect } from './marquee';

export interface FileViewProps {
  paneID?: string;
  presentation?: FolderPresentation;
  depths?: ReadonlyMap<string, number>;
  expanded?: string[];
  toggle?(entry: FileEntry): void;
  entries: FileEntry[];
  selection: string[];
  cursor?: string;
  selectionSet: ReadonlySet<string>;
  select(entry: FileEntry, event: FileModifiers, scope?: FileEntry[]): void;
  showHidden: boolean;
  open(entry: FileEntry, linked?: boolean): void;
  context(entry: FileEntry, event: MouseEvent): void;
  drag(entry: FileEntry, event: DragEvent): void;
  /** Marquee selection; views without it ignore drags on blank space. */
  region?: MarqueeSelect;
}
const date = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
export function FileIcon({ entry, size = 18 }: { entry: FileEntry; size?: number }) {
  const family = fileFamily(entry);
  return (
    <span className={`file-icon family-${family}`}>
      <Icon name={family as IconName} size={size} />
      {entry.kind === 'symlink' && <Icon name="alias" size={11} className="symlink-mark" />}
    </span>
  );
}
export const FileRow = memo(function FileRow({
  entry,
  selected,
  props,
  compact = false,
  columns = ['name', 'modified', 'kind', 'size'],
}: {
  entry: FileEntry;
  selected: boolean;
  props: Pick<
    FileViewProps,
    'select' | 'open' | 'context' | 'drag' | 'toggle' | 'expanded' | 'depths' | 'paneID'
  >;
  compact?: boolean;
  columns?: readonly ListColumn[];
}) {
  return (
    <div
      className={`file-row ${selected ? 'is-selected' : ''} ${compact ? 'compact-row' : ''}`}
      role="option"
      aria-selected={selected}
      data-file-path={entry.path}
      data-directory-path={entry.directory ? entry.path : undefined}
      aria-expanded={
        entry.directory && props.toggle ? props.expanded?.includes(entry.path) : undefined
      }
      title={entry.error || entry.path}
      onClick={(event) => props.select(entry, event)}
      onDoubleClick={(event) => props.open(entry, event.metaKey || event.altKey || event.ctrlKey)}
      onContextMenu={(event) => props.context(entry, event)}
      draggable
      onDragStart={(event) => props.drag(entry, event)}
    >
      <span
        className="file-name"
        style={
          props.depths
            ? { paddingInlineStart: (props.depths.get(entry.path) || 0) * 18 }
            : undefined
        }
      >
        {props.toggle && entry.directory && (
          <button
            className="folder-disclosure"
            style={{ left: 2 + (props.depths?.get(entry.path) || 0) * 18 }}
            aria-label={props.expanded?.includes(entry.path) ? 'Collapse folder' : 'Expand folder'}
            onClick={(event) => {
              event.stopPropagation();
              props.toggle?.(entry);
            }}
          >
            <Icon name={props.expanded?.includes(entry.path) ? 'down' : 'right'} size={12} />
          </button>
        )}
        <FileIcon entry={entry} />
        <span className="filename" title={entry.name}>
          {entry.name}
        </span>
        <LinkedPlaneButton paneID={props.paneID} entry={entry} />
        {entry.error && <Icon name="warning" size={14} />}
      </span>
      {!compact &&
        columns
          .filter((column) => column !== 'name')
          .map((column) => (
            <span
              key={column}
              data-column={column}
              className={`file-${column} ${column === 'modified' ? 'file-date' : ''} ${column === 'size' ? 'tabular' : ''}`}
            >
              {column === 'modified' || column === 'created' ? (
                entry[column] ? (
                  date.format(entry[column])
                ) : (
                  '—'
                )
              ) : column === 'kind' ? (
                entry.directory ? (
                  'Folder'
                ) : entry.kind === 'symlink' ? (
                  'Alias'
                ) : (
                  entry.extension.toUpperCase() || 'File'
                )
              ) : column === 'extension' ? (
                entry.extension || '—'
              ) : entry.directory ? (
                <FolderSizeValue path={entry.path} />
              ) : (
                formatBytes(entry.size)
              )}
            </span>
          ))}
      {compact && entry.directory && <Icon name="right" size={14} />}
    </div>
  );
});
function useRowActions(props: FileViewProps) {
  const current = useRef(props);
  current.current = props;
  return useMemo(
    () => ({
      select: (...args: Parameters<FileViewProps['select']>) => current.current.select(...args),
      open: (...args: Parameters<FileViewProps['open']>) => current.current.open(...args),
      context: (...args: Parameters<FileViewProps['context']>) => current.current.context(...args),
      drag: (...args: Parameters<FileViewProps['drag']>) => current.current.drag(...args),
    }),
    [],
  );
}
export function ListView(props: FileViewProps) {
  const actions = useRowActions(props);
  const rowProps = useMemo(
    () => ({
      ...actions,
      toggle: props.toggle,
      expanded: props.expanded,
      depths: props.depths,
      paneID: props.paneID,
    }),
    [actions, props.toggle, props.expanded, props.depths, props.paneID],
  );
  const defaultCompact = useViewer(
    (state) => state.settings.settings.browsing.density === 'compact',
  );
  const compact = props.presentation ? props.presentation.density === 'compact' : defaultCompact;
  const defaultList = useViewer((state) => state.saved.ui.list);
  const list = props.presentation?.list || defaultList;
  const { visible, order } = list;
  const columns = useMemo(() => visibleListColumns({ visible, order }), [visible, order]);
  const groups = useMemo(() => {
    const groups = new Map<number, string>();
    let last = '';
    for (const [index, entry] of props.entries.entries()) {
      if (props.depths?.get(entry.path)) continue;
      const name = fileGroup(entry, props.presentation?.group || 'none');
      if (name && name !== last) groups.set(index, name);
      last = name;
    }
    return groups;
  }, [props.entries, props.depths, props.presentation?.group]);
  const getItemKey = useCallback((index: number) => props.entries[index].path, [props.entries]);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: props.entries.length,
    getItemKey,
    getScrollElement: () => scroll.current,
    estimateSize: (index) => (compact ? 30 : 36) + (groups.has(index) ? 26 : 0),
    overscan: 12,
  });
  useEffect(() => {
    // Wrapped measurements must not survive a return to fixed-height rows.
    virtual.measure();
  }, [compact, list.wrapNames, groups, virtual]);
  useFileReveal(scroll, props.entries, (index) => virtual.scrollToIndex(index, { align: 'auto' }));
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.cursor);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [props.cursor, props.entries, virtual]);
  const marquee = useMarquee(
    scroll,
    content,
    (rect) => rowsUnder(virtual.measurementsCache, rect).map((index) => props.entries[index]),
    props.region,
    props.selection,
  );
  return (
    <div
      ref={scroll}
      className="file-scroll"
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
      onPointerDown={marquee.onPointerDown}
    >
      <div ref={content} style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {marquee.overlay}
        {virtual.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={list.wrapNames ? virtual.measureElement : undefined}
            style={{
              position: 'absolute',
              width: '100%',
              top: item.start,
              height: list.wrapNames ? undefined : item.size,
            }}
          >
            {groups.has(item.index) && (
              <div className="file-group-label">{groups.get(item.index)}</div>
            )}
            <FileRow
              entry={props.entries[item.index]}
              selected={props.selectionSet.has(props.entries[item.index].path)}
              props={rowProps}
              columns={columns}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
function Thumbnail({ entry }: { entry: FileEntry }) {
  const [url, setURL] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    setURL('');
    setError(false);
    if (
      !['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(entry.extension) ||
      entry.size > 30 * 1024 * 1024
    )
      return;
    let live = true;
    void window.viewer
      .thumbnail(entry.path, getState().settings.settings.previews.thumbnailSize)
      .then((url) => {
        if (live) setURL(url);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [entry.path, entry.modified, entry.extension, entry.size]);
  return url && !error ? (
    <img src={url} alt="" loading="lazy" draggable={false} onError={() => setError(true)} />
  ) : (
    <FileIcon entry={entry} size={44} />
  );
}
export function GridView(props: FileViewProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor(width / 142));
  const virtual = useVirtualizer({
    count: Math.ceil(props.entries.length / columns),
    getScrollElement: () => scroll.current,
    estimateSize: () => 140,
    overscan: 3,
  });
  useFileReveal(scroll, props.entries, (index) =>
    virtual.scrollToIndex(Math.floor(index / columns), { align: 'auto' }),
  );
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.cursor);
    if (index >= 0) virtual.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
  }, [props.cursor, props.entries, columns, virtual]);
  const marquee = useMarquee(
    scroll,
    content,
    (rect) =>
      tilesUnder(
        virtual.measurementsCache,
        rect,
        columns,
        content.current?.offsetWidth || width,
        props.entries.length,
      ).map((index) => props.entries[index]),
    props.region,
    props.selection,
  );
  return (
    <div
      ref={scroll}
      className="file-scroll grid-scroll"
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
      onPointerDown={marquee.onPointerDown}
    >
      <div ref={content} style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {marquee.overlay}
        {virtual.getVirtualItems().map((row) => (
          <div
            className="grid-row"
            key={row.key}
            style={{
              position: 'absolute',
              width: '100%',
              top: row.start,
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
            }}
          >
            {props.entries.slice(row.index * columns, (row.index + 1) * columns).map((entry) => (
              <div
                role="option"
                aria-selected={props.selectionSet.has(entry.path)}
                className={`file-tile ${props.selectionSet.has(entry.path) ? 'is-selected' : ''}`}
                key={entry.path}
                title={entry.path}
                data-file-path={entry.path}
                data-directory-path={entry.directory ? entry.path : undefined}
                onClick={(event) => props.select(entry, event)}
                onDoubleClick={(event) =>
                  props.open(entry, event.altKey || event.metaKey || event.ctrlKey)
                }
                onContextMenu={(event) => props.context(entry, event)}
                draggable
                onDragStart={(event) => props.drag(entry, event)}
              >
                <div className="tile-preview">
                  <Thumbnail entry={entry} />
                </div>
                <span className="file-linked-label">
                  <span>{entry.name}</span>
                  <LinkedPlaneButton paneID={props.paneID} entry={entry} />
                </span>
                <small>{entry.directory ? 'Folder' : formatBytes(entry.size)}</small>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
function Column({
  path,
  props,
  navigation,
}: {
  path: string;
  props: FileViewProps;
  navigation: ColumnNavigation;
}) {
  const listing = useFolder(path);
  const presentation = useFolderPresentation(path);
  const filtered = useMemo(
    () =>
      sortEntries(
        listing.entries.filter((entry) => presentation.showHidden || !entry.hidden),
        presentation.sort,
        presentation.descending,
        presentation.foldersFirst,
      ),
    [listing.entries, presentation],
  );
  const columnProps = {
    ...props,
    entries: filtered,
    presentation,
    select: (entry: FileEntry, event: FileModifiers) => {
      props.select(entry, event, filtered);
    },
  };
  const { register, unregister } = navigation;
  useEffect(() => {
    if (!listing.loading && !listing.error) register(path, filtered);
    return () => unregister(path);
  }, [path, filtered, listing.loading, listing.error, register, unregister]);
  return (
    <BrowserColumn path={path} entries={filtered} onActivate={() => navigation.activate(path)}>
      {listing.loading ? (
        <Loading />
      ) : listing.error ? (
        <Empty title="Folder unavailable" detail={listing.error}>
          {needsFolderAccess(listing.errorCode) && <FolderAccessButton folder={path} />}
        </Empty>
      ) : (
        <ListViewCompact props={columnProps} />
      )}
    </BrowserColumn>
  );
}
function ListViewCompact({ props }: { props: FileViewProps }) {
  const actions = useRowActions(props);
  // One stable object, so memoized rows skip re-rendering when nothing they show changed.
  const rowProps = useMemo(() => ({ ...actions, paneID: props.paneID }), [actions, props.paneID]);
  const defaultCompact = useViewer(
    (state) => state.settings.settings.browsing.density === 'compact',
  );
  const compact = props.presentation ? props.presentation.density === 'compact' : defaultCompact;
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: props.entries.length,
    getItemKey: (index) => props.entries[index].path,
    getScrollElement: () => scroll.current,
    estimateSize: () => (compact ? 30 : 36),
    overscan: 8,
  });
  useFileReveal(scroll, props.entries, (index) => virtual.scrollToIndex(index, { align: 'auto' }));
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.cursor);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [props.cursor, props.entries, virtual]);
  return (
    <div ref={scroll} className="file-scroll" role="listbox" aria-label="Column files">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => (
          <div key={item.key} style={{ position: 'absolute', top: item.start, width: '100%' }}>
            <FileRow
              compact
              entry={props.entries[item.index]}
              selected={props.selectionSet.has(props.entries[item.index].path)}
              props={rowProps}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
export function ColumnsView({
  path,
  navigation,
  ...props
}: FileViewProps & { path: string; navigation: ColumnNavigation }) {
  const scroll = useRef<HTMLDivElement>(null);
  const selected =
    props.selection.length === 1
      ? navigation.scope().find((entry) => entry.path === props.selection[0] && !entry.directory)
      : undefined;
  useEffect(() => {
    const last = scroll.current?.lastElementChild as HTMLElement | undefined;
    if (last && scroll.current) {
      const right = last.offsetLeft + last.offsetWidth;
      if (right > scroll.current.scrollLeft + scroll.current.clientWidth)
        scroll.current.scrollLeft = right - scroll.current.clientWidth;
    }
  }, [navigation.trail, selected?.path]);
  return (
    <div className="columns-view" ref={scroll}>
      <BrowserColumn
        path={path}
        entries={props.entries}
        onActivate={() => navigation.activate(path)}
      >
        <ListViewCompact props={props} />
      </BrowserColumn>
      {navigation.trail.map((folder) => (
        <Column key={folder} path={folder} props={props} navigation={navigation} />
      ))}
      {selected && (
        <div
          className="column-preview"
          role="region"
          aria-label="File preview"
          data-preview-path={selected.path}
        >
          <PreviewHost key={selected.path} path={selected.path} />
        </div>
      )}
    </div>
  );
}
export function GalleryView(props: FileViewProps) {
  const selected = props.entries.find((entry) => entry.path === props.cursor);
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    horizontal: true,
    count: props.entries.length,
    getItemKey: (index) => props.entries[index].path,
    getScrollElement: () => scroll.current,
    estimateSize: () => 106,
    overscan: 4,
  });
  useFileReveal(scroll, props.entries, (index) => virtual.scrollToIndex(index, { align: 'auto' }));
  useEffect(() => {
    const index = props.entries.indexOf(selected!);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [selected, props.entries, virtual]);
  return (
    <div className="gallery-view">
      <div className="gallery-preview">
        {selected && !selected.directory ? (
          <PreviewHost path={selected.path} />
        ) : (
          <Empty
            icon={selected?.directory ? 'folder' : 'image'}
            title={selected?.name || 'Select a file to preview'}
            detail={
              selected?.directory
                ? 'Double-click to open this folder.'
                : 'Use the filmstrip or arrow keys to explore.'
            }
          />
        )}
      </div>
      <div ref={scroll} className="gallery-strip" role="listbox" aria-label="Gallery files">
        <div style={{ width: virtual.getTotalSize(), height: '100%', position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const entry = props.entries[item.index];
            return (
              <div
                className="gallery-item-container"
                key={entry.path}
                style={{ position: 'absolute', left: item.start, height: '100%' }}
              >
                <button
                  className={`gallery-item ${props.selectionSet.has(entry.path) ? 'is-selected' : ''}`}
                  style={{ height: '100%' }}
                  data-file-path={entry.path}
                  data-directory-path={entry.directory ? entry.path : undefined}
                  aria-selected={props.selectionSet.has(entry.path)}
                  role="option"
                  onClick={(event) => props.select(entry, event)}
                  onDoubleClick={(event) =>
                    props.open(entry, event.altKey || event.metaKey || event.ctrlKey)
                  }
                  onContextMenu={(event) => props.context(entry, event)}
                  draggable
                  onDragStart={(event) => props.drag(entry, event)}
                  title={entry.name}
                >
                  <Thumbnail entry={entry} />
                  <span>{entry.name}</span>
                </button>
                <LinkedPlaneButton paneID={props.paneID} entry={entry} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
