import { useCallback, useEffect, useMemo, useRef, type DragEvent } from 'react';
import type { FileEntry } from '../../domain/contracts';
import { report } from '../state/store';
import { DragAutoScroll, SpringHover, type DragPoint } from './drag-navigation';

export const FILE_DRAG = 'application/x-viewer-files';
const accepts = (event: DragEvent<HTMLElement>) =>
  event.dataTransfer.types.includes(FILE_DRAG) || event.dataTransfer.types.includes('Files');
interface SpringFolders {
  open(path: string, valid: () => boolean): Promise<void>;
  finish(dropped?: boolean): void;
}
const scrollable = '.file-scroll, .file-table, .columns-view, .gallery-strip';
/**
 * A drag Viewer started itself, which reaches its own planes as a native drag with no Viewer data:
 * the devices of its items, so a drop's cursor shows the move a same-device transfer performs, and
 * the copy another device gets. Every such drag showed the copy cursor. It ends with
 * the drag, or once no plane has seen it for a moment.
 */
let started: { devices: ReadonlySet<string>; seen: number } | undefined;
const devices = new Map<string, string>();
const device = (identity: string) => identity.slice(0, identity.indexOf(':'));
export function rememberDrag(entries: readonly FileEntry[]): void {
  devices.clear();
  started = entries.length
    ? { devices: new Set(entries.map((entry) => device(entry.identity))), seen: performance.now() }
    : undefined;
}
/** What a plain drop of Viewer's own drag on `folder` does, once that folder's device is known. */
function startedEffect(folder: string): 'move' | 'copy' | undefined {
  if (!started || performance.now() - started.seen > 1500) return undefined;
  started.seen = performance.now();
  if (!devices.has(folder)) {
    devices.set(folder, '');
    void window.viewer.stat(folder).then(
      (entry) => devices.set(folder, device(entry.identity)),
      () => devices.delete(folder),
    );
    return undefined;
  }
  const destination = devices.get(folder);
  if (!destination) return undefined;
  return [...started.devices].every((value) => value === destination) ? 'move' : 'copy';
}
export function useFileDrop(directory: () => string | undefined, navigation?: SpringFolders) {
  const live = useRef({ directory, navigation });
  live.current = { directory, navigation };
  const highlighted = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const pointer = useRef<DragPoint | undefined>(undefined);
  const activity = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const paint = useCallback((element: HTMLElement | null) => {
    if (highlighted.current === element) return;
    highlighted.current?.classList.remove('is-drop-target');
    highlighted.current = element;
    element?.classList.add('is-drop-target');
  }, []);
  const target = useCallback((element: Element | null) => {
    if (!element || !root.current?.contains(element))
      return { element: null, path: undefined, folder: undefined };
    const folder = element?.closest<HTMLElement>('[data-directory-path]');
    const column = element?.closest<HTMLElement>('[data-folder-path]');
    return {
      element: folder || column,
      path: folder?.dataset.directoryPath || column?.dataset.folderPath || live.current.directory(),
      folder: folder?.dataset.directoryPath,
    };
  }, []);
  const hover = useMemo(
    () =>
      new SpringHover(async (path, valid) => {
        const navigation = live.current.navigation;
        const owns = () => {
          const point = pointer.current;
          return (
            valid() &&
            !!point &&
            navigation === live.current.navigation &&
            target(document.elementFromPoint(point.x, point.y)).folder === path
          );
        };
        if (owns()) await navigation?.open(path, owns);
      }),
    [target],
  );
  const scrolling = useMemo(
    () =>
      new DragAutoScroll(
        (point) => {
          const origin = root.current;
          const hit = document.elementFromPoint(point.x, point.y);
          if (!origin || !hit || !origin.contains(hit)) return [];
          const targets = [];
          let element = hit.closest<HTMLElement>(scrollable);
          while (element && origin.contains(element)) {
            const scroll = element;
            const bounds = scroll.getBoundingClientRect();
            targets.push({
              left: bounds.left,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
              width: scroll.clientWidth,
              height: scroll.clientHeight,
              scrollLeft: scroll.scrollLeft,
              scrollTop: scroll.scrollTop,
              scrollWidth: scroll.scrollWidth,
              scrollHeight: scroll.scrollHeight,
              scroll: (x: number, y: number) => {
                scroll.scrollLeft += x;
                scroll.scrollTop += y;
              },
            });
            element = scroll.parentElement?.closest<HTMLElement>(scrollable) ?? null;
          }
          return targets;
        },
        () => {
          // A scrolling row is not a stationary spring-loading target.
          hover.cancel();
          const point = pointer.current;
          if (point) paint(target(document.elementFromPoint(point.x, point.y)).element);
        },
      ),
    [hover, paint, target],
  );
  const clear = useCallback(
    (dropped = false) => {
      clearTimeout(activity.current);
      activity.current = undefined;
      hover.cancel();
      scrolling.stop();
      paint(null);
      pointer.current = undefined;
      root.current = null;
      live.current.navigation?.finish(dropped);
    },
    [hover, scrolling, paint],
  );
  useEffect(() => {
    const cancel = () => clear();
    const ended = () => {
      started = undefined;
      cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    const outside = (event: globalThis.DragEvent) => {
      if (!root.current?.contains(event.target as Node)) cancel();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('dragend', ended);
    window.addEventListener('drop', outside, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearTimeout(activity.current);
      activity.current = undefined;
      hover.cancel();
      scrolling.stop();
      paint(null);
      root.current = null;
      pointer.current = undefined;
      navigation?.finish();
      window.removeEventListener('dragend', ended);
      window.removeEventListener('drop', outside, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [clear, hover, scrolling, paint, navigation]);
  return {
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!accepts(event)) {
        clear();
        return;
      }
      root.current = event.currentTarget;
      const destination = target(event.target instanceof Element ? event.target : null);
      if (!destination.path) return;
      event.preventDefault();
      event.stopPropagation();
      // External sources can disappear without delivering dragend to this window.
      // Live native drags send dragover repeatedly; lost activity expires safely.
      clearTimeout(activity.current);
      activity.current = setTimeout(() => clear(), 1200);
      event.dataTransfer.dropEffect = event.altKey
        ? 'copy'
        : event.metaKey || event.dataTransfer.types.includes(FILE_DRAG)
          ? 'move'
          : (startedEffect(destination.path) ?? 'copy');
      pointer.current = { x: event.clientX, y: event.clientY };
      paint(destination.element);
      hover.hover(navigation ? destination.folder : undefined);
      scrolling.move(pointer.current);
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      // Replaced virtual rows do not own cancellation. A genuine native leave
      // may retain the last pointer coordinates and have no relatedTarget.
      if (event.target instanceof Node && !event.target.isConnected) return;
      clear();
    },
    onDragEnd: () => clear(),
    async onDrop(event: DragEvent<HTMLElement>) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      root.current = event.currentTarget;
      const destination = target(event.target instanceof Element ? event.target : null).path;
      clearTimeout(activity.current);
      activity.current = undefined;
      // Inspect native file objects only after an explicit drop, never on hover.
      hover.cancel();
      scrolling.stop();
      paint(null);
      if (!destination) {
        clear();
        return;
      }
      started = undefined;
      const kind = event.altKey ? 'copy' : event.metaKey ? 'move' : 'transfer';
      try {
        const sources: unknown = event.dataTransfer.types.includes(FILE_DRAG)
          ? JSON.parse(event.dataTransfer.getData(FILE_DRAG))
          : await window.viewer.fileDropPaths(Array.from(event.dataTransfer.files));
        if (
          !Array.isArray(sources) ||
          !sources.length ||
          sources.length > 10000 ||
          sources.some((path) => typeof path !== 'string')
        )
          throw new Error('The dragged file selection could not be read.');
        if (sources.includes(destination)) throw new Error('A folder cannot be moved into itself.');
        clear(true);
        void window.viewer.operate({ kind, sources, destination }).catch(report);
      } catch (error) {
        clear();
        report(error);
      }
    },
  };
}
