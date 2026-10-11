import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry } from '../../domain/contracts';
import { getState, useViewer } from '../state/store';
import { fileFamily, formatBytes, sortEntries } from '../../domain/files';
import { Icon, type IconName } from '../ui/Icon';
import { PreviewHost } from '../previews/PreviewHost';
import { useFolder } from './useFolder';
import { Empty, Loading } from '../ui/primitives';

export interface FileViewProps {
  entries: FileEntry[];
  selection: string[];
  selectionSet: ReadonlySet<string>;
  select(entry: FileEntry, event: MouseEvent, scope?: FileEntry[]): void;
  showHidden: boolean;
  open(entry: FileEntry, linked?: boolean): void;
  context(entry: FileEntry, event: MouseEvent): void;
  drag(entry: FileEntry, event: DragEvent): void;
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
}: {
  entry: FileEntry;
  selected: boolean;
  props: Pick<FileViewProps, 'select' | 'open' | 'context' | 'drag'>;
  compact?: boolean;
}) {
  return (
    <div
      className={`file-row ${selected ? 'is-selected' : ''} ${compact ? 'compact-row' : ''}`}
      role="option"
      aria-selected={selected}
      data-file-path={entry.path}
      title={entry.error || entry.path}
      onClick={(event) => props.select(entry, event)}
      onDoubleClick={(event) => props.open(entry, event.metaKey || event.altKey || event.ctrlKey)}
      onContextMenu={(event) => props.context(entry, event)}
      draggable
      onDragStart={(event) => props.drag(entry, event)}
    >
      <span className="file-name">
        <FileIcon entry={entry} />
        <span>{entry.name}</span>
        {entry.error && <Icon name="warning" size={14} />}
      </span>
      {!compact && (
        <>
          <span className="file-date">{entry.modified ? date.format(entry.modified) : '—'}</span>
          <span className="file-kind">
            {entry.directory
              ? 'Folder'
              : entry.kind === 'symlink'
                ? 'Alias'
                : entry.extension.toUpperCase() || 'File'}
          </span>
          <span className="file-size tabular">
            {entry.directory ? '—' : formatBytes(entry.size)}
          </span>
        </>
      )}
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
  const compact = useViewer((state) => state.settings.settings.browsing.density === 'compact');
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: props.entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => (compact ? 30 : 36),
    overscan: 12,
  });
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.selection.at(-1));
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [props.selection, props.entries, virtual]);
  return (
    <div
      ref={scroll}
      className="file-scroll"
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => (
          <div
            key={item.key}
            style={{ position: 'absolute', width: '100%', top: item.start, height: item.size }}
          >
            <FileRow
              entry={props.entries[item.index]}
              selected={props.selectionSet.has(props.entries[item.index].path)}
              props={actions}
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
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.selection.at(-1));
    if (index >= 0) virtual.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
  }, [props.selection, props.entries, columns, virtual]);
  return (
    <div
      ref={scroll}
      className="file-scroll grid-scroll"
      role="listbox"
      aria-label="Files"
      aria-multiselectable="true"
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
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
                <span>{entry.name}</span>
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
  depth,
  onFolder,
}: {
  path: string;
  props: FileViewProps;
  depth: number;
  onFolder: (path: string, depth: number) => void;
}) {
  const listing = useFolder(path);
  const filtered = useMemo(
    () =>
      sortEntries(
        listing.entries.filter((entry) => props.showHidden || !entry.hidden),
        'name',
        false,
      ),
    [listing.entries, props.showHidden],
  );
  const columnProps = {
    ...props,
    entries: filtered,
    select: (entry: FileEntry, event: MouseEvent) => {
      props.select(entry, event, filtered);
      onFolder(entry.directory ? entry.path : '', depth);
    },
  };
  return (
    <div className="file-column">
      <div className="column-title" title={path}>
        {path.split(/[\\/]/).pop() || path}
      </div>
      {listing.loading ? (
        <Loading />
      ) : listing.error ? (
        <Empty title="Folder unavailable" detail={listing.error} />
      ) : (
        <ListViewCompact props={columnProps} />
      )}
    </div>
  );
}
function ListViewCompact({ props }: { props: FileViewProps }) {
  const actions = useRowActions(props);
  const compact = useViewer((state) => state.settings.settings.browsing.density === 'compact');
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: props.entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => (compact ? 30 : 36),
    overscan: 8,
  });
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.selection.at(-1));
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [props.selection, props.entries, virtual]);
  return (
    <div ref={scroll} className="file-scroll" role="listbox" aria-label="Column files">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => (
          <div key={item.key} style={{ position: 'absolute', top: item.start, width: '100%' }}>
            <FileRow
              compact
              entry={props.entries[item.index]}
              selected={props.selectionSet.has(props.entries[item.index].path)}
              props={actions}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
export function ColumnsView({ path, ...props }: FileViewProps & { path: string }) {
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => setTrail([]), [path]);
  const onFolder = (next: string, depth: number) =>
    setTrail((value) => [...value.slice(0, depth), ...(next ? [next] : [])]);
  const rootProps = {
    ...props,
    select: (entry: FileEntry, event: MouseEvent) => {
      props.select(entry, event);
      onFolder(entry.directory ? entry.path : '', 0);
    },
  };
  return (
    <div className="columns-view">
      <div className="file-column">
        <div className="column-title">{path.split(/[\\/]/).pop() || path}</div>
        <ListViewCompact props={rootProps} />
      </div>
      {trail.map((folder, index) => (
        <Column key={folder} path={folder} props={props} depth={index + 1} onFolder={onFolder} />
      ))}
    </div>
  );
}
export function GalleryView(props: FileViewProps) {
  const selected = props.entries.find((entry) => entry.path === props.selection.at(-1));
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    horizontal: true,
    count: props.entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 106,
    overscan: 4,
  });
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
              <button
                className={`gallery-item ${props.selectionSet.has(entry.path) ? 'is-selected' : ''}`}
                style={{ position: 'absolute', left: item.start, height: '100%' }}
                key={entry.path}
                data-file-path={entry.path}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
