import { effectiveWindowSettings } from '../state/effective-ui';
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type DragEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry, ListColumn } from '../../domain/contracts';
import { visibleListColumns } from '../../domain/preferences/list-columns';
import { getState, report, useFolderPresentation, useViewer } from '../state/store';
import {
  browsable,
  fileFamily,
  formatBytes,
  groupEntries,
  kindLabel,
  listDate,
  sortEntries,
} from '../../domain/files/entries';
import { FileName } from '../ui/FileName';
import { Icon, type IconName } from '../ui/Icon';
import { HeldPreview } from '../previews/HeldPreview';
import { useFolder } from './useFolder';
import { Empty, Failure, Loading } from '../ui/primitives';
import { FolderAccessButton, needsFolderAccess } from '../ui/permissions/FolderAccessButton';
import { useFileReveal } from './anchors';
import type { ColumnNavigation } from './column-navigation';
import { keepPreviewKeys, type FileModifiers } from './selection';
import { PreviewColumn } from './PreviewColumn';

import type { FolderPresentation } from '../../domain/preferences/folder-presentation';
import { BrowserColumn } from './BrowserColumn';
import { FolderSizeValue } from './sizes';
import { LinkedPlaneButton } from '../workspace/LinkedPlaneButton';
import { rowsUnder, useMarquee, type MarqueeSelect } from './marquee';
import { renderedImageFormats } from '../../domain/previews/images/rendered';
import { thumbnailByteLimit } from '../../domain/previews/images/thumbnails';
import { previewsAsFile } from '../../domain/previews/documents/embedded';
import { PreviewActivity } from '../previews/activity';
import { AppIcon, hasBundleIcon } from './app-icon';
import {
  acceptsDrop,
  droppedPaths,
  fixedSections,
  gridRows,
  sectionRows,
  type ViewSection,
  type ViewSections,
} from './sections';
import { useLensGrouping } from './folder-sections';
import { GitBadge, GitColumn } from '../git/status';
import { SharedMark } from './NetworkSharing';
import { cachedThumbnail, thumbnail } from './thumbnail-cache';

