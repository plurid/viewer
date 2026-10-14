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
