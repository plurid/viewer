import { useRef, type ReactNode } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { browserColumnWidth } from '../../domain/preferences/folder-presentation';
import { updateFolderPresentation, useFolderPresentation } from '../state/store';
import { measureLocalX, type Point } from '../ui/projectedResize';
import { baseName } from '../../domain/workspaces/planes';
/** The geometry adapter is shared with list/sidebar resizing; movement never writes React state. */
export function BrowserColumn({
  path,
  entries,
  onActivate,
  children,
}: {
  path: string;
  entries: FileEntry[];
  onActivate(): void;
  children: ReactNode;
}) {
  const preferences = useFolderPresentation(path);
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    width: number;
    latest: number;
    localX(point: Point): number | undefined;
    targets: HTMLElement[];
    widths: number[];
  } | null>(null);
  const commit = (targets: HTMLElement[], width: number) => {
    for (const target of targets)
      updateFolderPresentation(target.dataset.folderPath!, { columnWidth: width });
  };
  return (
    <div
      ref={element}
      className="file-column"
      data-folder-path={path}
      style={{ width: preferences.columnWidth }}
      onPointerDown={onActivate}
    >
      <div className="column-title" title={path}>
        {baseName(path)}
      </div>
      {children}
      <button
        className="browser-column-resizer"
        role="separator"
        aria-label={`Resize ${baseName(path)} browsing column`}
        aria-orientation="vertical"
        aria-valuemin={160}
        aria-valuemax={1600}
        aria-valuenow={preferences.columnWidth}
        title="Drag to resize; Option resizes all columns; double-click to fit names"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          const column = element.current!;
          const canvas = document.createElement('canvas').getContext('2d')!;
          canvas.font = getComputedStyle(column.querySelector('.file-name') || column).font;
          const width = browserColumnWidth(
            entries.reduce(
              (width, entry) => Math.max(width, canvas.measureText(entry.name).width + 88),
              160,
            ),
          );
          commit(
            event.altKey
              ? [...column.parentElement!.querySelectorAll<HTMLElement>('.file-column')]
              : [column],
            width,
          );
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const width =
            event.key === 'Home'
              ? 160
              : event.key === 'End'
                ? 1600
                : browserColumnWidth(
                    preferences.columnWidth +
                      (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10),
                  );
          commit(
            event.altKey
              ? [...element.current!.parentElement!.querySelectorAll<HTMLElement>('.file-column')]
              : [element.current!],
            width,
          );
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const column = element.current!;
          const localX = measureLocalX(column.parentElement!);
          const x = localX({ x: event.clientX, y: event.clientY });
          if (x === undefined) return;
          const targets = event.altKey
            ? [...column.parentElement!.querySelectorAll<HTMLElement>('.file-column')]
            : [column];
          drag.current = {
            x,
            width: column.offsetWidth,
            latest: column.offsetWidth,
            localX,
            targets,
            widths: targets.map((target) => target.offsetWidth),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
        }}
        onPointerMove={(event) => {
          const value = drag.current;
          if (!value) return;
          event.stopPropagation();
          const x = value.localX({ x: event.clientX, y: event.clientY });
          if (x === undefined) return;
          value.latest = browserColumnWidth(value.width + x - value.x);
          for (const target of value.targets) target.style.width = value.latest + 'px';
          event.currentTarget.setAttribute('aria-valuenow', String(value.latest));
        }}
        onPointerUp={() => {
          const value = drag.current;
          drag.current = null;
          if (value) commit(value.targets, value.latest);
        }}
        onPointerCancel={() => {
          const value = drag.current;
          drag.current = null;
          value?.targets.forEach((target, index) => {
            target.style.width = value.widths[index] + 'px';
          });
        }}
      />
    </div>
  );
}