export interface FileViewProps {
  paneID?: string;
  /** Where the rows' DOM ids start, so the focused list can name its cursor row through
   * aria-activedescendant. */
  idPrefix?: string;
  presentation?: FolderPresentation;
  depths?: ReadonlyMap<string, number>;
  expanded?: string[];
  toggle?(entry: FileEntry): void;
  entries: FileEntry[];
  selection: string[];
  cursor?: string;
  /** Visual route through ancestor columns, independent of the operation selection. */
  ancestorPath?: string;
  selectionSet: ReadonlySet<string>;
  select(entry: FileEntry, event: FileModifiers, scope?: FileEntry[]): void;
  showHidden: boolean;
  open(entry: FileEntry, linked?: boolean): void;
  context(entry: FileEntry, event: MouseEvent): void;
  drag(entry: FileEntry, event: DragEvent): void;
  /** Marquee selection; views without it ignore drags on blank space. */
  region?: MarqueeSelect;
  /** Group headings; entries are ordered to match. */
  sections?: ViewSections;
}
/** A row's DOM id: its list's prefix and its path, for aria-activedescendant. */
export function fileRowID(prefix: string, path: string): string {
  // FNV-1a: a path's id stays the same as rows mount and unmount in a virtual list
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-row-${(hash >>> 0).toString(36)}`;
}
export function FileIcon({ entry, size = 18 }: { entry: FileEntry; size?: number }) {
  const family = fileFamily(entry);
  const symbol = <Icon name={family as IconName} size={size} />;
  return (
    <span className={`file-icon family-${family}`}>
      {hasBundleIcon(entry) ? <AppIcon entry={entry} size={size} fallback={symbol} /> : symbol}
      {entry.kind === 'symlink' && <Icon name="alias" size={11} className="symlink-mark" />}
      <GitBadge entry={entry} />
      {entry.directory && <SharedMark path={entry.path} />}
    </span>
  );
}
export const FileRow = memo(function FileRow({
  entry,
  selected,
  ancestor = false,
  props,
  compact = false,
  columns = ['name', 'modified', 'kind', 'size'],
  wrapName = false,
}: {
  entry: FileEntry;
  selected: boolean;
  ancestor?: boolean;
  props: Pick<
    FileViewProps,
    | 'select'
    | 'open'
    | 'context'
    | 'drag'
    | 'toggle'
    | 'expanded'
    | 'depths'
    | 'paneID'
    | 'idPrefix'
  >;
  compact?: boolean;
  columns?: readonly ListColumn[];
  /** List with "Wrap long filenames" on: the whole name, over as many lines as it takes. */
  wrapName?: boolean;
}) {
  return (
    <div
      className={`file-row ${selected ? 'is-selected' : ''} ${ancestor ? 'is-path-ancestor' : ''} ${compact ? 'compact-row' : ''}`}
      id={props.idPrefix ? fileRowID(props.idPrefix, entry.path) : undefined}
      role="option"
      aria-selected={selected}
      data-file-path={entry.path}
      // an application is no folder to drop into: its bundle is the app's own
      data-directory-path={browsable(entry) ? entry.path : undefined}
      aria-expanded={
        browsable(entry) && props.toggle ? props.expanded?.includes(entry.path) : undefined
      }
      // the name shows: a tooltip only says what the row cannot, as a read error
      title={entry.error || undefined}
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
        {props.toggle && browsable(entry) && (
          <button
            className="folder-disclosure"
            // the row is the list's one keyboard stop: ← and → open and close it
            tabIndex={-1}
            style={{ left: 2 + (props.depths?.get(entry.path) || 0) * 18 }}
            aria-label={`${props.expanded?.includes(entry.path) ? 'Collapse' : 'Expand'} ${entry.name}`}
            onClick={(event) => {
              event.stopPropagation();
              props.toggle?.(entry);
            }}
          >
            <Icon name={props.expanded?.includes(entry.path) ? 'down' : 'right'} size={12} />
          </button>
        )}
        <FileIcon entry={entry} />
        <FileName name={entry.name} className="filename" fit={wrapName ? 'wrap' : 'line'} />
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
              {column === 'git' ? (
                <GitColumn entry={entry} />
              ) : column === 'modified' || column === 'created' ? (
                entry[column] ? (
                  listDate(entry[column])
                ) : (
                  ''
                )
              ) : column === 'kind' ? (
                kindLabel(entry)
              ) : column === 'extension' ? (
                entry.extension
              ) : entry.directory ? (
                <FolderSizeValue path={entry.path} />
              ) : (
                formatBytes(entry.size)
              )}
            </span>
          ))}
      {compact && browsable(entry) && <Icon name="right" size={14} />}
    </div>
  );
});
/** A group heading. Lens groups collapse, take items dropped on them and have their own menu. */
function SectionHeader({ section, sections }: { section: ViewSection; sections: ViewSections }) {
  const [over, setOver] = useState(false);
  const lens = section.group !== undefined;
  const droppable = lens && !!sections.drop;
  return (
    <div
      className={`file-group-label ${lens ? 'is-lens' : ''} ${over ? 'is-drop-target' : ''}`}
      style={section.depth ? { paddingInlineStart: 16 + section.depth * 16 } : undefined}
      data-lens-group={lens ? (section.group ?? '') : undefined}
      onContextMenu={
        sections.context
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              sections.context!(section, event);
            }
          : undefined
      }
      onDragOver={
        droppable
          ? (event) => {
              if (!acceptsDrop(event)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'link';
              setOver(true);
            }
          : undefined
      }
      onDragLeave={droppable ? () => setOver(false) : undefined}
      onDrop={
        droppable
          ? (event) => {
              if (!acceptsDrop(event)) return;
              event.preventDefault();
              event.stopPropagation();
              setOver(false);
              void droppedPaths(event)
                .then((paths) => sections.drop!(section, paths))
                .catch(report);
            }
          : undefined
      }
    >
      {lens && section.group !== null && sections.toggle ? (
        <button
          className="section-disclosure"
          aria-expanded={!section.collapsed}
          aria-label={`${section.collapsed ? 'Expand' : 'Collapse'} ${section.label}`}
          onClick={(event) => {
            event.stopPropagation();
            sections.toggle!(section);
          }}
        >
          <Icon name={section.collapsed ? 'right' : 'down'} size={12} />
        </button>
      ) : null}
      <span className="section-label">{section.label}</span>
      {lens && <small className="section-count">{section.count.toLocaleString()}</small>}
    </div>
  );
}
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
      idPrefix: props.idPrefix,
    }),
    [actions, props.toggle, props.expanded, props.depths, props.paneID, props.idPrefix],
  );
  const defaultCompact = useViewer(
    (state) => effectiveWindowSettings(state).browsing.density === 'compact',
  );
  const compact = props.presentation ? props.presentation.density === 'compact' : defaultCompact;
  const defaultList = useViewer((state) => state.saved.ui.list);
  const list = props.presentation?.list || defaultList;
  const { visible, order } = list;
  const gitEnabled = useViewer((state) => state.settings.settings.git.enabled);
  const columns = useMemo(
    () => visibleListColumns({ visible, order }, gitEnabled),
    [visible, order, gitEnabled],
  );
  const rows = useMemo(
    () => sectionRows(props.entries, props.sections, props.depths),
    [props.entries, props.sections, props.depths],
  );
  const rowOf = useMemo(() => entryRows(rows), [rows]);
  const getItemKey = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === 'header'
        ? 'section:' + row.section.key
        : (props.entries[row.index]?.path ?? index);
    },
    [rows, props.entries],
  );
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getItemKey,
    getScrollElement: () => scroll.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? 30 : compact ? 30 : 36),
    overscan: 12,
  });
  useEffect(() => {
    // Wrapped measurements must not survive a return to fixed-height rows.
    virtual.measure();
  }, [compact, list.wrapNames, rows, virtual]);
  useFileReveal(scroll, props.entries, (index) =>
    virtual.scrollToIndex(rowOf.get(index) ?? index, { align: 'auto' }),
  );
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.cursor);
    if (index >= 0) virtual.scrollToIndex(rowOf.get(index) ?? index, { align: 'auto' });
  }, [props.cursor, props.entries, rowOf, virtual]);
  const marquee = useMarquee(
    scroll,
    content,
    (rect) =>
      rowsUnder(virtual.measurementsCache, rect).flatMap((index) => {
        const row = rows[index];
        return row?.kind === 'entry' ? (props.entries[row.index] ?? []) : [];
      }),
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
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row?.kind === 'header')
            return (
              <div
                key={item.key}
                data-index={item.index}
                style={{ position: 'absolute', width: '100%', top: item.start, height: item.size }}
              >
                <SectionHeader section={row.section} sections={props.sections!} />
              </div>
            );
          const entry = row ? props.entries[row.index] : undefined;
          if (!entry) return null;
          return (
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
              <FileRow
                entry={entry}
                selected={props.selectionSet.has(entry.path)}
                props={rowProps}
                columns={columns}
                wrapName={list.wrapNames}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
/** Each entry's row in a list that also holds headers. */
function entryRows(rows: readonly ReturnType<typeof sectionRows>[number][]): Map<number, number> {
  const map = new Map<number, number>();
  for (const [row, item] of rows.entries()) if (item.kind === 'entry') map.set(item.index, row);
  return map;
}
// Quick Look renders these thumbnails, including formats the renderer cannot decode.
const thumbnailFormats = new Set<string>([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'bmp',
  ...renderedImageFormats,
]);
export function Thumbnail({ entry }: { entry: FileEntry }) {
  const supported = thumbnailFormats.has(entry.extension) && entry.size <= thumbnailByteLimit;
  const size = supported ? getState().settings.settings.previews.thumbnailSize : 0;
  const [url, setURL] = useState(() => (supported && cachedThumbnail(entry, size)) || '');
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(false);
    if (!supported) {
      setURL('');
      return;
    }
    const cached = cachedThumbnail(entry, size);
    setURL(cached ?? '');
    if (cached !== undefined) return;
    let live = true;
    thumbnail(entry, size).then(
      (url) => {
        if (live) setURL(url);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
    // a file's version is its path, identity, modification time and size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path, entry.identity, entry.modified, entry.size, supported, size]);
  return url && !error ? (
    <span className="git-thumbnail">
      <img src={url} alt="" loading="lazy" draggable={false} onError={() => setError(true)} />
      <GitBadge entry={entry} />
    </span>
  ) : (
    <FileIcon entry={entry} size={44} />
  );
}
/**
 * A Grid tile. Memoized with stable actions, as list rows are: a folder's every render once
 * re-rendered every visible tile, its thumbnail and its link marker.
 */
const FileTile = memo(function FileTile({
  entry,
  selected,
  actions,
}: {
  entry: FileEntry;
  selected: boolean;
  actions: Pick<FileViewProps, 'select' | 'open' | 'context' | 'drag' | 'paneID'>;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      className={`file-tile ${selected ? 'is-selected' : ''}`}
      data-file-path={entry.path}
      data-directory-path={browsable(entry) ? entry.path : undefined}
      onClick={(event) => actions.select(entry, event)}
      onDoubleClick={(event) => actions.open(entry, event.altKey || event.metaKey || event.ctrlKey)}
      onContextMenu={(event) => actions.context(entry, event)}
      draggable
      onDragStart={(event) => actions.drag(entry, event)}
    >
      <div className="tile-preview">
        <Thumbnail entry={entry} />
      </div>
      <span className="file-linked-label">
        <FileName name={entry.name} fit="two-lines" />
        <LinkedPlaneButton paneID={actions.paneID} entry={entry} />
      </span>
      <small>{entry.directory ? kindLabel(entry) : formatBytes(entry.size)}</small>
    </div>
  );
});
export function GridView(props: FileViewProps) {
  const actions = useRowActions(props);
  const tileActions = useMemo(
    () => ({ ...actions, paneID: props.paneID }),
    [actions, props.paneID],
  );
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor(width / 142));
  const rows = useMemo(
    () => gridRows(props.entries, props.sections, columns),
    [props.entries, props.sections, columns],
  );
  const rowOf = useMemo(() => {
    const map = new Map<number, number>();
    for (const [index, row] of rows.entries())
      if (row.kind === 'tiles')
        for (let item = row.start; item < row.end; item++) map.set(item, index);
    return map;
  }, [rows]);
  const virtual = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => {
      const row = rows[index];
      return row?.kind === 'header' ? 'section:' + row.section.key : `tiles:${row?.start}`;
    },
    getScrollElement: () => scroll.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? 34 : 157),
    overscan: 3,
  });
  useEffect(() => {
    virtual.measure();
  }, [rows, virtual]);
  useFileReveal(scroll, props.entries, (index) =>
    virtual.scrollToIndex(rowOf.get(index) ?? 0, { align: 'auto' }),
  );
  useEffect(() => {
    const index = props.entries.findIndex((entry) => entry.path === props.cursor);
    if (index >= 0) virtual.scrollToIndex(rowOf.get(index) ?? 0, { align: 'auto' });
  }, [props.cursor, props.entries, rowOf, virtual]);
  const marquee = useMarquee(
    scroll,
    content,
    (rect) => {
      const tile = (content.current?.offsetWidth || width) / columns;
      const first = Math.max(0, Math.floor(rect.left / tile)),
        last = Math.min(columns - 1, Math.floor((rect.right - 0.01) / tile));
      if (first > last) return [];
      return rowsUnder(virtual.measurementsCache, rect).flatMap((index) => {
        const row = rows[index];
        if (row?.kind !== 'tiles') return [];
        return props.entries.slice(row.start + first, Math.min(row.end, row.start + last + 1));
      });
    },
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
      data-columns={columns}
      onPointerDown={marquee.onPointerDown}
    >
      <div ref={content} style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {marquee.overlay}
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          if (row.kind === 'header')
            return (
              <div
                key={item.key}
                style={{ position: 'absolute', width: '100%', top: item.start, height: item.size }}
              >
                <SectionHeader section={row.section} sections={props.sections!} />
              </div>
            );
          return (
            <div
              className="grid-row"
              key={item.key}
              style={{
                position: 'absolute',
                width: '100%',
                top: item.start,
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
              }}
            >
              {props.entries.slice(row.start, row.end).map((entry) => (
                <FileTile
                  key={entry.path}
                  entry={entry}
                  selected={props.selectionSet.has(entry.path)}
                  actions={tileActions}
                />
              ))}
            </div>
          );
        })}
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
  const ancestorPath = navigation.trail[navigation.trail.indexOf(path) + 1];
  const sorted = useMemo(
    () =>
      sortEntries(
        listing.entries.filter(
          (entry) => presentation.showHidden || !entry.hidden || entry.path === ancestorPath,
        ),
        presentation.sort,
        presentation.descending,
        presentation.foldersFirst,
      ),
    [listing.entries, presentation, ancestorPath],
  );
  // Each column follows its own folder's grouping, including its own lens.
  const lens = useLensGrouping(path, listing.entries, sorted, presentation, false);
  const filtered = useMemo(
    () =>
      presentation.group === 'lens'
        ? (lens.entries ?? sorted)
        : groupEntries(sorted, presentation.group),
    [presentation.group, lens.entries, sorted],
  );
  const sections = useMemo(
    () =>
      presentation.group === 'lens' ? lens.sections : fixedSections(filtered, presentation.group),
    [presentation.group, lens.sections, filtered],
  );
  const columnProps = {
    ...props,
    ancestorPath,
    entries: filtered,
    presentation,
    sections,
    select: (entry: FileEntry, event: FileModifiers) => {
      props.select(entry, event, filtered);
    },
  };
  const { register, unregister } = navigation;
  useEffect(() => {
    if (!listing.loading && !listing.unavailable) register(path, filtered, listing.entries);
    return () => unregister(path);
  }, [path, filtered, listing.entries, listing.loading, listing.unavailable, register, unregister]);
  return (
    <BrowserColumn
      path={path}
      entries={filtered}
      active={navigation.activeDirectory() === path}
      onActivate={() => navigation.activate(path)}
    >
      {listing.loading ? (
        <Loading />
      ) : listing.unavailable ? (
        needsFolderAccess(listing.errorCode) ? (
          <Failure
            title="Can't open this folder"
            detail="Viewer needs your permission to open this folder."
          >
            <FolderAccessButton folder={path} />
          </Failure>
        ) : (
          <Failure
            title="Can't open this folder"
            detail={listing.error}
            onRetry={listing.refresh}
          />
        )
      ) : (
        <ListViewCompact props={columnProps} />
      )}
    </BrowserColumn>
  );
}
function ListViewCompact({ props }: { props: FileViewProps }) {
  const actions = useRowActions(props);
  // One stable object, so memoized rows skip re-rendering when nothing they show changed.
  const rowProps = useMemo(
    () => ({ ...actions, paneID: props.paneID, idPrefix: props.idPrefix }),
    [actions, props.paneID, props.idPrefix],
  );
  const defaultCompact = useViewer(
    (state) => effectiveWindowSettings(state).browsing.density === 'compact',
  );
  const compact = props.presentation ? props.presentation.density === 'compact' : defaultCompact;
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => sectionRows(props.entries, props.sections),
    [props.entries, props.sections],
  );
  const rowOf = useMemo(() => entryRows(rows), [rows]);
  const virtual = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === 'header'
        ? 'section:' + row.section.key
        : (props.entries[row.index]?.path ?? index);
    },
    getScrollElement: () => scroll.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? 30 : compact ? 30 : 36),
    overscan: 8,
  });
  useEffect(() => {
    virtual.measure();
  }, [rows, virtual]);
  useFileReveal(scroll, props.entries, (index) =>
    virtual.scrollToIndex(rowOf.get(index) ?? index, { align: 'auto' }),
  );
  useEffect(() => {
    const index = props.entries.findIndex(
      (entry) => entry.path === (props.ancestorPath || props.cursor),
    );
    if (index >= 0) virtual.scrollToIndex(rowOf.get(index) ?? index, { align: 'auto' });
  }, [props.cursor, props.ancestorPath, props.entries, rowOf, virtual]);
  return (
    <div ref={scroll} className="file-scroll" role="listbox" aria-label="Column files">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row?.kind === 'header')
            return (
              <div
                key={item.key}
                style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}
              >
                <SectionHeader section={row.section} sections={props.sections!} />
              </div>
            );
          const entry = row ? props.entries[row.index] : undefined;
          if (!entry) return null;
          return (
            <div key={item.key} style={{ position: 'absolute', top: item.start, width: '100%' }}>
              <FileRow
                compact
                entry={entry}
                selected={props.selectionSet.has(entry.path)}
                ancestor={props.ancestorPath === entry.path}
                props={rowProps}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
/**
 * What a view's own preview shows: the selected item, except while Quick Preview shows this plane's
 * selection, when it keeps the item it showed then. Stepping through files there loads none of
 * them behind it.
 */
function useViewPreview(paneID: string | undefined, item: FileEntry | undefined) {
  const quick = useViewer((state) => !!paneID && state.quickPreview?.paneID === paneID);
  const [held, setHeld] = useState(item);
  // by path: a listing read again gives the same item as a new object
  if (!quick && held?.path !== item?.path) setHeld(item);
  return quick ? held : item;
}
export function ColumnsView({
  path,
  navigation,
  ...props
}: FileViewProps & { path: string; navigation: ColumnNavigation }) {
  const scroll = useRef<HTMLDivElement>(null);
  const activity = useContext(PreviewActivity);
  const selected = useViewPreview(
    props.paneID,
    props.selection.length === 1
      ? navigation
          .scope()
          .find((entry) => entry.path === props.selection[0] && previewsAsFile(entry))
      : undefined,
  );
  const directory = navigation.directory();
  const hasPreview = !!selected;
  // The current column stays in view, with as much of the preview as fits beside it, when the
  // trail changes, a preview appears or the plane resizes. Another file in the same column
  // changes neither, so the strip never moves under the pointer.
  useLayoutEffect(() => {
    const strip = scroll.current;
    if (!strip) return;
    const columns = [...strip.querySelectorAll<HTMLElement>(':scope > .file-column')];
    const last = columns.find((column) => column.dataset.folderPath === directory);
    if (!last) return;
    const preview = strip.querySelector<HTMLElement>(':scope > .column-preview');
    const reveal = () => {
      const spare = Math.max(0, strip.clientWidth - last.offsetWidth);
      const right = last.offsetLeft + last.offsetWidth + Math.min(preview?.offsetWidth ?? 0, spare);
      if (right > strip.scrollLeft + strip.clientWidth)
        strip.scrollLeft = Math.max(0, right - strip.clientWidth);
      else if (last.offsetLeft < strip.scrollLeft) strip.scrollLeft = last.offsetLeft;
    };
    reveal();
    // test documents may lack ResizeObserver; Chromium always has it
    if (typeof ResizeObserver === 'undefined') return;
    const resized = new ResizeObserver(reveal);
    resized.observe(strip);
    for (const column of columns) resized.observe(column);
    if (preview) resized.observe(preview);
    return () => resized.disconnect();
  }, [navigation.trail, hasPreview, directory]);
  return (
    <div className="columns-view" ref={scroll}>
      {navigation.trail.map((folder, index) =>
        folder === path ? (
          <BrowserColumn
            key={folder}
            path={path}
            entries={props.entries}
            active={navigation.activeDirectory() === path}
            onActivate={() => navigation.activate(path)}
          >
            <ListViewCompact props={{ ...props, ancestorPath: navigation.trail[index + 1] }} />
          </BrowserColumn>
        ) : (
          <Column key={folder} path={folder} props={props} navigation={navigation} />
        ),
      )}
      {selected && (
        // the width is the plane's, whichever folder the file is in
        <PreviewColumn paneID={props.paneID} path={selected.path}>
          <HeldPreview path={selected.path} {...activity} />
        </PreviewColumn>
      )}
    </div>
  );
}
/** A Gallery strip item, memoized with stable actions like Grid tiles and list rows. */
const GalleryItem = memo(function GalleryItem({
  entry,
  left,
  selected,
  section,
  actions,
}: {
  entry: FileEntry;
  left: number;
  selected: boolean;
  section?: string;
  actions: Pick<FileViewProps, 'select' | 'open' | 'context' | 'drag' | 'paneID'>;
}) {
  return (
    <div className="gallery-item-container" style={{ position: 'absolute', left, height: '100%' }}>
      <button
        className={`gallery-item ${selected ? 'is-selected' : ''}`}
        style={{ height: '100%' }}
        data-file-path={entry.path}
        data-directory-path={browsable(entry) ? entry.path : undefined}
        aria-selected={selected}
        role="option"
        onClick={(event) => actions.select(entry, event)}
        onDoubleClick={(event) =>
          actions.open(entry, event.altKey || event.metaKey || event.ctrlKey)
        }
        onContextMenu={(event) => actions.context(entry, event)}
        draggable
        onDragStart={(event) => actions.drag(entry, event)}
      >
        <Thumbnail entry={entry} />
        <FileName name={entry.name} />
      </button>
      {section && (
        <span className="gallery-section" title={section}>
          {section}
        </span>
      )}
      <LinkedPlaneButton paneID={actions.paneID} entry={entry} />
    </div>
  );
});
export function GalleryView(props: FileViewProps) {
  const actions = useRowActions(props);
  const itemActions = useMemo(
    () => ({ ...actions, paneID: props.paneID }),
    [actions, props.paneID],
  );
  const activity = useContext(PreviewActivity);
  const current = props.entries.find((entry) => entry.path === props.cursor);
  const selected = useViewPreview(props.paneID, current);
  const starts = useMemo(() => {
    const map = new Map<number, ViewSection>();
    let heading: ViewSection | undefined;
    for (const row of sectionRows(props.entries, props.sections))
      if (row.kind === 'header') heading = row.section;
      else if (heading) {
        map.set(row.index, heading);
        heading = undefined;
      }
    return map;
  }, [props.entries, props.sections]);
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    horizontal: true,
    count: props.entries.length,
    getItemKey: (index) => props.entries[index]?.path ?? index,
    getScrollElement: () => scroll.current,
    estimateSize: () => 106,
    overscan: 4,
  });
  useFileReveal(scroll, props.entries, (index) => virtual.scrollToIndex(index, { align: 'auto' }));
  useEffect(() => {
    // the strip follows the cursor, Quick Preview or not
    const index = props.entries.indexOf(current!);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [current, props.entries, virtual]);
  return (
    <div className="gallery-view">
      <div className="gallery-preview" ref={keepPreviewKeys}>
        {selected && previewsAsFile(selected) ? (
          <HeldPreview path={selected.path} {...activity} />
        ) : selected && hasBundleIcon(selected) ? (
          // an application or bundle shows its own icon, as Finder's preview does
          <div className="gallery-bundle">
            <AppIcon entry={selected} size={128} fallback={<Icon name="folder" size={64} />} />
            <strong>{selected.name}</strong>
          </div>
        ) : (
          <Empty
            icon={selected ? (fileFamily(selected) as IconName) : 'image'}
            title={selected?.name || 'Select a file to preview'}
            detail={
              !selected
                ? undefined
                : selected.directory
                  ? 'Double-click to open this folder.'
                  : 'No preview for this kind of file.'
            }
          />
        )}
      </div>
      <div ref={scroll} className="gallery-strip" role="listbox" aria-label="Gallery files">
        <div style={{ width: virtual.getTotalSize(), height: '100%', position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const entry = props.entries[item.index];
            if (!entry) return null;
            return (
              <GalleryItem
                key={entry.path}
                entry={entry}
                left={item.start}
                selected={props.selectionSet.has(entry.path)}
                section={starts.get(item.index)?.label}
                actions={itemActions}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
