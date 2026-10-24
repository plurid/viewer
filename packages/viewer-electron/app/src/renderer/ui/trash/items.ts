import type { FileEntry } from '../../../domain/contracts';
import type { TrashItem } from '../../../domain/files/trash';
import type { IconName } from '../Icon';

/** A Trash item in the shape the shared selection model and file icons expect. */
export const asFile = (item: TrashItem): FileEntry => ({
  path: item.id,
  parent: '',
  name: item.name,
  extension: item.directory ? '' : item.name.split('.').slice(1).at(-1)?.toLowerCase() || '',
  kind: item.directory
    ? 'directory'
    : item.symbolicLink
      ? 'symlink'
      : item.previewable === false
        ? 'other'
        : 'file',
  directory: item.directory,
  size: item.size,
  modified: item.modified || 0,
  created: 0,
  hidden: item.name.startsWith('.'),
  mime: '',
  identity: item.id,
});
export const trashDate = (value?: string | number) => {
  if (!value) return '—';
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? '—' : time.toLocaleDateString();
};
export type MenuAction = {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  run(): void;
};
export const originUnavailable =
  'Viewer has no verified original location for this item. Use Restore to… to choose a folder.';
