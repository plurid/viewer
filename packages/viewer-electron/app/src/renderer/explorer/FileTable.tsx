import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ListColumn, SortKey, UIPreferences } from '../../domain/contracts';
import {
  columnMaximum,
  columnMinimum,
  columnWidth,
  listColumns,
  listLayout,
  visibleListColumns,
} from '../../domain/list-columns';
import { columnCommandIDs } from '../commands/columns';
import {
  activeWorkspace,
  updateFolderPresentation,
  useFolderPresentation,
  changePreferences,
  useViewer,
} from '../state/store';
import { ContextMenu } from '../ui/ContextMenu';
import { measureLocalX, type Point } from '../ui/projectedResize';

/** One grid and horizontal viewport for headers and virtualized folder/search rows. */
export function FileTable({
  paneID,
  children,
  enabled = true,
  sort,
  descending,
  onSort,
}: {
  paneID: string;
  children: ReactNode;
  enabled?: boolean;
  sort?: SortKey;
  descending?: boolean;
  onSort?(column: SortKey): void;
}) {
  const folder = useViewer((state) =>
    activeWorkspace(state).panes.find((pane) => pane.id === paneID),
  );
  const presentation = useFolderPresentation(folder?.type === 'folder' ? folder.path : '');
  const preferences = presentation.list;
  const columns = useMemo(
    () => visibleListColumns(preferences),
    [preferences.visible, preferences.order],
  );
  const table = useRef<HTMLDivElement>(null);
  const resize = useRef<{
    column: ListColumn;
    x: number;
    width: number;
    latest: number;
    before: UIPreferences['list']['widths'];
    localX(point: Point): number | undefined;
  } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const layout = listLayout(columns, preferences.widths);
  const apply = (widths: UIPreferences['list']['widths']) => {
    const value = listLayout(columns, widths);
    table.current?.style.setProperty('--file-columns', value.template);
    table.current?.style.setProperty('--file-minimum', value.minimum + 'px');
  };
  const save = (column: ListColumn, width: number) =>
    folder?.type === 'folder'
      ? updateFolderPresentation(folder.path, {
          list: { widths: { ...preferences.widths, [column]: width } },
        })
      : changePreferences((ui) => ({
          ...ui,
          list: { ...ui.list, widths: { ...ui.list.widths, [column]: width } },
        }));
  useEffect(() => {
    const head = table.current?.querySelector<HTMLElement>('.file-head');
    if (head)
      table.current?.style.setProperty('--file-gutter', head.offsetWidth - head.clientWidth + 'px');
  }, [enabled]);
  if (!enabled) return children;
  return (
    <div
      className="file-table"
      ref={table}
      data-wrap-names={preferences.wrapNames}
      style={
        {
          '--file-columns': layout.template,
          '--file-minimum': layout.minimum + 'px',
        } as CSSProperties
      }
    >
      <div className="file-table-content">
        <div
          className="file-head"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          {columns.map((column) => {
            const definition = listColumns.find((item) => item.id === column)!;
            return (
              <div
                className="file-heading"
                data-column={column}
                key={column}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('application/x-viewer-column'))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  const moved = event.dataTransfer.getData(
                    'application/x-viewer-column',
                  ) as ListColumn;
                  if (
                    !listColumns.some((column) => column.id === moved) ||
                    moved === 'name' ||
                    column === 'name'
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const order = visibleListColumns(preferences).filter((item) => item !== moved);
                  order.splice(order.indexOf(column), 0, moved);
                  if (folder?.type === 'folder')
                    updateFolderPresentation(folder.path, { list: { ...preferences, order } });
                }}
              >
                {onSort ? (
                  <button
                    className="column-label"
                    draggable={column !== 'name'}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-viewer-column', column);
                      event.dataTransfer.effectAllowed = 'move';
                      event.stopPropagation();
                    }}
                    onClick={() => onSort(column)}
                  >
                    {definition.label} {sort === column && (descending ? '↓' : '↑')}
                  </button>
                ) : (
                  <span className="column-label">{definition.label}</span>
                )}
                <button
                  type="button"
                  className="column-resizer"
                  role="separator"
                  aria-label={`Resize ${definition.label} column`}
                  aria-orientation="vertical"
                  aria-valuemin={columnMinimum(column)}
                  aria-valuemax={columnMaximum(column)}
                  aria-valuenow={preferences.widths[column] || undefined}
                  title="Drag to resize; double-click to reset"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={() => save(column, definition.width)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const width = event.currentTarget.parentElement!.offsetWidth;
                    save(
                      column,
                      event.key === 'Home'
                        ? columnMinimum(column)
                        : event.key === 'End'
                          ? columnMaximum(column)
                          : columnWidth(
                              column,
                              width +
                                (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10),
                            ),
                    );
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !table.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const localX = measureLocalX(table.current);
                    const x = localX({ x: event.clientX, y: event.clientY });
                    if (x === undefined) return;
                    const width = event.currentTarget.parentElement!.offsetWidth;
                    resize.current = {
                      column,
                      x,
                      width,
                      latest: width,
                      before: preferences.widths,
                      localX,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    event.currentTarget.focus({ preventScroll: true });
                  }}
                  onPointerMove={(event) => {
                    const drag = resize.current;
                    if (!drag) return;
                    event.stopPropagation();
                    const x = drag.localX({ x: event.clientX, y: event.clientY });
                    if (x === undefined) return;
                    drag.latest = columnWidth(column, drag.width + x - drag.x);
                    apply({ ...drag.before, [column]: drag.latest });
                    event.currentTarget.setAttribute('aria-valuenow', String(drag.latest));
                  }}
                  onPointerUp={() => {
                    const drag = resize.current;
                    resize.current = null;
                    if (drag) save(drag.column, drag.latest);
                  }}
                  onPointerCancel={() => {
                    const drag = resize.current;
                    resize.current = null;
                    if (drag) apply(drag.before);
                  }}
                />
              </div>
            );
          })}
        </div>
        {children}
      </div>
      {menu && (
        <ContextMenu
          position={menu}
          request={{ paneID, ids: columnCommandIDs }}
          label="List columns"
          onClose={() => setMenu(undefined)}
        />
      )}
    </div>
  );
}
