import { useEffect, useRef, type DragEvent } from 'react';
import { report } from '../state/store';

export const FILE_DRAG = 'application/x-viewer-files';
export function useFileDrop(directory: () => string | undefined) {
  const highlighted = useRef<HTMLElement | null>(null);
  const clear = () => {
    highlighted.current?.classList.remove('is-drop-target');
    highlighted.current = null;
  };
  useEffect(() => clear, []);
  const target = (event: DragEvent<HTMLElement>) => {
    const element = event.target instanceof Element ? event.target : null;
    const folder = element?.closest<HTMLElement>('[data-directory-path]');
    const column = element?.closest<HTMLElement>('[data-folder-path]');
    return {
      element: folder || column,
      path: folder?.dataset.directoryPath || column?.dataset.folderPath || directory(),
    };
  };
  return {
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!event.dataTransfer.types.includes(FILE_DRAG)) return;
      const destination = target(event);
      if (!destination.path) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
      if (highlighted.current !== destination.element) {
        clear();
        highlighted.current = destination.element || null;
        highlighted.current?.classList.add('is-drop-target');
      }
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) clear();
    },
    onDragEnd: clear,
    onDrop(event: DragEvent<HTMLElement>) {
      if (!event.dataTransfer.types.includes(FILE_DRAG)) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
      const destination = target(event).path;
      if (!destination) return;
      try {
        const sources: unknown = JSON.parse(event.dataTransfer.getData(FILE_DRAG));
        if (
          !Array.isArray(sources) ||
          !sources.length ||
          sources.length > 10000 ||
          sources.some((path) => typeof path !== 'string')
        )
          throw new Error('The dragged file selection could not be read.');
        if (sources.includes(destination)) throw new Error('A folder cannot be moved into itself.');
        void window.viewer
          .operate({ kind: event.altKey ? 'copy' : 'move', sources, destination })
          .catch(report);
      } catch (error) {
        report(error);
      }
    },
  };
}
