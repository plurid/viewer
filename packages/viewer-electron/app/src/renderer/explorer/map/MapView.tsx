import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { FileEntry } from '../../../domain/contracts';
import { browsable } from '../../../domain/files/entries';
import {
  emptyLens,
  resolveLens,
  type Lens,
  type LensDocument,
  type LensOp,
  type LensRect,
} from '../../../domain/files/lenses';
import {
  layoutLens,
  MapIndex,
  mapRegionChrome,
  mapTile,
  nearestTile,
  dropRegion,
  placeIn,
  regionAt,
  snap,
  withinGroup,
  type MapDirection,
  type MapRegion,
  type MapTile,
} from '../../../domain/files/lens-layout';
import { measureLocalPoint, type Point } from '../../ui/projectedResize';
import { createLens, editLens } from '../../state/lenses';
import { announce, report, updateFolderPresentation } from '../../state/store';
import { FileIcon, Thumbnail, type FileViewProps } from '../views';
import { useMarquee } from '../marquee';
import { useFileReveal } from '../anchors';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/primitives';
import type { LensPrompt } from '../LensDialogs';

export interface MapControls {
  move(key: string, range: boolean): void;
  nudge(direction: MapDirection, step: number): void;
}
type Gesture =
  | { kind: 'tiles'; paths: ReadonlySet<string>; dx: number; dy: number }
  | { kind: 'region'; id: string | null; dx: number; dy: number }
  | { kind: 'resize'; id: string | null; dw: number; dh: number };
/** Zoom and scroll for this session, by plane and folder. */
const cameras = new Map<string, { zoom: number; left: number; top: number }>();
const margin = 480;
const draft = emptyLens('00000000-0000-4000-8000-000000000000', 'Map');
/** A lens being created for a folder that has none. Edits made before the Map receives it edit it:
 * each created another (“Map 2”, “Map 3”), auto-repeated nudges included. */
const creating = new Map<string, Promise<LensDocument>>();
const directions: Record<string, MapDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * A free arrangement of a folder's items, drawn from one lens: groups are regions, and every
 * item stays where it was put. Dragging changes the lens only; files never move. The first drag
 * in a folder without a lens creates one named “Map”.
 */
