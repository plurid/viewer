export const trashLocation = 'viewer://trash';
export type DesktopPlatform = 'darwin' | 'win32' | 'linux';
export const trashName = (platform: DesktopPlatform) =>
  platform === 'win32' ? 'Recycle Bin' : 'Trash';
export interface TrashItem {
  id: string;
  name: string;
  directory: boolean;
  size: number;
  location: string;
  originalPath?: string;
  deleted?: string;
  /** macOS directory-entry metadata, distinct from a recorded deletion time. */
  addedToTrash?: string;
  modified?: number;
  previewable?: boolean;
  symbolicLink?: boolean;
}
export interface TrashLocation {
  id: string;
  name: string;
  state: 'ready' | 'unavailable';
  message?: string;
  canRequestAccess?: boolean;
  access?: 'privacy' | 'folder';
}
export interface TrashSnapshot {
  revision: string;
  items: TrashItem[];
  locations: TrashLocation[];
  truncated: boolean;
  canEmpty: boolean;
  /** Breadcrumbs below the system Trash. Emptying always reviews the whole Trash. */
  ancestors?: TrashItem[];
  totalItems?: number;
}
export interface TrashRestoreResult {
  restored: number;
  cancelled: boolean;
}
export interface TrashOrigin {
  file: string;
  originalPath: string;
  identity: string;
}
export type TrashSortKey = 'name' | 'originalPath' | 'date' | 'size';
export function trashDateColumn(items: readonly TrashItem[]): 'deleted' | 'added' | undefined {
  if (items.some((item) => item.deleted && Number.isFinite(Date.parse(item.deleted))))
    return 'deleted';
  if (items.some((item) => item.addedToTrash && Number.isFinite(Date.parse(item.addedToTrash))))
    return 'added';
}
/** Keep unknown metadata last in either direction and use natural filename order. */
export function sortTrashItems(
  items: readonly TrashItem[],
  key: TrashSortKey,
  descending: boolean,
  dateKind = trashDateColumn(items),
): TrashItem[] {
  const direction = descending ? -1 : 1;
  const compare = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const value = (item: TrashItem): string | number | undefined => {
    if (key === 'name') return item.name;
    if (key === 'originalPath')
      return item.originalPath ? originalTrashFolder(item.originalPath) : undefined;
    if (key === 'size') return item.directory ? undefined : item.size;
    const time = dateKind === 'deleted' ? item.deleted : item.addedToTrash;
    return time && Number.isFinite(Date.parse(time)) ? Date.parse(time) : undefined;
  };
  return items.toSorted((a, b) => {
    const first = value(a),
      second = value(b);
    if (first === undefined || second === undefined) {
      if (first !== second) return first === undefined ? 1 : -1;
    } else {
      const order =
        typeof first === 'number' && typeof second === 'number'
          ? first - second
          : compare(String(first), String(second));
      if (order) return order * direction;
    }
    return compare(a.name, b.name) || a.id.localeCompare(b.id);
  });
}
export function originalTrashFolder(file: string): string {
  const clean = file.replace(/[/\\]+$/, '');
  const index = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return index <= 0
    ? file.slice(0, 1)
    : /^[A-Za-z]:$/.test(clean.slice(0, index))
      ? clean.slice(0, index + 1)
      : clean.slice(0, index);
}

/** The public bridge can inspect Trash or display native UI. It cannot empty it. */
export const forbiddenTrashCommands = new Set([
  'empty-trash',
  'trash-empty',
  'empty-recycle-bin',
  'recycle-bin-empty',
  'trash-menu',
  'trash-confirmation',
  'trash-restore',
]);
