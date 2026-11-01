import {
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import type { FileAccess } from '../files/file-access';
import { windowDialogs } from './window-dialogs';

/** OS panels remain the source of sandbox bookmarks and an explicit escape hatch. */
export async function openDialog(window: BrowserWindow | undefined, options: OpenDialogOptions) {
  const owner = !options.securityScopedBookmarks && windowDialogs(window);
  if (owner) {
    const result = await owner.open(options);
    if (result) return result;
  }
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}
export async function saveDialog(
  window: BrowserWindow | undefined,
  options: SaveDialogOptions,
  overwrite = false,
) {
  const owner = !options.securityScopedBookmarks && windowDialogs(window);
  if (owner) {
    const result = await owner.save(options, overwrite);
    if (result) return result;
  }
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

/** The grants a native panel's choice carries into Viewer. */
export type DialogAccess = Pick<FileAccess, 'scoped' | 'remember' | 'allowOnce' | 'require'>;
type OpenOptions = Omit<OpenDialogOptions, 'securityScopedBookmarks'>;
type SaveOptions = Omit<SaveDialogOptions, 'securityScopedBookmarks'>;

/** One file or folder, saved as a permission for later sessions. */
export async function chooseRemembered(
  access: DialogAccess,
  window: BrowserWindow,
  options: OpenOptions,
  directory: boolean,
): Promise<string | undefined> {
  const result = await openDialog(window, {
    ...options,
    securityScopedBookmarks: access.scoped,
  });
  const chosen = result.filePaths[0];
  if (result.canceled || !chosen) return;
  await access.remember(chosen, directory, result.bookmarks?.[0]);
  return chosen;
}

/** Several files, each saved as a permission; a choice over the limit is refused before any is. */
export async function chooseRememberedFiles(
  access: DialogAccess,
  window: BrowserWindow,
  options: Omit<OpenOptions, 'properties'>,
  limit: { count: number; message: string },
): Promise<string[]> {
  const result = await openDialog(window, {
    ...options,
    properties: ['openFile', 'multiSelections'],
    securityScopedBookmarks: access.scoped,
  });
  if (result.canceled) return [];
  if (result.filePaths.length > limit.count) throw new Error(limit.message);
  for (const [index, file] of result.filePaths.entries())
    await access.remember(file, false, result.bookmarks?.[index]);
  return result.filePaths;
}

/** One file to read, such as an import: allowed for this session only. */
export async function openOnce(
  access: DialogAccess,
  window: BrowserWindow | undefined,
  options: Omit<OpenOptions, 'properties'>,
): Promise<string | undefined> {
  const settings: OpenDialogOptions = {
    ...options,
    properties: ['openFile'],
    securityScopedBookmarks: access.scoped,
  };
  const result = await openDialog(window, settings);
  const chosen = result.filePaths[0];
  if (result.canceled || !chosen) return;
  await access.allowOnce(chosen, result.bookmarks?.[0]);
  await access.require([chosen]);
  return chosen;
}

/** One file to write, such as an export: allowed for this session only. */
export async function saveOnce(
  access: DialogAccess,
  window: BrowserWindow | undefined,
  options: SaveOptions,
): Promise<string | undefined> {
  const settings: SaveDialogOptions = { ...options, securityScopedBookmarks: access.scoped };
  const result = await saveDialog(window, settings);
  if (result.canceled || !result.filePath) return;
  await access.allowOnce(result.filePath, result.bookmark);
  await access.require([result.filePath]);
  return result.filePath;
}
