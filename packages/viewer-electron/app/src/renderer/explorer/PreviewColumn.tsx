import { useCallback, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Point } from '../ui/projectedResize';
import { measureLocalX } from '../ui/projectedResize';
import { updateFolderPresentation, useFolderPresentation } from '../state/store';
import { keepPreviewKeys } from './selection';

export const previewMinimum = 320;
export const previewMaximum = 1600;
const previewDefault = 360;
const previewWidth = (width: number) =>
  Math.round(Math.max(previewMinimum, Math.min(previewMaximum, width)));

/**
 * THE COLUMNS PREVIEW, as Finder's: it takes the room the list columns leave, at least the width
 * the person gave it, remembered per folder as the columns' own widths are. Its divider resizes it
 * by pointer or keys; the strip scrolls when it is wider than the plane.
 */
export function PreviewColumn({
  folder,
  path,
  children,
}: {
  folder: string;
  path: string;
  children: ReactNode;
}) {
  const preferences = useFolderPresentation(folder);
  const width = preferences.previewWidth ?? previewDefault;
  const column = useRef<HTMLDivElement>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    column.current = element;
    return keepPreviewKeys(element);
  }, []);
  const drag = useRef<{
    start: number;
    width: number;
    latest: number;
    localX(point: Point): number | undefined;
  }>(null);
  const save = (value: number) =>
    updateFolderPresentation(folder, { previewWidth: previewWidth(value) });
  return (
    <div
      className="column-preview"
      ref={attach}
      role="region"
      aria-label="File preview"
      data-preview-path={path}
      style={{ '--preview-width': `${width}px` } as CSSProperties}
    >
      {children}
      <button
        className="browser-column-resizer"
        role="separator"
        aria-label="Resize preview column"
        aria-orientation="vertical"
        aria-valuemin={previewMinimum}
        aria-valuemax={previewMaximum}
        aria-valuenow={width}
        title="Drag to resize preview; double-click to reset"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={() => save(previewDefault)}
        onKeyDownCapture={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          save(
            event.key === 'Home'
              ? previewMinimum
              : event.key === 'End'
                ? previewMaximum
                : (column.current?.offsetWidth || width) +
                  (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10),
          );
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !column.current) return;
          event.preventDefault();
          event.stopPropagation();
          const localX = measureLocalX(column.current.parentElement!);
          const start = localX({ x: event.clientX, y: event.clientY });
          if (start === undefined) return;
          const shown = column.current.offsetWidth;
          drag.current = { start, width: shown, latest: shown, localX };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          event.stopPropagation();
          const x = current.localX({ x: event.clientX, y: event.clientY });
          if (x === undefined) return;
          current.latest = previewWidth(current.width + x - current.start);
          column.current?.style.setProperty('--preview-width', `${current.latest}px`);
          event.currentTarget.setAttribute('aria-valuenow', String(current.latest));
        }}
        onPointerUp={() => {
          const current = drag.current;
          drag.current = null;
          if (current) save(current.latest);
        }}
        onPointerCancel={() => {
          drag.current = null;
          column.current?.style.setProperty('--preview-width', `${width}px`);
        }}
      />
    </div>
  );
}
