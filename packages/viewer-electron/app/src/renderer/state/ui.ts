// Transient window state: Quick Look, the file clipboard and copied text.
import { focusFiles } from '../workspace/sessions';
import { getState, update } from './core';
import { noteFirstRunStep } from './preferences';

export function quickPreview(
  paths: string | string[] | null,
  origin?: { paneID?: string; workspaceID: string },
): void {
  const old = getState().quickPreview;
  update({
    ...getState(),
    quickPreview: paths
      ? {
          paths: typeof paths === 'string' ? [paths] : paths,
          index: 0,
          paneID: origin?.paneID ?? getState().activePane,
          workspaceID: origin?.workspaceID ?? getState().saved.activeWorkspace,
        }
      : null,
  });
  if (!paths && old?.paneID) focusFiles(old.paneID);
  if (paths) noteFirstRunStep('quick-preview');
}
export function stepQuickPreview(delta: number): void {
  const quick = getState().quickPreview;
  if (quick)
    update({
      ...getState(),
      quickPreview: {
        ...quick,
        index: (quick.index + delta + quick.paths.length) % quick.paths.length,
      },
    });
}
/** Background discovery must not block navigation or retain stale copied items.
 * An actual Paste uses strict refresh and reports the native access failure. */
export async function refreshClipboard(quiet = false): Promise<void> {
  try {
    const clipboard = await window.viewer.clipboardRead();
    update({ ...getState(), clipboard });
  } catch (error) {
    update({ ...getState(), clipboard: null });
    if (!quiet) throw error;
  }
}
export async function writeFileClipboard(paths: string[], cut: boolean): Promise<void> {
  await window.viewer.clipboardWrite(paths, cut);
  update({ ...getState(), clipboard: { paths, cut } });
}
/**
 * Copied text replaces a copied or cut file on the pasteboard, so Paste is read again. Settings
 * keeps no workspace state and offers no Paste.
 */
async function afterTextCopy(): Promise<void> {
  if (getState()) await refreshClipboard(true);
}
/** Copies paths as text, one per line, through the desktop pasteboard. */
export async function copyPaths(paths: readonly string[]): Promise<void> {
  await window.viewer.copyPaths([...paths]);
  await afterTextCopy();
}
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  await afterTextCopy();
}