export const MapView = memo(function MapView({
  path,
  document,
  listing,
  controls,
  prompt,
  regionContext,
  ...props
}: FileViewProps & {
  path: string;
  document?: LensDocument;
  /** Every item in the folder, so hidden ones still count as present. */
  listing: readonly FileEntry[];
  controls: RefObject<MapControls | null>;
  prompt(prompt: LensPrompt): void;
  regionContext(region: MapRegion, event: MouseEvent): void;
}) {
  const lens: Lens = document?.lens ?? draft;
  const resolved = useMemo(() => {
    const all = resolveLens(lens, listing);
    // Unplaced items fill in the view's own order, shown items only.
    const order = new Map(props.entries.map((entry, index) => [entry.path, index]));
    return {
      ...all,
      sections: all.sections.map((section) => ({
        ...section,
        entries: section.entries
          .filter((entry) => order.has(entry.path))
          .toSorted((a, b) => order.get(a.path)! - order.get(b.path)!),
      })),
    };
  }, [lens, listing, props.entries]);
  const layout = useMemo(() => layoutLens(lens, resolved), [lens, resolved]);
  const index = useMemo(() => new MapIndex(layout), [layout]);
  // Reading order, top to bottom and left to right: a Shift range follows it, as the eye does;
  // it followed the list's order, which the Map does not show.
  const ordered = useMemo(() => layout.tiles.toSorted((a, b) => a.y - b.y || a.x - b.x), [layout]);
  const scope = useMemo(() => ordered.map((tile) => tile.entry), [ordered]);
  const key = `${props.paneID}:${path}`;
  const [zoom, setZoom] = useState(() => cameras.get(key)?.zoom ?? 1);
  const [viewport, setViewport] = useState<LensRect>([0, 0, 1600, 1200]);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [message, setMessage] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const editable = !document || document.writable;

  const measure = () => {
    const element = scroll.current;
    if (!element) return;
    cameras.set(key, { zoom, left: element.scrollLeft, top: element.scrollTop });
    setViewport([
      element.scrollLeft / zoom,
      element.scrollTop / zoom,
      element.clientWidth / zoom,
      element.clientHeight / zoom,
    ]);
  };
  useEffect(() => {
    const element = scroll.current,
      saved = cameras.get(key);
    if (element && saved) {
      element.scrollLeft = saved.left;
      element.scrollTop = saved.top;
    }
    measure();
    // Restore once per folder; measuring follows scrolling and zoom below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(measure, [zoom, layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef({ measure, zoomTo: (_value: number, _anchor?: Point) => {}, zoom });
  const zoomTo = (next: number, anchor?: Point) => {
    const element = scroll.current;
    const value = Math.min(2, Math.max(0.2, Math.round(next * 100) / 100));
    if (!element || value === zoom) return;
    const frame = element.getBoundingClientRect();
    const scale = frame.width / (element.offsetWidth || 1) || 1;
    const x = anchor ? (anchor.x - frame.left) / scale : element.clientWidth / 2,
      y = anchor ? (anchor.y - frame.top) / scale : element.clientHeight / 2;
    const mapX = (element.scrollLeft + x) / zoom,
      mapY = (element.scrollTop + y) / zoom;
    setZoom(value);
    requestAnimationFrame(() => {
      element.scrollLeft = mapX * value - x;
      element.scrollTop = mapY * value - y;
    });
  };
  latest.current = { measure, zoomTo, zoom };
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => latest.current.measure());
    observer.observe(element);
    // Pinch and Command-scroll zoom around the pointer; plain scrolling pans.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const { zoom: current, zoomTo: to } = latest.current;
      to(current * Math.exp(-event.deltaY * 0.01), { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, []);

  useEffect(() => {
    if (document) creating.delete(path);
  }, [document, path]);
  const commit = (ops: LensOp[], label: string, spoken: string) => {
    if (!ops.length) return;
    setMessage(spoken);
    if (document) {
      editLens(path, document.file, ops, label);
      return;
    }
    const pending = creating.get(path);
    if (pending) {
      void pending.then(
        (created) => editLens(path, created.file, ops, label),
        () => {},
      );
      return;
    }
    const created = createLens(path, 'Map', ops, label);
    creating.set(path, created);
    void created
      .then((created) => {
        updateFolderPresentation(path, { lens: created.lens.id });
        announce(
          created.local
            ? 'Created the lens “Map”, kept on this Mac because this folder cannot hold it. ⌘Z undoes it.'
            : 'Created the lens “Map” in this folder’s .viewer folder. Your files did not move. ⌘Z undoes it.',
        );
      })
      .catch((error) => {
        creating.delete(path);
        report(error);
      });
  };
  /** Follows the pointer in map units; measured once per gesture, so rotated planes work. */
  const track = (
    event: PointerEvent,
    move: (delta: Point, point: Point) => void,
    end: (delta: Point, point: Point, moved: boolean) => void,
  ) => {
    const element = content.current;
    if (!element) return;
    const local = measureLocalPoint(element);
    const start = local({ x: event.clientX, y: event.clientY });
    if (!start) return;
    let moved = false,
      last = start;
    const onMove = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const point = local({ x: next.clientX, y: next.clientY });
      if (!point) return;
      last = point;
      if (!moved && Math.hypot(point.x - start.x, point.y - start.y) * zoom < 4) return;
      moved = true;
      next.preventDefault();
      move({ x: point.x - start.x, y: point.y - start.y }, point);
    };
    const onEnd = (ended: globalThis.PointerEvent) => {
      if (ended.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (moved) {
        // The click ending a drag must not change the selection.
        const swallow = (click: globalThis.MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      end({ x: last.x - start.x, y: last.y - start.y }, last, moved && ended.type === 'pointerup');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const onTilePointerDown = (event: PointerEvent<HTMLDivElement>, tile: MapTile) => {
    if (event.button !== 0 || event.ctrlKey) return;
    // Command-drag carries the files themselves, to Finder or another plane.
    if (event.metaKey) {
      event.currentTarget.draggable = true;
      return;
    }
    event.stopPropagation();
    if (!editable) return;
    const selected = props.selectionSet.has(tile.entry.path);
    const paths = new Set(
      selected ? props.selection.filter((item) => layout.byPath.has(item)) : [tile.entry.path],
    );
    track(
      event,
      (delta) => {
        if (!selected)
          props.select(tile.entry, { shiftKey: false, metaKey: false, ctrlKey: false });
        setGesture({ kind: 'tiles', paths, dx: delta.x, dy: delta.y });
      },
      (delta, point, moved) => {
        setGesture(null);
        if (!moved) return;
        // Outside every region on a map with groups, a drop has no group to join: said, rather
        // than ignored.
        const target = dropRegion(layout, point.x, point.y);
        if (!target) {
          announce('Drop items onto a group, or onto Unsorted, to place them.');
          return;
        }
        const ops = [...paths].flatMap((item): LensOp[] => {
          const moving = layout.byPath.get(item);
          return moving
            ? [
                {
                  kind: 'place',
                  name: moving.entry.name,
                  group: target.id,
                  at: placeIn(target, moving.x + delta.x, moving.y + delta.y),
                },
              ]
            : [];
        });
        const count = ops.length === 1 ? `“${tile.entry.name}”` : `${ops.length} items`;
        commit(
          ops,
          target.bare ? `Place ${count}` : `Move ${count} to “${target.name}”`,
          target.bare ? `Placed ${count}` : `Moved ${count} to ${target.name}`,
        );
      },
    );
  };
  const regionGroup = (region: MapRegion) =>
    region.id === null ? undefined : lens.groups.find((group) => group.id === region.id);
  const onRegionPointerDown = (event: PointerEvent<HTMLDivElement>, region: MapRegion) => {
    if (event.button !== 0 || event.ctrlKey || !editable) return;
    event.stopPropagation();
    track(
      event,
      (delta) => setGesture({ kind: 'region', id: region.id, dx: delta.x, dy: delta.y }),
      (delta, point, moved) => {
        setGesture(null);
        if (!moved) return;
        const x = region.x + delta.x,
          y = region.y + delta.y;
        if (region.id === null) {
          commit(
            [
              {
                kind: 'set-lens',
                unsorted: {
                  ...lens.unsorted,
                  rect: [
                    Math.max(0, snap(x)),
                    Math.max(0, snap(y)),
                    region.width,
                    lens.unsorted?.rect?.[3] ?? 0,
                  ],
                },
              },
            ],
            `Move “${region.name}”`,
            `Moved ${region.name}`,
          );
          return;
        }
        const group = regionGroup(region);
        if (!group) return;
        // Dropped inside another group, the region nests there; elsewhere it is top level.
        const host = layout.regions
          .filter(
            (item) =>
              item.id !== null &&
              !item.bare &&
              !withinGroup(lens, item.id, region.id!) &&
              point.x >= item.x &&
              point.x < item.x + item.width &&
              point.y >= item.y &&
              point.y < item.y + item.height,
          )
          .reduce<MapRegion | undefined>(
            (found, item) => (!found || item.depth >= found.depth ? item : found),
            undefined,
          );
        const { parent: _, ...rest } = group;
        commit(
          [
            {
              kind: 'set-group',
              group: {
                ...rest,
                ...(host?.id ? { parent: host.id } : {}),
                rect: [
                  Math.max(0, snap(x - (host?.contentX ?? 0))),
                  Math.max(0, snap(y - (host?.contentY ?? 0))),
                  region.width,
                  group.rect?.[3] ?? 0,
                ],
              },
            },
          ],
          host ? `Move “${region.name}” into “${host.name}”` : `Move “${region.name}”`,
          host ? `Moved ${region.name} into ${host.name}` : `Moved ${region.name}`,
        );
      },
    );
  };
  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>, region: MapRegion) => {
    if (event.button !== 0 || !editable) return;
    event.stopPropagation();
    track(
      event,
      (delta) => setGesture({ kind: 'resize', id: region.id, dw: delta.x, dh: delta.y }),
      (delta, _point, moved) => {
        setGesture(null);
        if (!moved) return;
        const width = Math.max(mapTile.width * 2, snap(region.width + delta.x)),
          height = Math.max(mapTile.height + mapRegionChrome.header, snap(region.height + delta.y));
        const rect: LensRect = [region.local[0], region.local[1], width, height];
        const group = regionGroup(region);
        commit(
          region.id === null
            ? [{ kind: 'set-lens', unsorted: { ...lens.unsorted, rect } }]
            : group
              ? [{ kind: 'set-group', group: { ...group, rect } }]
              : [],
          `Resize “${region.name}”`,
          `Resized ${region.name}`,
        );
      },
    );
  };

  const marquee = useMarquee(
    scroll,
    content,
    (rect) =>
      index
        .query([rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top])
        .map((tile) => tile.entry),
    props.region,
    props.selection,
  );
  const reveal = (tile: MapTile | undefined) => {
    const element = scroll.current;
    if (!tile || !element) return;
    const left = tile.x * zoom,
      top = tile.y * zoom;
    if (
      left < element.scrollLeft ||
      left + mapTile.width * zoom > element.scrollLeft + element.clientWidth
    )
      element.scrollLeft = left - element.clientWidth / 2;
    if (
      top < element.scrollTop ||
      top + mapTile.height * zoom > element.scrollTop + element.clientHeight
    )
      element.scrollTop = top - element.clientHeight / 2;
  };
  useFileReveal(scroll, props.entries, (position) =>
    reveal(layout.byPath.get(props.entries[position]?.path ?? '')),
  );
  // The cursor is followed wherever it moves from, as the list and grid follow it: type-to-select
  // left the Map where it was.
  useEffect(() => reveal(layout.byPath.get(props.cursor ?? '')), [props.cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  controls.current = {
    move: (key, range) => {
      const direction = directions[key];
      const tile = direction
        ? nearestTile(layout, props.cursor, direction)
        : key === 'Home'
          ? ordered[0]
          : key === 'End'
            ? ordered.at(-1)
            : undefined;
      if (!tile) return;
      props.select(tile.entry, { shiftKey: range, metaKey: false, ctrlKey: false }, scope);
      reveal(tile);
    },
    nudge: (direction, step) => {
      if (!editable) return;
      const tiles = props.selection.flatMap((item) => layout.byPath.get(item) ?? []);
      const [dx, dy] =
        direction === 'left'
          ? [-step, 0]
          : direction === 'right'
            ? [step, 0]
            : direction === 'up'
              ? [0, -step]
              : [0, step];
      commit(
        tiles.map((tile): LensOp => ({
          kind: 'place',
          name: tile.entry.name,
          group: tile.group,
          at: [Math.max(0, tile.local[0] + dx), Math.max(0, tile.local[1] + dy)],
        })),
        'Nudge',
        `Nudged ${tiles.length === 1 ? tiles[0]!.entry.name : `${tiles.length} items`}`,
      );
    },
  };

  // Regions moving with a gesture carry their nested regions and items.
  const moving = useMemo(() => {
    if (gesture?.kind !== 'region') return new Set<string | null>();
    if (gesture.id === null) return new Set<string | null>([null]);
    return new Set<string | null>(
      lens.groups
        .filter((group) => withinGroup(lens, group.id, gesture.id!))
        .map((group) => group.id),
    );
  }, [gesture, lens]);
  const offset = (group: string | null) =>
    gesture?.kind === 'region' && moving.has(group) ? { x: gesture.dx, y: gesture.dy } : undefined;
  const detail = zoom >= 0.5 ? 'full' : zoom >= 0.3 ? 'icons' : 'summary';
  const shown = useMemo(() => {
    const [x, y, width, height] = viewport;
    const found = new Set(index.query([x - 240, y - 240, width + 480, height + 480]));
    for (const item of [...props.selection, props.cursor ?? ''])
      if (layout.byPath.has(item)) found.add(layout.byPath.get(item)!);
    return [...found];
  }, [index, viewport, props.selection, props.cursor, layout]);

  return (
    <div className="map-view">
      <div
        ref={scroll}
        className="file-scroll map-scroll"
        role="listbox"
        aria-label={`Map of ${lens.name}`}
        aria-multiselectable="true"
        onScroll={measure}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[data-map-handle]')) return;
          marquee.onPointerDown(event);
        }}
        onDoubleClick={(event) => {
          if (!editable || (event.target as Element).closest('[data-file-path], [data-map-handle]'))
            return;
          const point =
            content.current &&
            measureLocalPoint(content.current)({ x: event.clientX, y: event.clientY });
          if (!point) return;
          const host = regionAt(layout, point.x, point.y);
          prompt({
            kind: 'new-group',
            folder: path,
            document,
            ...(host?.id ? { parent: host.id } : {}),
            rect: [
              Math.max(0, snap(point.x - (host?.id ? host.contentX : 0))),
              Math.max(0, snap(point.y - (host?.id ? host.contentY : 0))),
              mapTile.width * 3 + mapRegionChrome.padding * 2 + 16,
              0,
            ],
          });
        }}
      >
        <div
          className="map-stage"
          style={{ width: (layout.width + margin) * zoom, height: (layout.height + margin) * zoom }}
        >
          <div
            ref={content}
            className={`map-content detail-${detail}`}
            style={{
              width: layout.width + margin,
              height: layout.height + margin,
              transform: `scale(${zoom})`,
            }}
          >
            {layout.regions.map((region) => {
              const shift = offset(region.id);
              const resizing =
                gesture?.kind === 'resize' && gesture.id === region.id ? gesture : undefined;
              if (region.bare) return null;
              return (
                <div
                  key={region.id ?? 'unsorted'}
                  className={`map-region depth-${Math.min(region.depth, 3)} ${region.id === null ? 'is-unsorted' : ''} ${shift ? 'is-moving' : ''}`}
                  role="presentation"
                  title={`${region.name}: ${region.count.toLocaleString()} ${region.count === 1 ? 'item' : 'items'}`}
                  style={{
                    left: region.x + (shift?.x ?? 0),
                    top: region.y + (shift?.y ?? 0),
                    width: region.width + (resizing?.dw ?? 0),
                    height: region.height + (resizing?.dh ?? 0),
                  }}
                >
                  <div
                    className="map-region-header"
                    data-map-handle
                    onPointerDown={(event) => onRegionPointerDown(event, region)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      regionContext(region, event);
                    }}
                  >
                    <Icon name={region.id === null ? 'list' : 'lens'} size={13} />
                    <span>{region.name}</span>
                    <small>{region.count.toLocaleString()}</small>
                  </div>
                  {detail === 'summary' && (
                    <div className="map-region-summary" aria-hidden="true">
                      {region.count.toLocaleString()}
                    </div>
                  )}
                  {editable && (
                    <div
                      className="map-region-resize"
                      data-map-handle
                      aria-hidden="true"
                      onPointerDown={(event) => onResizePointerDown(event, region)}
                    />
                  )}
                </div>
              );
            })}
            {shown.map((tile) => {
              // At summary detail the regions show counts; the cursor and the selection stay, as
              // icons, so Open and Reveal find their tile (2026-10-20: below 30% zoom, Open from the
              // keyboard failed, “no longer visible in this view”).
              if (
                detail === 'summary' &&
                props.cursor !== tile.entry.path &&
                !props.selectionSet.has(tile.entry.path)
              )
                return null;
              const dragged = gesture?.kind === 'tiles' && gesture.paths.has(tile.entry.path);
              const carried =
                offset(tile.group) ?? (dragged ? { x: gesture.dx, y: gesture.dy } : undefined);
              const selected = props.selectionSet.has(tile.entry.path);
              return (
                <div
                  key={tile.entry.path}
                  className={`map-tile ${selected ? 'is-selected' : ''} ${dragged ? 'is-dragging' : ''} ${props.cursor === tile.entry.path ? 'is-cursor' : ''}`}
                  role="option"
                  aria-selected={selected}
                  aria-label={tile.entry.name}
                  title={tile.entry.path}
                  data-file-path={tile.entry.path}
                  data-directory-path={browsable(tile.entry) ? tile.entry.path : undefined}
                  style={{ left: tile.x + (carried?.x ?? 0), top: tile.y + (carried?.y ?? 0) }}
                  onPointerDown={(event) => onTilePointerDown(event, tile)}
                  onPointerUp={(event) => {
                    event.currentTarget.draggable = false;
                  }}
                  onClick={(event) => props.select(tile.entry, event, scope)}
                  onDoubleClick={(event) =>
                    props.open(tile.entry, event.altKey || event.metaKey || event.ctrlKey)
                  }
                  onContextMenu={(event) => props.context(tile.entry, event)}
                  onDragStart={(event) => props.drag(tile.entry, event)}
                  onDragEnd={(event) => {
                    event.currentTarget.draggable = false;
                  }}
                >
                  <div className="map-tile-preview">
                    {detail === 'full' ? (
                      <Thumbnail entry={tile.entry} />
                    ) : (
                      <FileIcon entry={tile.entry} size={36} />
                    )}
                  </div>
                  {detail === 'full' && <span className="map-tile-name">{tile.entry.name}</span>}
                </div>
              );
            })}
            {marquee.overlay}
          </div>
        </div>
      </div>
      <div className="map-toolbar" role="toolbar" aria-label="Map zoom">
        <IconButton icon="down" label="Zoom out" onClick={() => zoomTo(zoom / 1.25)} />
        <button className="map-zoom-value" title="Actual size" onClick={() => zoomTo(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon="up" label="Zoom in" onClick={() => zoomTo(zoom * 1.25)} />
        <IconButton
          icon="frame"
          label="Fit map"
          onClick={() => {
            const element = scroll.current;
            if (!element || !layout.width) return;
            zoomTo(
              Math.min(
                element.clientWidth / (layout.width + 48),
                element.clientHeight / (layout.height + 48),
                1,
              ),
            );
            requestAnimationFrame(() => {
              element.scrollLeft = 0;
              element.scrollTop = 0;
            });
          }}
        />
      </div>
      {!editable && (
        <p className="map-readonly" role="status">
          This folder cannot be changed, so its map is read-only here.
        </p>
      )}
      <div className="visually-hidden" aria-live="polite">
        {message}
      </div>
    </div>
  );
});
