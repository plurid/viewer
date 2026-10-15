// Transient window state: Quick Look and the file clipboard.
import { focusFiles } from '../workspace/sessions';
import { getState, update } from './core';

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
