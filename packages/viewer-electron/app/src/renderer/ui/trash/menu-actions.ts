import type { TrashItem } from '../../../domain/files/trash';
import type { MenuAction } from './items';

export interface TrashMenuHandlers {
  go(id: string): void;
  showPreview(ids: string[]): void;
  /** Runs one action at a time, reporting its error and refreshing afterwards. */
  act(work: () => Promise<unknown>): void;
  restore(ids: string[], destination: 'original' | 'choose'): Promise<boolean>;
  openOriginal(item: TrashItem): Promise<void>;
  information(item: TrashItem): void;
}
/** Context menu actions for the chosen Trash items, offered only where they apply. */
export function trashMenuActions(
  items: readonly TrashItem[],
  ids: string[],
  handlers: TrashMenuHandlers,
): MenuAction[] {
  const [only] = items.length === 1 ? items : [];
  return items.length
    ? [
        ...(only?.directory
          ? [
              {
                id: 'open-selection',
                label: 'Open folder',
                icon: 'folder' as const,
                run: () => handlers.go(only.id),
              },
            ]
          : []),
        ...(items.some((item) => !item.directory && item.previewable !== false)
          ? [
              {
                id: 'quick-preview',
                label: 'Quick Look',
                icon: 'eye' as const,
                shortcut: 'Space',
                run: () => handlers.showPreview(ids),
              },
            ]
          : []),
        ...(items.every((item) => item.originalPath) && window.viewerNative
          ? [
              {
                id: 'restore',
                label: 'Restore',
                icon: 'restore' as const,
                run: () => handlers.act(() => handlers.restore(ids, 'original')),
              },
            ]
          : []),
        ...(window.viewerNative
          ? [
              {
                id: 'restore-to',
                label: 'Restore to…',
                icon: 'folder' as const,
                run: () => handlers.act(() => handlers.restore(ids, 'choose')),
              },
            ]
          : []),
        {
          id: 'copy-path',
          label: items.length === 1 ? 'Copy Path' : 'Copy Paths',
          icon: 'copy',
          run: () => handlers.act(() => window.viewer.trashCopyPaths(ids)),
        },
        ...(only
          ? [
              ...(only.originalPath
                ? [
                    {
                      id: 'open-original-folder',
                      label: 'Open original folder in plane',
                      icon: 'folder' as const,
                      run: () => handlers.act(() => handlers.openOriginal(only)),
                    },
                  ]
                : []),
              {
                id: 'info',
                label: 'Get Info',
                icon: 'info' as const,
                run: () => handlers.information(only),
              },
            ]
          : []),
      ]
    : [];
}
